#!/bin/bash
# Prepare a fresh Claude Code on the web container so build, tests, the
# sandbox smoke test, and business verification all run. Local Windows
# workspaces are left untouched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

npm ci --no-audit --no-fund

# data/ is runtime state and never committed; several tests write sheets there.
mkdir -p data

# Business verification needs a .env; the template is dashboard-first and holds
# no secrets. Never overwrite an existing .env.
if [ ! -f .env ]; then
  cp config/business.env.template .env
fi

# The sandbox smoke test copies data/business.db. Cloud containers have no
# production data, so seed an empty-schema database for it instead.
if [ ! -f data/business.db ]; then
  npx ts-node -e "require('./src/business/db').openDb('./data/business.db').close()"
fi

npm run build
