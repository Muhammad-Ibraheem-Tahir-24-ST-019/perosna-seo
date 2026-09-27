#!/usr/bin/env bash
# Run this on the VPS from the repo root: ./scripts/deploy.sh
# Fills in any still-placeholder secrets in .env.production, commits +
# pushes them, then rebuilds and restarts the stack.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.production.example to .env.production and fill in the non-secret values first (domain, email, etc.), then re-run this script." >&2
  exit 1
fi

changed=0

fill_secret() {
  local key="$1"
  local current
  current=$(grep -E "^${key}=" "$ENV_FILE" | cut -d= -f2- || true)
  if [ -z "$current" ] || [ "$current" = "replace-me" ]; then
    local value
    value=$(openssl rand -hex 32)
    sed -i "s#^${key}=.*#${key}=${value}#" "$ENV_FILE"
    echo "Generated ${key}"
    changed=1
  fi
}

# Only secrets with no persisted state depending on them (safe to regenerate
# any time). POSTGRES_PASSWORD / MINIO_* are deliberately NOT auto-generated
# here: once postgres's data volume is initialized with a password, changing
# the value in .env.production later does not change the actual DB user's
# password, so auto-rotating it here would silently break DB auth.
fill_secret SESSION_SECRET
fill_secret ENCRYPTION_KEY
fill_secret PAYMENT_WEBHOOK_SECRET

if [ "$changed" = "1" ]; then
  git add "$ENV_FILE"
  git commit -m "Auto-generate production secrets"
  git push
  echo "Committed and pushed generated secrets."
else
  echo "No placeholder secrets found."
fi

$COMPOSE build
$COMPOSE up -d
$COMPOSE ps
