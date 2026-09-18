# backend

The independent Python backend. Runs as a separate process from the Next.js
frontend; the two talk only over HTTP, called directly from the browser (so
every request shows up in the Network tab), never proxied through Next.js
API routes.

Third-party secrets (`SUPABASE_SERVICE_ROLE_KEY`, `EMPLOYEE_AUTH_SECRET`,
`ADMIN_PASSWORD`, `FACE_MATCH_KEY`, AI provider keys, SMTP credentials) live
only here, read from `.env.local` at the project root (`../.env.local` from here) — they are never sent to
the browser. The only thing the browser needs to know is
`NEXT_PUBLIC_BACKEND_URL`, which is just a URL, not a secret.

## Setup

```
cd Backend
pip install -r requirements.txt
```

## Run

```
uvicorn main:app --port 8080
```

Runs alongside `faceproj` (port 8000, its own separate microservice — see
`API_INVENTORY.md` at the repo root — the backend calls it internally over
HTTP via `services/faceproj_client.py`; the browser never talks to faceproj
directly). Start it with `cd Backend/faceproj && uvicorn service:app --port 8000`.

## Env vars (read from `../.env.local`)

- `EMPLOYEE_AUTH_SECRET` — HMAC secret for signing/verifying tokens.
  Byte-compatible with `src/lib/employee-auth.ts`'s `signToken`/`verifyToken`
  — verified by cross-generating tokens in Node and Python and confirming
  each side accepts the other's token.
- `ADMIN_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`
- `FACEPROJ_SERVICE_URL`, `FACE_MATCH_KEY` (optional)
- `FRONTEND_ORIGIN` — comma-separated allowed CORS origins, e.g.
  `http://localhost:3000`

Known quirk: `python-dotenv` can't parse the `SMTP_FROM="..." <email>` line
in `.env.local` (Node's dotenv is more lenient). It's skipped silently and
doesn't affect anything the backend currently uses — flagging so it doesn't
look like a startup failure.

## Migrated so far (compiles clean; verified against live Supabase only
where noted — I don't have network access to your Supabase project from my
sandbox, so anything hitting the DB needs to be exercised on your machine)

- `POST /api/admin/auth/login`, `GET /api/admin/auth/validate` — token
  compatibility verified (Node ↔ Python round-trip), rate limiting and
  audit-log writes ported faithfully. Not live-tested against Supabase.
- `POST /api/interview/access` — ports `session-service.ts`'s
  `getSessionByEmail` + a resume-existence check. Not live-tested.
- `POST /api/interview/{id}/verify_id` — orchestrates faceproj's `/compare`
  internally, writes the verification result into the resume's `report`
  column, writes an audit log entry. **Simplified vs. the original**: the
  original auto-creates the `verifications` Supabase Storage bucket if
  missing; this version assumes the bucket already exists (it does in your
  project) and just uploads — if that upload fails it logs a warning and
  continues rather than blocking verification, same as the original's
  local-fallback intent, but without the local-disk fallback path itself.
- `POST /api/interview/{id}/proctor_violation` — appends a violation to the
  resume's `report.proctoring` block, matches the original exactly.
  **Not ported**: the CSV auto-sync side effect
  (`interviewCSVService.syncAllInterviewsToCSV()`) — `interview-csv-service.ts`
  hasn't been read/ported yet.
- `POST /api/interview/{id}/conclude` — marks the candidate's session used.
  **Not ported**: `interviewService.generateOverallFeedback(id)`, the AI
  synthesis of a recruiter-facing summary — `interview-service.ts` (885
  lines of prompt logic) hasn't been ported yet. The original also doesn't
  block on this (fire-and-forget with a caught error), so this gap is silent
  on the candidate side either way, but the summary itself won't be
  generated until this is ported.
- `POST /api/interview/{id}/monitor`, `POST /api/employee/tests/{id}/monitor`
  — proxy to faceproj's `/monitor`. Employee route requires the same bearer
  token auth as everything else in that portal.
- `POST /api/employee/auth/login`, `GET /api/employee/auth/validate`,
  `POST /api/employee/auth/set-password`,
  `POST /api/employee/auth/confirm-password` — ports `employee-auth.ts` +
  `employee-account-store.ts`'s Supabase-primary path (the local-JSON-file
  fallback mode was intentionally not ported — see the scope note at the top
  of `services/employee_account_service.py`). Password hashing
  (PBKDF2-HMAC-SHA512, 120k iterations) verified **byte-for-byte identical**
  to the original Node implementation by cross-generating a hash in both
  languages for the same password+salt and diffing the output — see
  `tests/test_employee_account_service.py::test_pbkdf2_matches_node_reference`.
  `confirm-password` has no frontend caller currently — true in the original
  code too, not something this pass broke.

Frontend call sites updated to hit this backend directly via
`NEXT_PUBLIC_BACKEND_URL` (see `src/lib/backend-client.ts`): the admin login
gate, the landing page's access check, the candidate interview page's
conclude/proctor_violation/monitor/verify_id calls, and the employee
portal's login page, set-password page, `EmployeeAuthGate`, and dashboard
profile fetch.

The old Next.js routes for all of the above are now dead code — not
deleted yet, in case anything still depends on them; worth confirming
nothing does, then removing them.

## Testing

`tests/` has a pytest suite — `pip install pytest pytest-asyncio pytest-mock`
(or `pip install -r requirements.txt -r tests/requirements-dev.txt` if you
add one), then `pytest tests/ -v` from this directory. Two tiers:

- Most tests boot the real app with fake, non-secret env values (no live
  Supabase/faceproj needed) and check routing, auth gating, request
  validation, and — the main point of `test_interview_api.py` — that a
  downstream failure produces a clean JSON error, not the bare-text
  unhandled 500 that `_db_unavailable()` in `routers/interview.py` was added
  to fix.
- `test_employee_auth_api.py`'s `mock_accounts` fixture swaps in an
  in-memory dict for the `employees` table (via monkeypatch) so the full
  login → set-password → validate flow can be exercised without a live DB.

None of this is a substitute for testing against your real Supabase
project — it's what's possible without network access to it. Also verified
live in this environment (not just unit-tested): `Backend/` actually boots
with `uvicorn` and serves `/health`, `/docs`, and every route listed above
over real HTTP; `faceproj` actually boots, downloads its real YOLO and
FaceNet weights (from `github.com`/`download.pytorch.org` — both reachable
here), and returns correct results for synthetic no-face test images on
`/monitor` and `/compare`; the full request chain
client → `Backend` → `faceproj` was exercised end-to-end and returned a
correct response. `Frontend` was verified to boot with `next dev` and serve
its homepage, and `next build` completes (it only fails on this sandbox's
inability to reach Google Fonts, unrelated to the migration). What's
**not** verified anywhere in this environment: any request that needs real
data back from Supabase, a real Groq response, or an actual Azure
deployment.

## Not yet migrated

Everything else — see `API_INVENTORY.md` at the repo root for the full list. Roughly, by remaining service file
size: `resume-service.ts` (1596 lines — resume upload/parsing/analysis
pipeline), `automation-service.ts` (1555 lines — not yet read, scope
unknown), `interview-service.ts` (885 lines — question generation, answer
grading, overall feedback; this is where the Groq JSON-parsing bug from
earlier lives), `resource-mapping-service.ts` (643), `effectiveness-service.ts`
(503), plus employee SSO (Microsoft/Outlook/SAML) and reset-password, the
rest of the Employee Portal (tests, dashboard data, learning), Resume &
Evaluation admin views, and the rest of Admin Portal (logs, JD management,
emails, employee management).
