# 🤖 APIShield MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes
the APIShield gateway's admin/control plane as **typed, discoverable tools** so
AI assistants (Claude Desktop, Cursor, VS Code, custom agents) can operate the
gateway safely — without a long-lived HTTP admin token.

The server talks directly to Redis, so it needs no gateway HTTP credentials: an
assistant that can spawn (or reach) this process can query metrics, block IPs,
manage API keys, and read incident reports.

---

## 🧰 Tools

| Tool | What it does |
|------|--------------|
| `get_gateway_metrics` | Live counters (total / rate-limited / unauthorized) + last 10 requests. |
| `get_blacklist` | Currently blocked IPs. |
| `block_ip` | Block an IP address. |
| `unblock_ip` | Unblock an IP address. |
| `get_api_keys` | All keys with quotas, status, creation dates. |
| `update_key_quota` | Change a key's requests-per-minute limit. |
| `update_key_status` | Activate / suspend a key. |
| `get_agent_logs` | Security Agent logs, incident reports, live pipeline state. |

Each tool carries a JSON-Schema input contract — see the
[API Reference](../docs/API_REFERENCE.md#5-mcp-admin-server) for the exact
schemas and example calls.

---

## 🔌 Transports

### stdio (default)

For AI tools that spawn the process locally. The client just runs:

```bash
node index.js
```

### SSE (remote / HTTP)

Set `TRANSPORT=sse` — the server exposes an HTTP streaming endpoint:

| Endpoint | Purpose |
|----------|---------|
| `GET /sse` | Server → client event stream. |
| `POST /messages` | Client → server messages. |

This is the mode used by [Docker Compose](../docker-compose.yml) and
[Kubernetes](../k8s/README.md).

---

## 🚀 Getting started

```bash
npm install
cp .env.example .env    # PORT=8001, TRANSPORT=stdio, REDIS_URL=...
npm start
```

Redis must be reachable at `REDIS_URL`. In stdio mode the process stays alive
until the client disconnects.

### Connect from Claude Desktop

Open `claude_desktop_config.json` (path varies by OS) and add:

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

> ⚠️ Replace the `args` path with the **absolute path of your own checkout**.
> The `d:/...` value above is just the location used when this demo was built.

### Connect from Cursor / VS Code / other MCP clients

Add an MCP server pointing at the same `command` + `args` (stdio), or — for
remote setups — point the client at `http://<host>:8001/sse` with the SSE
transport.

---

## ⚙️ Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `8001` | HTTP port (SSE mode). |
| `TRANSPORT` | `stdio` | `stdio` or `sse`. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string. |

---

## 🧪 Tests

```bash
npm test
```

Runs `tests/index.test.js` with Node's built-in test runner (Redis mocked).

---

## 📚 Related

- [API Reference — tool contracts](../docs/API_REFERENCE.md#5-mcp-admin-server)
- [Architecture — why a Redis-backed MCP server](../docs/ARCHITECTURE.md#9-the-mcp-admin-server)
- [Troubleshooting — MCP issues](../docs/TROUBLESHOOTING.md#4-mcp-server)
- [Root README](../README.md)
