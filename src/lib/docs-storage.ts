import { dirname, join } from "path";
import fs from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";
import { getRuntimeUploadsRoot } from "@/lib/runtime-data";
import { isCloudDeployment } from "@/lib/container-runtime";
import { safeStorageFileName } from "@/lib/security";

export type DocCategory = "BR" | "JD" | "Resumes" | "Corp Pool" | "Portal Mapping";

const DOCS_BUCKET = "docs-ingest";

const LOCAL_DIRS: Record<DocCategory, string> = {
  BR: "BR",
  JD: "JD",
  Resumes: "Resumes",
  "Corp Pool": "Corp Pool",
  "Portal Mapping": "Portal Mapping",
};

export function useCloudDocsStorage(): boolean {
  return isCloudDeployment();
}

export function getDocsIngestMode(): "cloud" | "local" {
  return useCloudDocsStorage() ? "cloud" : "local";
}

function localDir(category: DocCategory): string {
  return join(process.cwd(), "docs", LOCAL_DIRS[category]);
}

function cloudObjectPath(category: DocCategory, filename: string): string {
  const safe = safeStorageFileName(filename) || "file";
  return `${LOCAL_DIRS[category]}/${safe}`;
}

function cachePath(category: DocCategory, filename: string): string {
  const safe = safeStorageFileName(filename) || "file";
  return join(getRuntimeUploadsRoot(), "docs-cache", LOCAL_DIRS[category], safe);
}

async function ensureLocalDir(category: DocCategory): Promise<void> {
  await mkdir(localDir(category), { recursive: true });
}

async function ensureDocsBucket(): Promise<void> {
  try {
    const { data: buckets, error } = await supabaseServer.storage.listBuckets();
    if (error) throw error;
    if (!buckets?.some((b) => b.id === DOCS_BUCKET)) {
      await supabaseServer.storage.createBucket(DOCS_BUCKET, { public: false });
    }
  } catch (e) {
    console.warn("Could not ensure docs-ingest bucket:", e);
  }
}

/** Ensures local folders (dev) or Supabase docs bucket (Vercel). */
export async function ensureDocsStorage(): Promise<void> {
  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    return;
  }
  for (const category of Object.keys(LOCAL_DIRS) as DocCategory[]) {
    await ensureLocalDir(category);
  }
  await mkdir(getRuntimeUploadsRoot(), { recursive: true });
}

function isUsableDocName(name: string): boolean {
  return Boolean(name) && !name.startsWith(".") && name !== ".gitkeep";
}

async function listNamesInDir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(/*turbopackIgnore: true*/ dir);
    return entries.filter(isUsableDocName);
  } catch {
    return [];
  }
}

async function listLocalCategoryFiles(category: DocCategory): Promise<string[]> {
  const folder = LOCAL_DIRS[category];
  const names = new Set<string>();

  // Cloud deploys read from Supabase. Scanning repo docs/ here makes Turbopack
  // trace the whole project into the serverless bundle.
  if (!useCloudDocsStorage()) {
    for (const name of await listNamesInDir(join(process.cwd(), "docs", folder))) {
      names.add(name);
    }
    for (const name of await listNamesInDir(join(process.cwd(), "uploads", "docs-cache", folder))) {
      names.add(name);
    }
  }

  if (useCloudDocsStorage()) {
    for (const name of await listNamesInDir(join(getRuntimeUploadsRoot(), "docs-cache", folder))) {
      names.add(name);
    }
  }

  return Array.from(names);
}

export async function listDocFiles(category: DocCategory): Promise<string[]> {
  const names = new Set<string>();

  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    const prefix = LOCAL_DIRS[category];
    const { data, error } = await supabaseServer.storage
      .from(DOCS_BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.warn(`listDocFiles cloud failed for ${category}:`, error.message);
    } else {
      for (const entry of data ?? []) {
        if (entry.name && entry.id !== null && isUsableDocName(entry.name)) {
          names.add(entry.name);
        }
      }
    }
  }

  for (const name of await listLocalCategoryFiles(category)) {
    names.add(name);
  }

  if (names.size === 0 && !useCloudDocsStorage()) {
    await ensureLocalDir(category);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export async function readDocFileBuffer(
  category: DocCategory,
  filename: string
): Promise<Buffer> {
  const localPath = join(localDir(category), filename);
  const cached = cachePath(category, filename);

  const readIfPresent = async (fullPath: string): Promise<Buffer | null> => {
    try {
      if (!fs.existsSync(/*turbopackIgnore: true*/ fullPath)) return null;
      const buf = await readFile(/*turbopackIgnore: true*/ fullPath);
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  };

  // Cloud ingest writes the fresh file to docs-cache first. Prefer that over a
  // leftover docs/ copy with the same name, which would parse stale bytes.
  if (useCloudDocsStorage()) {
    const cachedBuffer = await readIfPresent(cached);
    if (cachedBuffer) return cachedBuffer;
  } else {
    const localBuffer = await readIfPresent(localPath);
    if (localBuffer) return localBuffer;
    const cachedBuffer = await readIfPresent(cached);
    if (cachedBuffer) return cachedBuffer;
  }

  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    const objectPath = cloudObjectPath(category, filename);
    const { data, error } = await supabaseServer.storage
      .from(DOCS_BUCKET)
      .download(objectPath);
    if (error || !data) {
      throw new Error(error?.message || `Cloud doc not found: ${objectPath}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    try {
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, buffer);
    } catch {
      // cache optional
    }
    return buffer;
  }

  throw new Error(`Local doc not found: ${localPath}`);
}

export async function writeDocFile(
  category: DocCategory,
  filename: string,
  buffer: Buffer
): Promise<void> {
  const safeName = safeStorageFileName(filename);
  if (!safeName) {
    throw new Error("Invalid file name");
  }
  filename = safeName;
  if (useCloudDocsStorage()) {
    await ensureDocsBucket();
    const objectPath = cloudObjectPath(category, filename);
    const { error } = await supabaseServer.storage
      .from(DOCS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: "application/octet-stream",
        upsert: true,
      });
    if (error) throw new Error(error.message);
    try {
      const cached = cachePath(category, filename);
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, buffer);
    } catch {
      // cache optional
    }
    return;
  }

  await ensureLocalDir(category);
  await writeFile(join(localDir(category), filename), buffer);
  try {
    const cached = cachePath(category, filename);
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, buffer);
  } catch {
    // cache optional
  }
}

export async function deleteDocFile(
  category: DocCategory,
  filename: string
): Promise<void> {
  const localPath = join(localDir(category), filename);
  const cached = cachePath(category, filename);
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ localPath)) fs.unlinkSync(localPath);
  } catch {
    // ignore
  }
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ cached)) fs.unlinkSync(cached);
  } catch {
    // ignore
  }
  if (useCloudDocsStorage()) {
    try {
      await supabaseServer.storage.from(DOCS_BUCKET).remove([cloudObjectPath(category, filename)]);
    } catch (e) {
      console.warn(`Failed to delete cloud doc ${category}/${filename}:`, e);
    }
  }
}

/** True when cloud bucket has at least one object (used for empty-state hints). */
export async function cloudDocsHasAnyFiles(): Promise<boolean> {
  if (!useCloudDocsStorage()) return false;
  for (const category of Object.keys(LOCAL_DIRS) as DocCategory[]) {
    const files = await listDocFiles(category);
    if (files.length > 0) return true;
  }
  return false;
}

/** Migrate local docs/ folder to Supabase (one-time dev → prod helper). */
export async function syncLocalDocsToCloud(): Promise<{ uploaded: number }> {
  if (!useCloudDocsStorage()) {
    throw new Error("Cloud docs storage is not enabled");
  }
  let uploaded = 0;
  for (const category of Object.keys(LOCAL_DIRS) as DocCategory[]) {
    const dir = localDir(category);
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) continue;
    const files = await readdir(/*turbopackIgnore: true*/ dir);
    for (const file of files) {
      const full = join(dir, file);
      if (!fs.statSync(full).isFile()) continue;
      const buffer = await readFile(/*turbopackIgnore: true*/ full);
      await writeDocFile(category, file, buffer);
      uploaded++;
    }
  }
  return { uploaded };
}
