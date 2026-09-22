# Phases — TalentScope

How the product was built and what “done” means in each phase. Dates are approximate; the live system on **17 Sep 2026** is Phase 4.

---

## Phase 0 — Resume intelligence (original repo)

**Intent:** Candidate uploads a CV; a local heuristic engine scores ATS / impact / clarity; admin reviews.

| Delivered | Notes |
|-----------|--------|
| `/` upload + parse (pdf-parse, mammoth) | Still in the tree |
| `src/lib/local-ai.ts` rule-based scoring | Fallback when Gemini is down |
| `resumes` table + admin resume detail | Suitable / non-suitable tabs |

This README-era product is **not** what TAG uses day to day. Do not “simplify back” to heuristics-only.

---

## Phase 1 — Candidate mock interview

**Intent:** After a CV is in, generate questions, score answers, record video, verify ID.

| Delivered | Notes |
|-----------|--------|
| `/interview/[id]` proctored session | Camera / mic Permissions-Policy |
| Gemini question generation + answer eval | `interview-service.ts` |
| Code-run route for coding questions | `/api/interview/[id]/run_code` |
| Face match (Python OpenCV / face-api) | Local, not a cloud ID vendor |
| SMTP invite from admin | Optional |

Still available. Not the TAG screening loop.

---

## Phase 2 — Employee Portal (Q-forms)

**Intent:** Assigned Infinite employees log in and take a **product** assessment from `QB-new.xlsx`.

| Wave | What landed |
|------|-------------|
| 2a SDM | Phase 2 SDM product details → portal users + tests |
| 2b PACO | PACO credential workbooks → portal users |
| 2c IPTEL | IPTEL workbook → 62 users; products NN, NTAS, SBC, CFX, NEF. MSS/MGW = login only |
| 2d Fixes | Product mismatch corrections (example: Pinkesh Kumar `1041229` HSS → SDL, same password, questions replaced in place) |

**Exit criteria:** Emp ID login works; Q-form is the mapped product; admin can see portal status **without** those people appearing as Corp Pool.

Microsoft Entra SSO was added on this surface (`MICROSOFT_CLIENT_*`).

---

## Phase 3 — TalentScope Admin (TAG daily driver)

**Intent:** Requirements + Corp Pool in `/admin`, dated batches, BR IDs, skill chips, shortlist.

| Wave | What landed |
|------|-------------|
| 3a Requirements | `job_descriptions`, synthetic `0000nBR`, official BRs, date filter |
| 3b Corp Pool | Roster in `portal_settings`, date groups, Emp No, resume text as skills |
| 3c Skill engine | `skill-match.ts`, 60% qualified bar, family (Java vs DevOps vs QA) |
| 3d Isolation | Deleted-requirement and deleted-corp-pool tombstones; portal never overwritten by corp ingest |

**Exit criteria:** TAG can drop a JD under “today”, drop a zip of resumes under “today”, and see two separate date groups. Employee Portal tab unchanged.

---

## Phase 4 — Local LLM + intelligent scoring (current)

**Intent:** Score people against a **selected** JD with something smarter than keyword chips, without sending resumes to a public API when Qwen is local.

| Wave | What landed |
|------|-------------|
| 4a Qwen 4B llamafile | `AI/start.bat`, `LOCAL_LLM_*`, health check includes `localLlm.up` |
| 4b File placement | `/api/admin/files/llm-place` classifies corp pool vs JD vs portal mapping |
| 4c Person vs JD | `/api/admin/employees/llm-evaluate` + scripted intelligent scorers |
| 4d Override model | `score_override` + `score_override_jd_id` so AWS scores do not stick on a Java JD |

**Live examples (Sep 2026):**

- 16 Sep: 114 Active Pool people scored vs `00002BR` DevOps Engineer - AWS (not vs Ansible `00001BR`).
- 17 Sep: `51210BR` Senior Software Engineer ingested; three Java CVs scored against it.

**Exit criteria for a scoring request:** numbers visible in admin when that JD is selected; roster persisted; portal untouched.

---

## Phase 5 — Next (not committed unless asked)

Suggested, not scheduled:

| Item | Why |
|------|-----|
| Store per-JD score history (not a single override slot) | TAG often re-scores the same person against a new BR |
| Brassring OCR pipeline as a first-class ingest | Vector PDFs are still manual compose |
| Portal + Corp Pool conflict detector | Same Emp No in both lists should stay two records, clearly labelled |
| Qwen on GPU / larger box | 4B on 2 vCPU is slow and truncates JSON |

Do not start Phase 5 work unless the operator asks.

---

## Definition of done (any phase work)

1. The list you were asked to touch is the only list that changed.
2. Date groups still split “today” vs older batches.
3. Official BR / Emp No used when they exist.
4. No secret or credential workbook committed.
5. Admin UI shows the result after refresh (or say if it was not browser-verified).
