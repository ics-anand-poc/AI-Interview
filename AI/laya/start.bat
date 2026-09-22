@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python 3.10+ is required for Laya.
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating AI\laya\.venv …
  python -m venv .venv
)
echo Installing / updating Laya (first run downloads PyTorch + weights)…
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo pip install failed.
  exit /b 1
)
echo Laya API on http://127.0.0.1:8090  Leave this window open.
:loop
".venv\Scripts\python.exe" server.py
echo Laya stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
