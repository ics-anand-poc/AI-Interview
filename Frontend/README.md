# Frontend

Next.js 16 (App Router, TypeScript, Tailwind) UI. Also currently hosts most
of the app's business-logic API routes under `src/app/api/` — these are
being migrated one-by-one to the Python `Backend/`; see `../API_INVENTORY.md`
for which ones have moved.

## Setup

```bash
npm install
```

## Env

The real `.env.local` lives at the project root (`../.env.local`), shared
with `Backend/`. `next.config.mjs` loads it explicitly on startup/build via
`@next/env`'s `loadEnvConfig`, since Next.js only auto-loads an `.env.local`
that sits in its own project directory. `Frontend/.env.example` documents
the subset of variables this side actually reads — copy the real file from
`../Backend/.env.example` as a starting point (or see the root README).

## Run

```bash
npm run dev      # http://localhost:3000
npm run build && npm run start   # production
npm run typecheck
npm run lint
```

## Talking to the Backend

`src/lib/backend-client.ts` exports `BACKEND_URL`, read from
`NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:8080`). Only
endpoints listed as "Ported to FastAPI" in `../API_INVENTORY.md` are called
through it — everything else still calls this app's own `/api/...` routes.

## Docker

`Dockerfile` here builds a standalone production image (`output: "standalone"`
in `next.config.mjs`); orchestrated together with the Backend and faceproj
via `../Backend/docker-compose.yml` / `docker-compose.azure.yml`.
