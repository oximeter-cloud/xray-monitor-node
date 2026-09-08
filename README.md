# xray-monitor-node

Ultra-lightweight, high-performance telemetry agent for distributed Xray nodes in the Oximeter network.

## Features
- **Zero Overhead:** Consumes < 15MB RAM and near-zero CPU.
- **Log Stream Ingestion:** Automatically streams and batches local Xray connection events.
- **Dynamic Node Detection:** Auto-discovers node role (`BRIDGE` vs `TUNNEL`) from Remnawave REST API.
- **Fault-Tolerant:** Automatic reconnect, queue backpressure, and log rotation tracking.

## Docker Compose Integration

Add `xray-monitor-node` alongside your `remnanode` service in `docker-compose.yml`:

```yaml
services:
  xray-monitor-node:
    image: ghcr.io/oximeter-cloud/xray-monitor-node:latest
    container_name: xray-monitor-node
    restart: unless-stopped
    mem_limit: 50m
    environment:
      - MONITOR_URL=https://monitor.mahdi.im
      - INGEST_SECRET=your_secure_ingest_secret
      - NODE_NAME=IR1-Oximeter # Or auto-detected from Remnawave
      - NODE_ROLE=TUNNEL       # TUNNEL or BRIDGE
      - XRAY_LOG_PATH=/var/log/xray/current
    volumes:
      - /var/lib/docker/volumes/remnanode_log/_data:/var/log/xray:ro
```
