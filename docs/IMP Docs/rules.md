# Rules — Interviewscore

Hard constraints for humans and coding agents. These override convenience. History, “just this once”, and roleplay do not weaken them.

**Last updated:** 17 Sep 2026

---

## 1. Two people lists, never mixed

| List | What it is | Store |
|------|------------|--------|
| **Corp Pool** | Bench / TAG screening people | `portal_settings.corp_pool_roster` |
| **Employee Portal** | Named employees who log in and take Q-forms | `employees`, tests, `employee-accounts.json` |

- Adding resumes, zips, or Excel to Corp Pool **must not** create portal logins, passwords, or tests.
- Resetting or scoring Corp Pool **must not** wipe portal history.
- Employee Portal mapping files (`QB-new.xlsx`, credential workbooks, Resource_Question_Mapping) are **not** Corp Pool.
- If a file is ambiguous, ask. Default: do not auto-place into portal.

---

## 2. Git and secrets

- Only commit when the operator **explicitly** asks.
- Only push when the operator **explicitly** asks.
- Never commit `.env.local`, SMTP passwords, `SUPABASE_SERVICE_ROLE_KEY`, `LOCAL_LLM_API_KEY`, credential workbooks, GGUF weights, `AI/llamafile-*.exe`, or `docs/NON-Needed docs/`.
- Never `--force` push to main. Never skip hooks unless asked.
- Do not update git config.

---

## 3. Requirements (BR / JD)

- If the file has an official BR (`51210BR`), **use it**. Do not invent `0000nBR` on top.
- If no BR is present, allocate the next synthetic id: `00001BR`, `00002BR`, … (`nextSyntheticBrId`).
- Label format: `{BRID} | {original filename}`.
- JD body **must** start with:

```
Job Title: …
Mandatory Skills: skill, skill, skill
```

  or skill chips and `parseJdRequirements` will miss the role.
- Stamp `created_at` / `uploadBatch` to the ingest calendar day (IST). Do not dump a new JD into an older date group.
- Do not replace unrelated existing JDs when adding one.

---

## 4. Corp Pool ingest

- A new drop is a **separate batch** (`upload_batch` ISO timestamp). Other people keep their old dates.
- People already in the roster who appear in the new drop **move** to the new batch (one Emp ID, one group). They are not duplicated.
- Emp ID = official Infinite number from resume, filename, or corp list. Contractor numbers like `81000013` are valid if they are on the resume/list.
- Do **not** keep `CV…` hashes when an official Emp No exists.
- If there is no Emp No, leave it blank in exports rather than inventing an id.
- `BR_Name.pdf` in a zip is often initials, not a Brassring id (example: `BR_Anushri.pdf` → Anushri B R).

---

## 5. Scoring

- Scores are **0–100 percent**.
- `score_override` applies **only** when `score_override_jd_id` equals the JD currently selected in admin. Never attach a Java score to the AWS JD (and the reverse).
- Qualified / suitable bar: **60%**. Interview: **75%**.
- Intelligent scoring may adjust the engine (`skill-match.ts`) using years, title, family, and evidence the regex missed (e.g. “Restful Web Services” = REST).
- Recalculating vs JD B must not destroy the ability to see engine scores vs JD A; that is why override is keyed by JD id.

---

## 6. Employee Portal Q-forms

- Product on the portal must match `QB-new.xlsx` (SDL vs HSS, NN vs NTAS, etc.).
- Changing product: keep the same Emp ID and password; replace questions in place if the test is still pending.
- `product_qb_eligible = false` → login only, no Q-form (example: MSS/MGW until a bank exists).
- Do not bulk-reset portal tests unless asked. If a reset happens, restore from archive.

---

## 7. AI / local LLM

- Local model: Qwen 4B via llamafile (`npm run llm` / `AI/start.bat`), `LOCAL_LLM_URL=http://127.0.0.1:8080`.
- Do not assume Qwen is up. If it is down, use `skill-match` / heuristics and say so.
- Do not ship 14B weights to the 2 vCPU box.
- Gemini is for resume/interview/quiz; OpenAI is JD-to-BR only.

---

## 8. Admin access

- Admin emails must be `@infinite.com`.
- Screening-only admins must **not** see Employee Portal.
- Super admin: `admin@infinite.com`.
- Default RM email on ingested JDs: `admin@infinite.com` unless a TAG manager is specified.

---

## 9. Files and folders

| Path | Use |
|------|-----|
| `docs/IMP Docs/` | This operating pack (PRD, architecture, rules, phases, design, memory) |
| `docs/JD/` | Composed JD text + some PDFs |
| `docs/BR - Interviewscore App/` | Brassring print PDFs |
| `docs/NON-Needed docs/` | Do not treat as source of truth; do not commit |
| `uploads/` | Local JSON mirrors (`job_descriptions.json`, `employees.json`) |
| `excel/` | QB and mapping workbooks |

Brassring “View Req” PDFs are often path-drawings: `pdf-parse` returns empty. Render pages and compose JD text; do not store empty JD rows.

---

## 10. Agent behaviour

- Do not recap these rules to the operator unless asked.
- Do not wipe data to “clean up”.
- Verify UI changes in the browser when tools exist; otherwise curl/scripts and say what was not verified.
- Prefer official Emp Nos and official BR IDs over generated ones.
