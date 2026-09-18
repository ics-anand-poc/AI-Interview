/**
 * Add DevOps Engineer - AWS requirement (all listed skills mandatory).
 * Uses 00001BR because no official BR ID was given. Does not replace other JDs.
 *
 * Usage:
 *   npx tsx scripts/add-aws-devops-jd.ts
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
const BR_ID = "00001BR";
const FILE = "DevOps AWS.txt";
const createdAt = "2026-09-16T06:30:00.000Z";

async function main() {
  const jdText = readFileSync(join(ROOT, "docs", "JD", FILE), "utf8").trim();
  const row = {
    id: brIdToUuid(BR_ID),
    jd_text: jdText,
    rm_email: "admin@infinite.com",
    file_name: `${BR_ID} | ${FILE}`,
    created_at: createdAt,
  };

  const { url, key } = getSupabaseConfig();
  if (url && key) {
    const supabase = createClient(url, key);
    const oldId = brIdToUuid("88006BR");
    if (oldId !== row.id) {
      await supabase.from("job_descriptions").delete().eq("id", oldId);
    }

    const { data: existing, error: readErr } = await supabase
      .from("job_descriptions")
      .select("id, file_name")
      .eq("id", row.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing?.id) {
      const { error } = await supabase
        .from("job_descriptions")
        .update({
          jd_text: row.jd_text,
          file_name: row.file_name,
        })
        .eq("id", existing.id);
      if (error) throw error;
      console.log(`Updated existing requirement ${existing.file_name || row.file_name}`);
    } else {
      const { error } = await supabase.from("job_descriptions").insert(row);
      if (error) throw error;
      console.log(`Inserted ${row.file_name} dated ${createdAt}`);
    }
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
  const idx = local.findIndex(
    (j) =>
      j.id === row.id ||
      j.id === brIdToUuid("88006BR") ||
      String(j.fileName || "").includes(FILE)
  );
  const prev = idx === -1 ? null : local[idx];
  const localRow = {
    id: row.id,
    jdText: row.jd_text,
    rmEmail: prev?.rmEmail || row.rm_email,
    fileName: row.file_name,
    createdAt: prev?.createdAt || prev?.created_at || createdAt,
    uploadBatch: prev?.uploadBatch || prev?.upload_batch || createdAt,
  };
  if (idx === -1) local.push(localRow);
  else local[idx] = { ...local[idx], ...localRow };
  writeFileSync(localPath, JSON.stringify(local, null, 2), "utf8");
  console.log(`Updated ${localPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
