/**
 * Merge "Corp Pool Active List 8th Sept'26.xlsx" into the live Corp Pool.
 * Keeps the people already in the pool. New people get today's upload batch.
 */
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { writeFile, readFile } from "fs/promises";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const CORP_PATH = "C:/Users/Aryan/OneDrive/Desktop/Corp Pool Active List 8th Sept'26.xlsx";
const CORP_SOURCE = "Corp Pool Active List 8th Sept 26.xlsx";

function cellToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/\u00a0/g, " ").trim();
  if (typeof v === "object") {
    const o = v as any;
    if (typeof o.text === "string") return o.text.replace(/\u00a0/g, " ").trim();
    if (Array.isArray(o.richText)) {
      return o.richText.map((p: any) => p.text || "").join("").replace(/\u00a0/g, " ").trim();
    }
    if (typeof o.result !== "undefined") return String(o.result ?? "").replace(/\u00a0/g, " ").trim();
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

function guessEmail(name: string, empNo: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}.${parts[parts.length - 1]}@infinite.com`.toLowerCase();
  if (parts.length === 1) return `${parts[0]}@infinite.com`.toLowerCase();
  return `${empNo}@infinite.com`;
}

function mergeText(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const text = String(part || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.join("\n");
}

async function parsePeople() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CORP_PATH);
  const sheet = wb.worksheets[0];
  const byId = new Map<
    string,
    {
      employee_id: string;
      full_name: string;
      grade: string;
      designation: string;
      status: string;
      skills: string;
    }
  >();
  let header: string[] = [];
  let idxs = {
    id: -1,
    name: -1,
    grade: -1,
    role: -1,
    category: -1,
    bucket: -1,
    detailed: -1,
    status: -1,
  };
  sheet.eachRow((row) => {
    const vals = ((row.values as any[]) || []).slice(1).map(cellToText);
    if (idxs.id === -1) {
      header = vals.map((v) => v.toLowerCase().replace(/[_-]/g, " "));
      const findIncl = (name: string) => header.findIndex((h) => h === name || h.includes(name));
      idxs = {
        id: findIncl("emp no"),
        name: findIncl("emp name"),
        grade: findIncl("grade"),
        role: findIncl("designation"),
        category: findIncl("skills category"),
        bucket: findIncl("skills bucket"),
        detailed: findIncl("detailed skills"),
        status: findIncl("status"),
      };
      return;
    }
    const employee_id = idxs.id >= 0 ? vals[idxs.id] : "";
    const full_name = idxs.name >= 0 ? vals[idxs.name] : "";
    if (!employee_id && !full_name) return;
    const id = employee_id || full_name;
    const prev = byId.get(id);
    const nextSkills = mergeText([
      prev?.skills || "",
      idxs.detailed >= 0 ? vals[idxs.detailed] : "",
      idxs.bucket >= 0 ? vals[idxs.bucket] : "",
      idxs.category >= 0 ? vals[idxs.category] : "",
    ]);
    byId.set(id, {
      employee_id: id,
      full_name: full_name || prev?.full_name || "Unknown Employee",
      grade: (idxs.grade >= 0 ? vals[idxs.grade] : "") || prev?.grade || "E1",
      designation: (idxs.role >= 0 ? vals[idxs.role] : "") || prev?.designation || "Engineer",
      status: (idxs.status >= 0 ? vals[idxs.status] : "") || prev?.status || "Active",
      skills: nextSkills,
    });
  });
  return Array.from(byId.values());
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);
  const uploadBatchAt = new Date().toISOString();

  const incoming = await parsePeople();
  if (!incoming.length) throw new Error("No people parsed from Corp Pool Active List 8th Sept'26.xlsx");

  const { data: rosterRow, error: rosterErr } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "corp_pool_roster")
    .maybeSingle();
  if (rosterErr) throw new Error(rosterErr.message);
  const raw = rosterRow?.value as any;
  const existing: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.employees)
      ? raw.employees
      : [];

  const { data: deletedRow, error: delErr } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "deleted_corp_pool")
    .maybeSingle();
  if (delErr) throw new Error(delErr.message);
  const deleted = (deletedRow?.value || { ids: [], files: [] }) as { ids: string[]; files: string[] };
  const incomingIds = new Set(incoming.map((p) => p.employee_id.toLowerCase()));
  const nextDeletedIds = (deleted.ids || []).filter((id) => !incomingIds.has(String(id).toLowerCase()));
  const { error: saveDelErr } = await supabase.from("portal_settings").upsert(
    { key: "deleted_corp_pool", value: { ids: nextDeletedIds, files: deleted.files || [] } },
    { onConflict: "key" }
  );
  if (saveDelErr) throw new Error(saveDelErr.message);

  const byId = new Map<string, any>();
  for (const emp of existing) {
    if (emp?.employee_id) byId.set(String(emp.employee_id), emp);
  }

  let added = 0;
  let updated = 0;
  for (const person of incoming) {
    const prev = byId.get(person.employee_id);
    const keepEmail =
      prev?.email && String(prev.email).includes("@") && !String(prev.email).includes("@example.com")
        ? String(prev.email)
        : guessEmail(person.full_name, person.employee_id);
    if (prev) {
      byId.set(person.employee_id, {
        ...prev,
        full_name: prev.manually_edited ? prev.full_name : person.full_name,
        email: keepEmail,
        department: prev.department || "Engineering",
        skills: prev.manually_edited ? prev.skills : person.skills,
        grade: prev.manually_edited ? prev.grade : person.grade,
        designation: prev.manually_edited ? prev.designation : person.designation,
        status: prev.manually_edited ? prev.status : person.status || prev.status || "Active",
        shortlisted: Boolean(prev.shortlisted),
        score_override: prev.score_override,
        uploaded_at: prev.uploaded_at,
        upload_batch: prev.upload_batch,
        source_file: prev.source_file || CORP_SOURCE,
        score: typeof prev.score_override === "number" ? prev.score_override : prev.score ?? 0,
      });
      updated += 1;
    } else {
      byId.set(person.employee_id, {
        employee_id: person.employee_id,
        full_name: person.full_name,
        email: keepEmail,
        department: "Engineering",
        skills: person.skills,
        grade: person.grade,
        designation: person.designation,
        status: person.status || "Active",
        shortlisted: false,
        score: 0,
        matchingSkills: [],
        source_file: CORP_SOURCE,
        uploaded_at: uploadBatchAt,
        upload_batch: uploadBatchAt,
      });
      added += 1;
    }
  }

  const employees = Array.from(byId.values());
  const { error: saveRosterErr } = await supabase.from("portal_settings").upsert(
    { key: "corp_pool_roster", value: { employees } },
    { onConflict: "key" }
  );
  if (saveRosterErr) throw new Error(saveRosterErr.message);

  const serialized = JSON.stringify(employees, null, 2);
  await writeFile("uploads/employees.json", serialized, "utf8");
  await supabase.storage
    .from("app-data")
    .upload("employees.json", serialized, { contentType: "application/json", upsert: true });

  const corpBuf = await readFile(CORP_PATH);
  await supabase.storage.from("docs-ingest").upload(`Corp Pool/${CORP_SOURCE}`, corpBuf, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });

  console.log(
    JSON.stringify(
      {
        parsedUnique: incoming.length,
        added,
        updated,
        total: employees.length,
        sampleNew: incoming
          .filter((p) => !existing.some((e) => String(e.employee_id) === p.employee_id))
          .slice(0, 8)
          .map((p) => `${p.employee_id} ${p.full_name}`),
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
