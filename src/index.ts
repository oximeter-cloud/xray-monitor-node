import { openSync, readSync, statSync, watch, existsSync, readdirSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";

interface Config {
  monitorUrl: string;
  ingestSecret: string;
  nodeName: string;
  nodeRole: string;
  logPath: string;
  flushIntervalMs: number;
  batchSize: number;
  remnawaveUrl?: string;
  remnawaveToken?: string;
}

interface ConnectionRecord {
  ts: string;
  client_ip: string;
  proto: string;
  dest: string;
  port: number;
  inbound: string;
  outbound: string;
  email: string;
}

const LOG_PATTERN =
  /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?) (?:from )?(?:[a-z0-9]+:)?([^\s]+) accepted ([a-z0-9]+):([^:]+):(\d+) \[([^ \]]+)(?: -> ([^\]]+))?\] email: (\S+)/;

class XrayMonitorNode {
  private config: Config;
  private queue: ConnectionRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private fileOffset = 0;
  private currentFd: number | null = null;
  private currentFilePath = "";
  private isSending = false;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    return {
      monitorUrl: (process.env.MONITOR_URL || "https://monitor.mahdi.im").replace(/\/+$/, ""),
      ingestSecret: process.env.INGEST_SECRET || "oximeter_shared_secret",
      nodeName: process.env.NODE_NAME || hostname() || "Unknown-Node",
      nodeRole: process.env.NODE_ROLE || "BRIDGE",
      logPath: process.env.XRAY_LOG_PATH || "/var/log/xray/current",
      flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS) || 3000,
      batchSize: Number(process.env.BATCH_SIZE) || 150,
      remnawaveUrl: process.env.REMNAWAVE_API_URL,
      remnawaveToken: process.env.REMNAWAVE_API_TOKEN,
    };
  }

  public async start() {
    console.log(`[XrayNode] Starting telemetry agent on ${this.config.nodeName} [${this.config.nodeRole}]...`);
    console.log(`[XrayNode] Monitor Target: ${this.config.monitorUrl}/api/ingest`);

    // Auto-discover identity from Remnawave if credentials provided and role/name not explicitly pinned
    if (this.config.remnawaveUrl && this.config.remnawaveToken) {
      await this.autoDiscoverTopology();
    }

    this.resolveAndTailLog();

    this.flushTimer = setInterval(() => {
      this.flushQueue();
    }, this.config.flushIntervalMs);
  }

  private async autoDiscoverTopology() {
    if (!this.config.remnawaveUrl || !this.config.remnawaveToken) return;
    try {
      const url = `${this.config.remnawaveUrl.replace(/\/+$/, "")}/nodes`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.remnawaveToken}` },
      });
      if (!res.ok) return;

      const data: any = await res.json();
      const nodes: any[] = data.response?.nodes || data.response || [];
      if (!Array.isArray(nodes)) return;

      // Match by local network IP
      const localIps = new Set<string>();
      const ifaces = networkInterfaces();
      for (const list of Object.values(ifaces)) {
        if (!list) continue;
        for (const iface of list) {
          if (!iface.internal) localIps.add(iface.address);
        }
      }

      for (const n of nodes) {
        if (localIps.has(n.address) || n.name?.toLowerCase().includes(hostname().toLowerCase())) {
          this.config.nodeName = n.name;
          const isTunnel = (n.name || "").toLowerCase().includes("tunnel") || (n.name || "").startsWith("IR");
          this.config.nodeRole = isTunnel ? "TUNNEL" : "BRIDGE";
          console.log(`[XrayNode] Auto-detected from Remnawave: Name=${n.name}, Role=${this.config.nodeRole}, Address=${n.address}`);
          break;
        }
      }
    } catch (e: any) {
      console.warn(`[XrayNode] Remnawave auto-discovery skipped: ${e.message}`);
    }
  }

  private resolveAndTailLog() {
    let target = this.config.logPath;

    // Check if target is a directory or doesn't exist yet
    if (!existsSync(target)) {
      // Fallback searches
      const candidates = [
        "/var/log/xray/current",
        "/var/log/xray/access.log",
        "/var/log/xray.log",
      ];
      for (const c of candidates) {
        if (existsSync(c)) {
          target = c;
          break;
        }
      }
    }

    if (!existsSync(target)) {
      console.warn(`[XrayNode] Log file ${target} not found yet. Retrying in 5 seconds...`);
      setTimeout(() => this.resolveAndTailLog(), 5000);
      return;
    }

    try {
      this.currentFilePath = target;
      const stat = statSync(target);
      this.fileOffset = Math.max(0, stat.size - 64 * 1024); // Start near tail to avoid flood on restart
      this.currentFd = openSync(target, "r");
      console.log(`[XrayNode] Tailing log: ${target} (offset: ${this.fileOffset})`);

      this.readNewLines();

      // Watch for changes
      watch(target, () => {
        this.readNewLines();
      });

      // Poll periodically in case file events are missed by inotify
      setInterval(() => {
        this.readNewLines();
      }, 1000);
    } catch (e: any) {
      console.error(`[XrayNode] Error opening log ${target}:`, e.message);
      setTimeout(() => this.resolveAndTailLog(), 5000);
    }
  }

  private readNewLines() {
    if (this.currentFd === null) return;
    try {
      const stat = statSync(this.currentFilePath);
      if (stat.size < this.fileOffset) {
        // File rotated / truncated
        console.log(`[XrayNode] Log rotated, resetting offset to 0`);
        this.fileOffset = 0;
      }

      const diff = stat.size - this.fileOffset;
      if (diff <= 0) return;

      const buf = Buffer.alloc(Math.min(diff, 512 * 1024));
      const bytesRead = readSync(this.currentFd, buf, 0, buf.length, this.fileOffset);
      this.fileOffset += bytesRead;

      const text = buf.toString("utf8", 0, bytesRead);
      const lines = text.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.includes("accepted tcp:")) continue;

        const match = trimmed.match(LOG_PATTERN);
        if (match) {
          const [, ts, client_ip, proto, dest, port, inbound, outbound, email] = match;
          this.queue.push({
            ts,
            client_ip,
            proto,
            dest,
            port: Number(port),
            inbound,
            outbound: outbound || "direct",
            email,
          });

          if (this.queue.length >= this.config.batchSize * 2) {
            this.flushQueue();
          }
        }
      }
    } catch (e: any) {
      // Ignore transient read errors during rotation
    }
  }

  private async flushQueue() {
    if (this.isSending || this.queue.length === 0) return;
    this.isSending = true;

    const batch = this.queue.splice(0, this.config.batchSize);

    try {
      const payload = {
        node: this.config.nodeName,
        role: this.config.nodeRole,
        count: batch.length,
        timestamp: new Date().toISOString(),
        connections: batch,
      };

      const res = await fetch(`${this.config.monitorUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ingest-Key": this.config.ingestSecret,
          "User-Agent": `xray-monitor-node/1.0 (${this.config.nodeName})`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`[XrayNode] Ingest returned ${res.status}: ${errText.slice(0, 100)}`);
        // Put back in queue if not 4xx client error
        if (res.status >= 500 || res.status === 429) {
          this.queue.unshift(...batch);
        }
      }
    } catch (e: any) {
      console.warn(`[XrayNode] Failed to send telemetry batch: ${e.message}`);
      // Put back with cap
      if (this.queue.length < 2000) {
        this.queue.unshift(...batch);
      }
    } finally {
      this.isSending = false;
    }
  }
}

const node = new XrayMonitorNode();
node.start().catch((err) => {
  console.error(`[XrayNode] Fatal error:`, err);
  process.exit(1);
});
