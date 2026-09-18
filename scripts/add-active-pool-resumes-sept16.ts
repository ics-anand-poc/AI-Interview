/**
 * Add everyone in ActivePoolResumes.zip to Corp Pool as a separate
 * 16 Sep 2026 batch. Existing people not in the zip keep their old dates.
 *
 * Usage:
 *   npx tsx scripts/add-active-pool-resumes-sept16.ts
 */
import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const ZIP_PATH = "C:/Users/Aryan/Downloads/ActivePoolResumes.zip";
const CORP_SOURCE = "ActivePoolResumes.zip";
const UPLOAD_BATCH_AT = "2026-09-16T12:45:00.000Z";

function isPlausibleEmployeeId(value: string): boolean {
  const id = String(value || "").trim();
  if (!/^[A-Za-z]?\d{4,12}$/.test(id)) return false;
  const digits = id.replace(/\D/g, "");
  if (digits.length === 4) {
    const year = Number(digits);
    if (year >= 1970 && year <= 2035) return false;
  }
  if (digits.length === 10 || digits.length === 11 || digits.length === 12) return false;
  return true;
}

function extractEmployeeId(text: string, file: string): string {
  const normalized = String(text || "").replace(/\u00a0/g, " ");
  const patterns = [
    /employee\s*(?:id|code|number|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
    /emp(?:loyee)?\s*(?:id|no|code|number)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
    /staff\s*(?:id|code|no)\s*[:#.\-|]*\s*([A-Za-z]?\d{4,12})\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1] && isPlausibleEmployeeId(match[1])) return match[1].trim();
  }
  const fromFile = String(file || "").match(/(?:^|[^A-Za-z0-9])([A-Za-z]?\d{5,10})(?=[^A-Za-z0-9]|$)/);
  if (fromFile?.[1] && isPlausibleEmployeeId(fromFile[1])) return fromFile[1];
  for (const line of normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12)) {
    const leading = line.match(/^([A-Za-z]?\d{5,8})(?:\s+[A-Za-z].*)?$/);
    if (leading?.[1] && isPlausibleEmployeeId(leading[1])) return leading[1];
  }
  return "";
}

function stripLeadingEmployeeId(value: string): { id: string; rest: string } {
  const match = String(value || "").trim().match(/^([A-Za-z]?\d{5,12})\s+(.+)$/);
  if (match?.[1] && isPlausibleEmployeeId(match[1])) {
    return { id: match[1], rest: match[2].trim() };
  }
  return { id: "", rest: String(value || "").trim() };
}

function looksLikePersonName(line: string): boolean {
  const raw = String(line || "").replace(/\s+/g, " ").trim();
  const text = stripLeadingEmployeeId(raw).rest.replace(/[!|]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length < 3 || text.length > 50) return false;
  if (/@|https?:|www\./i.test(text) || /[|]/.test(raw)) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(text)) return false;
  const titleCaseWords = words.filter((word) => /^[A-Z][a-zA-Z'.-]*$/.test(word) || /^[A-Z]\.?$/.test(word));
  return titleCaseWords.length >= Math.ceil(words.length / 2);
}

function nameFromFile(file: string): string {
  const base = file.replace(/\.[^/.]+$/, "");
  return stripLeadingEmployeeId(
    base
      .replace(/[_-]+/g, " ")
      .replace(/\(\d+\)/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\d+\s*(yoe|yrs?|years?)\b/gi, "")
      .replace(/\b(SDET|QA|resume|cv|curriculum vitae|infinite|updated|latest|profile|ics)\b/gi, "")
      .replace(/\b20\d{2}\b/g, "")
      .replace(/\b\d{1,2}[.]\d{1,2}\b/g, " ")
      .replace(/\bI\b/g, " ")
      .replace(/!+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).rest;
}

function profileFromCv(file: string, text: string) {
  const fromFile = nameFromFile(file);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const nameFromLine = lines.slice(0, 15).find((line) => looksLikePersonName(line));
  const nameFromLineClean = nameFromLine ? stripLeadingEmployeeId(nameFromLine) : { id: "", rest: "" };
  const labeledTitleMatch = text.match(
    /(?:^|[\n\r])\s*(?:title|designation|role|position)\s*[:|#]\s*([^\n\r]{2,80})/i
  );
  const titleLine = lines.find(
    (line) =>
      line.length < 60 &&
      /\b(SDET|engineer|developer|lead|manager|analyst|architect|tester|consultant)\b/i.test(line) &&
      !looksLikePersonName(line)
  );
  const email = text.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] || "";
  const employeeId =
    extractEmployeeId(text, file) || nameFromLineClean.id || "";
  let name =
    (nameFromLineClean.rest && looksLikePersonName(nameFromLineClean.rest) ? nameFromLineClean.rest : "") ||
    (looksLikePersonName(fromFile) ? fromFile : "") ||
    fromFile.replace(/!+/g, " ").replace(/\s+/g, " ").trim() ||
    "Unknown";
  if (/product|specialist|latest\s*i$|cv\s*i$|!/i.test(name) && fromFile) {
    const cleanedFile = fromFile
      .replace(/!+/g, " ")
      .replace(/integrationspecialist/gi, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    if (cleanedFile) name = cleanedFile;
  }
  const designationFromFile =
    file.match(/\b(SDET|QA|Quality\s*Analyst|Developer|Engineer|Lead|Manager|Architect|Analyst|Consultant|Tester)\b/i)?.[0] ||
    "";
  return {
    name: name.replace(/\s+/g, " ").trim() || "Unknown",
    designation: (labeledTitleMatch?.[1] || designationFromFile || titleLine || "Engineer").replace(/\s+/g, " ").trim(),
    email,
    employeeId,
  };
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function oleDocText(buffer: Buffer): string {
  const chunks: string[] = [];
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] !== 0 || buffer[i + 1] < 32) continue;
    let j = i;
    let out = "";
    while (j < buffer.length - 1 && buffer[j + 1] === 0 && buffer[j] >= 32 && buffer[j] < 127) {
      out += String.fromCharCode(buffer[j]);
      j += 2;
    }
    if (out.length >= 8) chunks.push(out);
    i = j;
  }
  const ascii = buffer
    .toString("latin1")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ");
  return `${chunks.join("\n")}\n${ascii}`.trim();
}

async function extractPdf(buffer: Buffer): Promise<string> {
  try {
    const pdfParseModule = require("pdf-parse");
    const PDFParse = pdfParseModule.PDFParse;
    if (typeof pdfParseModule.setWorker === "function") pdfParseModule.setWorker();
    if (typeof PDFParse === "function") {
      const parser = new PDFParse({ data: Uint8Array.from(buffer) });
      try {
        const result = await parser.getText({ itemJoiner: " ", cellSeparator: " ", lineEnforce: true });
        const text =
          result?.text ||
          (Array.isArray(result?.pages) ? result.pages.map((page: any) => page?.text || "").join("\n") : "");
        if (String(text || "").trim().length >= 40) return String(text).trim();
      } finally {
        if (typeof parser.destroy === "function") await parser.destroy();
      }
    } else if (typeof pdfParseModule.default === "function") {
      const dataResult = await pdfParseModule.default(buffer);
      if (dataResult?.text) return String(dataResult.text).trim();
    } else if (typeof pdfParseModule === "function") {
      const dataResult = await pdfParseModule(buffer);
      if (dataResult?.text) return String(dataResult.text).trim();
    }
  } catch {}
  const raw = buffer.toString("latin1");
  const chunks: string[] = [];
  const paren = /\((?:\\.|[^\\)])*\)/g;
  let match: RegExpExecArray | null;
  while ((match = paren.exec(raw))) {
    const decoded = match[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/\\([()\\])/g, "$1");
    const cleaned = decoded.replace(/\s+/g, " ").trim();
    if (cleaned.length >= 2) chunks.push(cleaned);
  }
  return chunks.join(" ").trim();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || "").trim();
}

function extractOdtOrPptx(buffer: Buffer, kind: "odt" | "pptx"): string {
  const zip = new AdmZip(buffer);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    const name = String(entry.entryName || "").replace(/\\/g, "/").toLowerCase();
    if (kind === "odt" && name === "content.xml") {
      parts.push(xmlToText(entry.getData().toString("utf8")));
    }
    if (kind === "pptx" && /^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      parts.push(xmlToText(entry.getData().toString("utf8")));
    }
  }
  return parts.join("\n").trim();
}

function sniffExt(name: string, buffer: Buffer): string {
  let ext = (name.split(".").pop() || "").toLowerCase();
  if (buffer[0] === 0x25 && buffer[1] === 0x50) return "pdf";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    if (ext === "odt" || ext === "pptx" || ext === "docx") return ext;
    return "docx";
  }
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return "doc";
  return ext;
}

export async function extractText(name: string, buffer: Buffer): Promise<string> {
  const ext = sniffExt(name, buffer);
  if (ext === "pdf") return extractPdf(buffer);
  if (ext === "docx") return extractDocx(buffer);
  if (ext === "odt") return extractOdtOrPptx(buffer, "odt");
  if (ext === "pptx") return extractOdtOrPptx(buffer, "pptx");
  if (ext === "doc") {
    try {
      const viaMammoth = await extractDocx(buffer);
      if (viaMammoth.length >= 40) return viaMammoth;
    } catch {}
    return oleDocText(buffer);
  }
  if (ext === "txt") return buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    try {
      return await extractDocx(buffer);
    } catch {
      return extractOdtOrPptx(buffer, "odt") || extractOdtOrPptx(buffer, "pptx");
    }
  }
  return "";
}

function skillsFromText(text: string): string {
  const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= 6000) return cleaned;
  return cleaned.slice(0, 6000);
}

function guessEmail(name: string, empNo: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}.${parts[parts.length - 1]}@infinite.com`.toLowerCase();
  if (parts.length === 1) return `${parts[0]}@infinite.com`.toLowerCase();
  return `${empNo}@infinite.com`.toLowerCase();
}

function fileStemKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\(\d+\)/g, " ")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(resume|cv|updated|latest|infinite|ics|profile)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generatedId(file: string): string {
  return `CV${createHash("md5").update(file.toLowerCase()).digest("hex").slice(0, 10)}`;
}

function normalizeName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Incoming = {
  employee_id: string;
  full_name: string;
  email: string;
  designation: string;
  skills: string;
  source_file: string;
};

async function parseZip(): Promise<{ people: Incoming[]; failed: string[] }> {
  const zip = new AdmZip(await readFile(ZIP_PATH));
  const failed: string[] = [];
  const byKey = new Map<string, Incoming>();
  const byStem = new Map<string, string>();
  const entries = zip.getEntries().filter((entry) => {
    if (entry.isDirectory) return false;
    const name = String(entry.entryName || "").replace(/\\/g, "/");
    const base = name.split("/").pop() || "";
    if (!base || base.startsWith(".") || base.toLowerCase() === "desktop.ini") return false;
    if (name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX")) return false;
    return true;
  });

  entries.sort((a, b) => {
    const an = (a.entryName.split("/").pop() || "").includes("(1)") ? 1 : 0;
    const bn = (b.entryName.split("/").pop() || "").includes("(1)") ? 1 : 0;
    return an - bn;
  });

  for (const entry of entries) {
    const baseName = entry.entryName.replace(/\\/g, "/").split("/").pop() || "resume";
    let data: Buffer;
    try {
      data = entry.getData();
    } catch {
      failed.push(`${baseName} (unreadable)`);
      continue;
    }
    if (!data?.length) {
      failed.push(`${baseName} (empty)`);
      continue;
    }
    let text = "";
    try {
      text = await extractText(baseName, data);
    } catch (err: any) {
      failed.push(`${baseName} (${err?.message || "parse error"})`);
      continue;
    }
    if (!text || text.length < 30) {
      const fallbackName = nameFromFile(baseName);
      if (fallbackName) {
        const employee_id = extractEmployeeId("", baseName) || generatedId(baseName);
        const person: Incoming = {
          employee_id,
          full_name: fallbackName,
          email: "",
          designation: baseName.match(/\b(SDET|QA|Developer|Engineer|Lead|Manager|Architect|Analyst|Consultant|Tester)\b/i)?.[0] || "Engineer",
          skills: fallbackName,
          source_file: baseName,
        };
        const key = person.employee_id.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, person);
        const stem = fileStemKey(baseName);
        if (stem && !byStem.has(stem)) byStem.set(stem, key);
        failed.push(`${baseName} (image/scanned — added from filename)`);
        continue;
      }
      failed.push(`${baseName} (no text)`);
      continue;
    }
    const profile = profileFromCv(baseName, text);
    const employee_id = profile.employeeId || generatedId(baseName);
    const person: Incoming = {
      employee_id,
      full_name: profile.name,
      email: profile.email,
      designation: profile.designation,
      skills: skillsFromText(text),
      source_file: baseName,
    };
    const stem = fileStemKey(baseName);
    const key = (stem && byStem.get(stem)) || person.employee_id.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || person.skills.length > prev.skills.length) {
      if (prev && prev.employee_id.toLowerCase() !== key) byKey.delete(prev.employee_id.toLowerCase());
      byKey.set(key, person);
    }
    if (stem) byStem.set(stem, key);
  }

  return { people: Array.from(byKey.values()), failed };
}

async function main() {
  loadProjectEnv();
  if (process.env.ALLOW_INSECURE_TLS === "1") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);

  const { people: incoming, failed } = await parseZip();
  if (!incoming.length) throw new Error("No people parsed from ActivePoolResumes.zip");

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
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const emp of existing) {
    if (!emp?.employee_id) continue;
    const id = String(emp.employee_id);
    byId.set(id, emp);
    const email = String(emp.email || "").trim().toLowerCase();
    if (email && email.includes("@") && !email.includes("@example.com") && !email.includes("@corp-pool.local")) {
      byEmail.set(email, id);
    }
    const n = normalizeName(emp.full_name);
    if (n) byName.set(n, id);
  }

  let added = 0;
  let moved = 0;

  const incomingByFile = new Map(incoming.map((p) => [p.source_file.toLowerCase(), p]));
  const incomingByName = new Map(incoming.map((p) => [normalizeName(p.full_name), p]));
  for (const [id, emp] of Array.from(byId.entries())) {
    if (!/^CV/i.test(id)) continue;
    const fromFile = incomingByFile.get(String(emp.source_file || "").toLowerCase());
    const fromName = incomingByName.get(normalizeName(emp.full_name));
    const replacement = fromFile || fromName;
    if (replacement && replacement.employee_id !== id) {
      byId.delete(id);
    }
  }
  for (const person of incoming) {
    const email = String(person.email || "").trim().toLowerCase();
    const existingId =
      (byId.has(person.employee_id) ? person.employee_id : "") ||
      (email && byEmail.get(email)) ||
      byName.get(normalizeName(person.full_name)) ||
      "";
    const prev = existingId ? byId.get(existingId) : undefined;
    const keepEmail =
      (person.email && person.email.includes("@") ? person.email : "") ||
      (prev?.email && String(prev.email).includes("@") && !String(prev.email).includes("@example.com")
        ? String(prev.email)
        : guessEmail(person.full_name, person.employee_id));
    const keepId =
      prev && /^CV/i.test(String(prev.employee_id)) && !/^CV/i.test(person.employee_id)
        ? person.employee_id
        : prev
          ? String(prev.employee_id)
          : person.employee_id;
    if (prev && keepId !== String(prev.employee_id)) byId.delete(String(prev.employee_id));
    const row = {
      ...(prev || {}),
      employee_id: keepId,
      full_name: prev?.manually_edited ? prev.full_name : person.full_name,
      email: keepEmail,
      department: prev?.department || "Engineering",
      skills: prev?.manually_edited ? prev.skills : person.skills,
      grade: prev?.grade || "",
      designation: prev?.manually_edited ? prev.designation : person.designation,
      status: prev?.status || "Active",
      shortlisted: Boolean(prev?.shortlisted),
      score_override: prev?.score_override,
      score_override_jd_id: prev?.score_override_jd_id,
      score: typeof prev?.score_override === "number" ? prev.score_override : prev?.score ?? 0,
      matchingSkills: prev?.matchingSkills || [],
      source_file: person.source_file,
      uploaded_at: UPLOAD_BATCH_AT,
      upload_batch: UPLOAD_BATCH_AT,
    };
    byId.set(keepId, row);
    if (email) byEmail.set(email, keepId);
    byName.set(normalizeName(person.full_name), keepId);
    if (prev) moved += 1;
    else added += 1;
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

  const zipBuf = await readFile(ZIP_PATH);
  await supabase.storage.from("docs-ingest").upload(`Corp Pool/${CORP_SOURCE}`, zipBuf, {
    contentType: "application/zip",
    upsert: true,
  });

  console.log(
    JSON.stringify(
      {
        parsedUnique: incoming.length,
        added,
        movedToToday: moved,
        total: employees.length,
        failed,
        sample: incoming.slice(0, 12).map((p) => `${p.employee_id} ${p.full_name}`),
        batch: UPLOAD_BATCH_AT,
      },
      null,
      2
    )
  );
}

const isDirect = /add-active-pool-resumes-sept16/i.test(process.argv[1] || "");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
