/**
 * Export 16 Sep Corp Pool (114) vs DevOps Engineer - AWS scores to Excel.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import ExcelJS from "exceljs";
import { decisionFromScore } from "../src/lib/skill-match";

const BATCH = "2026-09-16T12:45:00.000Z";
const OUT = join(process.cwd(), "CorpPool_16Sep26_DevOps_AWS_Scores.xlsx");
const OUT_DOCS = join(process.cwd(), "docs", "NON-Needed docs", "CorpPool_16Sep26_DevOps_AWS_Scores.xlsx");

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
  return MANDATORY.filter(([, re]) => re.test(text)).map(([label]) => label);
}

function decisionFill(decision: string): string {
  if (decision === "interview") return "166534";
  if (decision === "screen") return "1D4ED8";
  if (decision === "hold") return "B45309";
  return "B91C1C";
}

async function main() {
  const employees: any[] = JSON.parse(await readFile("uploads/employees.json", "utf8"));
  const rows = employees
    .filter((e) => e.upload_batch === BATCH)
    .map((e) => {
      const blob = `${e.full_name} ${e.designation} ${e.skills}`;
      const hits = hitsIn(blob);
      const score = Number(e.score_override ?? e.score ?? 0);
      const decision = decisionFromScore(score);
      const skills = String(e.skills || "").replace(/\s+/g, " ").trim();
      return {
        score,
        decision,
        hits,
        emp: e,
        skillsPreview: skills.length > 1200 ? `${skills.slice(0, 1200)}…` : skills,
      };
    })
    .sort((a, b) => b.score - a.score || String(a.emp.full_name).localeCompare(String(b.emp.full_name)));

  const wb = new ExcelJS.Workbook();
  wb.creator = "TalentScope";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Item", key: "item", width: 36 },
    { header: "Value", key: "value", width: 70 },
  ];
  const buckets = { interview: 0, screen: 0, hold: 0, reject: 0 };
  for (const r of rows) buckets[r.decision as keyof typeof buckets] += 1;
  const summaryRows = [
    ["Requirement", "00002BR | DevOps AWS.txt"],
    ["Job title", "DevOps Engineer - AWS"],
    ["Pool", "Corp Pool — 16 Sep 2026 (ActivePoolResumes)"],
    ["People scored", String(rows.length)],
    ["Emp ID note", "CV-hash placeholders removed. Blank Emp ID = no Infinite Emp No on the resume or corp list. 81000013 / 63000129 are official contractor Emp Nos from the corp list."],
    ["Interview (75+)", String(buckets.interview)],
    ["Screen (60–74)", String(buckets.screen)],
    ["Hold (30–59)", String(buckets.hold)],
    ["Reject (<30)", String(buckets.reject)],
    [
      "Mandatory skills",
      "Jenkins, AWS, EKS, EC2, Lambda, API Gateway, CloudFront, RDS, IAM, VPC, S3, Route 53, ELB, ALB, Auto Scaling, WAF, CloudWatch, Bitbucket, GitLab, Docker, Kubernetes, Fargate",
    ],
    ["Scored on", "16 Sep 2026"],
  ];
  for (const [item, value] of summaryRows) summary.addRow({ item, value });
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFF" } };
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "111827" } };

  const ws = wb.addWorksheet("All 114 scores");
  ws.columns = [
    { header: "Rank", key: "rank", width: 8 },
    { header: "Emp ID", key: "id", width: 16 },
    { header: "Emp No note", key: "idNote", width: 42 },
    { header: "Name", key: "name", width: 32 },
    { header: "Email", key: "email", width: 36 },
    { header: "Designation", key: "designation", width: 42 },
    { header: "Department", key: "department", width: 16 },
    { header: "Grade", key: "grade", width: 10 },
    { header: "Score %", key: "score", width: 10 },
    { header: "Decision", key: "decision", width: 12 },
    { header: "Mandatory hits", key: "hitCount", width: 16 },
    { header: "Skills evidenced (of 22)", key: "hits", width: 48 },
    { header: "Matching skills", key: "matching", width: 40 },
    { header: "Profile skills / resume excerpt", key: "skills", width: 60 },
    { header: "Recruiter notes", key: "notes", width: 70 },
    { header: "Source file", key: "source", width: 40 },
    { header: "JD", key: "jd", width: 28 },
    { header: "Pool date", key: "date", width: 14 },
  ];

  const header = ws.getRow(1);
  header.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "111827" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 28;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: "R1" };

  rows.forEach((row, i) => {
    const emp = row.emp;
    const rawId = String(emp.employee_id || "");
    const displayId = /^CV/i.test(rawId) ? "" : rawId;
    const idNote = /^CV/i.test(rawId)
      ? "Not on resume or corp list"
      : /^(81|63)\d+/.test(rawId)
        ? "Official Emp No on Infinite corp list (contractor series)"
        : "Official Emp No";
    const added = ws.addRow({
      rank: i + 1,
      id: displayId,
      idNote,
      name: emp.full_name,
      email: emp.email || "",
      designation: emp.designation || "",
      department: emp.department || "",
      grade: emp.grade || "",
      score: row.score,
      decision: row.decision,
      hitCount: `${row.hits.length}/22`,
      hits: row.hits.join(", ") || "none",
      matching: Array.isArray(emp.matchingSkills) ? emp.matchingSkills.join(", ") : "",
      skills: row.skillsPreview,
      notes: emp.llm_rationale || "",
      source: emp.source_file || "",
      jd: emp.llm_best_jd || "00002BR | DevOps AWS.txt",
      date: "16 Sep 2026",
    });
    added.font = { name: "Segoe UI", size: 10 };
    added.alignment = { vertical: "top", wrapText: true };
    added.height = 36;
    const dec = added.getCell("decision");
    dec.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFF" } };
    dec.fill = { type: "pattern", pattern: "solid", fgColor: { argb: decisionFill(row.decision) } };
    dec.alignment = { vertical: "middle", horizontal: "center" };
    added.getCell("score").alignment = { vertical: "middle", horizontal: "center" };
    added.getCell("rank").alignment = { vertical: "middle", horizontal: "center" };
  });

  await wb.xlsx.writeFile(OUT);
  await wb.xlsx.writeFile(OUT_DOCS);
  console.log(JSON.stringify({ people: rows.length, buckets, out: OUT, outDocs: OUT_DOCS }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
