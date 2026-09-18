@echo off
cd /d "%~dp0"
if not exist "Qwen3.5-4B-Q4_K_M.gguf" (
  echo Missing Qwen3.5-4B-Q4_K_M.gguf in AI\
  exit /b 1
)
if not exist ".llm-api-key" (
  echo Missing AI\.llm-api-key. Generate one and set LOCAL_LLM_API_KEY in .env.local
  exit /b 1
)
powershell -NoProfile -Command "$k=(Get-Content -Raw '.llm-api-key').Trim(); @{apiKey=$k} | ConvertTo-Json | Set-Content -NoNewline -Encoding ascii .llm-ui-config.json"
if not exist ".llm-ui-config.json" (
  echo Failed to write AI\.llm-ui-config.json
  exit /b 1
)
echo Qwen 4B API server on http://127.0.0.1:8080
echo Chat UI and the app both use LOCAL_LLM_API_KEY. Leave this window open.
:loop
.\llamafile-0.10.5.exe --server --host 127.0.0.1 --port 8080 --model "Qwen3.5-4B-Q4_K_M.gguf" --ctx-size 2048 --threads 4 --parallel 1 --gpu disable --reasoning off --reasoning-budget 0 --chat-template-kwargs "{\"enable_thinking\":false}" --api-key-file ".llm-api-key" --ui-config-file ".llm-ui-config.json"
echo Qwen stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
