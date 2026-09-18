/**
 * Add 3 Java resumes as a separate 17 Sep 2026 Corp Pool batch.
 * Existing Emp IDs are kept; only these three move to today's group.
 *
 * Usage: npx tsx scripts/add-three-corp-sept17.ts
 */
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import { createClient } from "@supabase/supabase-js";
import { extractText } from "./add-active-pool-resumes-sept16";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const BATCH = "2026-09-17T12:30:00.000Z";
const ROOT = process.cwd();

const FILES = [
  {
    path: "C:/Users/Aryan/Downloads/SHAIK RAFI_Java_ICS.DOCX",
    employee_id: "1035947",
    full_name: "Shaik Rafi",
    designation: "Senior Software Engineer",
  },
  {
    path: "C:/Users/Aryan/Downloads/1036246_Pamidi_08182026.DOCX",
    employee_id: "1036246",
    full_name: "Naresh Pamidi",
    designation: "Senior Software Engineer",
  },
  {
    path: "C:/Users/Aryan/Downloads/Satya_Gundarapu_1032084.docx",
    employee_id: "1032084",
    full_name: "Gundarapu Satyanarayana",
    designation: "Senior Technical Lead",
  },
];

function skillsFromText(text: string): string {
  const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length <= 6000 ? cleaned : cleaned.slice(0, 6000);
}

function firstEmail(text: string): string {
  return text.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] || "";
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);

  const destDir = join(ROOT, "docs", "CorpPool_17Sep26");
  mkdirSync(destDir, { recursive: true });

  const incoming: Array<{
    employee_id: string;
    full_name: string;
    designation: string;
    email: string;
    skills: string;
    source_file: string;
  }> = [];

  for (const file of FILES) {
    if (!existsSync(file.path)) throw new Error(`Missing ${file.path}`);
    const buf = await readFile(file.path);
    const source_file = basename(file.path);
    copyFileSync(file.path, join(destDir, source_file));
    const text = await extractText(source_file, buf);
    incoming.push({
      employee_id: file.employee_id,
      full_name: file.full_name,
      designation: file.designation,
      email: firstEmail(text),
      skills: skillsFromText(text) || file.full_name,
      source_file,
    });
    await supabase.storage.from("docs-ingest").upload(`Corp Pool/${source_file}`, buf, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
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

  const result: Array<{ id: string; name: string; action: string }> = [];
  for (const person of incoming) {
    const prev = byId.get(person.employee_id) || {};
    const email =
      (person.email && person.email.includes("@") ? person.email : "") ||
      prev.email ||
      `${person.full_name.split(/\s+/)[0].toLowerCase()}@infinite.com`;
    byId.set(person.employee_id, {
      ...prev,
      employee_id: person.employee_id,
      full_name: person.full_name,
      email,
      department: prev.department || "Engineering",
      skills: person.skills,
      grade: prev.grade || "",
      designation: person.designation,
      status: prev.status || "Active",
      shortlisted: Boolean(prev.shortlisted),
      score_override: prev.score_override,
      score_override_jd_id: prev.score_override_jd_id,
      score: typeof prev.score_override === "number" ? prev.score_override : prev.score ?? 0,
      matchingSkills: prev.matchingSkills || [],
      source_file: person.source_file,
      uploaded_at: BATCH,
      upload_batch: BATCH,
    });
    result.push({
      id: person.employee_id,
      name: person.full_name,
      action: prev.employee_id ? "moved-to-17sep" : "added",
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

  const today = next.filter((e) => e.upload_batch === BATCH);
  const sept16 = next.filter((e) => e.upload_batch === "2026-09-16T12:45:00.000Z");
  console.log(
    JSON.stringify(
      {
        total: next.length,
        todayCount: today.length,
        sept16Count: sept16.length,
        people: result,
        batch: BATCH,
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
