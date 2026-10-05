#!/usr/bin/env bash
# Starts the shared Next.js dev server on port 3000 if it is not already answering.
# Safe to run from several shells at once (flock serializes starts).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .scratch
exec 9>.scratch/dev-server.lock
flock 9
if curl -s -o /dev/null -m 5 http://localhost:3000/api/health; then
  echo "dev server already running"
  exit 0
fi
nohup npx next dev -p 3000 > .scratch/dev-server.log 2>&1 &
for i in $(seq 1 60); do
  if curl -s -o /dev/null -m 5 http://localhost:3000/api/health; then
    echo "dev server started"
    exit 0
  fi
  sleep 2
done
echo "dev server did not start; see .scratch/dev-server.log" >&2
exit 1
