#!/usr/bin/env bash
# One-time setup for a GitHub Codespace (run by .devcontainer/devcontainer.json).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Installing backend and web dependencies..."
(cd backend && npm ci)
(cd web && npm ci)

# A Codespace link can be made public, so never run it on the well-known
# default signing secret, and never show password-reset codes on screen.
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  secret="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  jwt="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  sed -i "s/^SECRET_KEY=.*/SECRET_KEY=${secret}/" backend/.env
  sed -i "s/^JWT_SECRET_KEY=.*/JWT_SECRET_KEY=${jwt}/" backend/.env
  printf '\n# Codespace: reset codes go by email only (set SMTP_USER/SMTP_PASS to enable).\nEXPOSE_DEV_CODES=false\n' >> backend/.env
  echo "Created backend/.env with fresh secrets."
fi

echo "Setup done. Start the app with: bash scripts/start-dev.sh"
