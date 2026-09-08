# xray-monitor-node

Ultra-lightweight, high-performance telemetry agent for distributed Xray nodes in the Oximeter network.

## Features
- **Zero Overhead:** Consumes < 15MB RAM and near-zero CPU.
- **Self-Contained:** The node knows its own identity and role from environment variables.
- **Log Stream Ingestion:** Automatically streams and batches local Xray connection events.
- **Fault-Tolerant:** Automatic reconnect, queue backpressure, and log rotation tracking.

## Docker Compose Integration

Add `xray-monitor-node` alongside your `remnanode` service in `docker-compose.yml`:

```yaml
services:
  xray-monitor-node:
    image: ghcr.io/oximeter-cloud/xray-monitor-node:latest
    container_name: xray-monitor-node
    restart: always
    network_mode: host
    mem_limit: 50m
    environment:
      - MONITOR_URL=https://monitor.example.com
      - INGEST_SECRET=your_secure_ingest_secret
      - NODE_NAME=DE1-Oximeter # Or IR1-Oximeter, etc.
      - NODE_ROLE=BRIDGE       # BRIDGE or TUNNEL
      - XRAY_LOG_PATH=/var/log/xray/current
    volumes:
      - /var/lib/docker/volumes/remnanode_log/_data:/var/log/xray:ro
```
