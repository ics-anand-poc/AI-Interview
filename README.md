# AI-Interview-POC

Resume intelligence + AI-proctored interview platform. Candidates upload a
resume, get analyzed/scored, and take an AI-generated technical interview
with live proctoring (face verification + monitoring). Also includes an
Employee Portal (learning paths, assigned tests) and an Admin Portal.

This repo is split into two independently-runnable parts:

```
AI-Interview-POC/
├── Backend/    Python — FastAPI app + faceproj (YOLO/FaceNet) microservice
├── Frontend/   Next.js — UI, and (for now) most business-logic API routes
├── .env.local          # <- real secrets go here (git-ignored), see below
├── API_INVENTORY.md     # Frontend ↔ Backend endpoint-by-endpoint status
├── ARCHITECTURE.md      # more detail on the migration-in-progress
└── docs/SUPABASE_DOCUMENTATION.md   # DB schema, RLS, migrations reference
```

## Architecture

```
Browser
   │
   ▼
Frontend / Next.js  ──────────────┐
   │  (most business logic        │  (migrated endpoints call
   │   still lives here, as       │   this directly — see
   │   Next.js API routes)        │   API_INVENTORY.md)
   ▼                               ▼
Supabase (Postgres + Storage)   Backend / FastAPI
   ▲                               │
   │                               ├── Interview APIs (partial)
   └───────────────────────────────┤── Admin auth
                                    ├── Employee monitoring
Groq (interview Qs, grading) ◄─────┤
                                    └── faceproj (internal only)
                                          ├── YOLO monitoring
                                          └── FaceNet identity verification
                                                └── landmark alignment
```

The Backend and Frontend talk to Supabase independently (both hold
`SUPABASE_SERVICE_ROLE_KEY`); the browser never talks to `faceproj`
directly, only through the Backend.

## Quick start

```bash
# 1. Frontend deps
cd Frontend && npm install && cd ..

# 2. Backend deps
cd Backend && python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt && cd ..

# 3. faceproj deps (separate venv recommended — heavier: torch, ultralytics)
cd Backend/faceproj && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && cd ../..

# 4. Configure
cp Backend/.env.example .env.local   # then fill in real values

# 5. Run all three (separate terminals)
cd Backend/faceproj && uvicorn service:app --port 8000
cd Backend          && uvicorn main:app --port 8080
cd Frontend          && npm run dev            # http://localhost:3000
```

Or via Docker: `docker compose -f Backend/docker-compose.yml up --build`.

See `Backend/README.md` and `Frontend/README.md` for details,
`API_INVENTORY.md` for which endpoints are served by which side today, and
`docs/SUPABASE_DOCUMENTATION.md` for the database schema and migrations.
