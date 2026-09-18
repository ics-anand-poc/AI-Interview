/**
 * Second pass: map remaining 16 Sep CV-hash rows to official Emp Nos
 * from the corp-pool roster / zip, and fix garbage names.
 */
import { readFile, writeFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const BATCH = "2026-09-16T12:45:00.000Z";

const FILE_TO_ID: Record<string, string> = {
  "br_anushri.pdf": "1028166",
  "pawan kr burnwal_latest.docx": "1042491",
  "bharath_integrationspecialist.pdf": "63000129",
  "mohanapriya deenadhayalan.docx": "1029140",
  "ravindra_latest_cv.pdf": "1042052",
  "samas_java.docx": "1037058",
  "sangeetha_updatedprofile.docx": "1029240",
  "seshadriinfiniteaug2026.doc": "1042200",
  "udit _resume 2.pdf": "1043142",
  "ranjitha_s_s_cv_02.07.26 2.pdf": "1038060",
  "karthick_k_resume (2).pdf": "1032567",
};

const FILE_TO_NAME: Record<string, string> = {
  "br_anushri.pdf": "Anushri B R",
  "pawan kr burnwal_latest.docx": "Pawan Kumar Burnwal",
  "bharath_integrationspecialist.pdf": "Bharath Gowda R S",
  "franklin sm - infinite final 2026  .pdf (1).pdf": "Crestoe Jabez Franklin",
  "udit _resume 2.pdf": "Udit Narayan Atrey",
  "seshadriinfiniteaug2026.doc": "Rajamannar Seshadri",
  "sangeetha_updatedprofile.docx": "M Sangeetha",
  "gopal kanjoliancv-latest-i.doc": "Gopal Kanjolia",
  "kishore murali etl qa - n.pdf": "Kishore Murali",
  "y.aswini_azure_data_engineer.docx": "Y Aswini",
};

function keyFile(name: string): string {
  return String(name || "").replace(/\\/g, "/").split("/").pop()?.toLowerCase().trim() || "";
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);

  const employees: any[] = JSON.parse(await readFile("uploads/employees.json", "utf8"));
  const byId = new Map(employees.map((e) => [String(e.employee_id), e]));
  const changes: any[] = [];

  for (const emp of [...employees]) {
    if (emp.upload_batch !== BATCH) continue;
    const src = keyFile(emp.source_file);
    const mappedId = FILE_TO_ID[src];
    const mappedName = FILE_TO_NAME[src];
    if (mappedName && (!emp.full_name || /cv|unknown|summary|skills|casagrand|anushri br|data-driven|carrer|mandate/i.test(String(emp.full_name)))) {
      emp.full_name = mappedName;
    } else if (mappedName && /^CV/i.test(String(emp.employee_id))) {
      emp.full_name = mappedName;
    }
    if (!mappedId || mappedId === String(emp.employee_id)) continue;

    const existing = byId.get(mappedId);
    if (existing && existing !== emp) {
      existing.upload_batch = BATCH;
      existing.uploaded_at = BATCH;
      existing.source_file = emp.source_file || existing.source_file;
      existing.score = emp.score;
      existing.score_override = emp.score_override;
      existing.score_override_jd_id = emp.score_override_jd_id;
      existing.llm_rationale = emp.llm_rationale;
      existing.llm_best_jd = emp.llm_best_jd;
      existing.llm_best_jd_why = emp.llm_best_jd_why;
      existing.matchingSkills = emp.matchingSkills;
      if (String(emp.skills || "").length > String(existing.skills || "").length) existing.skills = emp.skills;
      byId.delete(String(emp.employee_id));
      changes.push({ action: "merge", from: emp.employee_id, to: mappedId, name: existing.full_name, src: emp.source_file });
    } else {
      byId.delete(String(emp.employee_id));
      emp.employee_id = mappedId;
      byId.set(mappedId, emp);
      changes.push({ action: "id", from: emp.employee_id, to: mappedId, name: emp.full_name, src: emp.source_file });
    }
  }

  const next = Array.from(byId.values());
  const { error } = await supabase.from("portal_settings").upsert(
    { key: "corp_pool_roster", value: { employees: next } },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  const serialized = JSON.stringify(next, null, 2);
  await writeFile("uploads/employees.json", serialized, "utf8");
  await supabase.storage.from("app-data").upload("employees.json", serialized, {
    contentType: "application/json",
    upsert: true,
  });

  const today = next.filter((e) => e.upload_batch === BATCH);
  const stillCv = today.filter((e) => /^CV/i.test(String(e.employee_id)));
  console.log(
    JSON.stringify(
      {
        changes,
        today: today.length,
        stillCv: stillCv.map((e) => ({ id: e.employee_id, name: e.full_name, src: e.source_file })),
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
