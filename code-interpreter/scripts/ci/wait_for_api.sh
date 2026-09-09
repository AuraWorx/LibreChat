#!/usr/bin/env bash
set -euo pipefail

url="${1:-http://localhost:8000/health}"
attempts="${2:-24}"
sleep_seconds="${3:-5}"

for _ in $(seq 1 "${attempts}"); do
  if curl -fs "${url}" >/dev/null; then
    exit 0
  fi
  sleep "${sleep_seconds}"
done

exit 1
