# 🛡️ APIShield — Smart API Gateway, Rate-Limiter & Telemetry Console

[![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-v7.0+-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![n8n](https://img.shields.io/badge/n8n-Workflow%20Automation-FF6F59?logo=n8n&logoColor=white)](https://n8n.io/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Enabled-326CE5?logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-Supported-4f46e5)](https://modelcontextprotocol.io/)

## 🔒 The Problem: Securing Modern API Ecosystems

Modern microservices architectures face relentless threats:
- **Credential Stuffing & Brute Force Attacks**: Attackers bombard endpoints with credential combinations
- **Rate Abuse & DDoS**: Malicious clients exhaust rate limits or overwhelm resources
- **Credential Stuffing**: Stolen API keys abused for unauthorized access
- **Operational Blind Spot**: Lack of real-time visibility into traffic patterns and threats

APIShield solves these challenges by providing a **zero-trust API gateway** that combines intelligent rate limiting, automated threat response, and comprehensive observability—all while maintaining sub-millisecond latency for legitimate traffic.

## 🚀 Core Capabilities

### 🛡️ Intelligent Threat Protection
- **Adaptive Rate Limiting**: Redis Lua-scripted token-bucket algorithm prevents race conditions
- **Autonomous IP Blocking**: Self-healing firewall that blocks abusive IPs in real-time
- **Credential Protection**: Automatic API key suspension for compromised credentials
- **Multi-Agent Orchestration**: Specialized AI agents (Auditor, Mitigator, Reporter) collaborate on threat response

### 📊 Comprehensive Observability
- **Real-time Telemetry**: Live RPS, latency, and error rate monitoring
- **Request Tracing**: Full visibility into every API call with geolocation and threat scoring
- **Redis Inspection**: Live view of rate limit counters, blacklists, and API key metadata
- **Incident Reporting**: Auto-generated markdown reports for every security incident

### 🤖 AI-Powered Operations
- **Natural Language Admin**: Control gateway via conversational AI ("Block IP 192.168.1.100")
- **Autonomous Security Agent**: Background daemon that learns and adapts to threats
- **Multi-Agent Incident Response**: Coordinated response to complex attack patterns
- **Predictive Threat Analysis**: Early warning of emerging attack patterns

### ⚡ Enterprise-Grade Performance
- **Sub-Millisecond Latency**: Atomic Redis operations keep overhead under 1ms
- **Horizontal Scaling**: Stateless design enables effortless horizontal scaling
- **Zero-Downtime Updates**: Rolling updates with health checks and circuit breakers
- **Resource Efficiency**: Minimal CPU/memory footprint with intelligent caching

## 🏗️ System Architecture

```mermaid
graph TD
    %% External Entities
    subgraph External[External Systems]
        A[API Clients] -->|HTTP Requests| B(APIShield Gateway)
        C[Admin Users] -->|Web UI| F[Developer Console]
        D[AI Assistants] -->|MCP/SSE| E[MCP Admin Server]
        G[n8n Workflows] -->|Webhooks| B
    end

    %% Core Gateway
    subgraph Gateway[APIShield Gateway Node]
        B -->|IP Blacklist Check| H[IP Blacklist Middleware]
        H -->|API Key Auth| I[API Security Middleware]
        I -->|Rate Limiting| J[Redis Lua Token Bucket]
        J -->|Route to| K[Dynamic Proxy Engine]
        K -->|Forward to| L[Downstream Services]
        K -->|Fallback to| M[Mock Services]
        
        %% Admin Endpoints
        B -->|Admin Requests| N[Admin & Telemetry Routes]
        N -->|Metrics| O[Redis Telemetry]
        N -->|Key Management| P[Redis API Keys]
        N -->|Blacklist Management| Q[Redis Blacklist]
        N -->|Agent Controls| R[Redis Agent State]
    end

    %% Data Layer
    subgraph Data[Data Storage Layer]
        O -->|Telemetry Stream| R1[Telemetry: recent_requests]
        O -->|Counters| R2[Telemetry: counters]
        P -->|Key Store| R3[API Keys: apikey:*]
        Q -->|Block List| R4[Blacklist: blacklist:ips]
        R -->|Agent State| R5[Agent: config & logs]
        R1 -->|Stream Processing| S[n8n Abuse Detection]
    end

    %% Automation & AI
    subgraph Automation[Automation & AI Layer]
        S -->|Detect Abuse| T[n8n Workflow Engine]
        T -->|Trigger| U[Webhook: Developer Onboarding]
        T -->| V[Webhook: Abuse Prevention]
        U -->|Create Key| P
        V -->|Block IP| Q
        
        E -->|SSE Stream| W[Admin AI Copilot]
        W -->|Natural Language| B
        W -->|Commands| N
        
        X[Autonomous Security Agent] -->|Monitor Logs| R1
        X -->|Analyze Threats| Y[Threat Detection Engine]
        Y -->|Escalate| Z[Multi-Agent Orchestrator]
        Z -->|Orchestrate| AA[Auditor Agent]
        Z -->|Orchestrate| AB[Mitigator Agent]
        Z -->|Orchestrate| AC[Reporter Agent]
        AA -->|Analyze| AD[Telemetry Analysis]
        AB -->|Act| AE[IP Blocking & Key Suspension]
        AC -->|Report| AF[Incident Reports]
    end

    %% Monitoring & Visualization
    subgraph Monitoring[Monitoring & Visualization]
        F -->|WebSocket| AG[Real-time Dashboard]
        AG -->|Displays| AH[RPS & Latency Graphs]
        AG -->|Displays| AI[Live Request Stream]
        AG -->|Displays| AJ[IP Blacklist View]
        AG -->|Displays| AK[API Key Management]
        AG -->|Displays| AL[AI Chat Interface]
        AG -->|Displays| AM[Multi-Agent Visualizer]
        AG -->|Displays| AN[Incident Reports]
    end

    %% Styling
    classDef external fill:#f9f,stroke:#333,stroke-width:2px;
    classDef gateway fill:#bbf,stroke:#333,stroke-width:2px;
    classDef data fill:#bfb,stroke:#333,stroke-width:2px;
    classDef automation fill:#fb8,stroke:#333,stroke-width:2px;
    classDef monitoring fill:#ffb,stroke:#333,stroke-width:2px;
    
    class A,C,D,G external;
    class B,H,I,J,K,L,M,N,O,P,Q,R gateway;
    class R1,R2,R3,R4,R5 data;
    class S,T,U,V,W,X,Y,Z,AA,AB,AC,AD,AE,AF,AG,AH,AI,AJ,AK,AL,AM,AN automation;
    class F,AG,AH,AI,AJ,AK,AL,AM,AN monitoring;
```

## ⚡ Technical Highlights & Algorithms

### 1. Atomic Rate Limiting (Redis Lua)
To prevent race conditions under concurrent client bursts (Time-of-Check to Time-of-Use bugs), APIShield executes a thread-safe **Token-Bucket Rate Limiter** entirely within Redis using Lua:

- **Atomic Execution**: Bucket state evaluation occurs entirely in Redis memory
- **Dynamic Refill**: Tokens replenish based on elapsed milliseconds since last request
- **Single Round-Trip**: Returns `(allowed, remaining_tokens)` in one Redis call (<1ms overhead)
- **Automatic Expiry**: Keys expire after 24h of inactivity to prevent memory leaks

### 2. Microservice Decoupling & Autonomous Response
Rather than bloating the gateway with batch processing:
- **n8n Workflows**: Handle async tasks (onboarding emails, abuse cron jobs)
- **Multi-Agent Orchestrator**: Coordinates specialized AI agents for threat response
- **Event-Driven Architecture**: Redis pub/sub enables loose coupling between services
- **Fail-Safe Mechanisms**: Critical actions (IP blocking) occur immediately, others async

### 3. AI-Powered Administration
- **Model Context Protocol (MCP)**: Standardizes admin tools for AI consumption
- **Natural Language Interface**: Admins issue commands like "Block IP 192.168.1.100"
- **Context-Aware Responses**: AI understands gateway state and suggests actions
- **Sandbox Mode**: Falls back to deterministic NLP when AI unavailable

## 🛠️ Getting Started

### 🚀 Single-Command Local Setup (Docker Compose)
```bash
docker compose up --build -d
```

This single command launches the complete stack:
- 🛡️ **APIShield Gateway** (Node.js/Express) on `http://localhost:8000`
- 🔁 **Workflow Engine** (n8n) on `http://localhost:5678`
- 🤖 **MCP Admin Server** on `http://localhost:8001/sse`
- 🗄️ **Redis** (Rate limiting & state) on `localhost:6379`
- 🐘 **PostgreSQL** (n8n state) on `localhost:5432`
- 💻 **Developer Console** (React/Vite) on `http://localhost:3000`

### 🔧 Access Points
| Service | URL | Description |
|---------|-----|-------------|
| **Developer Console** | [http://localhost:3000](http://localhost:3000) | Glassmorphic dashboard with live telemetry |
| **API Gateway** | [http://localhost:8000](http://localhost:8000) | Main proxy endpoint for API traffic |
| **MCP Server** | [http://localhost:8001/sse](http://localhost:8001/sse) | Streamed admin interface for AI assistants |
| **n8n Dashboard** | [http://localhost:5678](http://localhost:5678) | Workflow automation and monitoring |
| **Redis Commander** | `redis://localhost:6379` | Direct cache inspection (via redis-cli) |

### 📋 Post-Setup Instructions
1. **Developer Onboarding**:
   - Visit [http://localhost:5678](http://localhost:5678)
   - Import `./n8n/workflows/developer_onboarding.json`
   - Activate the workflow

2. **Abuse Prevention**:
   - Import `./n8n/workflows/abuse_prevention_cron.json`
   - Activate the workflow for automated IP blocking

3. **AI Assistant Setup**:
   - Copy the MCP configuration from README to your AI tool (Claude Desktop, Cursor, etc.)
   - Set `GEMINI_API_KEY` in `.env` for full AI capabilities

### 🧪 Running the Test Suite
```bash
# Run all tests (gateway + MCP server)
npm test

# Gateway tests only
npm --prefix gateway test

# MCP server tests only  
npm --prefix mcp-server test
```

### ☸️ Kubernetes Deployment
See [k8s/README.md](k8s/README.md) for production-ready manifests including:
- Resource limits and requests
- Horizontal pod autoscalers
- Ingress controllers with TLS
- Redis and Postgres persistence
- Monitoring and logging sidecars

## 📖 API Reference

### Gateway Administration Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/metrics` | Aggregated gateway statistics |
| `POST` | `/admin/keys` | Create new API key |
| `GET` | `/admin/keys/all` | List all registered API keys |
| `POST` | `/admin/keys/status` | Enable/disable API key |
| `POST` | `/admin/blacklist` | Block/unblock IP address |
| `GET` | `/admin/agent/logs` | Security agent telemetry & config |
| `POST` | `/admin/agent/config` | Update agent configuration |
| `POST` | `/admin/chat` | AI-powered admin interface |

### Downstream Proxy Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/resource` | Mock protected resource (requires API key) |
| `GET` | `/api/v1/info` | Gateway metadata (requires API key) |
| `GET` | `/downstream/resource` | Direct proxy to configured resource |
| `GET` | `/downstream/info` | Direct proxy to configured info service |

## 📊 System Requirements

- **Node.js**: v20+ (for local development)
- **Docker**: 20.10+ (for containerized deployment)
- **Docker Compose**: v2.0+ (for multi-service orchestration)
- **Resource Minimum**: 2GB RAM, 2 CPU cores
- **Recommended**: 4GB RAM, 4 CPU cores for production loads

## 🔐 Security Architecture

### Defense-in-Depth Layers
1. **Network Layer**: Optional API gateway firewall rules
2. **Transport Layer**: TLS termination at ingress/load balancer
3. **Application Layer**: APIShield gateway (this project)
   - IP reputation filtering
   - API key validation & rate limiting
   - Request/response sanitization
4. **Data Layer**: Encrypted Redis persistence (in production)
5. **Orchestration Layer**: n8n workflows with credential vaulting
6. **Observability Layer**: Real-time alerting and audit trails

### Data Protection
- **At-Rest**: Redis persistence with encryption (production deployments)
- **In-Transit**: TLS 1.3 for all service-to-service communication
- **Secrets Management**: Environment variables + Docker secrets/K8s secrets
- **Access Control**: Principle of least privilege for all service accounts

## 📚 Documentation & Resources

- [Architecture Deep Dive](docs/ARCHITECTURE.md)
- [API Reference](docs/API_REFERENCE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [API Contribution Guidelines](CONTRIBUTING.md)

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---
*APIShield: Protecting APIs with intelligence, not just barriers.*