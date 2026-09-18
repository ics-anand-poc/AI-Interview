# Memory — live operating state

Working memory for the next session. Facts below were true on **Thursday 17 Sep 2026**. Re-verify against Supabase if anything looks stale.

Read with `rules.md`. This file is not a licence to mix Corp Pool and Employee Portal.

---

## 1. Product split (do not forget)

- **Corp Pool** = TAG bench screening. Roster key `corp_pool_roster`.
- **Employee Portal** = Q-forms. `employees` + tests. Do not wipe.
- Scoring Corp Pool does not write portal tests.
- Adding JDs does not create people.

---

## 2. Requirements (JD) as of 17 Sep 2026

Synthetic BRs (no official Brassring id):

| BR | File | UUID (md5-derived) | Notes |
|----|------|--------------------|--------|
| 00001BR | DevOps Ansible | `c781bfcb-88ea-4782-a36a-3ed7e83e25f5` | Do **not** score AWS people against this |
| 00002BR | `DevOps AWS.txt` | `26f16d25-cd78-4634-a712-741141734312` | 16 Sep Active Pool scores attached here |
| 00004BR | ReactJs Developer | | 16 Sep batch |
| 00005BR | Senior Full Stack — Java Focused | | |
| 00006BR | Senior Full Stack — SLED | | |
| 00007BR | Test Automation | | |

Official BR:

| BR | File | UUID | created_at |
|----|------|------|------------|
| **51210BR** | `51210BR \| 51210BR.pdf` | `16cf1b7c-ac48-405f-ab87-2724f3280004` | `2026-09-17T12:15:00.000Z` |

51210BR = Senior Software Engineer, Conduent Transportation-BATA, Hyderabad, E3, **3–6 years**. Mandatory: Java, J2EE, REST APIs. Source PDF was vector (no extractable text); JD composed from page renders.

`brIdToUuid` = MD5 of the BR string, formatted as UUID with version nibble `4`.

---

## 3. Corp Pool batches

Total roster size last write: **160** people.

| Batch ISO | Label | Who |
|-----------|--------|-----|
| `2026-09-16T12:45:00.000Z` | 16 Sep 2026 | ActivePoolResumes.zip + corp list. Was 114; **111** after three people moved to 17 Sep |
| `2026-09-17T12:30:00.000Z` | 17 Sep 2026 | **3** Java CVs |

17 Sep people (also scored vs 51210BR):

| Emp ID | Name | Title | 51210BR % |
|--------|------|-------|-----------|
| 1036246 | Naresh Pamidi | Senior Software Engineer | 87 interview |
| 1035947 | Shaik Rafi | Senior Software Engineer | 74 screen |
| 1032084 | Gundarapu Satyanarayana | Senior Technical Lead | 70 screen |

They already existed on the 16 Sep Excel list; they were **moved**, not duplicated. Resumes: `docs/CorpPool_17Sep26/` (and copies under Downloads originally).

16 Sep AWS scoring used `score_override_jd_id = 00002BR` UUID. After 17 Sep Java scoring, those three rows’ override points at **51210BR**. The other 16 Sep people should still have AWS overrides.

Emp ID cleanup (16 Sep): official Infinite numbers from resumes/list; `CV…` hashes stripped in the Excel export; `BR_Anushri.pdf` = Anushri B R `1028166`; Pankaj `81000013` is a real contractor number.

---

## 4. Employee Portal (do not “refresh” this away)

Known waves (see scripts, not a full census):

- SDM Phase 2 — `add_sdm_phase2_portal_users.py`
- PACO — `add_paco_16sep26_portal_users.py`
- IPTEL 16 Sep — 62 users from credentials workbook; Q-forms NN / NTAS / SBC / CFX / NEF. **Sankaranandh G R `1040337` MSS/MGW = login only**
- Pinkesh Kumar `1041229`: was HSS, switched to **SDL** (25 questions), same Emp ID/password; test id `6aed223f-e2fd-486b-8fc0-09bc7d1c2ee7` was pending when switched

Manifest counts under `uploads/` vs `src/data/employee_test_manifest.json` have drifted historically; do not “reconcile” by deleting tests.

---

## 5. Local LLM

- Binary: `AI/llamafile-0.10.5.exe` + Qwen 4B GGUF (not in git).
- Start: `npm run llm` → `AI/start.bat`. Linux: `AI/start.sh` / `AI/qwen.service`.
- App: `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL=Qwen3.5-4B-Q4_K_M`, `LOCAL_LLM_API_KEY`.
- Health: `GET /api/health` → `localLlm.up`.
- 4B on 2 vCPU is slow; JSON often needs repair. Do not block Corp Pool ingest on Qwen being up.

---

## 6. Scripts worth knowing

| Script | Purpose |
|--------|---------|
| `scripts/add-51210br-jd.ts` | Upsert 51210BR under 17 Sep |
| `scripts/add-three-corp-sept17.ts` | Move/add the 3 Java CVs to 17 Sep batch |
| `scripts/score-three-51210br.ts` | Intelligent scores vs 51210BR |
| `scripts/add-active-pool-resumes-sept16.ts` | 16 Sep zip ingest (`extractText` exported; `main` only if argv matches) |
| `scripts/score-corp-pool-00001br.ts` | Name is stale — scores the **AWS** JD `00002BR` |
| `scripts/add-aws-devops-jd.ts` | AWS JD; early version used 00001BR, live AWS is 00002BR |
| `scripts/load-env.ts` | Loads `.env.local` for tsx |

`ALLOW_INSECURE_TLS=1` is for corporate SSL inspection only, never production.

---

## 7. Operator preferences (this workspace)

- Do not commit unless asked. Do not push unless asked.
- Do not commit `.env.local`, credential xlsx, GGUF, `NON-Needed docs`.
- Prefer official BR and Emp Nos.
- “Keep them separate” + “under today’s date” = new `upload_batch` / `created_at`, not mixed into yesterday’s group.
- Excel share-outs for TAG go to project `docs/` (and sometimes repo root); keep secrets out of git.

---

## 8. Pitfalls already paid for

1. Scoring 16 Sep people vs `00001BR` hit **Ansible**, not AWS. Always resolve JD by filename/`DevOps AWS.txt`, then write `score_override_jd_id` to that UUID.
2. Emp ID glued as `Employee ID: 1028779Senior` — regex must not require a word boundary after the digits.
3. Importing `add-active-pool-resumes-sept16.ts` used to re-run ingest; it is now guarded.
4. Brassring PDF text extract = empty. Render PNG, compose JD.
5. `replace_or_create_test` may log “created CMG test” even for SDL — cosmetic.

---

## 9. What “done” looked like on 17 Sep evening

- 51210BR on Requirements under 17 Sep.
- Three Java profiles in Corp Pool under 17 Sep, scored vs 51210BR.
- Employee Portal not touched that day.
- No commit/push of this work unless the operator asks.
