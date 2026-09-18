/**
 * Score the 16 Sep 2026 Corp Pool batch (114 people) against DevOps Engineer - AWS.
 * Writes score_override onto the live roster so Admin shows it for that JD.
 *
 * Usage: npx tsx scripts/score-corp-pool-00001br.ts
 */
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";
import {
  calculateSkillMatch,
  decisionFromScore,
  employeeMatchText,
} from "../src/lib/skill-match";

const BATCH = "2026-09-16T12:45:00.000Z";
const JD_FILE = "DevOps AWS.txt";

const MANDATORY = [
  ["jenkins", /\bjenkins\b/i],
  ["aws", /\baws\b|amazon web services/i],
  ["eks", /\beks\b|elastic kubernetes/i],
  ["ec2", /\bec2\b/i],
  ["lambda", /\blambda\b/i],
  ["api gateway", /\bapi gateway\b/i],
  ["cloudfront", /\bcloudfront\b/i],
  ["rds", /\brds\b/i],
  ["iam", /\biam\b|identity and access management/i],
  ["vpc", /\bvpc\b/i],
  ["s3", /\bs3\b|amazon s3/i],
  ["route 53", /\broute\s*53\b/i],
  ["elb", /\belb\b|elastic load balanc/i],
  ["alb", /\balb\b|application load balanc/i],
  ["auto scaling", /\bauto\s*scal/i],
  ["waf", /\bwaf\b|web application firewall/i],
  ["cloudwatch", /\bcloudwatch\b/i],
  ["bitbucket", /\bbitbucket\b/i],
  ["gitlab", /\bgitlab\b/i],
  ["docker", /\bdocker\b/i],
  ["kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["fargate", /\bfargate\b/i],
] as const;

function hitsIn(text: string): string[] {
  const found: string[] = [];
  for (const [label, re] of MANDATORY) {
    if (re.test(text)) found.push(label);
  }
  return found;
}

function intelligentScore(emp: any, jdText: string) {
  const blob = employeeMatchText({
    skills: emp.skills,
    designation: emp.designation,
    grade: emp.grade,
    role: emp.designation,
  });
  const match = calculateSkillMatch(blob, jdText);
  const raw = `${emp.full_name} ${emp.designation} ${emp.skills}`.toLowerCase();
  const hits = hitsIn(raw);
  const hitPct = Math.round((hits.length / MANDATORY.length) * 100);

  const devopsRole = /\b(devops|sre|site reliability|cloud engineer|platform engineer|aws engineer|kubernetes)\b/i.test(
    raw
  );
  const bonus = [
    /\bterraform\b/i,
    /\bansible\b/i,
    /\bhelm\b/i,
    /\bargo\s*cd\b/i,
    /\bprometheus\b/i,
    /\bgrafana\b/i,
    /\bcloudformation\b/i,
  ].filter((re) => re.test(raw)).length;
  const blocker =
    (/\b(cobol|jcl|vsam)\b/i.test(raw) && hits.length < 4) ||
    (/\b(appian|salesforce|mainframe)\b/i.test(raw) && hits.length < 5);

  let score = Math.round(0.58 * match.score + 0.42 * hitPct);

  if (devopsRole && hits.length >= 8) score = Math.max(score, 72);
  else if (devopsRole && hits.length >= 5) score = Math.max(score, 62);
  else if (hits.length >= 10) score = Math.max(score, 68);
  else if (hits.length >= 6) score = Math.max(score, 55);
  if (bonus >= 2 && hits.length >= 5) score = Math.min(100, score + 5);

  if (match.familyRelation === "mismatch" && hits.length < 6) {
    score = Math.min(score, 36);
  }
  if (blocker) score = Math.min(score, 24);
  if (hits.length <= 1) score = Math.min(score, 22);
  if (hits.length === 0) score = Math.min(score, 12);

  score = Math.max(0, Math.min(100, score));
  const decision = decisionFromScore(score);
  const rationale = [
    `${decision === "screen" || decision === "interview" ? "Fit" : "Weak"} for DevOps AWS (${hits.length}/${MANDATORY.length} mandatory skills in profile).`,
    hits.length ? `Evidence: ${hits.join(", ")}.` : "No AWS/DevOps stack evidence.",
    match.rationale,
  ].join(" ");

  return {
    score,
    decision,
    rationale,
    hits,
    engineScore: match.score,
    matchingSkills: match.matchingSkills,
    family: match.personFamily,
  };
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);

  const jdText = (await readFile(join(process.cwd(), "docs", "JD", JD_FILE), "utf8")).trim();
  const { data: jdRows, error: jdErr } = await supabase
    .from("job_descriptions")
    .select("id, file_name, jd_text");
  if (jdErr) throw new Error(jdErr.message);
  const jdRow =
    (jdRows || []).find((j) => /devops\s*aws\.txt/i.test(String(j.file_name || ""))) ||
    (jdRows || []).find((j) => /devops engineer\s*-\s*aws/i.test(String(j.jd_text || "")));
  if (!jdRow?.id) throw new Error("DevOps Engineer - AWS JD not found in job_descriptions");
  const text = String(jdRow.jd_text || jdText).trim();
  if (!text) throw new Error("DevOps AWS JD text missing");

  const { data: rosterRow, error } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "corp_pool_roster")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = rosterRow?.value as any;
  const employees: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.employees) ? raw.employees : [];

  let scored = 0;
  const results: Array<{
    id: string;
    name: string;
    designation: string;
    score: number;
    engine: number;
    decision: string;
    hits: number;
    family: string;
  }> = [];
  for (const emp of employees) {
    if (emp.upload_batch !== BATCH) continue;
    const out = intelligentScore(emp, text);
    emp.score = out.score;
    emp.score_override = out.score;
    emp.score_override_jd_id = jdRow.id;
    emp.llm_rationale = out.rationale;
    emp.llm_best_jd = jdRow.file_name;
    emp.llm_best_jd_why = `Scored against ${jdRow.file_name} DevOps Engineer - AWS.`;
    emp.matchingSkills = out.matchingSkills;
    scored += 1;
    results.push({
      id: emp.employee_id,
      name: emp.full_name,
      designation: String(emp.designation || ""),
      score: out.score,
      engine: out.engineScore,
      decision: out.decision,
      hits: out.hits.length,
      family: out.family,
    });
  }

  if (!scored) throw new Error("No 16 Sep Corp Pool people found to score");

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
  const bucket = { interview: 0, screen: 0, hold: 0, reject: 0 };
  for (const r of results) bucket[r.decision as keyof typeof bucket] += 1;

  console.log(
    JSON.stringify(
      {
        jd: jdRow.file_name,
        jdId: jdRow.id,
        scored,
        buckets: bucket,
        people: results,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
