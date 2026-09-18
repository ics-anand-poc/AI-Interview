# =============================================================================
# AI-Interview-POC — faceproj (YOLO monitoring + FaceNet identity verification)
# Build context: Backend/faceproj/  (docker compose -f Backend/docker-compose.yml build)
#
# Model weights (YOLO_WEIGHTS, e.g. yolo11n.pt) are NOT baked into this image —
# see Backend/faceproj/README.md for where to download them. Mount them at
# runtime (e.g. a bind mount to /app/<weights-file>) or fetch them via an
# entrypoint script if you need a fully self-contained image.
# =============================================================================
FROM python:3.11-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000"]
