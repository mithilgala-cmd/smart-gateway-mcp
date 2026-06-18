# APIShield - Smart API Gateway & Rate-Limiter Console

APIShield is a production-ready, microservice-based **API Gateway, Rate-Limiter, and Telemetry Console** built to demonstrate advanced backend engineering, automated Devops workflows, and Kubernetes orchestration. 

By combining low-latency caching, visual workflow automation, and the Model Context Protocol (MCP), APIShield protects downstream APIs from abuse, automatically blacklists malicious actors, and exposes an AI-manageable control plane.

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

### Core Technologies
1. **API Gateway (Node.js/Express)**: Implements token-bucket rate limiting, authentication checks, and IP blacklists using atomic **Redis Lua Scripts** to prevent race conditions.
2. **Database Cache (Redis)**: Serves as the high-speed state and metrics engine.
3. **Workflow Automation (n8n)**: Automates developer onboarding (keys generation) and schedules cron-checkers that analyze gateway traffic to block abusive IPs.
4. **AI Control Plane (MCP Server)**: Exposes standardized Model Context Protocol tools, enabling AI agents (like Claude Desktop or Cursor) to administer rate limits and blacklists.
5. **Frontend Console (Vite + React)**: A visually rich, glassmorphic neon dashboard featuring a Live Request Simulator, real-time traffic streaming, and connection widgets.

---

## 🚀 Local Quickstart (Docker Compose)

Start the entire microservice stack locally with a single command:

```bash
docker compose up --build -d
```

### Ports and Access URLs:
* **Frontend Console**: [http://localhost:3000](http://localhost:3000)
* **API Gateway**: [http://localhost:8000](http://localhost:8000)
* **n8n Automation Dashboard**: [http://localhost:5678](http://localhost:5678)
* **MCP Server (SSE Endpoint)**: [http://localhost:8001/sse](http://localhost:8001/sse)
* **Redis Instance**: `localhost:6379`

### ⚙️ Setting up the n8n Workflows:
1. Open the **n8n Dashboard** at [http://localhost:5678](http://localhost:5678).
2. Create a new workflow, click on the options menu (three dots in top right), select **Import from File**, and upload:
   * `./n8n/workflows/developer_onboarding.json` (Active it).
3. Repeat the process for the abuse prevention workflow:
   * `./n8n/workflows/abuse_prevention_cron.json` (Active it).
4. Head back to the **Frontend Console** at [http://localhost:3000] and trigger registrations or run rate-limit burst tests!

---

## ☸️ Kubernetes Local Deployment (Kind/Minikube)

Run the entire cluster orchestration stack locally for free.

### Prerequisites:
Make sure you have `kubectl` installed and a local Kubernetes engine running, e.g., **Kind** or **Minikube**.

### 1. Build and Load Docker Images
If using **Kind**, you must build the images locally and load them into your cluster context so Kubernetes can locate them without an external registry:

```bash
# Build Gateway Image
docker build -t apishield-gateway:latest ./gateway

# Build MCP Server Image
docker build -t apishield-mcp-server:latest ./mcp-server

# Build Frontend Dashboard Image
docker build -t apishield-frontend:latest ./frontend

# Load into Kind Cluster
kind load docker-image apishield-gateway:latest
kind load docker-image apishield-mcp-server:latest
kind load docker-image apishield-frontend:latest
```

### 2. Apply Manifests
Deploy the entire microservice suite (Deployments, Services, PVC storage, and configuration metrics) using:

```bash
kubectl apply -f k8s/
```

### 3. Verify Resources
```bash
# Check Pod statuses
kubectl get pods

# Check exposed services (LoadBalancers will map to local ports)
kubectl get svc
```

Access the frontend via port forwarding or local LoadBalancer configurations:
```bash
kubectl port-forward svc/frontend 3000:80
kubectl port-forward svc/gateway 8000:8000
kubectl port-forward svc/n8n 5678:5678
```

---

## 🔌 Model Context Protocol (MCP) AI Connections

Expose APIShield tools directly to your local AI coding assistant:

### Claude Desktop Integration:
Open your `claude_desktop_config.json`:
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Append the following object to your `mcpServers` list:
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

### Cursor IDE Integration:
1. Navigate to **Settings > Features > MCP**.
2. Click **+ Add New MCP Server**.
3. Set configuration:
   * **Name**: `apishield-admin`
   * **Type**: `stdio`
   * **Command**: `node d:/smart-gateway-mcp/mcp-server/index.js`
4. Ask your chat window: *"Check the operational metrics for the APIShield gateway."*

---

## ☁️ Free Cloud Deployment Guide

You can deploy this entire architecture publicly for **$0** using free tier cloud platforms:

### 1. Redis Cache: **Upstash**
* Go to [Upstash](https://upstash.com/) and create a free serverless Redis database.
* Copy the connection string: `redis://default:password@host:port`.

### 2. Databases & n8n: **Render / Fly.io**
* Deploy **PostgreSQL** on Render (free tier lasts 90 days, or use a free SQLite setup inside n8n).
* Deploy **n8n** as a Web Service on Render or Fly.io pointing to your PostgreSQL instance. You can deploy it using the official Docker image `n8nio/n8n:latest`.

### 3. API Gateway & MCP Server: **Render Web Services**
* Connect your GitHub Repository to Render.
* **Deploy API Gateway**:
  * Create a new Web Service.
  * Root Directory: `gateway` (or root with Dockerfile path `./gateway/Dockerfile`).
  * Add Environment Variable: `REDIS_URL` (your Upstash connection URL).
* **Deploy MCP Server**:
  * Create a new Web Service.
  * Root Directory: `mcp-server` (or root with Dockerfile path `./mcp-server/Dockerfile`).
  * Add Environment Variables:
    * `REDIS_URL` (Upstash connection URL)
    * `TRANSPORT=sse`
    * `PORT=8001` (Render will bind to port 8001 automatically).
  * Exposing SSE allows remote clients (like Cursor or custom tools) to connect to your MCP server over the internet!

### 4. Frontend: **Vercel / Netlify**
* Create a free account on Vercel.
* Link the `frontend` folder and deploy it as a static React site.
* Override Environment/Connection URLs directly in the settings drawer on the frontend dashboard to hook up your public gateway and n8n webhooks.
