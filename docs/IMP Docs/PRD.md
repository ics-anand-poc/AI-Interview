# Product Requirements Document — Interviewscore / HR Screening Console

**Product name:** Interviewscore (repo `resume-intelligence-platform`)  
**Audience:** Infinite Computer Solutions TAG / RMG, delivery managers, and assigned employees  
**Document owner:** Product + engineering  
**Version:** 2.0  
**Date:** 17 Sep 2026  

---

## 1. Problem

Infinite TAG needs one console to:

1. Ingest Brassring requisitions (BR) and job descriptions (JD).
2. Keep a live **Corp Pool** of bench people, grouped by the day they were added.
3. Score those people against a selected requirement and shortlist.
4. Run **Employee Portal** product assessments (Q-forms) for named employees — without mixing that roster into Corp Pool.
5. Optionally run candidate resume screening and proctored mock interviews.

These were previously spreadsheets, Brassring print PDFs, zip dumps of resumes, and separate credential workbooks. The product replaces that with a dated, auditable screening loop.

---

## 2. Users

| Persona | Auth | What they do |
|---------|------|----------------|
| Super admin (`admin@infinite.com`) | `@infinite.com` email + admin password | Full Screening Dashboard including Employee Portal |
| Screening-only admin | Named Infinite emails (e.g. Ramendra, Neha, Shwetha) | Requirements + Corp Pool + candidates. **No Employee Portal tab** |
| Employee | Emp ID + password, or Microsoft Entra SSO | Take assigned Q-form, see dashboard / learning |
| Candidate | Email + session code | Upload resume, take proctored mock interview |

---

## 3. Goals

| ID | Goal | Success signal |
|----|------|----------------|
| G1 | Keep **Corp Pool** and **Employee Portal** as two separate people lists | Adding Corp Pool resumes never creates portal logins or tests |
| G2 | Stamp every ingest with a date/batch so TAG can filter “today’s people / today’s JDs” | UI groups by `upload_batch` / `created_at` (IST) |
| G3 | Use official Brassring IDs when present; otherwise allocate `00001BR`, `00002BR`, … | File label is `{BR} \| {filename}` |
| G4 | Score people against **one selected JD**; a score saved for JD A must not show under JD B | `score_override` + `score_override_jd_id` |
| G5 | Employee Q-forms come from `QB-new.xlsx` by product (SDM, PACO, IPTEL, SDL, …) | Portal user sees the product they were mapped to |
| G6 | Do not wipe portal history when doing Corp Pool / JD work | Portal archive / restore path exists; Corp Pool writes `corp_pool_roster` only |

Non-goals: replacing Brassring, payroll, or Infinite’s official HRIS. This app is screening + assessment, not employee system of record.

---

## 4. Product surfaces

### 4.1 Screening Dashboard (`/admin`) — primary TAG console

Tabs:

1. **Requirements (BR / JD)** — ingest, date-filter, skill chips, pin a JD for scoring.
2. **Corp Pool** — people list, date groups, search, shortlist, select pool, score vs pinned JD, Excel export.
3. **Suitable / Non-Suitable Candidates** — external CVs vs JD (60% qualified bar).
4. **Employee Portal** — only if the admin may view it. Q-form status, retake, credentials dispatch.
5. **Outbox / Logs** — invites and audit.

### 4.2 Employee Portal (`/employee`)

- Login (Emp ID / password) or Microsoft SSO.
- Assigned product Q-form (timed, proctored, video).
- Results dashboard and optional learning curriculum.
- `product_qb_eligible = false` means login-only (no question bank for that product yet).

### 4.3 Candidate interview (`/`, `/interview/[id]`)

- Email gate, resume upload, Gemini (or local fallback) analysis, proctored interview, ID/selfie check.

---

## 5. Functional requirements

### Requirements (JD / BR)

| ID | Requirement |
|----|-------------|
| R-JD-1 | Accept PDF / DOCX / TXT JD. Brassring “View Req” PDFs may be vector drawings; text must still be composed with `Job Title:` and `Mandatory Skills:` so skill chips parse. |
| R-JD-2 | If the file already has a BR (`51210BR`), use it. If not, assign the next synthetic id `0000nBR`. |
| R-JD-3 | Persist to Supabase `job_descriptions` and `uploads/job_descriptions.json`. `created_at` / `uploadBatch` = ingest day. |
| R-JD-4 | Deleting a JD tombstones it; it must not come back from leftover files unless TAG re-adds it. |
| R-JD-5 | Date filter on the Requirements tab groups by local calendar day of `created_at`. |

### Corp Pool

| ID | Requirement |
|----|-------------|
| R-CP-1 | Source of truth: `portal_settings.corp_pool_roster`. Mirror `uploads/employees.json` + Storage `app-data/employees.json`. |
| R-CP-2 | A new resume/zip/Excel is a **new batch**. People not in that file keep their old `upload_batch`. People in the file get today’s stamp (they move if they already existed). |
| R-CP-3 | Emp ID = official Infinite Emp No when present on resume/filename/list. Never invent `CV…` hashes if an official number exists. Blank is better than a fake id. |
| R-CP-4 | Score vs the pinned requirement. Persist `score`, `score_override`, `score_override_jd_id`, `matchingSkills`, rationale. |
| R-CP-5 | Shortlist + “select pool” is a working set for Analyze / export. It is not Employee Portal. |
| R-CP-6 | Soft-delete via `deleted_corp_pool`. Re-uploading those Emp IDs un-deletes only those IDs. |

### Scoring

| ID | Requirement |
|----|-------------|
| R-SC-1 | Baseline engine: `src/lib/skill-match.ts`. Qualified / suitable ≥ **60%**. Interview ≥ **75%**. Hold ≥ 30%. Else reject. |
| R-SC-2 | JD text must include `Job Title:` and `Mandatory Skills:` or chips and core coverage will be wrong. |
| R-SC-3 | Intelligent / Qwen / scripted scores are stored as overrides **for that JD only**. |
| R-SC-4 | Scores are percentages, not 1–5 ratings. |

### Employee Portal

| ID | Requirement |
|----|-------------|
| R-EP-1 | Credentials live on `employees` + local `employee-accounts.json`. Tests in `tests` / `test_questions`. |
| R-EP-2 | Question bank = `QB-new.xlsx` mapped by product. Wrong product (e.g. HSS vs SDL) must be correctable without changing Emp ID/password. |
| R-EP-3 | Corp Pool ingest **must not** insert portal users or tests. |
| R-EP-4 | SSO via Microsoft Entra is optional; Emp ID login remains. |

### AI

| ID | Requirement |
|----|-------------|
| R-AI-1 | Local Qwen 4B (llamafile on `http://127.0.0.1:8080`) is the on-box LLM for file placement and person-vs-JD scoring when running. |
| R-AI-2 | Gemini is used for resume analysis, interview questions/answers, and portal quiz generation. |
| R-AI-3 | OpenAI is optional, JD → BR field extraction only. |
| R-AI-4 | If Gemini/Qwen is down, heuristic `LocalAIEngine` / `skill-match` still produces a number. |

---

## 6. Data rules

- **Do not commit** `.env.local`, credential xlsx, GGUF weights, or `docs/NON-Needed docs/`.
- **Do not push** Qwen/local-LLM wiring unless asked.
- **Do not commit or push** unless the operator asks.
- Brassring PDFs and JD text copies may live under `docs/JD` and `docs/BR - Interviewscore App`.

---

## 7. Out of scope (this version)

- Auto-filling Brassring.
- Payroll / timesheets.
- Replacing Infinite identity as system of record.
- Training a private model on resumes.

---

## 8. Open decisions

| Topic | Current default |
|-------|-----------------|
| Overqualified (e.g. 14-year Tech Lead vs 3–6 year SSE) | Skill-rich but seniority penalty on intelligent score |
| Same person in two date groups | Impossible; one Emp ID, one `upload_batch` |
| Synthetic BR vs official BR | Official always wins; never rename `51210BR` to `0000nBR` |
