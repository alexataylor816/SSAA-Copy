#!/usr/bin/env bash
# Start the backend (port 8000) and the website (port 8082) together; Ctrl+C stops both.
# The Linux/Codespaces counterpart of dev.ps1.
set -euo pipefail
cd "$(dirname "$0")/.."

if lsof -i :8082 >/dev/null 2>&1 || (command -v ss >/dev/null && ss -ltn | grep -q ':8082 '); then
  echo "Port 8082 is already in use; the app is probably running in another terminal."
  exit 0
fi

(cd backend && npm run dev) &
backend_pid=$!
(cd web && npm run dev) &
web_pid=$!
trap 'kill "$backend_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT

echo "Backend: http://localhost:8000/health"
echo "Website: http://localhost:8082 (in Codespaces, open the Ports tab for the link)"
wait
