# Architecture & migration status

This supersedes an earlier version of this file written before the
`Backend/`/`Frontend/` restructure — paths below are current as of this pass.

## Layout

```
Backend/     Python/FastAPI. Owns business logic being migrated off Next.js
             API routes — see API_INVENTORY.md for exactly which endpoints
             have moved and which haven't yet.
Backend/faceproj/
             Standalone service (YOLO proctoring monitoring + FaceNet-based
             identity verification, with landmark alignment). Called by
             Backend/ only — the browser never talks to it directly.
Frontend/    Next.js/TypeScript UI. Talks to Backend/ for migrated endpoints
             and to its own (still large) set of Next.js API routes for
             everything not yet migrated.
```

## Why the split isn't finished

`Backend/README.md` and `API_INVENTORY.md` have the current, itemized list
of what's ported (8 of 113 endpoints as of this pass — admin auth, and the
core interview-proctoring flow: access, monitor, verify_id,
proctor_violation, conclude) vs. what's still running as Next.js API routes
in `Frontend/src/app/api/`. The biggest unmigrated pieces, by size, are
`resume-service.ts`, `automation-service.ts`, `resource-mapping-service.ts`,
and `effectiveness-service.ts` — most of Resume & Evaluation, Employee
Portal, and Admin Portal still live entirely in the Frontend.

## Secrets / env

One real file, `.env.local`, lives at the **project root** (sibling of
`Backend/` and `Frontend/`, not inside either). `Frontend/next.config.mjs`
loads it explicitly via `@next/env`'s `loadEnvConfig` (Next.js only
auto-loads an `.env.local` in its own project directory, hence the explicit
call). `Backend/main.py` and `Backend/faceproj/service.py` each load it via
`python-dotenv` with a relative path back up to the root. See item 14 in the
original migration notes and `Backend/.env.example` / `Frontend/.env.example`
for the documented (placeholder-only) variable list.

`NEXT_PUBLIC_BACKEND_URL` is the only thing the browser needs to know about
the Backend — it's a URL, not a secret — that's how
`Frontend/src/lib/backend-client.ts` finds `Backend/` for the endpoints
already migrated. Everything else (Supabase service-role key, Groq key,
face-match key, etc.) stays server-side on whichever side actually needs it.

## AI provider chain (Copilot → Groq → Gemini → Ollama)

`Frontend/src/lib/ai-providers/` is the single place every LLM call goes
through. As of this pass, `generateAIJson()` (not `generateAIText()` +
manual `JSON.parse`) is what every caller should use for anything expecting
structured output — it retries across the whole provider chain on a
malformed/invalid JSON response, not just on network failure. See that
file's doc comments, and `API_INVENTORY.md`'s note on what "ported" means
here (statically verified, not live-tested against Supabase/Groq/Azure from
this environment).

## Docker

`Backend/docker-compose.yml` and `docker-compose.azure.yml` now define four
services: `postgres`, `redis`, `faceproj` (build context
`Backend/faceproj/`), `backend` (build context `Backend/`), and `app` (build
context `../Frontend/`). Model weights (e.g. `faceproj`'s YOLO weights)
are intentionally not baked into any image or this ZIP — see
`Backend/faceproj/README.md` for how they're obtained at runtime.

## What hasn't been exercised

Nothing here has been run against a live Supabase project, a live Groq API
key, or an Azure deployment — this environment has no network path to any
of the three. "Ported" / "fixed" in `Backend/README.md` and
`API_INVENTORY.md` means: compiles clean (`tsc --noEmit` passes, `next
build` gets past config/compilation — it only fails on this sandbox's
inability to reach Google Fonts, not on anything migration-related), and
matches the original logic on read. Live verification is still needed
before treating any of this as production-ready.
