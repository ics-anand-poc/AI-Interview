# faceproj

Persistent biometric service used by the AI-Interview platform for identity
verification (`/compare`) and live proctoring monitoring (`/monitor`).

Models (MTCNN, FaceNet, YOLO nano) load once at process startup instead of
per-request, which is the main latency fix over the old subprocess-per-call
approach.

## Setup

```
cd faceproj
pip install -r requirements.txt
```

`yolo11n.pt` (~5MB, COCO-pretrained) downloads automatically on first run via
`ultralytics`. Override the weights path with `YOLO_WEIGHTS` if needed.

## Run

```
uvicorn service:app --host 0.0.0.0 --port 8000
```

Set `FACEPROJ_SERVICE_URL=http://127.0.0.1:8000` in the Next.js app's
`.env.local` — **the scheme matters**: this is a plain HTTP server, so using
`https://` here will fail with an SSL/TLS handshake error
(`ERR_SSL_WRONG_VERSION_NUMBER` on the Node side, "Invalid HTTP request
received" repeated in the uvicorn log). If `FACE_MATCH_KEY` is set in
`.env.local`, the service requires the same value on every request's
`X-Face-Match-Key` header; leave it blank to disable that check.

## Endpoints

- `POST /compare` — `{ idImage, selfieImage }` (base64 or data URLs) → `{ matched, confidence, reason }`
- `POST /monitor` — `{ frame }` (base64 or data URL) → `{ state, personCount, phoneDetected }`
  - `state` is one of `one`, `none`, `multiple`, `phone`, `left`, `right`, `up`, `down`
- `GET /health`

## Design notes

- Face detection/embedding: `facenet-pytorch` (MTCNN + InceptionResnetV1/FaceNet).
  MTCNN's 5-point landmarks are used to run an explicit similarity-transform
  alignment (eyes/nose/mouth warped to a canonical template) before embedding,
  instead of a raw crop+resize — this is what actually helps with skewed or
  low-quality ID scans.
- Monitoring: YOLO nano (`yolo11n.pt`) detects `person` and `cell phone` (COCO
  classes) per frame — covers face-missing / multiple-people / phone-detected
  in one small model. When exactly one person is present, MTCNN (already
  loaded for verification) is reused on that crop to get gaze direction
  (left/right/up/down), so no second model is loaded for pose.
- `compare_images.py` is kept as a thin CLI over the same pipeline for manual
  testing; it is no longer used by the Next.js app.
- The Node side (`src/lib/local-http.ts`) calls this service with Node's raw
  `http`/`https` modules rather than `fetch`, since Next.js's fetch patch
  honors `HTTP_PROXY`/`HTTPS_PROXY` env vars — on a machine with a corporate
  proxy configured, that can silently route even `localhost` calls through
  the proxy and break them. Raw `http.request` bypasses that.
