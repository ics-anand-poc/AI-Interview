import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import ExcelJS from "exceljs";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { checkCsrf } from "@/lib/security";
import { loadCorpPoolRoster, saveCorpPoolRoster } from "@/lib/corp-pool-store";
import { writePersistedJson, getRuntimeUploadsRoot } from "@/lib/runtime-data";
import { cacheStore } from "@/lib/cache-store";
import { jsonPublicError } from "@/lib/api-errors";
import type { EmployeeRecord } from "@/services/automation-service";

export const runtime = "nodejs";

function cellToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/\u00a0/g, " ").trim();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.replace(/\u00a0/g, " ").trim();
    if (Array.isArray(o.richText)) {
      return o.richText.map((p: any) => p.text || "").join("").replace(/\u00a0/g, " ").trim();
    }
    if (typeof o.result !== "undefined") return String(o.result ?? "").replace(/\u00a0/g, " ").trim();
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

function parseScore(raw: string): number | null {
  const n = Number(String(raw || "").replace(/%/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}

function findCol(headers: string[], names: string[]): number {
  for (const name of names) {
    const idx = headers.findIndex((h) => h === name || h.includes(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur.trim());
      cur = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && src[i + 1] === "\n")) {
      if (ch === "\r") i++;
      row.push(cur.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") {
      row.push(cur.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  row.push(cur.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const jdId = String(form.get("jdId") || "").trim();
    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ error: "Choose an Excel or CSV score file." }, { status: 400 });
    }
    if (!jdId || jdId === "all" || jdId.includes("@")) {
      return NextResponse.json({ error: "Select one requirement first, then upload match scores for that JD." }, { status: 400 });
    }

    const name = String(file.name || "").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    let table: string[][] = [];
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      table = parseCsv(buf.toString("utf8"));
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      const sheet = wb.worksheets[0];
      if (!sheet) {
        return NextResponse.json({ error: "That workbook has no sheet." }, { status: 400 });
      }
      sheet.eachRow((row) => {
        const vals = ((row.values as unknown[]) || []).slice(1).map(cellToText);
        if (vals.some(Boolean)) table.push(vals);
      });
    }
    if (table.length < 2) {
      return NextResponse.json({ error: "No score rows found in that file." }, { status: 400 });
    }

    const headers = table[0].map(headerKey);
    const idCol = findCol(headers, ["emp no", "employee id", "employee_id", "emp id", "id"]);
    const nameCol = findCol(headers, ["emp name", "full name", "name"]);
    const scoreCol = findCol(headers, ["match score", "percentage", "score %", "score"]);
    if (scoreCol < 0 || (idCol < 0 && nameCol < 0)) {
      return NextResponse.json(
        { error: "Need a score column and an Employee ID or Name column." },
        { status: 400 }
      );
    }

    const employees = await loadCorpPoolRoster<EmployeeRecord>();
    const byId = new Map(employees.map((emp) => [String(emp.employee_id || "").trim().toUpperCase(), emp]));
    const byName = new Map(
      employees.map((emp) => [String(emp.full_name || "").trim().toLowerCase(), emp])
    );

    let updated = 0;
    let skipped = 0;
    for (const vals of table.slice(1)) {
      const score = parseScore(vals[scoreCol] || "");
      if (score == null) {
        skipped++;
        continue;
      }
      const id = idCol >= 0 ? String(vals[idCol] || "").trim().toUpperCase() : "";
      const fullName = nameCol >= 0 ? String(vals[nameCol] || "").trim().toLowerCase() : "";
      const matched = (id && byId.get(id)) || (fullName && byName.get(fullName)) || null;
      if (!matched) {
        skipped++;
        continue;
      }
      matched.score = score;
      matched.score_override = score;
      matched.score_override_jd_id = jdId;
      updated++;
    }

    if (!updated) {
      return NextResponse.json(
        { error: "No Corp Pool people matched the rows in that file." },
        { status: 400 }
      );
    }

    await saveCorpPoolRoster(employees);
    const serialized = JSON.stringify(employees, null, 2);
    await writeFile(join(getRuntimeUploadsRoot(), "employees.json"), serialized, "utf8").catch(() => {});
    await writePersistedJson("employees.json", serialized);
    cacheStore.invalidate("employees");

    return NextResponse.json({ success: true, updated, skipped, jdId });
  } catch (error: any) {
    return jsonPublicError(error, error?.message || "Failed to import match scores");
  }
}
