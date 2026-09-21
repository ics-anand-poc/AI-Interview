/**
 * Add the 11 Java resumes in Downloads/51210BR as an 18 Sep 2026 Corp Pool batch
 * and score them against 51210BR Senior Software Engineer.
 *
 * Existing Emp IDs are kept; people already in the pool are moved to today, not duplicated.
 *
 * Usage: npx tsx scripts/add-eleven-51210br-sept18.ts
 */
import { createHash } from "crypto";
import { existsSync, readdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { basename, extname, join } from "path";
import { createClient } from "@supabase/supabase-js";
import { extractText } from "./add-active-pool-resumes-sept16";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";
import {
  calculateSkillMatch,
  decisionFromScore,
  employeeMatchText,
} from "../src/lib/skill-match";

const DIR = "C:/Users/Aryan/Downloads/51210BR";
const BATCH = "2026-09-18T12:00:00.000Z";
const ROOT = process.cwd();
const SEPT17 = "2026-09-17T12:30:00.000Z";

const FILE_HINTS: Record<string, { employee_id?: string; full_name?: string }> = {
  "1033846_AbhishekKM_Resume (1).docx": { employee_id: "1033846", full_name: "Abhishek K M" },
  "1035362_Penchala_Madireddy (1).docx": { employee_id: "1035362", full_name: "Penchala Madireddy" },
  "1036246_Pamidi_08182026.DOCX": { employee_id: "1036246", full_name: "Naresh Pamidi" },
  "Aparna(1038550)_ICS_resume.pdf": { employee_id: "1038550", full_name: "Aparna" },
  "Moh Salman Khan - 1035656 - Resume (1).docx": { employee_id: "1035656", full_name: "Moh Salman Khan" },
  "Mohammed Owaish.docx": { full_name: "Mohammed Owaish" },
  "Narasimhulu Devineni_Resume.docx": { full_name: "Narasimhulu Devineni" },
  "Resume_Vivek28022025.doc": { full_name: "Vivek" },
  "Samas_Java.docx": { full_name: "Samas" },
  "Satya_Gundarapu_1032084.docx": { employee_id: "1032084", full_name: "Gundarapu Satyanarayana" },
  "SHAIK RAFI_Java_ICS.DOCX": { employee_id: "1035947", full_name: "Shaik Rafi" },
};

const SIGNALS = [
  ["Java", /\bjava\b|\bcore java\b/i],
  ["J2EE", /\bj2ee\b|\bjavaee\b|\bjava ee\b/i],
  ["REST APIs", /\brest(?:ful)?\b|\brest\s*api/i],
  ["SOAP", /\bsoap\b/i],
  ["Spring Boot", /\bspring\s*boot\b/i],
  ["Spring", /\bspring(?:\s+(?:mvc|security|framework))?\b/i],
  ["Hibernate", /\bhibernate\b|\bjpa\b|\borm\b/i],
  ["Microservices", /\bmicro[\s-]*services?\b/i],
  ["SQL", /\bsql\b|\bmysql\b|\boracle\b|\bpostgresql\b/i],
  ["PL/SQL", /\bpl\s*\/?\s*sql\b/i],
  ["Servlets", /\bservlets?\b/i],
  ["JSP", /\bjsp\b/i],
  ["Struts", /\bstruts\b/i],
  ["React", /\breact(?:js)?\b/i],
  ["Angular", /\bangular\b/i],
  ["Tomcat", /\btomcat\b/i],
  ["Git", /\bgit\b|\bgithub\b|\bgitlab\b|\bbitbucket\b|\bsvn\b/i],
  ["Jira", /\bjira\b/i],
  ["OWASP", /\bowasp\b|\bpci\b|\bsecure coding\b/i],
  ["Team lead", /\b(lead(?:ing)? a (?:small )?team|team lead|technical lead|tech lead)\b/i],
] as const;

function isPlausibleEmployeeId(value: string): boolean {
  const id = String(value || "").trim();
  if (!/^[A-Za-z]?\d{4,12}$/.test(id)) return false;
  const digits = id.replace(/\D/g, "");
  if (digits.length === 4) {
    const year = Number(digits);
    if (year >= 1970 && year <= 2035) return false;
  }
  if (digits.length >= 10) return false;
  return true;
}

function extractEmployeeId(text: string, file: string): string {
  const normalized = String(text || "").replace(/\u00a0/g, " ");
  const patterns = [
    /employee\s*(?:id|code|number|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
    /emp(?:loyee)?\s*(?:id|no|code|number)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1] && isPlausibleEmployeeId(match[1])) return match[1].trim();
  }
  const fromFile = String(file || "").match(/(?:^|[^A-Za-z0-9])(\d{6,8})(?=[^A-Za-z0-9]|$)/);
  if (fromFile?.[1] && isPlausibleEmployeeId(fromFile[1])) return fromFile[1];
  return "";
}

function firstEmail(text: string): string {
  return text.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] || "";
}

function skillsFromText(text: string): string {
  const cleaned = text.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length <= 7000 ? cleaned : cleaned.slice(0, 7000);
}

function normalizeName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleFromText(text: string, fallback: string): string {
  const labeled = text.match(
    /(?:^|[\n\r])\s*(?:title|designation|role|position)\s*[:|#]\s*([^\n\r]{2,80})/i
  );
  if (labeled?.[1]) return labeled[1].replace(/\s+/g, " ").trim();
  const line = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find(
      (row) =>
        row.length < 70 &&
        /\b(senior software engineer|software engineer|technical lead|tech lead|developer|engineer)\b/i.test(row)
    );
  return line || fallback;
}

function contentType(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".doc") return "application/msword";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function hitsIn(text: string): string[] {
  const found: string[] = [];
  for (const [label, re] of SIGNALS) {
    if (re.test(text)) found.push(label);
  }
  return found;
}

function yearsFrom(text: string): number | null {
  const m =
    text.match(/(\d+(?:\.\d+)?)\s*\+?\s*years?\s+of\s+(?:industry\s+)?exp/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*\+\s*years?\b/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*years?\s+of\s+experience/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function intelligentScore(emp: any, jdText: string) {
  const blob = employeeMatchText({
    skills: emp.skills,
    designation: emp.designation,
    grade: emp.grade,
    role: emp.designation,
  });
  const match = calculateSkillMatch(blob, jdText);
  const raw = `${emp.full_name} ${emp.designation} ${emp.skills}`;
  const hits = hitsIn(raw);
  const has = (label: string) => hits.includes(label);
  const mandatory = ["Java", "J2EE", "REST APIs"].filter(has);
  const primary = [
    "Spring Boot",
    "Spring",
    "Hibernate",
    "SQL",
    "PL/SQL",
    "Servlets",
    "JSP",
    "SOAP",
    "Microservices",
    "Struts",
    "React",
    "Angular",
    "Tomcat",
    "Git",
    "Jira",
  ].filter(has);
  const years = yearsFrom(raw);
  const techLead = /\b(senior technical lead|technical lead|tech lead)\b/i.test(raw);
  const sse = /\bsenior software engineer\b/i.test(raw);

  let score = Math.round(
    0.34 * match.score +
      0.38 * ((mandatory.length / 3) * 100) +
      0.28 * ((primary.length / 15) * 100)
  );

  if (mandatory.length === 3) score = Math.max(score, 68);
  if (has("Spring Boot") && has("Hibernate") && has("Microservices")) score = Math.min(100, score + 3);
  if (has("SOAP") && has("REST APIs")) score = Math.min(100, score + 2);
  if (has("OWASP")) score = Math.min(100, score + 2);
  if (has("Angular") || has("React")) score = Math.min(100, score + 2);
  if (!has("Servlets") && !has("JSP") && !has("Struts")) {
    score -= 3;
    score = Math.min(score, 86);
  }
  if (!has("Team lead")) score -= 2;

  if (years != null) {
    if (years >= 3 && years <= 6) score += 3;
    else if (years > 6 && years <= 8) score -= 2;
    else if (years >= 12) score -= 10;
    else if (years < 3) score -= 8;
  }
  if (sse && !techLead) score += 2;
  if (techLead) score -= 6;

  score = Math.max(0, Math.min(100, score));
  const decision = decisionFromScore(score);
  const matchingSkills = Array.from(
    new Set([
      ...mandatory,
      ...primary.filter((s) =>
        ["Spring Boot", "Hibernate", "SOAP", "Microservices", "Angular", "SQL", "PL/SQL", "Tomcat", "Jira", "Git"].includes(s)
      ),
    ])
  );
  const rationale = [
    `${decision === "interview" ? "Interview" : decision === "screen" ? "Screen" : "Hold"} for 51210BR Senior Software Engineer (Java/J2EE/REST).`,
    `Mandatory ${mandatory.length}/3: ${mandatory.join(", ") || "none"}.`,
    `Primary ${primary.length}/15: ${primary.join(", ") || "none"}.`,
    years != null ? `Stated experience ~${years} years (req 3–6).` : "Years not stated.",
    techLead ? "Title is Technical Lead vs E3 SSE — seniority mismatch." : sse ? "Title matches Senior Software Engineer." : "",
    match.rationale,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    score,
    decision,
    rationale,
    hits,
    mandatory,
    primary,
    years,
    engineScore: match.score,
    matchingSkills: matchingSkills.length ? matchingSkills : match.matchingSkills,
  };
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);

  const files = readdirSync(DIR).filter((name) => /\.(pdf|docx?)$/i.test(name));
  if (files.length !== 11) {
    throw new Error(`Expected 11 resumes in ${DIR}, found ${files.length}: ${files.join(", ")}`);
  }

  const incoming: Array<{
    employee_id: string;
    full_name: string;
    designation: string;
    email: string;
    skills: string;
    source_file: string;
  }> = [];

  for (const name of files) {
    const path = join(DIR, name);
    if (!existsSync(path)) throw new Error(`Missing ${path}`);
    const buf = await readFile(path);
    const text = await extractText(name, buf);
    const hint = FILE_HINTS[name] || {};
    const employee_id =
      hint.employee_id ||
      extractEmployeeId(text, name) ||
      `CV${createHash("md5").update(name.toLowerCase()).digest("hex").slice(0, 10)}`;
    const full_name = hint.full_name || name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const designation = titleFromText(text, "Senior Software Engineer");
    incoming.push({
      employee_id,
      full_name,
      designation,
      email: firstEmail(text),
      skills: skillsFromText(text) || full_name,
      source_file: basename(name),
    });
    const { error: upErr } = await supabase.storage.from("docs-ingest").upload(`Corp Pool/${basename(name)}`, buf, {
      contentType: contentType(name),
      upsert: true,
    });
    if (upErr) console.warn(`storage upload ${name}:`, upErr.message);
  }

  const { data: rosterRow, error } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "corp_pool_roster")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = rosterRow?.value as any;
  const employees: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.employees) ? raw.employees : [];
  const byId = new Map(employees.map((e) => [String(e.employee_id), e]));
  const byName = new Map(
    employees.map((e) => [normalizeName(e.full_name), e]).filter(([name]) => Boolean(name))
  );

  const { data: deletedRow } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "deleted_corp_pool")
    .maybeSingle();
  const deleted = (deletedRow?.value || { ids: [], files: [] }) as { ids: string[]; files: string[] };
  const incomingIds = new Set(incoming.map((p) => p.employee_id.toLowerCase()));
  const nextDeletedIds = (deleted.ids || []).filter((id) => !incomingIds.has(String(id).toLowerCase()));
  await supabase.from("portal_settings").upsert(
    { key: "deleted_corp_pool", value: { ids: nextDeletedIds, files: deleted.files || [] } },
    { onConflict: "key" }
  );

  const { data: jdRows, error: jdErr } = await supabase
    .from("job_descriptions")
    .select("id, file_name, jd_text");
  if (jdErr) throw new Error(jdErr.message);
  const jdRow = (jdRows || []).find((j) => /51210BR/i.test(String(j.file_name || "")));
  if (!jdRow?.id) throw new Error("51210BR not found in job_descriptions");
  const jdText = String(jdRow.jd_text || "").trim();
  if (!jdText) throw new Error("51210BR JD text missing");

  const result: any[] = [];
  for (const person of incoming) {
    const named = byName.get(normalizeName(person.full_name));
    const prev =
      byId.get(person.employee_id) ||
      (named && !incomingIds.has(String(named.employee_id).toLowerCase()) ? named : null) ||
      {};
    const keepId = String(prev.employee_id || person.employee_id);
    if (prev.employee_id && String(prev.employee_id) !== person.employee_id) {
      byId.delete(String(prev.employee_id));
    }
    const email =
      (person.email && person.email.includes("@") ? person.email : "") ||
      prev.email ||
      `${person.full_name.split(/\s+/)[0].toLowerCase()}@infinite.com`;
    const draft = {
      ...prev,
      employee_id: keepId,
      full_name: person.full_name.length > 3 ? person.full_name : prev.full_name || person.full_name,
      email,
      department: prev.department || "Engineering",
      skills: person.skills,
      grade: prev.grade || "",
      designation: person.designation || prev.designation || "Senior Software Engineer",
      status: prev.status || "Active",
      shortlisted: Boolean(prev.shortlisted),
      matchingSkills: prev.matchingSkills || [],
      source_file: person.source_file,
      uploaded_at: BATCH,
      upload_batch: BATCH,
    };
    const out = intelligentScore(draft, jdText);
    draft.score = out.score;
    draft.score_override = out.score;
    draft.score_override_jd_id = jdRow.id;
    draft.llm_rationale = out.rationale;
    draft.llm_best_jd = jdRow.file_name;
    draft.llm_best_jd_why = `Scored against ${jdRow.file_name} Senior Software Engineer (Java).`;
    draft.matchingSkills = out.matchingSkills;
    byId.set(keepId, draft);
    result.push({
      id: keepId,
      name: draft.full_name,
      designation: draft.designation,
      score: out.score,
      decision: out.decision,
      years: out.years,
      mandatory: out.mandatory,
      primary: out.primary,
      action: prev.employee_id ? (prev.upload_batch === SEPT17 ? "moved-from-17sep" : "updated") : "added",
      file: person.source_file,
    });
  }

  const next = Array.from(byId.values());
  const { error: saveErr } = await supabase.from("portal_settings").upsert(
    { key: "corp_pool_roster", value: { employees: next } },
    { onConflict: "key" }
  );
  if (saveErr) throw new Error(saveErr.message);

  const serialized = JSON.stringify(next, null, 2);
  await writeFile(join(ROOT, "uploads", "employees.json"), serialized, "utf8");
  await supabase.storage
    .from("app-data")
    .upload("employees.json", serialized, { contentType: "application/json", upsert: true });
  const { bumpDashboardSync } = await import("../src/lib/dashboard-sync");
  await bumpDashboardSync("corp_pool_51210br_18sep");

  result.sort((a, b) => b.score - a.score);
  const today = next.filter((e) => e.upload_batch === BATCH);
  console.log(
    JSON.stringify(
      {
        jd: jdRow.file_name,
        jdId: jdRow.id,
        total: next.length,
        todayCount: today.length,
        sept17Count: next.filter((e) => e.upload_batch === SEPT17).length,
        batch: BATCH,
        people: result,
      },
      null,
      2
    )
  );
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("add-eleven-51210br-sept18.ts");
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
