# 📖 APIShield — API Reference

Complete reference for every HTTP endpoint exposed by the APIShield Gateway and
every tool exposed by the MCP Admin Server. All examples use the bundled demo
key and assume the stack is running locally (see the
[root README](../README.md#getting-started)).

Related docs: [Architecture](./ARCHITECTURE.md) · [Deployment](./DEPLOYMENT.md) ·
[Troubleshooting](./TROUBLESHOOTING.md)

---

## 1. Conventions

- **Base URL:** `http://localhost:8000` (Docker/K8s: `http://gateway:8000`)
- **Content type:** `application/json` for all requests and responses.
- **Authentication for protected routes:** pass an API key in the `X-Api-Key`
  header (a `?apiKey=` query parameter is also accepted).
- **Demo key:** `demo-key-123` (limit 60 req/min), seeded automatically on boot.
- **Status codes used:** `200` · `201` · `400` · `401` · `403` · `404` · `429` ·
  `500` · `502`.

### Error response shape

```json
{
  "error": "Unauthorized",
  "message": "API Key missing. Please provide the key in the x-api-key header."
}
```

### Rate-limit headers

Every authenticated request sets the standard rate-limit headers:

| Header | Example | Meaning |
|--------|---------|---------|
| `X-RateLimit-Limit` | `60` | Requests allowed per minute for this key. |
| `X-RateLimit-Remaining` | `42` | Tokens left in the bucket for this key. |

---

## 2. Gateway — System

### `GET /`

Service health/landing endpoint. Returns the gateway identity.

**Response `200`**

```json
{
  "status": "OK",
  "message": "APIShield API Gateway is active and secure."
}
```

---

## 3. Gateway — Protected / Downstream

All routes below are the "product" surface: they demonstrate a protected API
that consumers call with an API key.

### `GET /api/v1/resource`

Mock protected resource behind the full middleware chain
(blacklist → auth → rate limit).

**Headers:** `X-Api-Key: demo-key-123`

**Response `200`**

```json
{
  "status": "success",
  "timestamp": "2026-08-06T10:00:00.000Z",
  "developer": "Demo Developer",
  "data": {
    "message": "Hello! Your request successfully traversed the Shield API Gateway.",
    "payload": "Secure data payload received.",
    "endpoints": ["/api/v1/resource", "/api/v1/info"]
  }
}
```

### `GET /api/v1/info`

Mock gateway metadata endpoint, same protection.

**Response `200`**

```json
{
  "status": "success",
  "timestamp": "2026-08-06T10:00:00.000Z",
  "developer": "Demo Developer",
  "system": {
    "gatewayName": "APIShield Gateway",
    "version": "1.0.0",
    "uptime": 123.45
  }
}
```

### `GET /downstream/resource` · `GET /downstream/info`

The same mock handlers exposed **without** the security middleware. Useful for
demonstrating what a *raw* downstream service looks like.

> ⚠️ Unauthenticated by design. Do not expose in production.

### Dynamic proxy routes

When the gateway is started with a `PROXY_ROUTES` environment variable — a JSON
object mapping a path prefix to a target URL — those prefixes become live
proxies behind the full middleware chain:

```json
{ "PROXY_ROUTES": "{\"/orders\": \"https://orders.example.com/api\"}" }
```

| Behaviour | Detail |
|-----------|--------|
| Middleware | blacklist → auth → rate limit, same as `/api/v1/*` |
| Rewrite | the configured target path is substituted, query string preserved |
| Fallback | on proxy error, `/api/v1/resource` and `/api/v1/info` fall back to the inline mock handlers |
| Failure | other proxy errors return `502` `{ "error": "Bad Gateway" }` |

---

## 4. Gateway — Admin & Telemetry

> ⚠️ **No application-level auth** on `/admin/*` (by design — see
> [Architecture, §4.1](./ARCHITECTURE.md#41-protected-vs-unprotected-routes)).
> Protect these routes at the network layer in production.

### `GET /admin/metrics`

Aggregated gateway statistics: counters, the last 50 request logs, and the
current blacklist.

**Response `200`**

```json
{
  "metrics": {
    "totalRequests": 1284,
    "rateLimited": 12,
    "unauthorized": 7
  },
  "recentLogs": [
    {
      "ip": "127.0.0.1",
      "path": "/api/v1/resource",
      "status": 200,
      "developer": "Demo Developer",
      "timestamp": "2026-08-06T10:00:00.000Z"
    }
  ],
  "blacklist": ["192.168.1.50"]
}
```

### `POST /admin/keys`

Create an API key.

**Request**

```json
{ "name": "Acme Developer", "limit": 120, "apiKey": "acme-key-01" }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Human-readable owner name. |
| `limit` | number | yes | Requests per minute. |
| `apiKey` | string | yes | The key value the caller will send in `X-Api-Key`. |

**Response `201`**

```json
{ "message": "API Key created successfully", "apiKey": "acme-key-01" }
```

**Errors:** `400` when any field is missing.

### `GET /admin/keys/all`

List every registered API key.

**Response `200`**

```json
{
  "keys": [
    {
      "apiKey": "demo-key-123",
      "name": "Demo Developer",
      "limit": 60,
      "active": true,
      "createdAt": "2026-08-06T09:00:00.000Z"
    }
  ]
}
```

### `POST /admin/keys/status`

Activate or suspend an API key.

**Request**

```json
{ "apiKey": "acme-key-01", "active": false }
```

**Response `200`**

```json
{ "message": "API Key 'acme-key-01' active status set to false." }
```

**Errors:** `400` missing fields · `404` unknown key.

### `POST /admin/blacklist`

Block or unblock an IP address.

**Request**

```json
{ "ip": "192.168.1.50", "block": true }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ip` | string | yes | IPv4/IPv6 string. |
| `block` | boolean | — | `true` blocks, `false` (or omitted) unblocks. |

**Response `200`**

```json
{ "message": "IP 192.168.1.50 blacklisted successfully." }
```

**Errors:** `400` missing IP.

### `GET /admin/agent/logs`

Security Agent lifecycle logs, Orchestrator incident reports, live config, and
the current multi-agent pipeline state.

**Response `200`**

```json
{
  "logs": [
    {
      "timestamp": "2026-08-06T09:00:05.000Z",
      "type": "threat",
      "message": "IP 192.168.1.50 exceeded threshold",
      "ip": "192.168.1.50",
      "violations": 6
    }
  ],
  "reports": [
    {
      "timestamp": "2026-08-06T09:00:06.000Z",
      "type": "incident",
      "content": "# Incident Report\n\n... markdown ..."
    }
  ],
  "config": {
    "active": true,
    "max429Violations": 5,
    "max401Violations": 5
  },
  "agentState": {
    "activeNode": "mitigator",
    "currentThreat": "192.168.1.50"
  }
}
```

### `POST /admin/agent/config`

Update the Security Agent's runtime configuration. Any subset of fields may be
sent; unset fields keep their current values.

**Request**

```json
{ "active": true, "max429Violations": 8, "max401Violations": 3 }
```

| Field | Type | Notes |
|-------|------|-------|
| `active` | boolean | Master switch for the Security Agent. |
| `max429Violations` | number | `429` responses within the window that trigger a block. |
| `max401Violations` | number | `401` responses within the window that trigger a block. |

**Response `200`**

```json
{ "message": "Agent configuration updated successfully" }
```

### `POST /admin/chat`

Natural-language gateway copilot. If `GEMINI_API_KEY` is set in the gateway
environment it delegates to Gemini (`gemini-1.5-flash`); otherwise it falls back
to a deterministic offline NLP interpreter that understands a small command
grammar ("block ip …", "set limit of … to …", etc.).

**Request**

```json
{ "message": "Block IP 192.168.1.50" }
```

**Response `200`** — a markdown reply describing the executed action.

**Errors:** `400` missing message.

---

## 5. MCP Admin Server

The MCP server (`mcp-server/`, port `8001` in SSE mode) exposes the same control
plane as typed MCP tools. Two transports:

- **stdio** (default) — spawn `node index.js` from an MCP client.
- **SSE** (`TRANSPORT=sse`) — HTTP streaming: `GET http://localhost:8001/sse`
  (event stream), `POST http://localhost:8001/messages` (client messages).

### Tool contracts

| Tool | Input (JSON Schema) | Behaviour |
|------|---------------------|-----------|
| `get_gateway_metrics` | `{}` | Returns `summary` (total/rate-limited/unauthorized) + the last 10 request records. |
| `get_blacklist` | `{}` | Returns `blockedIps` array. |
| `block_ip` | `{ "ip": string }` | Adds IP to `blacklist:ips`. |
| `unblock_ip` | `{ "ip": string }` | Removes IP; reports if it was not present. |
| `get_api_keys` | `{}` | All keys with `name`, `limit`, `active`, `createdAt`. |
| `update_key_quota` | `{ "apiKey": string, "limit": number }` | Updates a key's requests-per-minute; errors if the key does not exist. |
| `update_key_status` | `{ "apiKey": string, "active": boolean }` | Activates/suspends a key. |
| `get_agent_logs` | `{}` | Security Agent logs, Orchestrator incident reports, and live pipeline state. |

### Example — connecting Claude Desktop

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apishield": {
      "command": "node",
      "args": ["d:/smart-gateway-mcp/mcp-server/index.js"]
    }
  }
}
```

On macOS/Linux, point `args` at the checked-out repository path instead. See the
[mcp-server README](../mcp-server/README.md) for Cursor/VS Code and SSE variants.

---

## 6. Redis Keyspace (reference for debugging)

The control plane is thin; all state lives in Redis. Useful keys to inspect with
`redis-cli`:

| Key | Type | Purpose |
|-----|------|---------|
| `apikey:*` | hash | API-key metadata. |
| `blacklist:ips` | set | Blocked IPs. |
| `rate:limit:<key>` | hash | Live token bucket for a key. |
| `telemetry:total_requests` | string | Counter. |
| `telemetry:rate_limited_requests` | string | Counter. |
| `telemetry:unauthorized_requests` | string | Counter. |
| `telemetry:recent_requests` | list | Last ~50 request records. |
| `telemetry:endpoint:<path>` | string | Per-endpoint counter. |
| `telemetry:agent_logs` | list | Agent log lines. |
| `telemetry:agent_reports` | list | Incident reports. |
| `telemetry:threat_queue` | list | Encrypted threat events. |
| `config:security_agent_active` | string | `"true"`/`"false"`. |
| `config:max_429_violations` | string | Threshold (default `5`). |
| `config:max_401_violations` | string | Threshold (default `5`). |
| `multi-agent:state` | string | JSON pipeline state (TTL 60 s). |

---

## 7. Related

- [Architecture](./ARCHITECTURE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
- [Root README](../README.md)
