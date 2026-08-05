#!/usr/bin/env bash
#
# Regenerates k8s/secrets.yaml with fresh random credentials and a brand-new
# RSA-2048 key pair for the gateway's hybrid AES-RSA payload encryption.
#
# The output file is gitignored — commit the generator and secrets.example.yaml,
# never secrets.yaml.
#
# Usage:  ./k8s/generate-secrets.sh
# Apply:  kubectl apply -f k8s/secrets.yaml
#
# Requires: openssl, base64
set -euo pipefail

cd "$(dirname "$0")"

# Portable base64 (GNU -w0, BSD -b0, fallback).
b64() {
  if base64 -w0 >/dev/null 2>&1 <<<"test"; then
    base64 -w0
  elif base64 -b0 >/dev/null 2>&1 <<<"test"; then
    base64 -b0
  else
    base64
  fi
}

gen_password() { openssl rand -hex 24; }

echo "==> Generating postgres / redis passwords (hex, URL-safe)"
POSTGRES_PASSWORD=$(gen_password)
REDIS_PASSWORD=$(gen_password)

echo "==> Generating RSA-2048 key pair for payload encryption"
PRIV_KEY=$(openssl genrsa 2048 2>/dev/null)
PUB_KEY=$(printf '%s' "$PRIV_KEY" | openssl rsa -pubout 2>/dev/null)

cat > secrets.yaml <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: apishield-secrets
  namespace: apishield
  labels:
    app.kubernetes.io/part-of: apishield
type: Opaque
data:
  POSTGRES_USER: "$(printf '%s' 'n8n_user' | b64)"
  POSTGRES_PASSWORD: "$(printf '%s' "$POSTGRES_PASSWORD" | b64)"
  POSTGRES_DB: "$(printf '%s' 'n8n_db' | b64)"
  REDIS_PASSWORD: "$(printf '%s' "$REDIS_PASSWORD" | b64)"
  ENCRYPTION_RSA_PRIVATE_KEY: "$(printf '%s' "$PRIV_KEY" | b64)"
  ENCRYPTION_RSA_PUBLIC_KEY: "$(printf '%s' "$PUB_KEY" | b64)"
EOF

echo "==> Wrote k8s/secrets.yaml"
echo "    Apply with: kubectl apply -f k8s/secrets.yaml"
echo "    NOTE: existing Redis / Postgres data (PVCs) will reject the new passwords."
echo "    Rotate PVCs or re-apply passwords accordingly on an existing cluster."
