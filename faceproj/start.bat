@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python 3.11+ is required for FaceNet.
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating faceproj\.venv ...
  python -m venv .venv
)
echo Installing FaceNet. First run downloads PyTorch CPU wheels...
".venv\Scripts\python.exe" -m pip install -q --upgrade pip
if errorlevel 1 (
  echo pip upgrade failed.
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 (
  echo PyTorch install failed.
  exit /b 1
)
".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info < (3,13) else 1)"
if errorlevel 1 (
  echo Python 3.13: using prebuilt wheels, not the Docker numpy==1.26.4 pin.
  ".venv\Scripts\python.exe" -m pip install -q "fastapi==0.115.12" "uvicorn[standard]==0.34.2" "pydantic==2.11.3" "opencv-python-headless>=4.10,<4.13" requests tqdm
  if errorlevel 1 (
    echo pip install failed.
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install -q "facenet-pytorch==2.6.0" --no-deps
) else (
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt
)
if errorlevel 1 (
  echo pip install failed.
  exit /b 1
)
if exist "..\.env.local" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /I "FACE_MATCH_API_KEY=" "..\.env.local"`) do set "FACE_MATCH_API_KEY=%%B"
)
echo FaceNet API on http://127.0.0.1:10000  Leave this window open.
:loop
".venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 10000
echo FaceNet stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
