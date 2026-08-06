# 🔁 APIShield — n8n Workflows

Low-code automation that handles the **asynchronous, non-critical** work the
gateway should never block on. n8n calls the same admin API the Developer
Console and MCP Server use — one control plane, three clients.

## 📦 Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| [`developer_onboarding.json`](workflows/developer_onboarding.json) | `POST /webhook/developer-onboarding` | Takes a developer's name, generates an API key, provisions it via the gateway (`POST /admin/keys`), and returns it to the caller. |
| [`abuse_prevention_cron.json`](workflows/abuse_prevention_cron.json) | Cron, every 1 minute | Pulls gateway metrics (`GET /admin/metrics`), analyses the recent request log for abusive IPs, and blacklists offenders (`POST /admin/blacklist`). |

## 🧩 Node overview

**Developer Onboarding**

```
Webhook Ingest → Generate API Key → Save to Redis via Gateway → Respond to Webhook
```

**Abuse Prevention Cron**

```
Schedule Trigger (1m) → Get Gateway Metrics → Analyze Abusive IPs → Blacklist IP in Redis → Notify Admin
```

> ℹ️ "Notify Admin" is a placeholder node — replace it with email (SMTP), Slack,
> or any n8n notification node you use.

## 🚀 Import & activate

1. Start the stack (`docker compose up --build -d`) or run n8n standalone.
2. Open the n8n dashboard at `http://localhost:5678`.
3. **Workflows → Add workflow → ⋯ → Import from file** → select a
   `.json` from this folder.
4. Click **Active** (top-right) to enable it.

## 🧪 Try it

```bash
curl -X POST http://localhost:5678/webhook/developer-onboarding \
  -H "Content-Type: application/json" \
  -d '{"developer":"Ada Lovelace"}'
```

The response should include a fresh API key. Verify it in the gateway:

```bash
curl -H "X-Api-Key: <returned-key>" http://localhost:8000/api/v1/resource
```

## ⚙️ Configuration

- The HTTP nodes call the gateway at `http://gateway:8000`, which resolves only
  on the **Docker compose network**. Running n8n elsewhere? Point the nodes at
  your gateway's address instead (see
  [Troubleshooting](../docs/TROUBLESHOOTING.md#2-docker-compose)).
- The abuse cron uses the same abuse criteria as the
  [Security Agent](../gateway/README.md) — it is a complementary, configurable
  sweep rather than a replacement for the agent's sub-second response.

## 📚 Related

- [Architecture — n8n automation layer](../docs/ARCHITECTURE.md#11-n8n-automation)
- [Deployment — importing workflows](../docs/DEPLOYMENT.md#25-import-the-n8n-workflows)
- [Root README](../README.md)
