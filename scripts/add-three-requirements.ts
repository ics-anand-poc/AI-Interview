/**
 * Add Linux Developer, DevOps + Ansible, and Test Automation requirements.
 * Does not delete or replace existing JDs.
 *
 * Usage:
 *   npx tsx scripts/add-three-requirements.ts
 */
import { createHash } from "crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

loadProjectEnv();

function brIdToUuid(brId: string): string {
  const hash = createHash("md5").update(brId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const ROOT = process.cwd();
const createdAt = new Date().toISOString();

const REQUIREMENTS = [
  {
    brId: "88001BR",
    file: "Linux Developer.txt",
  },
  {
    brId: "88002BR",
    file: "DevOps Ansible.txt",
  },
  {
    brId: "88003BR",
    file: "Test Automation.txt",
  },
];

function loadJdText(filename: string): string {
  return readFileSync(join(ROOT, "docs", "JD", filename), "utf8").trim();
}

async function main() {
  const rows = REQUIREMENTS.map((item) => ({
    id: brIdToUuid(item.brId),
    jd_text: loadJdText(item.file),
    rm_email: "admin@infinite.com",
    file_name: `${item.brId} | ${item.file}`,
    created_at: createdAt,
  }));

  const { url, key } = getSupabaseConfig();
  if (url && key) {
    const supabase = createClient(url, key);
    const { data: existing, error: readErr } = await supabase
      .from("job_descriptions")
      .select("id, file_name, created_at");
    if (readErr) throw readErr;
    const existingRows = existing || [];
    const toUpsert = rows.map((row) => {
      const found =
        existingRows.find((e) => e.id === row.id) ||
        existingRows.find((e) =>
          String(e.file_name || "")
            .toLowerCase()
            .includes(row.file_name.split(" | ")[1].toLowerCase())
        );
      if (!found) return row;
      return {
        ...row,
        id: found.id,
        created_at: found.created_at || row.created_at,
        file_name: found.file_name || row.file_name,
      };
    });
    const { error } = await supabase.from("job_descriptions").upsert(toUpsert);
    if (error) throw error;
    console.log(`Upserted ${toUpsert.length} requirement(s) into job_descriptions.`);
    for (const row of toUpsert) console.log(`  ${row.file_name}`);
  } else {
    console.warn("No Supabase config; writing local JSON only.");
  }

  const localPath = join(ROOT, "uploads", "job_descriptions.json");
  mkdirSync(join(ROOT, "uploads"), { recursive: true });
  let local: any[] = [];
  if (existsSync(localPath)) {
    try {
      local = JSON.parse(readFileSync(localPath, "utf8"));
    } catch {}
  }
  for (const row of rows) {
    const idx = local.findIndex((j) => j.id === row.id || String(j.fileName || "").includes(row.file_name.split(" | ")[1]));
    const prev = idx === -1 ? null : local[idx];
    const stamped = prev?.createdAt || prev?.created_at || row.created_at;
    const localRow = {
      id: prev?.id || row.id,
      jdText: row.jd_text,
      rmEmail: prev?.rmEmail || row.rm_email,
      fileName: prev?.fileName || row.file_name,
      createdAt: stamped,
      uploadBatch: prev?.uploadBatch || prev?.upload_batch || stamped,
    };
    if (idx === -1) local.push(localRow);
    else local[idx] = { ...local[idx], ...localRow };
  }
  writeFileSync(localPath, JSON.stringify(local, null, 2), "utf8");
  console.log(`Updated ${localPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
