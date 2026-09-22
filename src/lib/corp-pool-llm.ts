import ExcelJS from "exceljs";
import { localLlmCompleteJson, localLlmIsUp } from "@/lib/local-llm";
import { hrPlacement, placeHrFile, type HrFilePlacement } from "@/lib/hr-file-place";
import {
  calculateSkillMatch,
  compileJdForMatch,
  employeeMatchText,
  type CompiledJd,
  type MatchDecision,
} from "@/lib/skill-match";

export type LlmFileKind = "corp_pool" | "jd" | "br" | "portal_mapping" | "unknown";

export type LlmFilePlacement = HrFilePlacement;

export type LlmPersonScore = {
  score: number;
  decision: MatchDecision;
  rationale: string;
  bestJdFileName: string;
  bestJdWhy: string;
  matchingSkills?: string[];
  engine?: "jd-cv" | "chips" | "laya";
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

export async function classifyHrFileWithLlm(input: {
  fileName: string;
  preview: string;
}): Promise<LlmFilePlacement> {
  const rules = placeHrFile(input);
  if (rules.kind !== "unknown") return rules;

  if (!(await localLlmIsUp())) return rules;

  try {
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
    { temperature: 0.1, maxTokens: 220, timeoutMs: 12_000 }
  );

  const kind = (["corp_pool", "jd", "br", "portal_mapping", "unknown"] as LlmFileKind[]).includes(
    parsed.kind
  )
    ? (parsed.kind as LlmFileKind)
    : "unknown";

  return hrPlacement(kind, String(parsed.why || "").trim() || "Could not classify this file.", {
    peopleCount: Number(parsed.peopleCount) || undefined,
    suggestedTitle: String(parsed.suggestedTitle || "").trim() || undefined,
    columns: parsed.columns && typeof parsed.columns === "object" ? parsed.columns : undefined,
  });
  } catch {
    return rules;
  }
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
    product?: string;
    role?: string;
    cv_vec?: string[];
    cv_hash?: string;
  };
  jdVec?: string[];
  deep?: boolean;
  llmReady?: boolean;
  compiledJd?: CompiledJd;
}): Promise<LlmPersonScore> {
  const match = calculateSkillMatch(
    employeeMatchText({
      skills: input.person.skills,
      designation: input.person.designation,
      grade: input.person.grade,
      product: input.person.product,
      role: input.person.role,
    }),
    input.selectedJdText,
    input.compiledJd
  );
  return {
    score: match.score,
    decision: match.decision,
    rationale: match.rationale,
    bestJdFileName: input.selectedJdFileName,
    bestJdWhy: match.rationale,
    matchingSkills: match.matchingSkills,
    engine: "chips",
  };
}

export function compileSelectedJd(jdText: string): CompiledJd {
  return compileJdForMatch(jdText);
}
