import ExcelJS from "exceljs";
import { localLlmCompleteJson } from "@/lib/local-llm";
import { decisionFromScore, type MatchDecision } from "@/lib/skill-match";

export type LlmFileKind = "corp_pool" | "jd" | "br" | "portal_mapping" | "unknown";

export type LlmFilePlacement = {
  kind: LlmFileKind;
  category: "employee" | "jd" | "br" | "portal-mapping" | "resume";
  placeIn: string;
  why: string;
  peopleCount?: number;
  suggestedTitle?: string;
  columns?: Record<string, string>;
};

export type LlmPersonScore = {
  score: number;
  decision: MatchDecision;
  rationale: string;
  bestJdFileName: string;
  bestJdWhy: string;
};

function cellToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/\u00a0/g, " ").trim();
  if (typeof v === "object") {
    const o = v as any;
    if (typeof o.text === "string") return o.text.replace(/\u00a0/g, " ").trim();
    if (Array.isArray(o.richText)) {
      return o.richText.map((p: any) => p.text || "").join("").replace(/\u00a0/g, " ").trim();
    }
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

export async function excelSheetPreview(buffer: Buffer, maxRows = 12): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const lines: string[] = [];
  for (const sheet of wb.worksheets.slice(0, 3)) {
    lines.push(`Sheet: ${sheet.name}`);
    let n = 0;
    sheet.eachRow((row) => {
      if (n >= maxRows) return;
      const vals = ((row.values as any[]) || []).slice(1, 10).map(cellToText);
      if (vals.some(Boolean)) {
        lines.push(vals.join(" | "));
        n += 1;
      }
    });
  }
  return lines.join("\n").slice(0, 7000);
}

const KIND_TO_CATEGORY: Record<LlmFileKind, LlmFilePlacement["category"]> = {
  corp_pool: "employee",
  jd: "jd",
  br: "br",
  portal_mapping: "portal-mapping",
  unknown: "resume",
};

const KIND_TO_PLACE: Record<LlmFileKind, string> = {
  corp_pool: "Corp Pool (people list)",
  jd: "Requirements JD/BR",
  br: "Requirements JD/BR (BR workbook)",
  portal_mapping: "Employee Portal mapping",
  unknown: "Do not auto-place — pick the tab yourself",
};

export async function classifyHrFileWithLlm(input: {
  fileName: string;
  preview: string;
}): Promise<LlmFilePlacement> {
  const parsed = await localLlmCompleteJson(
    `You classify files for an HR screening console with two people lists that must stay separate:
- Corp Pool = bench/employees to match against job descriptions (Emp No, name, grade, skills)
- Employee Portal mapping = test/question mapping, NOT Corp Pool
- JD / BR = job descriptions / requisitions (role title, responsibilities, mandatory skills). A JD Excel is often one column of prose, not Emp No rows.

Filename: ${input.fileName}

File contents (preview):
${input.preview.slice(0, 6500)}

Return ONLY JSON:
{
  "kind": "corp_pool" | "jd" | "br" | "portal_mapping" | "unknown",
  "why": "one or two sentences",
  "peopleCount": 0,
  "suggestedTitle": "",
  "columns": { "emp_no": "", "name": "", "skills": "" }
}
If it is a JD, suggestedTitle is the job title. columns only for corp_pool.`,
    { temperature: 0.1, maxTokens: 500, timeoutMs: 120_000 }
  );

  const kind = (["corp_pool", "jd", "br", "portal_mapping", "unknown"] as LlmFileKind[]).includes(
    parsed.kind
  )
    ? (parsed.kind as LlmFileKind)
    : "unknown";

  return {
    kind,
    category: KIND_TO_CATEGORY[kind],
    placeIn: KIND_TO_PLACE[kind],
    why: String(parsed.why || "").trim() || "Could not classify this file.",
    peopleCount: Number(parsed.peopleCount) || undefined,
    suggestedTitle: String(parsed.suggestedTitle || "").trim() || undefined,
    columns: parsed.columns && typeof parsed.columns === "object" ? parsed.columns : undefined,
  };
}

export async function scorePersonAgainstJdsWithLlm(input: {
  selectedJdFileName: string;
  selectedJdText: string;
  otherJds: Array<{ fileName: string; title: string; skills: string }>;
  person: {
    employee_id: string;
    full_name: string;
    designation?: string;
    grade?: string;
    skills?: string;
  };
}): Promise<LlmPersonScore> {
  const parsed = await localLlmCompleteJson(
    `Score 0-100 vs this JD. Wrong family <50. JSON only, no thinking.
JD: ${input.selectedJdFileName}
${input.selectedJdText.slice(0, 420)}
PERSON ${input.person.employee_id} ${input.person.full_name} ${input.person.designation || ""} ${input.person.grade || ""}
Skills: ${String(input.person.skills || "").slice(0, 280)}
{"score":0,"rationale":"short","bestJdFileName":"${input.selectedJdFileName}","bestJdWhy":"short"}`,
    { temperature: 0.1, maxTokens: 72, timeoutMs: 90_000 }
  );

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  return {
    score,
    decision: decisionFromScore(score),
    rationale: String(parsed.rationale || "").trim() || "Local Qwen score.",
    bestJdFileName: String(parsed.bestJdFileName || input.selectedJdFileName).trim(),
    bestJdWhy: String(parsed.bestJdWhy || "").trim(),
  };
}
