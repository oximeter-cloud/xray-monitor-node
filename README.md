# xray-monitor-node

Ultra-lightweight, high-performance telemetry agent for distributed Xray nodes in the Oximeter network.

## Features
- **Zero Overhead:** Consumes < 20MB RAM and near-zero CPU.
- **Log Stream Ingestion:** Automatically streams and batches local Xray connection events.
- **Dynamic Node Detection:** Auto-discovers node identity, public IP, and role (`BRIDGE` vs `TUNNEL`) directly from Remnawave REST API.
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
    mem_limit: 80m
    environment:
      - MONITOR_URL=https://monitor.example.com
      - INGEST_SECRET=your_secure_ingest_secret
      # Dynamic auto-detection via Remnawave (No hardcoded NODE_NAME or NODE_ROLE needed!):
      - REMNAWAVE_API_URL=https://panel.example.com/api
      - REMNAWAVE_API_TOKEN=your_remnawave_api_token
      - XRAY_LOG_PATH=/var/log/xray/current
    volumes:
      - /var/lib/docker/volumes/remnanode_log/_data:/var/log/xray:ro
```
