#!/usr/bin/env bash
# Dev launcher (Linux). Backend in Docker (detached), frontend dev on host.
#   ./run.sh          start backend, wait healthy, run frontend dev (Ctrl-C stops dev, backend stays up)
#   ./run.sh stop     stop backend containers
#   ./run.sh down     stop + remove containers (add -v yourself to wipe Postgres)
set -euo pipefail
cd "$(dirname "$0")"

BACKEND="postgres hq-server bff-gateway edge-kathmandu edge-pokhara edge-sarlahi"

case "${1:-up}" in
  stop) exec docker compose stop $BACKEND ;;
  down) exec docker compose down ;;
esac

# hq_state is bind-mounted and written by the container's non-root user (uid 999);
# host files are uid 1000, so grant write. ponytail: chmod is the dev shortcut —
# permanent fix is `user: "1000:1000"` on hq-server in docker-compose.yml.
chmod -R a+rwX hq_state 2>/dev/null || true

echo "→ starting backend…"
docker compose up -d $BACKEND

echo -n "→ waiting for BFF :4000 "
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null localhost:4000/api/health; then echo " ready"; break; fi
  echo -n .; sleep 2
done
curl -fs -o /dev/null localhost:4000/api/health || { echo " BFF not healthy — check: docker compose logs bff-gateway"; exit 1; }

echo "→ frontend dev on http://localhost:3000  (Ctrl-C stops it; backend keeps running)"
cd frontend
[ -d node_modules ] || npm install
exec npm run dev
