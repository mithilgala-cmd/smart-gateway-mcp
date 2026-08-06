# 🔧 APIShield — Troubleshooting

A practical guide to the failure modes you are most likely to hit, in local
development, Docker Compose, and Kubernetes. Start here before filing an issue.

Related: [Architecture](./ARCHITECTURE.md) · [API Reference](./API_REFERENCE.md) ·
[Deployment](./DEPLOYMENT.md) · [root README](../README.md)

---

## 1. Local Development

### Gateway won't start — `ECONNREFUSED`

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Cause:** Redis is not running, or `REDIS_URL` points somewhere unreachable.

**Fix:**
```bash
docker run --name apishield-redis -p 6379:6379 -d redis:7-alpine
redis-cli ping     # expect PONG
```

If you use a remote Redis (Upstash etc.), confirm `REDIS_URL` in
`gateway/.env` uses the `rediss://` TLS scheme and valid credentials.

### `401 Unauthorized` on every request

**Cause:** The key you sent is not in Redis, or the gateway's Redis is a
*different* database than the one where the key was seeded.

**Fix:** Confirm the key exists and is active:

```bash
redis-cli HGETALL apikey:demo-key-123
curl -H "X-Api-Key: demo-key-123" http://localhost:8000/api/v1/resource
```

The demo key `demo-key-123` is seeded automatically on gateway boot. If you
cleared Redis while the gateway was running, restart the gateway.

### `429 Too Many Requests` immediately

**Cause:** You hit the key's per-minute limit (default `60`), or the bucket
never got refilled because `date`/`Date.now()` on your machine is skewed.

**Fix:** Wait ~1 minute, or raise the limit:

```bash
curl -X POST http://localhost:8000/admin/keys \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo Developer","limit":600,"apiKey":"demo-key-123"}'
```

### The Security Agent isn't blocking anything

1. Confirm the daemon is running (`npm run agent`). It is a *separate process*
   from the gateway — starting the gateway alone does not start it.
2. Check its config: `GET http://localhost:8000/admin/agent/logs` → `config`.
   The agent only acts when a single IP produces ≥ `max429Violations` (default
   `5`) `429`s (or `max401Violations` `401`s) inside the sliding 15 s window.
3. Send a burst from one IP to trigger it:
   ```bash
   for i in $(seq 1 10); do
     curl -s -H "X-Api-Key: demo-key-123" http://localhost:8000/api/v1/resource > /dev/null
   done
   ```
   Then check `GET /admin/metrics` → `blacklist`.

> 💡 All 10 requests in the burst consume the token bucket (60/min), so they
> return `429` after the first few — that is what the agent counts.

### The orchestrator can't decrypt agent events

**Cause:** The two daemons are using *different* RSA keys. When
`ENCRYPTION_RSA_*` env vars are unset, each process auto-generates its own
ephemeral pair.

**Fix:** Set the same `ENCRYPTION_RSA_PRIVATE_KEY` / `ENCRYPTION_RSA_PUBLIC_KEY`
on both processes (or rely on the Kubernetes Secret, which mounts one shared
pair). See [Architecture §8](./ARCHITECTURE.md#8-encrypted-threat-events-hybrid-aes-rsa).

### The AI Control Center replies with canned text instead of using Gemini

**Cause:** `GEMINI_API_KEY` is unset in the gateway environment, so `/admin/chat`
uses the offline NLP fallback.

**Fix:** Add `GEMINI_API_KEY=<your key>` to `gateway/.env` and restart the
gateway. (If you deploy to Kubernetes, set it in the Secret.)

---

## 2. Docker Compose

### `docker compose up` fails building

- Port conflicts: `docker compose stop` anything already on `8000/8001/3000/5678/6379/5432`.
- Check `docker compose logs gateway` for startup errors — the gateway container
  exits if Redis is unreachable, and Redis must start first (`depends_on` only
  waits for *container start*, not Redis readiness).

### Containers run but `localhost:3000` shows a blank page

**Fix:** hard-refresh the browser (the console is served by nginx and caches the
previous build). If it persists, `docker compose logs frontend`.

### n8n workflows fail calling the gateway

**Cause:** The workflow nodes call `http://gateway:8000`, which only resolves on
the compose network. If you imported the workflow into an n8n instance *outside*
this compose stack (e.g. your own n8n), it cannot reach that hostname.

**Fix:** Run n8n from this compose file, or change the HTTP node URL to your
gateway's address.

### Everything restarts in a loop

`docker compose ps` shows `Restarting`. **Cause:** a service crash-loops.
**Fix:** `docker compose logs <service>` and address the specific error (most
commonly Redis connectivity or a missing env var).

---

## 3. Kubernetes

The [k8s README](../k8s/README.md#-troubleshooting) covers cluster-specific
issues in detail. The most common:

| Symptom | Likely cause / fix |
|---------|--------------------|
| Pods stuck `Pending` | No metrics-server (HPA), unschedulable PVC, or images not loaded into the cluster. |
| Gateway `CrashLoopBackOff` | Redis password mismatch between `secrets.yaml` and what the gateway reads — re-apply matching secrets. |
| Cross-pod decrypt fails | RSA keys diverged — both agent daemons must mount the *same* Secret. |
| DNS resolution fails inside the cluster | NetworkPolicy dropped DNS — check the kube-dns egress rule. |
| SSE stream drops after ~60 s | Missing `proxy-read-timeout` annotation on the ingress. |
| Probes failing after a secret rotation | Existing PVC holds data under the *old* credentials. |

---

## 4. MCP Server

### `Transport closed` when the AI client connects

- In **stdio** mode the process must stay alive. Run it from a terminal first to
  confirm it starts (`node mcp-server/index.js`) and that Redis is reachable.
- In **SSE** mode confirm the server is listening on `8001`:
  ```bash
  curl -N http://localhost:8001/sse
  ```
  (leave this streaming in a terminal while the client connects).

### Tools error with "command not found" style messages

The MCP client spawns `node mcp-server/index.js` with the working directory of
the *client*. Ensure the MCP server's own `node_modules` are installed
(`npm --prefix mcp-server install`) — it must be able to resolve `redis` and
`@modelcontextprotocol/sdk`.

### The hardcoded `d:/...` path in the console's MCP snippet

The Developer Console's "MCP Server Connect" tab shows a ready-to-copy config
that includes the machine-specific path `d:/smart-gateway-mcp/mcp-server/index.js`
that was used when the demo was recorded. **Replace `args` with the absolute
path of your own checkout** before using it — see
[API Reference §5](./API_REFERENCE.md#5-mcp-admin-server) for portable examples.

---

## 5. General

### `npm test` fails

Run the suites separately to isolate:

```bash
npm --prefix gateway test
npm --prefix mcp-server test
```

The tests mock Redis (no server required). A failure usually means a package
version drift — run `npm install` in the failing directory and retry.

### Redis keys accumulate (`telemetry:*`, `rate:limit:*`)

By design: counters are unbounded, request logs and buckets self-expire.
- `telemetry:recent_requests` / `telemetry:agent_logs` are trimmed to the last
  ~50 entries by the writers.
- `rate:limit:*` keys expire after 24 h of inactivity.
- For long-running deployments, set a Redis `maxmemory` policy
  (`allkeys-lru`) and alert on eviction.

### Where is everything documented?

| Topic | Doc |
|-------|-----|
| How the pieces fit | [Architecture](./ARCHITECTURE.md) |
| Every endpoint / tool | [API Reference](./API_REFERENCE.md) |
| Deploy it anywhere | [Deployment](./DEPLOYMENT.md) |
| Contributing | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Security disclosures | [SECURITY.md](../SECURITY.md) |

---

## 6. Reporting a Bug

If the checklist above did not help, open an issue with:

1. Deployment target (local / compose / k8s) and exact commands run.
2. The full error output and `docker compose logs` (if applicable).
3. The state of `GET http://localhost:8000/admin/metrics` at failure time.
4. Steps to reproduce, ideally in ≤ 5 commands.
