#!/usr/bin/env bash
# Always-on Qwen 4B API on ICSBETINTAPP01. Clients use Authorization: Bearer $LOCAL_LLM_API_KEY.
set -euo pipefail
cd "$(dirname "$0")"

MODEL="${MODEL:-Qwen3.5-4B-Q4_K_M.gguf}"
CTX="${CTX:-2048}"
THREADS="${THREADS:-2}"
PORT="${PORT:-8080}"
HOST="${HOST:-127.0.0.1}"
BIN="${BIN:-llamafile-0.10.5.exe}"
KEY_FILE="${KEY_FILE:-.llm-api-key}"

if [[ ! -f "$MODEL" ]]; then
  echo "Missing model file: $MODEL"
  exit 1
fi
if [[ "$MODEL" == *14B* || "$MODEL" == *14b* || "$MODEL" == *27B* || "$MODEL" == *27b* ]]; then
  echo "Refusing to start $MODEL on a 4 GB VM."
  exit 1
fi
if [[ ! -f "$KEY_FILE" ]]; then
  echo "Missing $KEY_FILE. Put the same secret in LOCAL_LLM_API_KEY for the Next.js app."
  exit 1
fi

if [[ ! -f /swapfile ]] && [[ "$(swapon --show | wc -l)" -eq 0 ]]; then
  echo "No swap detected. Creating 4 GB /swapfile so 4B does not OOM..."
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

chmod +x "$BIN" 2>/dev/null || true
KEY="$(tr -d '\r\n' < "$KEY_FILE")"
printf '{"apiKey":"%s"}' "$KEY" > .llm-ui-config.json
chmod 600 .llm-ui-config.json
echo "Qwen 4B API on http://${HOST}:${PORT}  (Bearer key from ${KEY_FILE})"

while true; do
  "./$BIN" \
    --server \
    --host "$HOST" \
    --port "$PORT" \
    --model "$MODEL" \
    --ctx-size "$CTX" \
    --threads "$THREADS" \
    --parallel 1 \
    --gpu disable \
    --reasoning off \
    --reasoning-budget 0 \
    --chat-template-kwargs '{"enable_thinking":false}' \
    --api-key-file "$KEY_FILE" \
    --ui-config-file ".llm-ui-config.json" || true
  echo "Qwen stopped. Restarting in 3 seconds..."
  sleep 3
done
