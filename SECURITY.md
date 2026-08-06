# 🔒 Security Policy

APIShield is an API gateway — its whole job is protecting other systems — so we
take security reports seriously and aim to respond quickly and transparently.

## Supported versions

| Version | Supported |
|---------|-----------|
| `main` | ✅ actively developed |
| Any tagged release | ✅ supported |
| Older commits | ❌ not supported |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.** Instead,
email **mithil.gala@gmail.com** with the subject `[APIShield Security] <summary>`.

Include as much of the following as you can:

1. **Affected component** — gateway, MCP server, console, k8s manifests, n8n.
2. **Severity** — your assessment (critical / high / medium / low).
3. **Steps to reproduce** — minimal commands or a curl sequence.
4. **Impact** — what an attacker could do, and under what assumptions.
5. **Suggested fix**, if you have one.

### What happens next

- We acknowledge receipt within **48 hours**.
- We investigate, reproduce, and assess impact.
- We keep you informed as a fix lands, and credit you in the release notes
  (unless you prefer to stay anonymous).

## Known security considerations (by design)

These are documented behaviour, not vulnerabilities — but please read them
before deploying:

- **`/admin/*` and `/downstream/*` carry no application-level auth.** The admin
  API is the control plane. In production it must sit behind ingress
  basic-auth / mTLS / a VPN. See [Architecture §4.1](docs/ARCHITECTURE.md#41-protected-vs-unprotected-routes)
  and the commented annotations in [`k8s/ingress.yaml`](k8s/ingress.yaml).
- **Demo credentials** (`demo-key-123`, compose Postgres password, example
  secrets) are for development only. Regenerate everything before production:
  `./k8s/generate-secrets.sh`.
- **Threat events** are encrypted end-to-end between the Security Agent and the
  Multi-Agent Orchestrator, but Redis itself should still run with `requirepass`
  and, ideally, TLS (the k8s manifests enable auth + AOF by default).
- **`/admin/chat`** sends gateway state to the Gemini API only when
  `GEMINI_API_KEY` is set; without it, the offline NLP fallback makes no
  outbound calls. The k8s network policy blocks that egress unless you
  explicitly allow it.

## Security hardening checklist

- [ ] Rotate all demo credentials and generate fresh secrets.
- [ ] Terminate TLS at the ingress / reverse proxy.
- [ ] Protect `/admin/*` with basic-auth / mTLS / VPN.
- [ ] Enable Redis `requirepass` + TLS (`rediss://`).
- [ ] Apply the default-deny NetworkPolicies.
- [ ] Run containers as a non-root user (UID 1000) — already the default in the
      Dockerfiles and manifests.
- [ ] Keep Node 20 base images and dependencies patched (`npm audit`).

## Thanks

We appreciate every report — responsible disclosure makes the project better for
everyone who uses it.
