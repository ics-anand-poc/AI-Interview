/**
 * Replace CV-hash / garbage Emp IDs on the 16 Sep Corp Pool with real
 * Infinite employee numbers from ActivePoolResumes.zip + corp-pool lists.
 */
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";
import { extractText } from "./add-active-pool-resumes-sept16";

const ZIP_PATH = "C:/Users/Aryan/Downloads/ActivePoolResumes.zip";
const BATCH = "2026-09-16T12:45:00.000Z";
const CORP_XLSX = join(process.cwd(), "docs", "NON-Needed docs", "Corp Pool Active List 18th Aug'26.xlsx");

function cellToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/\u00a0/g, " ").trim();
  if (typeof v === "object") {
    const o = v as any;
    if (typeof o.text === "string") return o.text.replace(/\u00a0/g, " ").trim();
    if (Array.isArray(o.richText)) return o.richText.map((p: any) => p.text || "").join("").replace(/\u00a0/g, " ").trim();
    if (typeof o.result !== "undefined") return String(o.result ?? "").replace(/\u00a0/g, " ").trim();
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

function isEmpId(raw: string): boolean {
  const d = String(raw || "").replace(/\D/g, "");
  if (!/^\d{6,8}$/.test(d)) return false;
  if (/^20(1[5-9]|2[0-9]|3[0-5])$/.test(d)) return false;
  return /^10\d{5,6}$/.test(d) || /^17\d{5}$/.test(d);
}

function looksWeirdId(id: string): boolean {
  const s = String(id || "").trim();
  if (!s || /^CV/i.test(s)) return true;
  if (!/^\d{6,8}$/.test(s)) return true;
  if (s.startsWith("81") && s.length === 8) return true;
  return false;
}

function extractEmpId(text: string, file: string): string {
  const blob = `${file}\n${text || ""}`;
  const labeled = [
    /employee\s*(?:id|code|number|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{5,8})/i,
    /emp(?:loyee)?\s*(?:id|no|code|number|#)\s*[:#.\-|]*\s*([A-Za-z]?\d{5,8})/i,
    /staff\s*(?:id|code|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{5,8})/i,
    /emp\s*code\s*[:#.\-|]*\s*([A-Za-z]?\d{5,8})/i,
  ];
  for (const re of labeled) {
    const m = blob.match(re);
    if (m?.[1] && isEmpId(m[1])) return m[1].replace(/\D/g, "");
  }
  const fromFile = [...String(file).matchAll(/(?:^|[^\d])(10\d{5,6}|17\d{5})(?=[^\d]|$)/g)].map((m) => m[1]);
  if (fromFile[0]) return fromFile[0];
  const head = String(text || "").slice(0, 2800);
  const headIds = [...head.matchAll(/(?:^|[^\d])(10\d{5})(?=[^\dA-Za-z]|[A-Z]|$)/g)].map((m) => m[1]);
  const uniq = [...new Set(headIds)];
  if (uniq.length === 1) return uniq[0];
  if (uniq.length > 1) return uniq[0];
  return "";
}

function normName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\b(resume|cv|ics|infinite|updated|latest|profile|sr|senior|engineer|lead|manager)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameFromFile(file: string): string {
  const base = file.replace(/\.[^/.]+$/, "");
  let cleaned = base
    .replace(/^BR[_-]+/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\(\d+\)/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b10\d{5,6}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[.]\d{1,2}(?:[.]\d{2})?\b/g, " ")
    .replace(/\b(SDET|QA|resume|cv|curriculum vitae|infinite|updated|latest|profile|ics|yoe|yrs|final)\b/gi, "")
    .replace(/\b(cobol|jcl|vsam|java|dotnet|azure|web api|core|etl tester|data engineer|associate softwear|software)\b/gi, "")
    .replace(/!+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  cleaned = cleaned.replace(/^\d+\s+/, "").trim();
  return cleaned;
}

function looksLikePersonName(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 48) return false;
  if (/unknown|personal summary|data-driven|casagrand|^rata$/i.test(t)) return false;
  if (/@|https?:|www\./i.test(t)) return false;
  const words = t.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  return /^[A-Za-z][A-Za-z .'-]*$/.test(t);
}

function pickName(file: string, text: string, current: string): string {
  if (looksLikePersonName(current) && !/cv latest|senior technical lead/i.test(current)) return current;
  const fromFile = nameFromFile(file);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 16);
  const fromLine = lines.find((l) => looksLikePersonName(l.replace(/^10\d{5}\s+/, "")));
  const lineName = fromLine ? fromLine.replace(/^10\d{5}\s+/, "").trim() : "";
  if (looksLikePersonName(lineName)) return lineName;
  if (looksLikePersonName(fromFile)) return fromFile;
  return fromFile || current || "Unknown";
}

async function loadCorpList(): Promise<Map<string, { id: string; name: string }>> {
  const byName = new Map<string, { id: string; name: string }>();
  if (!existsSync(CORP_XLSX)) return byName;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CORP_XLSX);
  const sheet = wb.worksheets[0];
  let idIdx = -1;
  let nameIdx = -1;
  sheet.eachRow((row) => {
    const vals = ((row.values as any[]) || []).slice(1).map(cellToText);
    if (idIdx === -1) {
      const header = vals.map((v) => v.toLowerCase().replace(/[_-]/g, " "));
      idIdx = header.findIndex((h) => h.includes("emp no") || h === "emp id" || h === "id");
      nameIdx = header.findIndex((h) => h.includes("emp name") || h.includes("employee name") || h === "name");
      return;
    }
    const id = String(idIdx >= 0 ? vals[idIdx] : "").replace(/\D/g, "");
    const name = nameIdx >= 0 ? vals[nameIdx] : "";
    if (!isEmpId(id) || !name) return;
    const key = normName(name);
    if (key) byName.set(key, { id, name });
  });
  return byName;
}

function lookupName(map: Map<string, { id: string; name: string }>, name: string): { id: string; name: string } | null {
  const key = normName(name);
  if (!key) return null;
  if (map.has(key)) return map.get(key)!;
  const tokens = key.split(" ").filter((t) => t.length > 2);
  if (tokens.length < 2) return null;
  const hits = [...map.entries()].filter(([k]) => {
    const kt = k.split(" ").filter((t) => t.length > 2);
    const overlap = tokens.filter((t) => kt.includes(t));
    return overlap.length >= Math.min(2, tokens.length) && (k.includes(tokens[0]) || tokens.includes(kt[0]));
  });
  if (hits.length === 1) return hits[0][1];
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  const lastFirst = [...map.entries()].filter(([k]) => k.includes(last) && k.includes(first));
  if (lastFirst.length === 1) return lastFirst[0][1];
  return null;
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);

  const employees: any[] = JSON.parse(await readFile("uploads/employees.json", "utf8"));
  const corp = await loadCorpList();
  const rosterNames = new Map<string, { id: string; name: string }>();
  for (const emp of employees) {
    if (!isEmpId(String(emp.employee_id))) continue;
    const n = normName(emp.full_name);
    if (n) rosterNames.set(n, { id: String(emp.employee_id), name: emp.full_name });
  }

  const zip = new AdmZip(await readFile(ZIP_PATH));
  const bySource = new Map<string, { id: string; name: string; file: string }>();
  const parsed: any[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const file = String(entry.entryName || "").replace(/\\/g, "/").split("/").pop() || "";
    if (!file || file.startsWith(".") || file.toLowerCase() === "desktop.ini") continue;
    let text = "";
    try {
      text = await extractText(file, entry.getData());
    } catch {
      text = "";
    }
    const id = extractEmpId(text, file);
    const name = pickName(file, text, "");
    const rec = { file, id, name, textLen: text.length };
    parsed.push(rec);
    bySource.set(file.toLowerCase(), { id, name, file });
  }

  const changes: any[] = [];
  const byId = new Map(employees.map((e) => [String(e.employee_id), e]));

  for (const emp of employees) {
    if (emp.upload_batch !== BATCH) continue;
    const src = String(emp.source_file || "");
    const fromZip = bySource.get(src.toLowerCase());
    let nextId = String(emp.employee_id);
    let nextName = String(emp.full_name || "");

    const zipId = fromZip?.id || extractEmpId("", src);
    const listed =
      lookupName(corp, nextName) ||
      lookupName(corp, fromZip?.name || "") ||
      lookupName(rosterNames, nextName) ||
      lookupName(rosterNames, fromZip?.name || "");

    if (looksWeirdId(nextId)) {
      nextId = zipId || listed?.id || nextId;
    } else if (zipId && zipId !== nextId && isEmpId(zipId)) {
      nextId = zipId;
    }

    const betterName = pickName(src, "", nextName);
    if (!looksLikePersonName(nextName) || /cv latest|anushri br|personal summary/i.test(nextName)) {
      nextName = listed?.name || fromZip?.name || betterName || nextName;
    } else if (fromZip?.name && looksLikePersonName(fromZip.name) && fromZip.name.length > 3) {
      if (/unknown|gopal kanjolia cv|m sangeetha senior/i.test(nextName)) nextName = fromZip.name;
    }

    if (nextId === String(emp.employee_id) && nextName === emp.full_name) continue;

    const prev = { ...emp };
    if (nextId !== String(emp.employee_id)) {
      const existing = byId.get(nextId);
      if (existing && existing !== emp) {
        existing.upload_batch = BATCH;
        existing.uploaded_at = BATCH;
        existing.source_file = src || existing.source_file;
        if (emp.score_override != null) {
          existing.score = emp.score;
          existing.score_override = emp.score_override;
          existing.score_override_jd_id = emp.score_override_jd_id;
          existing.llm_rationale = emp.llm_rationale;
          existing.llm_best_jd = emp.llm_best_jd;
          existing.matchingSkills = emp.matchingSkills;
        }
        if (String(emp.skills || "").length > String(existing.skills || "").length) {
          existing.skills = emp.skills;
        }
        byId.delete(String(emp.employee_id));
        changes.push({
          action: "merge",
          from: prev.employee_id,
          to: nextId,
          name: existing.full_name,
          source: src,
        });
        continue;
      }
      byId.delete(String(emp.employee_id));
      emp.employee_id = nextId;
      byId.set(nextId, emp);
    }
    emp.full_name = nextName;
    changes.push({
      action: "update",
      from: prev.employee_id,
      to: nextId,
      oldName: prev.full_name,
      name: nextName,
      source: src,
    });
  }

  const nextEmployees = Array.from(byId.values());
  const { error } = await supabase.from("portal_settings").upsert(
    { key: "corp_pool_roster", value: { employees: nextEmployees } },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  const serialized = JSON.stringify(nextEmployees, null, 2);
  await writeFile("uploads/employees.json", serialized, "utf8");
  await supabase.storage
    .from("app-data")
    .upload("employees.json", serialized, { contentType: "application/json", upsert: true });

  const stillWeird = nextEmployees
    .filter((e) => e.upload_batch === BATCH && looksWeirdId(String(e.employee_id)))
    .map((e) => ({ id: e.employee_id, name: e.full_name, source: e.source_file }));

  console.log(
    JSON.stringify(
      {
        zipParsed: parsed.length,
        zipWithId: parsed.filter((p) => p.id).length,
        changes: changes.length,
        stillWeird,
        sampleChanges: changes.slice(0, 40),
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
