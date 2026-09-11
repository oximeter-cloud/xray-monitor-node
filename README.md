# xray-monitor-node

Ultra-lightweight, high-performance telemetry agent for distributed Xray nodes in multi-server proxy architectures.

## Features

- **Near-Zero Footprint:** Consumes ~18MB–22MB RAM and < 0.2% CPU on edge nodes.
- **Autonomous Self-Containment:** The agent identifies itself via environment variables (`NODE_NAME`, `NODE_ROLE`) without requiring direct access or credentials to Remnawave.
- **Fault-Tolerant Log Tailing:** Tracks file descriptors and system inodes (`stat.ino`). When log rotation or container recreation occurs, stale file descriptors are automatically closed and reopened from offset 0 without missing lines or freezing.
- **Heartbeat & Queue Management:** Maintains queue backpressure with exponential backoff on network drops and sends periodic keepalive heartbeats to report node health during quiet traffic periods.
- **Pre-Shared Key Security:** Telemetry payloads are authenticated via the `X-Ingest-Key` HTTP header.

## Architecture

```text
┌────────────────────────────────────────┐
│             Edge Server                │
│                                        │
│  ┌──────────────┐     writes log       │
│  │ Xray /       ├─────────────────┐    │
│  │ Remnanode    │                 ▼    │
│  └──────────────┘         ┌────────────┴───────────┐
│                           │  /var/log/xray/current │
│                           └────────────┬───────────┘
│                                        │ tails inode
│  ┌─────────────────────────┐           ▼
│  │ xray-monitor-node       ├───────────┘
│  │ - Batching & Parsing    │
│  │ - Queue Backpressure    │
│  │ - Heartbeat Keepalive   │
│  └────────────┬────────────┘
└───────────────┼────────────────────────┘
                │
                │ POST /api/ingest (X-Ingest-Key)
                ▼
┌────────────────────────────────────────┐
│        Central xray-monitor Server     │
└────────────────────────────────────────┘
```

## Docker Compose Integration

Add `xray-monitor-node` alongside your `remnanode` service in `docker-compose.yml`:

```yaml
services:
  xray-monitor-node:
    image: ghcr.io/oximeter-cloud/xray-monitor-node:latest
    container_name: xray-monitor-node
    restart: unless-stopped
    mem_limit: 80m
    environment:
      - MONITOR_URL=http://central-monitor-ip:9922  # Or https://monitor.example.com
      - INGEST_SECRET=your_secure_pre_shared_key
      - NODE_NAME=DE1-Edge-Node                     # Unique node name matching panel
      - NODE_ROLE=BRIDGE                            # BRIDGE or TUNNEL
      - XRAY_LOG_PATH=/var/log/xray/current
    volumes:
      # Mount the directory or container rootfs containing Xray current log
      - /var/log/xray:/var/log/xray:ro
```

### Locating the Xray Log File

Depending on how `remnanode` is deployed:
1. **Host/Volume Mount:** Mount the host path or volume mapped to `/var/log/xray`.
2. **Container Overlayfs:** You can mount from the container's merged layer:
   ```bash
   -v $(docker inspect remnanode --format '{{.GraphDriver.Data.MergedDir}}')/var/log/xray:/var/log/xray:ro
   ```

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MONITOR_URL` | Base URL of central `xray-monitor` instance | `http://127.0.0.1:9922` |
| `INGEST_SECRET` | Pre-shared key validated via `X-Ingest-Key` | `(required)` |
| `NODE_NAME` | Name identifier for this edge node | `Node` |
| `NODE_ROLE` | Role of this node in topology: `BRIDGE` or `TUNNEL` | `BRIDGE` |
| `XRAY_LOG_PATH` | Path to active Xray access log file | `/var/log/xray/current` |
| `BATCH_SIZE` | Maximum connection records per HTTP request | `200` |
| `FLUSH_INTERVAL_MS`| Telemetry queue flush interval in milliseconds | `2000` |

## Resource Consumption

Tested under continuous high load:
- **Memory (RSS):** 18MB – 22MB
- **CPU Usage:** 0.05% – 0.20% (1 vCPU core)
- **Disk:** 0 bytes (in-memory buffer, strictly stateless)

## License

MIT License.
