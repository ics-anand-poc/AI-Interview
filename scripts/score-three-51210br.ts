/**
 * Score the 17 Sep Corp Pool three (Shaik, Pamidi, Satya) against 51210BR
 * and persist score_override so Admin shows it for that JD.
 *
 * Usage: npx tsx scripts/score-three-51210br.ts
 */
import { writeFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";
import {
  calculateSkillMatch,
  decisionFromScore,
  employeeMatchText,
} from "../src/lib/skill-match";

const IDS = ["1035947", "1036246", "1032084"];

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

function intelligentScore(emp: any, jdText: string) {
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

  // Engine under-credits "Restful Web Services" as REST APIs. Rebuild from evidence.
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

  // 51210BR is 3–6 years, E3 Senior Software Engineer, lead 5–10.
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
    new Set([...mandatory, ...primary.filter((s) => ["Spring Boot", "Hibernate", "SOAP", "Microservices", "Angular", "SQL", "PL/SQL", "Tomcat", "Jira", "Git"].includes(s))])
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

  const { data: jdRows, error: jdErr } = await supabase
    .from("job_descriptions")
    .select("id, file_name, jd_text");
  if (jdErr) throw new Error(jdErr.message);
  const jdRow = (jdRows || []).find((j) => /51210BR/i.test(String(j.file_name || "")));
  if (!jdRow?.id) throw new Error("51210BR not found in job_descriptions");
  const text = String(jdRow.jd_text || "").trim();
  if (!text) throw new Error("51210BR JD text missing");

  const { data: rosterRow, error } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "corp_pool_roster")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = rosterRow?.value as any;
  const employees: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.employees) ? raw.employees : [];

  const want = new Set(IDS);
  const results: any[] = [];
  let scored = 0;
  for (const emp of employees) {
    if (!want.has(String(emp.employee_id))) continue;
    const out = intelligentScore(emp, text);
    emp.score = out.score;
    emp.score_override = out.score;
    emp.score_override_jd_id = jdRow.id;
    emp.llm_rationale = out.rationale;
    emp.llm_best_jd = jdRow.file_name;
    emp.llm_best_jd_why = `Scored against ${jdRow.file_name} Senior Software Engineer (Java).`;
    emp.matchingSkills = out.matchingSkills;
    scored += 1;
    results.push({
      id: emp.employee_id,
      name: emp.full_name,
      designation: emp.designation,
      score: out.score,
      engine: out.engineScore,
      decision: out.decision,
      years: out.years,
      mandatory: out.mandatory,
      primary: out.primary,
    });
  }
  if (scored !== 3) throw new Error(`Expected 3 people, scored ${scored}`);

  const { error: saveErr } = await supabase.from("portal_settings").upsert(
    { key: "corp_pool_roster", value: { employees } },
    { onConflict: "key" }
  );
  if (saveErr) throw new Error(saveErr.message);
  const serialized = JSON.stringify(employees, null, 2);
  await writeFile("uploads/employees.json", serialized, "utf8");
  await supabase.storage
    .from("app-data")
    .upload("employees.json", serialized, { contentType: "application/json", upsert: true });

  results.sort((a, b) => b.score - a.score);
  console.log(JSON.stringify({ jd: jdRow.file_name, jdId: jdRow.id, results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
