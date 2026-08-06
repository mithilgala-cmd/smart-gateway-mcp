# 💻 APIShield — Developer Console

The human interface for APIShield: a **React 19 + Vite** dashboard for exploring
the gateway, watching live telemetry, driving the AI copilot, and wiring up the
MCP server. It is not a read-only chart board — every panel acts on the gateway's
admin API, so anything you do here is immediately visible to the MCP server and
n8n.

## ✨ Feature tour

The console has four tabs:

| Tab | What it does |
|-----|--------------|
| **Developer Sandbox** | Call the gateway with the sandbox key (`demo-key-123`), run traffic simulations (steady / DDoS / auth-attack), watch live request logs. |
| **Admin Telemetry** | Live metrics (requests, rate-limited, unauthorized), Redis keyspace inspector, blacklist & API-key management. |
| **AI Control Center** | Natural-language copilot (`POST /admin/chat`), one-click abuse scenarios, the multi-agent pipeline visualiser, and generated incident reports. |
| **MCP Server Connect** | Point an MCP client at the server and copy a ready-to-use Claude Desktop / Cursor config snippet. |

When the gateway is unreachable the console switches to **simulated mode**, so
the UI stays explorable during development (API calls are faked client-side).

## 🗂️ Project structure

```
frontend/
├── index.html            # HTML shell (fonts, favicon, title)
├── vite.config.js        # Vite + React plugin config
├── eslint.config.js      # ESLint flat config
├── Dockerfile            # Multi-stage build → nginx:alpine static server
├── public/
│   └── favicon.svg       # APIShield logo
└── src/
    ├── main.jsx          # React entry point
    ├── App.jsx           # The entire console (tabs, simulators, visualisers)
    └── index.css         # Dark-theme design system (Linear/Vercel inspired)
```

## 🚀 Getting started

```bash
npm install
npm run dev          # Vite dev server → http://localhost:3000
```

The console talks to the gateway and n8n. Start those first
(`npm run gateway` and the n8n webhook from the repo root, or `docker compose up`).

### URLs the console uses

| What | Default (local) | Where to change |
|------|-----------------|-----------------|
| Gateway API | `http://localhost:8000` | URL field in the top bar of the console. |
| n8n onboarding webhook | `http://localhost:5678/webhook/developer-onboarding` | URL field in the top bar. |

> The local/production defaults are chosen automatically: on `localhost` the
> console uses the compose/local addresses; elsewhere it assumes hosted
> gateways.

## 🧪 Checks

```bash
npm run lint        # ESLint
npm run build       # production build → dist/
npm run preview     # serve the production build locally
```

CI runs `lint` + `build` on every push/PR — see
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## 🐳 Docker

```bash
docker build -t apishield-frontend .
docker run -p 3000:80 apishield-frontend
```

The multi-stage `Dockerfile` builds the static assets in Node 20, then serves
them with nginx — the image has no Node runtime at runtime.

## 📚 Related

- [Architecture — console role in the stack](../docs/ARCHITECTURE.md#10-the-developer-console)
- [API Reference — the endpoints the console calls](../docs/API_REFERENCE.md)
- [Root README](../README.md)
