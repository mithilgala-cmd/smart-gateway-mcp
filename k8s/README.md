# ☸️ APIShield — Production-Ready Kubernetes Manifests

Production-hardened Kubernetes configuration for the APIShield smart gateway
stack. The manifests include **resource limits, health probes, secrets
management, a dedicated namespace, network policies, an ingress controller,
horizontal autoscaling, and disruption budgets** — so the cluster behaves like a
real production environment.

## 📦 What's in this directory

| File | Purpose |
|------|---------|
| `namespace.yaml` | Dedicated `apishield` namespace |
| `configmap.yaml` | Non-secret shared config (ports, transport, Redis host) |
| `secrets.example.yaml` | **Demo** secrets + RSA keys (works out of the box) |
| `generate-secrets.sh` | Regenerates `secrets.yaml` with fresh credentials |
| `gateway-deployment.yaml` | API Gateway (2 replicas, ClusterIP, probes) |
| `frontend-deployment.yaml` | React console behind nginx (2 replicas, ClusterIP) |
| `mcp-server-deployment.yaml` | MCP admin server (TCP probes, ClusterIP) |
| `agents-deployment.yaml` | Security Agent + Multi-Agent Orchestrator daemons |
| `n8n-deployment.yaml` | n8n workflow engine (Postgres-backed, ClusterIP) |
| `postgres-deployment.yaml` | PostgreSQL 16 (PVC, exec probes, ClusterIP) |
| `redis-deployment.yaml` | Redis 7 with **auth enabled** + AOF (ClusterIP) |
| `ingress.yaml` | NGINX ingress — single entry point, host-based routing |
| `hpa.yaml` | Horizontal autoscalers (gateway, mcp-server) |
| `pdb.yaml` | PodDisruptionBudget for the gateway |
| `network-policy.yaml` | Default-deny + least-privilege pod segmentation |

## 🏗️ Cluster Topology

```
                         ┌──────────────────────────┐
                         │   NGINX Ingress (TLS)    │
                         └──────┬─────┬─────┬───────┘
        apishield.local ────────┘     │     │        *.apishield.local
   ┌──────────────────────────────────┼─────┼──────────────────────┐
   │                        namespace: apishield                  │
   │  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
   │  │ frontend │   │ gateway  │   │ mcp-server│  │   n8n    │   │
   │  │  (nginx) │   │ 2-10 HPA │   │  1-5 HPA │   │          │   │
   │  └──────────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   │
   │                       │             │               │        │
   │   security-agent ─────┤             │               │        │
   │   multi-agent-orch ───┼─► Redis ◄───┘               │        │
   │                       │   (auth+AOF)                └─► Postgres
   │                       └───────────────────────────────►(webhooks)
   └──────────────────────────────────────────────────────────────┘
```

## 🧰 Prerequisites

- A Kubernetes cluster (kind, minikube, k3s, or cloud — EKS/GKE/AKS)
- **NGINX Ingress Controller**
  ```bash
  helm install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx --create-namespace
  ```
- **metrics-server** (required for the HPAs)
  ```bash
  minikube addons enable metrics-server   # or your platform's equivalent
  ```
- **cert-manager** (optional — for automatic TLS, see below)
- Local images `apishield-gateway:latest`, `apishield-frontend:latest`,
  `apishield-mcp-server:latest` loaded into the cluster
  ```bash
  docker build -t apishield-gateway:latest gateway/
  docker build -t apishield-mcp-server:latest mcp-server/
  docker build -t apishield-frontend:latest frontend/
  # kind:  kind load docker-image apishield-gateway:latest ...
  # minikube: minikube image load apishield-gateway:latest ...
  ```

## 🔐 Secrets

`secrets.example.yaml` ships with **real working demo credentials** so the stack
works on first apply. It contains:

- Postgres user / password / database
- Redis password (Redis now runs with `--requirepass`)
- The **RSA-2048 key pair** used for the hybrid AES-RSA payload encryption
  between the Security Agent and the Multi-Agent Orchestrator

> ⚠️ **Never use the example values in production.** Regenerate everything:

```bash
./k8s/generate-secrets.sh     # writes a fresh k8s/secrets.yaml (gitignored)
kubectl apply -f k8s/secrets.yaml
```

> 🔑 **Why the RSA keys matter:** the security agent *encrypts* threat events
> onto the Redis threat queue and the orchestrator *decrypts* them. If each pod
> auto-generated its own key pair (the fallback when the env vars are unset),
> the orchestrator could not decrypt the agent's events. Both daemons therefore
> mount the **same** pair from the Secret.

> ⚠️ Regenerating passwords on an **existing** cluster will lock out pods that
> already hold data encrypted/authenticated with the old values (Redis AOF /
> Postgres). Rotate the PVCs or reconcile passwords when changing secrets.

## 🚀 Quick Start

```bash
# 1. Create the namespace, secrets, and config
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.example.yaml   # or secrets.yaml (generated)
kubectl apply -f k8s/configmap.yaml

# 2. Deploy the workloads (order matters for depends-on)
kubectl apply -f k8s/postgres-deployment.yaml
kubectl apply -f k8s/redis-deployment.yaml
kubectl apply -f k8s/gateway-deployment.yaml
kubectl apply -f k8s/mcp-server-deployment.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/n8n-deployment.yaml
kubectl apply -f k8s/agents-deployment.yaml

# 3. Scale, resilience, and networking policies
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/pdb.yaml
kubectl apply -f k8s/network-policy.yaml

# 4. Expose everything behind the ingress
kubectl apply -f k8s/ingress.yaml

# 5. Watch the rollout
kubectl -n apishield get pods,svc,hpa,pdb,ingress -w
```

## 🌐 Accessing the Stack

The ingress routes by hostname. On a local cluster add these to `/etc/hosts`
(or use a wildcard DNS service):

```text
<cluster-ingress-ip>  apishield.local      api.apishield.local  mcp.apishield.local  n8n.apishield.local
```

| Host | Service |
|------|---------|
| `apishield.local` | Developer Console (React) |
| `api.apishield.local` | API Gateway — admin + proxied APIs |
| `mcp.apishield.local` | MCP Admin Server (SSE stream) |
| `n8n.apishield.local` | n8n dashboard |

Get the ingress controller's address:

```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller
```

## 🔒 TLS (automatic certificates)

Install cert-manager, create a `ClusterIssuer`, then uncomment the `tls:` block
in `ingress.yaml`:

```bash
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm install cert-manager jetstack/cert-manager --namespace cert-manager \
  --create-namespace --set crds.enabled=true
```

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: you@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

Set `annotations.cert-manager.io/cluster-issuer: letsencrypt-prod` on the
Ingress and uncomment `spec.tls`.

## 📈 Scaling & Resilience

- **Gateway**: 2 replicas, HPA scales 2 → 10 on CPU. Stateless, so it scales
  horizontally. A **PDB** guarantees ≥1 replica survives voluntary disruptions
  (node drains, cluster upgrades).
- **mcp-server**: HPA scales 1 → 5.
- **Redis / Postgres / n8n**: single-replica with PVCs (stateful — scale up
  requires a HA topology; the PDB deliberately excludes them because evicting
  their only pod is never safe).
- Every container declares **resource requests/limits**, so the scheduler packs
  pods predictably and the HPA has a CPU target to act on.

## 🛡️ Network Policies

The stack runs under **default-deny**: no pod-to-pod traffic unless a policy
explicitly allows it. `network-policy.yaml` opens only the verified paths:

```
redis     ← gateway, mcp-server, security-agent, multi-agent-orchestrator
postgres  ← n8n
gateway   ← ingress-nginx (public API), n8n (webhook nodes)
frontend  ← ingress-nginx
mcp-server ← ingress-nginx (SSE stream)
n8n       ← ingress-nginx
```

Every egress rule also permits DNS (→ kube-dns), and kubelet health probes
bypass policies, so readiness/liveness probes keep working.

- n8n workflow nodes that call **public APIs** need the commented internet
  egress rule in `allow-n8n` — enable it only if your workflows require it.
- The gateway's `/admin/chat` calls the Gemini API when `GEMINI_API_KEY` is set.
  Add an internet egress rule to `allow-gateway` before enabling it (the unset
  key falls back to offline sandbox NLP, which needs no egress).
- Externally-hosted downstream proxy targets (the `DOWNSTREAM_*` env vars) also
  require egress from `allow-gateway`.
- Debug: `kubectl -n apishield describe networkpolicy`
- Last resort: `kubectl -n apishield delete networkpolicy --all`

## 🤖 The Agent Daemons

`agents-deployment.yaml` runs the two daemons that make APIShield
self-healing, using the gateway image's bundled scripts:

- **security-agent** → scans telemetry, blocks offending IPs, pushes *encrypted*
  threat events to the Redis threat queue.
- **multi-agent-orchestrator** → runs the Auditor → Mitigator → Reporter
  workflow, decrypting those events with the shared RSA private key.

Both are single-replica pollers with no HTTP surface, so they carry resource
limits but no probes (Kubernetes restarts a crashed container; the daemons
self-heal from Redis outages via exponential backoff).

## ✅ Production Checklist

- [ ] Regenerate secrets (`./k8s/generate-secrets.sh`) — never the example file
- [ ] Set a real `GEMINI_API_KEY` (uncomment in `secrets.example.yaml`) for full
      AI chat, or leave unset for the sandbox NLP fallback
- [ ] Enable n8n basic auth (`N8N_BASIC_AUTH_ACTIVE=true`) and HTTPS
- [ ] Push images to a private registry and set `imagePullPolicy: IfNotPresent`
      with digest pinning
- [ ] Add cert-manager TLS (`cert-manager.io/cluster-issuer` annotation)
- [ ] Enable n8n internet egress only if your workflows need it
- [ ] Back up the PVCs (`velero`, or platform snapshots)
- [ ] Route the gateway admin endpoints behind ingress HTTP basic-auth
      (commented annotations in `ingress.yaml`)

## 🐞 Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Pods stuck `Pending` | No metrics-server (HPA), PVC unschedulable, or images not loaded |
| Gateway `CrashLoopBackOff` | Redis password mismatch — check `kubectl logs`; re-apply matching secrets |
| Cross-pod decrypt fails | RSA keys diverged — both agents must mount the same Secret |
| ClusterDNS resolution fails | NetworkPolicy dropped DNS — verify the kube-dns egress rule |
| SSE stream drops after ~60s | Missing `proxy-read-timeout` annotation on the ingress |
| Probes failing on stateful pods | Existing PVC has data under the *old* credentials after a secret rotation |

## 📄 Related

- [Architecture & getting started (root README)](../README.md)
- [CI/CD pipeline](../.github/workflows/ci.yml)
- [Docker Compose local stack](../docker-compose.yml)
