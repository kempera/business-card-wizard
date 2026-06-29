#!/usr/bin/env bash
set -euo pipefail

# Run this on the Hostinger VPS from /opt/business-card-wizard after copying the repo there.
# It creates a local-only Postgres-backed Business Card Wizard deployment.

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Edit it before starting the stack."
fi

if ! grep -q '^POSTGRES_PASSWORD=' .env; then
  password="$(openssl rand -base64 36 | tr -d '\n')"
  {
    echo "POSTGRES_DB=business_card_wizard"
    echo "POSTGRES_USER=bcw_user"
    echo "POSTGRES_PASSWORD=$password"
  } >> .env
  echo "Added generated Postgres credentials to .env."
fi

docker compose -f docker-compose.hostinger.yml up -d --build

echo "Business Card Wizard stack started. App is bound to 127.0.0.1:3007."
