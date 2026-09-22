import { supabaseServer } from "@/lib/db";
import { vectorizeCvText, vectorizeJdText } from "@/lib/skill-match";

const JD_VEC_KEY = "jd_vectors";

const VECTOR_VERSION = "v2";

function hashText(text: string): string {
  const s = VECTOR_VERSION + String(text || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export type VectoredEmployee = {
  employee_id: string;
  skills?: string | null;
  designation?: string | null;
  grade?: string | null;
  cv_vec?: string[] | null;
  cv_hash?: string | null;
};

export function cvBlob(emp: { skills?: string | null; designation?: string | null; grade?: string | null }): string {
  return [emp.designation, emp.grade, emp.skills].filter(Boolean).join("\n");
}

/** Vectorize a CV once. Reuses the stored vector until the resume text changes. */
export function ensureCvVector<T extends VectoredEmployee>(emp: T): T {
  const blob = cvBlob(emp);
  const hash = hashText(blob);
  if (emp.cv_hash === hash && Array.isArray(emp.cv_vec) && emp.cv_vec.length) {
    return emp;
  }
  emp.cv_vec = vectorizeCvText(blob);
  emp.cv_hash = hash;
  return emp;
}

export function ensureCvVectors<T extends VectoredEmployee>(employees: T[]): T[] {
  for (const emp of employees) ensureCvVector(emp);
  return employees;
}

export type JdVectorRecord = {
  id: string;
  fileName?: string;
  jd_vec: string[];
  jd_hash: string;
};

type JdVectorMap = Record<string, JdVectorRecord>;

let jdVecCache: { at: number; value: JdVectorMap } | null = null;

export function buildJdVector(jdText: string): { jd_vec: string[]; jd_hash: string } {
  const text = String(jdText || "").trim();
  return { jd_vec: vectorizeJdText(text), jd_hash: hashText(text) };
}

async function readJdVectorMap(): Promise<JdVectorMap> {
  if (jdVecCache && Date.now() - jdVecCache.at < 8000) return jdVecCache.value;
  const { data, error } = await supabaseServer
    .from("portal_settings")
    .select("value")
    .eq("key", JD_VEC_KEY)
    .maybeSingle();
  if (error) {
    console.warn("Failed to load JD vectors:", error.message);
    return jdVecCache?.value || {};
  }
  const raw = data?.value;
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as JdVectorMap) : {};
  jdVecCache = { at: Date.now(), value };
  return value;
}

async function writeJdVectorMap(value: JdVectorMap): Promise<void> {
  jdVecCache = { at: Date.now(), value };
  const { error } = await supabaseServer.from("portal_settings").upsert(
    { key: JD_VEC_KEY, value },
    { onConflict: "key" }
  );
  if (error) throw new Error(`Failed to save JD vectors: ${error.message}`);
}

/** Vectorize a JD once on upload. Reuses the stored vector until the JD text changes. */
export async function saveJdVector(id: string, jdText: string, fileName?: string): Promise<JdVectorRecord> {
  const [rec] = await saveJdVectors([{ id, jdText, fileName }]);
  return rec;
}

export async function saveJdVectors(
  rows: Array<{ id: string; jdText: string; fileName?: string }>
): Promise<JdVectorRecord[]> {
  const map = rows.length ? await readJdVectorMap() : {};
  const out: JdVectorRecord[] = [];
  let dirty = false;
  for (const row of rows) {
    const jdId = String(row.id || "").trim();
    const built = buildJdVector(row.jdText);
    const rec: JdVectorRecord = { id: jdId, fileName: row.fileName, ...built };
    out.push(rec);
    if (!jdId) continue;
    const prev = map[jdId];
    if (prev?.jd_hash === rec.jd_hash && prev.jd_vec?.length) continue;
    map[jdId] = rec;
    dirty = true;
  }
  if (dirty) await writeJdVectorMap(map);
  return out;
}

export async function loadOrCreateJdVector(id: string, jdText: string, fileName?: string): Promise<string[]> {
  const jdId = String(id || "").trim();
  const hash = hashText(String(jdText || "").trim());
  if (jdId) {
    const map = await readJdVectorMap();
    const prev = map[jdId];
    if (prev?.jd_hash === hash && prev.jd_vec?.length) return prev.jd_vec;
  }
  const rec = await saveJdVector(jdId, jdText, fileName);
  return rec.jd_vec;
}
