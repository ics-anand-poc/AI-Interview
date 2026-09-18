/**
 * Add the two unique ActivePool resumes that never got their own 16 Sep row:
 * Akshat Gupta (already 1036900 on 9 Sep) and Aakriti Sharma (missing).
 */
import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const ZIP_PATH = "C:/Users/Aryan/Downloads/ActivePoolResumes.zip";
const BATCH = "2026-09-16T12:45:00.000Z";

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || "").trim();
}

function skillsFromText(text: string): string {
  const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length <= 6000 ? cleaned : cleaned.slice(0, 6000);
}

async function loadResume(zip: AdmZip, endsWith: string): Promise<{ file: string; text: string }> {
  const entry = zip.getEntries().find((e) => String(e.entryName).replace(/\\/g, "/").endsWith(endsWith));
  if (!entry) throw new Error(`Missing ${endsWith}`);
  const file = String(entry.entryName).replace(/\\/g, "/").split("/").pop() || endsWith;
  return { file, text: await extractDocx(entry.getData()) };
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);
  const zip = new AdmZip(await readFile(ZIP_PATH));
  const akshat = await loadResume(zip, "Akshat Resume (ICS).docx");
  const aakriti = await loadResume(zip, "ICS Resume Aakriti.docx");

  const { data: rosterRow, error } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "corp_pool_roster")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = rosterRow?.value as any;
  const employees: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.employees) ? raw.employees : [];
  const byId = new Map(employees.map((e) => [String(e.employee_id), e]));

  const akshatRow = byId.get("1036900") || {};
  byId.set("1036900", {
    ...akshatRow,
    employee_id: "1036900",
    full_name: "Akshat Gupta",
    email: akshatRow.email || "akshatgu@infinite.com",
    department: akshatRow.department || "Engineering",
    skills: skillsFromText(akshat.text),
    grade: akshatRow.grade || "",
    designation: akshatRow.designation || "Engineer",
    status: akshatRow.status || "Active",
    shortlisted: Boolean(akshatRow.shortlisted),
    score: akshatRow.score ?? 0,
    matchingSkills: akshatRow.matchingSkills || [],
    source_file: akshat.file,
    uploaded_at: BATCH,
    upload_batch: BATCH,
  });

  const aakritiId = `CV${createHash("md5").update("ics resume aakriti.docx").digest("hex").slice(0, 10)}`;
  const existingAakriti = [...byId.values()].find((e) =>
    /aakriti/i.test(String(e.full_name || "")) || /akki32sharma/i.test(String(e.email || ""))
  );
  const keepAakritiId = existingAakriti?.employee_id || aakritiId;
  if (existingAakriti && keepAakritiId !== aakritiId) byId.delete(aakritiId);
  byId.set(keepAakritiId, {
    ...(existingAakriti || {}),
    employee_id: keepAakritiId,
    full_name: "Aakriti Sharma",
    email: "akki32sharma@gmail.com",
    department: "Engineering",
    skills: skillsFromText(aakriti.text),
    grade: existingAakriti?.grade || "",
    designation: existingAakriti?.designation || "Engineer",
    status: "Active",
    shortlisted: Boolean(existingAakriti?.shortlisted),
    score: existingAakriti?.score ?? 0,
    matchingSkills: existingAakriti?.matchingSkills || [],
    source_file: aakriti.file,
    uploaded_at: BATCH,
    upload_batch: BATCH,
  });

  const next = Array.from(byId.values());
  const { error: saveErr } = await supabase.from("portal_settings").upsert(
    { key: "corp_pool_roster", value: { employees: next } },
    { onConflict: "key" }
  );
  if (saveErr) throw new Error(saveErr.message);
  const serialized = JSON.stringify(next, null, 2);
  await writeFile("uploads/employees.json", serialized, "utf8");
  await supabase.storage
    .from("app-data")
    .upload("employees.json", serialized, { contentType: "application/json", upsert: true });

  const today = next.filter((e) => e.upload_batch === BATCH);
  console.log(
    JSON.stringify(
      {
        total: next.length,
        today: today.length,
        akshat: today.find((e) => e.employee_id === "1036900")
          ? { id: "1036900", name: "Akshat Gupta", file: akshat.file }
          : null,
        aakriti: today
          .filter((e) => /aakriti/i.test(String(e.full_name)))
          .map((e) => ({ id: e.employee_id, name: e.full_name, file: e.source_file })),
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
