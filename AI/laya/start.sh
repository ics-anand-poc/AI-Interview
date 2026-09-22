#!/usr/bin/env bash
# Local Laya classifier on ICSBETINTAPP01. Do not run next to Qwen on a 4 GB VM.
set -euo pipefail
cd "$(dirname "$0")"

HOST="${LAYA_HOST:-127.0.0.1}"
PORT="${LAYA_PORT:-8090}"
export LAYA_HOST="$HOST"
export LAYA_PORT="$PORT"
export LAYA_DEVICE="${LAYA_DEVICE:-cpu}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 3.10+ is required for Laya."
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "Creating AI/laya/.venv …"
  python3 -m venv .venv
fi

echo "Installing / updating Laya…"
.venv/bin/python -m pip install -q -r requirements.txt

echo "Laya API on http://${HOST}:${PORT}"
while true; do
  .venv/bin/python server.py || true
  echo "Laya stopped. Restarting in 3 seconds..."
  sleep 3
done
