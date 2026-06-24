# 🛡️ APIShield — Smart API Gateway, Rate-Limiter & Telemetry Console

[![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-v7.0+-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![n8n](https://img.shields.io/badge/n8n-Workflow%20Automation-FF6F59?logo=n8n&logoColor=white)](https://n8n.io/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Enabled-326CE5?logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-Supported-4f46e5)](https://modelcontextprotocol.io/)

APIShield is a production-grade, low-latency **API Gateway, Rate-Limiter, and Telemetry Console** microservice ecosystem. Designed for modern cloud-native environments, it protects downstream microservices from abuse, automates developer onboarding via visual pipelines, and exposes an AI-driven DevOps control plane using the **Model Context Protocol (MCP)**.

---

## 🏗️ Architectural Blueprint

```
                      ┌──────────────────────────────────────────────┐
                      │                Client / Browser              │
                      └──────────────────────┬───────────────────────┘
                                             │
                                   HTTP Requests with API Key
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │            apishield-gateway (Node)          │
                      └──────────────┬───────────────┬───────────────┘
                                     │               │
                             Read & Write      Proxy Valid Requests
                                     │               │
                                     ▼               ▼
 ┌───────────────────┐        ┌──────────────┐    ┌──────────────────┐
 │ apishield-mcp     │◄───────┤    Redis     │    │  Mock Downstream │
 │ Admin Server      │        │  Rate Limits │    │  Microservice    │
 └─────────▲─────────┘        │  Blacklists  │    └──────────────────┘
           │                  └──────▲───────┘
   MCP over SSE (Admin AI)           │
           │                   Read & Write
           │                         │
 ┌─────────┴─────────┐        ┌──────┴───────┐
 │     n8n Server    │◄───────┤  PostgreSQL  │
 │  (Onboarding &    │        │  (n8n State) │
 │  Abuse Cron)      │        └──────────────┘
 └───────────────────┘
```

### Core Components
1. **API Gateway (Node.js/Express)**: A reverse proxy handling incoming traffic. It validates headers, runs security middleware, and executes high-speed rate-limiting.
2. **Database Cache (Redis)**: The central state store. It stores API keys, active request metrics, and the IP blacklist.
3. **Workflow Automation (n8n)**: Coordinates complex pipelines (onboarding email notifications, key provisioning, and background cron schedules that flag anomalies).
4. **AI Control Plane (MCP Server)**: Standardizes gateway administration tools (quota resizing, IP blocking) into schemas that AI coding assistants and LLMs can interact with directly.
5. **Developer Console (React/Vite)**: A glassmorphic dashboard showcasing real-time traffic pipelines, live RPS/latency graphs, and sandbox simulators.

---

## ⚡ Technical Highlights & Algorithms

### 1. Atomic Rate Limiting (Redis Lua)
To avoid race conditions under concurrent client bursts (Time-of-Check to Time-of-Use bugs), APIShield runs a thread-safe **Token-Bucket Rate Limiter** executed atomically on the Redis server:

* The bucket state is evaluated entirely in memory inside a Redis **Lua script** (`RATE_LIMIT_LUA` in `gateway/server.js`).
* Tokens are dynamically refilled based on elapsed milliseconds since the last request.
* Returns execution status (`1` for allowed, `0` for blocked) and remaining quota back to the gateway in a single round-trip, keeping database network overhead under **1ms**.

### 2. Microservice Decoupling
* Rather than bloating the Gateway node with batch processing, **n8n** runs async cron workflows to sweep Redis telemetry logs, analyze rate-limit breaches (429 codes), and automatically block offending IPs at the gateway firewall.

---

## 🛠️ Complete Local Quickstart (Docker Compose)

Spin up the entire local sandbox (Gateway, Redis, MCP, Postgres, n8n, and Frontend) in one command:

```bash
docker compose up --build -d
```

### Access Ports & Dashboards:
* 🖥️ **Developer Console**: [http://localhost:3000](http://localhost:3000)
* 🛡️ **API Gateway**: [http://localhost:8000](http://localhost:8000)
* 🔌 **MCP Server (SSE Link)**: [http://localhost:8001/sse](http://localhost:8001/sse)
* ⚙️ **n8n Workflow Dashboard**: [http://localhost:5678](http://localhost:5678)
* 🗄️ **Redis Instance**: `localhost:6379`

### Setting up the n8n Workflows:
1. Open the **n8n Dashboard** at [http://localhost:5678](http://localhost:5678).
2. Create a new workflow, click on the top-right menu (three dots), choose **Import from File**, and upload:
   * `./n8n/workflows/developer_onboarding.json`
3. Activate the workflow.
4. Create a second workflow and import the abuse-prevention job:
   * `./n8n/workflows/abuse_prevention_cron.json`
5. Activate it, and you're ready to test!

---

## ☸️ Kubernetes Local Deployment (Kind/Minikube)

Expose APIShield in a production-like cluster topology.

### 1. Build and Load Images (For Kind clusters)
If you are running **Kind**, build images locally and load them directly into your cluster's context:

```bash
# Build Gateway, MCP, and Frontend Images
docker build -t apishield-gateway:latest ./gateway
docker build -t apishield-mcp-server:latest ./mcp-server
docker build -t apishield-frontend:latest ./frontend

# Load into Kind
kind load docker-image apishield-gateway:latest
kind load docker-image apishield-mcp-server:latest
kind load docker-image apishield-frontend:latest
```

### 2. Deploy Cluster Resources
Apply the configuration manifests:

```bash
kubectl apply -f k8s/
```

### 3. Expose Services via Port-Forwarding
Expose the key services to local ports:

```bash
kubectl port-forward svc/frontend 3000:80
kubectl port-forward svc/gateway 8000:8000
kubectl port-forward svc/n8n 5678:5678
```

---

## 🔌 Model Context Protocol (MCP) Setup

Expose APIShield admin commands to your AI tools (e.g. Claude Desktop, Cursor IDE).

### 1. Claude Desktop Configuration
Add the server block to your config file:
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "apishield-admin": {
      "command": "node",
      "args": [
        "d:/smart-gateway-mcp/mcp-server/index.js"
      ],
      "env": {
        "REDIS_URL": "redis://localhost:6379",
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

### 2. Cursor IDE Configuration
1. Go to **Settings > Features > MCP**.
2. Click **+ Add New MCP Server**.
3. Choose type `stdio`, set the name to `apishield-admin`, and enter the startup command:
   ```bash
   node d:/smart-gateway-mcp/mcp-server/index.js
   ```

---

## 🧪 Automated Testing Suite

APIShield has a robust, 100% isolated test suite built using Node.js's native `node:test` runner, `supertest` for HTTP integration, and custom **in-memory mock Redis stores** to guarantee tests run fast, synchronously, and without requiring a live Redis database.

### Running the Tests:

* **Run all tests sequentially (Root Workspace):**
  ```bash
  npm test
  ```
* **Run Gateway tests:**
  ```bash
  npm --prefix gateway test
  ```
* **Run MCP Server tests:**
  ```bash
  npm --prefix mcp-server test
  ```

### Test Coverage Highlights:
* **API Gateway Tests (`gateway/tests/server.test.js`):**
  * Verifies health checkpoints (`GET /`).
  * Asserts block-level behaviors for unauthorized API keys (401) and missing headers.
  * Validates rate limiters (429 response) under heavy traffic spikes.
  * Simulates IP-blacklist firewalls (403 Forbidden).
  * Validates administration routes (`POST /admin/keys`, `POST /admin/blacklist`, `GET /admin/metrics`).
* **MCP Server Tests (`mcp-server/tests/index.test.js`):**
  * Asserts schema syntax for all registered tools.
  * Tests execution logic for retrieving telemetry logs (`get_gateway_metrics`), editing blacklists (`block_ip` / `unblock_ip`), and resizing API limits (`update_key_quota`).

---

## 📑 API Reference & Tools

### Public API Gateway Endpoints
* `GET /api/v1/resource` - Fetches mock downstream secure resources. (Requires `x-api-key` header).
* `GET /api/v1/info` - Fetches downstream system metadata. (Requires `x-api-key` header).

### Gateway Administration Endpoints
* `GET /admin/metrics` - Aggregates gateway stats, recent telemetry logs, and current blacklists.
* `POST /admin/keys` - Seeds a new API key. Body: `{ "name": "string", "limit": 100, "apiKey": "string" }`.
* `POST /admin/blacklist` - Blocks/unblocks client IPs. Body: `{ "ip": "string", "block": true }`.

### MCP Admin Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `get_gateway_metrics` | None | Returns total requests, rate-limited counts, unauthorized hits, and recent logs. |
| `get_blacklist` | None | Lists all blocked IP addresses. |
| `block_ip` | `{ "ip": "string" }` | Blacklists an IP, rejecting all subsequent requests. |
| `unblock_ip` | `{ "ip": "string" }` | Restores network access for a blacklisted IP. |
| `update_key_quota` | `{ "apiKey": "string", "limit": number }` | Dynamically resizes the requests-per-minute quota for an API key. |

---

## 📜 License
This project is licensed under the [MIT License](LICENSE).
