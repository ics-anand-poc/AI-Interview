# Design — Interviewscore UI

Visual and interaction spec for the three surfaces. Implementation: Next.js App Router, React 18, Tailwind 3, Radix slot Button, Lucide, Framer Motion, Recharts.

**Last updated:** 17 Sep 2026

---

## 1. Brand and colour

Default theme is **indigo screening** (`globals.css` `:root`).

| Token | Light | Role |
|-------|-------|------|
| Primary | `#6366f1` indigo-500 | Tabs, buttons, focus ring |
| Primary gradient | indigo → violet `#8b5cf6` | Headings / emphasis |
| Background | cool blue-gray `#e6f0fd` | Page |
| Card | near-white `#f8faff` | Tables |
| Qualified | emerald | Success toasts, shortlist |
| Danger | red-500 | Errors, delete |
| Muted | slate-500 | Helper text |

Dark mode inverts to violet-on-navy. Additional named palettes exist in `globals.css` (blue, purple, emerald, rose, orange) for theme variants — do not invent a new primary without updating CSS variables.

**Type:** black / `font-black` for tab labels and Emp IDs; `text-xs` inside dense tables. Rounding: `rounded-2xl` / `rounded-3xl` cards, `rounded-xl` controls.

**Icons:** Lucide only (`ClipboardList` for Screening Dashboard).

---

## 2. Screening Dashboard (`/admin`)

### Chrome

- Top nav: product title + link back to Candidate Portal.
- Page title: **Screening Dashboard**.
- Toasts: emerald success / red error, auto-dismiss.

### Tabs (left → right)

1. Requirements (BR / JD)
2. Corp Pool
3. Suitable Candidates
4. Non-Suitable Candidates
5. Employee Portal *(hidden for screening-only admins)*
6. Outbox
7. Logs *(if present in build)*

Active tab: indigo bottom border + white card background. Count badges on each tab.

### Requirements

- Date filter (calendar day of `created_at`, IST).
- Search + skill chip filter.
- Pin / select one JD for Corp Pool scoring.
- Columns: BR no, filename, title, mandatory skill chips, created day, actions (view / delete).
- Empty state: “No requirements for this date” — not a blank table.

### Corp Pool

- **Date groups** from `upload_batch`. Same calendar day with two batches shows `17 Sep 2026 · 6:00 pm`.
- Toolbar: search, JD picker (scores follow the pinned JD), Select pool, Analyze (Qwen), shortlist, Excel export.
- Row: checkbox, Emp ID, name, designation, score **as %**, matching skill chips, shortlist star.
- Score colour: treat ≥75 interview, ≥60 screen, ≥30 hold, else weak — do not show 1–5 stars.
- Selecting a JD with no override falls back to live `skill-match` (so an AWS override does not leak onto 51210BR).

### Candidates (suitable / not)

- Bulk CV list vs active JD.
- 60% bar (`QUALIFIED_COVERAGE_PERCENT`) unless admin overrode suitability.
- Invite / reset session actions stay on these tabs, not on Corp Pool.

### Employee Portal tab

- Dense table: Emp ID, name, product, Q-form status, completed date, score, video, retake.
- Completed-date filter uses **week buckets** (this week / last week / older weeks).
- Never show Corp Pool shortlist controls here.

---

## 3. Employee Portal (`/employee`)

- Login card, then dashboard with **Analytics** and **Tests** tabs.
- Assigned test CTA only if `product_qb_eligible` and a pending test exists.
- Test runner: one question at a time, timer, proctoring banner, no back-nav that dumps answers without confirm.
- Charts: radar / trend / weekly average (`DashboardInner`). Keep them secondary to “your assigned test”.

SSO popup (`/employee/outlook-sso-popup`) must close into `/employee/sso-complete` without leaving a second dashboard.

---

## 4. Candidate interview

- Email gate on `/`.
- Interview room: question, notes, code pane (when coding), camera pip, submit.
- Do not reuse Corp Pool table chrome here.

---

## 5. Layout rules

| Breakpoint | Behaviour |
|------------|-----------|
| Desktop | Full tab labels, multi-column tables |
| `sm` / mobile | Tabs scroll horizontally (`overflow-x-auto`); hide “Candidate Portal” words, keep icon |

Tables inside cards use `text-xs`, `border-collapse`, sticky header where the list is long.

Do not add a third people table. If a feature needs “employees”, decide **Corp Pool vs Portal** first (see `rules.md`).

---

## 6. Copy

- Say **Corp Pool**, not “employees”, in the screening tab.
- Say **Employee Portal** for Q-forms.
- Say **BR** and **JD** in the requirements tab.
- Scores: `87%`, not `0.87` or `8.7/10`.
- Dates: `17 Sep 2026` (en-IN, Asia/Kolkata) for batch labels.

---

## 7. Motion and charts

- Framer Motion: light fade on toasts and dashboard widgets only. No page-wide parallax.
- Recharts on employee analytics; Screening Dashboard is tables-first.

---

## 8. Accessibility

- Tab buttons are real `<button>`s with selected state via class, not `div` + click.
- Checkbox columns have `aria-label`.
- Do not rely on colour alone for score — keep the percent number visible.
