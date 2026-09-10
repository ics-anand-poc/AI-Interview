import { join, basename } from 'path';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import { supabase } from '@/lib/db';
import { resumeService } from '@/services/resume-service';
import { extractJdDetails } from '@/lib/jd-to-br/aiService';
import { writeLog } from '@/lib/structured-logger';
import { interviewCSVService } from '@/services/interview-csv-service';
import { generateAIText } from '@/lib/ai-providers';
import {
  ensureDocsStorage,
  listDocFiles,
  readDocFileBuffer,
  writeDocFile,
  deleteDocFile,
} from '@/lib/docs-storage';
import { writePersistedJson, readPersistedJson } from '@/lib/runtime-data';
import { loadCorpPoolRoster, saveCorpPoolRoster } from '@/lib/corp-pool-store';
import { cacheStore } from '@/lib/cache-store';
import { calculateSkillMatch, employeeMatchText } from '@/lib/skill-match';
import { isCorpPoolDeleted, loadDeletedCorpPool, unmarkCorpPoolDeleted } from '@/lib/deleted-corp-pool';

// Re-exported so existing callers (employees/route.ts, employees/rerank/route.ts) that
// import calculateSkillMatch from this module keep working unchanged.
export { calculateSkillMatch };

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export interface EmployeeRecord {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  skills: string;
  product?: string;
  grade: string;
  designation: string;
  status: string;
  shortlisted: boolean;
  score: number;
  matchingSkills: string[];
  source_file?: string;
  /** First time this person was added to Corp Pool. */
  uploaded_at?: string;
  /** Same ISO stamp for everyone added in one Corp Pool upload. */
  upload_batch?: string;
  /** Admin-set match score; wins over JD auto-match until cleared. */
  score_override?: number | null;
  /** JD this override belongs to. Blank/old overrides do not apply to other reqs. */
  score_override_jd_id?: string | null;
  /** When true, a later Corp Pool scan keeps these edited profile fields. */
  manually_edited?: boolean;
}

/**
 * Ensures the folders /docs/Resumes, /docs/BR-JD, and /docs/Corp Pool exist.
 */
export async function ensureDocsDirectories() {
  const root = process.cwd();
  const dirs = [
    join(root, "docs", "Resumes"),
    join(root, "docs", "BR"),
    join(root, "docs", "JD"),
    join(root, "docs", "Corp Pool"),
    join(getUploadsRoot())
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Stage 2 of talent matching: refines a shortlist of candidates with a proper
 * LLM-grounded assessment.
 *
 * Architecture rationale: calculateSkillMatch() above is a hardcoded keyword-overlap
 * scorer, deliberately kept that way because it runs once per employee record and a
 * deployment can have hundreds of employees — running an LLM call per employee per JD
 * would be slow and needlessly expensive for what is fundamentally a bulk filtering
 * pass. This function is the second stage: called ONLY on the already-narrowed
 * shortlist (top N by calculateSkillMatch), it sends each shortlisted candidate's ACTUAL
 * skills/experience text plus the ACTUAL JD text to the LLM and asks for a grounded
 * extraction-based comparison — not a generic opinion, but an assessment tied to what is
 * literally present in those two source texts. Cost stays bounded by shortlist size, not
 * total employee count.
 */
export interface TalentShortlistCandidate {
  employeeId: string;
  fullName: string;
  skillsText: string;
  keywordScore: number;
  matchingSkills: string[];
}

export interface TalentShortlistAssessment {
  employeeId: string;
  fullName: string;
  refinedScore: number; // 0-100
  matchedSkillsFromText: string[]; // skills the LLM actually found evidenced in skillsText
  skillGaps: string[]; // JD requirements not evidenced in skillsText
  rationale: string;
}

export async function refineCandidateShortlistWithAI(
  jdText: string,
  shortlist: TalentShortlistCandidate[]
): Promise<TalentShortlistAssessment[]> {
  if (shortlist.length === 0) return [];

  try {
    const prompt = `
You are a technical recruiter comparing a shortlist of internal candidates against a job description.

CRITICAL: Base every assessment strictly on the actual text provided for each candidate below —
do not assume skills/experience a candidate might plausibly have; only credit what is evidenced in
their skillsText. Similarly, only count something as a JD requirement if it is actually present in
the JD text below.

Job Description Text:
-------------------------------------------
${jdText}
-------------------------------------------

Candidate Shortlist (JSON):
${JSON.stringify(shortlist.map(c => ({ employeeId: c.employeeId, fullName: c.fullName, skillsText: c.skillsText })), null, 2)}

For EACH candidate in the shortlist, return an assessment. Return ONLY a raw JSON array with this exact structure:
[
  {
    "employeeId": "must match the input employeeId exactly",
    "fullName": "must match the input fullName exactly",
    "refinedScore": 78,
    "matchedSkillsFromText": ["skill actually found in this candidate's skillsText that matches a JD requirement"],
    "skillGaps": ["JD requirement not evidenced anywhere in this candidate's skillsText"],
    "rationale": "1-2 sentence grounded explanation referencing specifics from the candidate's actual skillsText and the JD text."
  }
]
`;

    const raw = await generateAIText(prompt);
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) throw new Error("AI response was not an array");

    const byId = new Map(parsed.map((p: any) => [p.employeeId, p]));
    return shortlist.map((c) => {
      const match = byId.get(c.employeeId);
      if (match) {
        return {
          employeeId: c.employeeId,
          fullName: c.fullName,
          refinedScore: Math.max(0, Math.min(100, Math.round(Number(match.refinedScore) || c.keywordScore))),
          matchedSkillsFromText: Array.isArray(match.matchedSkillsFromText) ? match.matchedSkillsFromText : c.matchingSkills,
          skillGaps: Array.isArray(match.skillGaps) ? match.skillGaps : [],
          rationale: typeof match.rationale === 'string' ? match.rationale : "",
        };
      }
      // LLM didn't return this candidate for some reason — fall back to its stage-1 score.
      return {
        employeeId: c.employeeId,
        fullName: c.fullName,
        refinedScore: c.keywordScore,
        matchedSkillsFromText: c.matchingSkills,
        skillGaps: [],
        rationale: "AI assessment unavailable for this candidate; showing keyword-match score.",
      };
    });
  } catch (err) {
    console.warn("AI shortlist refinement failed, returning stage-1 keyword-match scores unchanged.", err);
    return shortlist.map((c) => ({
      employeeId: c.employeeId,
      fullName: c.fullName,
      refinedScore: c.keywordScore,
      matchedSkillsFromText: c.matchingSkills,
      skillGaps: [],
      rationale: "AI shortlist assessment was unavailable; showing keyword-match score.",
    }));
  }
}

/**
 * Loads the base Excel BR template workbook
 */
async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const templatePath = join(getUploadsRoot(), "BR_RawData.xlsx");
  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = await readFile(templatePath);
    await workbook.xlsx.load(buffer as any);
    return workbook;
  } catch (e) {}
  
  // Blank workbook fallback
  const sheet = workbook.addWorksheet("BR _Raw Data");
  sheet.addRow([
    "Auto req ID", "Current Req Status", "Grade", "Designation", "Recruiter",
    "Department Type", "BU", "Client Interview?", "Mandatory Skills", "Entity",
    "Client Name", "Billing Type", "Project", "Requester ID", "TAG Manager",
    "RM Name", "Job description", "Joining Location", "Backfill for Employee Name",
    "Date Approved", "No. of Positions", "Positions Remaining", "Sourcing Type",
    "Requirement Type", "ST (Bill Rate) Enter only numeric value and 0 for Non-Billable"
  ]);
  return workbook;
}

/**
 * Helper to convert a custom BR ID/string (e.g. 46394BR) into a deterministic UUID format
 */
export function brIdToUuid(brId: string): string {
  if (!brId) return brId;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brId)) {
    return brId;
  }
  const hash = createHash('md5').update(brId).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * 1. Requirements Refresh: Scans /docs/BR and /docs/JD
 */
export async function refreshRequirements(): Promise<{ success: boolean; processedBRs: number; convertedJDs: number }> {
  await ensureDocsDirectories();
  const brPath = join(process.cwd(), "docs", "BR");
  const jdPath = join(process.cwd(), "docs", "JD");
  
  const brFiles = await readdir(brPath);
  const jdFiles = await readdir(jdPath);
  
  let processedBRs = 0;
  let convertedJDs = 0;

  let localJds: any[] = [];
  const localJdPath = join(getUploadsRoot(), "job_descriptions.json");
  try {
    const raw = await readFile(localJdPath, "utf8");
    localJds = JSON.parse(raw);
  } catch (e) {}
  
  const xlsxBrFiles = brFiles.filter(f => f.endsWith(".xlsx") || f.endsWith(".xls"));
  const actualJdFiles = jdFiles.filter(f => f.endsWith(".pdf") || f.endsWith(".docx") || f.endsWith(".doc") || f.endsWith(".txt"));
  
  // Scenario A & C: Process available BR Excel files directly from docs/BR
  for (const file of xlsxBrFiles) {
    try {
      const filePath = join(brPath, file);
      const workbook = new ExcelJS.Workbook();
      const buffer = await readFile(filePath);
      await workbook.xlsx.load(buffer as any);
      
      const sheet = workbook.getWorksheet("BR _Raw Data") || workbook.worksheets[0];
      const sheetData: any[][] = [];
      sheet.eachRow((row) => {
        sheetData.push(row.values as any[]);
      });
      
      if (sheetData.length <= 0) continue;
      
      // Dynamically find the header row
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(10, sheetData.length); i++) {
        const r = sheetData[i];
        if (Array.isArray(r)) {
          const hasHeaders = r.some(h => {
            if (!h) return false;
            const str = String(h).trim().toLowerCase();
            return str.includes("auto req id") || str.includes("br id") || str.includes("designation") || str.includes("job title");
          });
          if (hasHeaders) {
            headerRowIdx = i;
            break;
          }
        }
      }
      
      if (headerRowIdx === -1) {
        headerRowIdx = 0;
      }
      
      const headerRow = sheetData[headerRowIdx] || [];
      const getColIndex = (names: string[]) => {
        const normalizedNames = names.map(n => n.trim().toLowerCase().replace(/[_-]/g, ' '));
        return headerRow.findIndex((h: any) => {
          if (!h) return false;
          const normalizedH = String(h).trim().toLowerCase().replace(/[_-]/g, ' ');
          return normalizedNames.includes(normalizedH);
        });
      };
      
      const findColIdx = (namesInOrderOfPriority: string[]) => {
        for (const name of namesInOrderOfPriority) {
          const idx = getColIndex([name]);
          if (idx !== -1) return idx;
        }
        return -1;
      };
      
      const idIdx = findColIdx(["auto req id", "br id", "id"]);
      const titleIdx = findColIdx(["designation", "job title", "role", "position"]);
      const skillsIdx = findColIdx(["mandatory skills", "skills", "detailed skills"]);
      const jdIdx = findColIdx(["job description", "jd"]);
      const rmIdx = findColIdx(["rm name", "reporting manager"]);
      
      for (let r = headerRowIdx + 1; r < sheetData.length; r++) {
        const row = sheetData[r];
        if (!row) continue;
        
        const autoReqId = idIdx !== -1 && row[idIdx] ? String(row[idIdx]).trim() : "";
        if (!autoReqId) continue;
        
        const designation = titleIdx !== -1 && row[titleIdx] ? String(row[titleIdx]).trim() : "Technical Role";
        let skills = skillsIdx !== -1 && row[skillsIdx] ? String(row[skillsIdx]).trim() : "";
        let jdText = jdIdx !== -1 && row[jdIdx] ? String(row[jdIdx]).trim() : "";
        const rmEmail = rmIdx !== -1 && row[rmIdx] ? String(row[rmIdx]).trim() : "admin@infinite.com";

        // Dynamic fallback heuristic for shifted/misaligned spreadsheet rows:
        const looksLikeJd = (text: string) => {
          const lower = text.toLowerCase();
          return text.length > 150 && (
            lower.includes("responsibilities") ||
            lower.includes("experience") ||
            lower.includes("skills") ||
            lower.includes("troubleshooting") ||
            lower.includes("qualification") ||
            lower.includes("support")
          );
        };
        
        const looksLikeSkills = (text: string) => {
          const commaCount = (text.match(/,/g) || []).length;
          const lower = text.toLowerCase();
          return commaCount >= 2 && (
            lower.includes("sql") ||
            lower.includes("unix") ||
            lower.includes("linux") ||
            lower.includes("java") ||
            lower.includes("python") ||
            lower.includes("aws") ||
            lower.includes("azure")
          );
        };

        // Scan all cells in the row for a better candidate if needed
        for (let idx = 1; idx < row.length; idx++) {
          const val = row[idx];
          if (val && typeof val === "string") {
            const trimmed = val.trim();
            if (looksLikeJd(trimmed)) {
              jdText = trimmed;
            } else if (looksLikeSkills(trimmed) && trimmed.length > skills.length) {
              skills = trimmed;
            }
          }
        }
        
        const jdUuid = brIdToUuid(autoReqId);
        const jdTextContent = jdText || skills;
        const newLocalJd = {
          id: jdUuid,
          jdText: jdTextContent,
          rmEmail: rmEmail.includes("@") ? rmEmail : "admin@infinite.com",
          fileName: `${autoReqId} | ${file}`,
          createdAt: new Date().toISOString()
        };
        const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
        if (existingIdx !== -1) {
          localJds[existingIdx] = newLocalJd;
        } else {
          localJds.push(newLocalJd);
        }

        let dbError: any = null;
        try {
          const { error } = await supabase.from('job_descriptions').upsert({
            id: jdUuid,
            jd_text: jdTextContent,
            rm_email: newLocalJd.rmEmail,
            file_name: newLocalJd.fileName,
            created_at: newLocalJd.createdAt
          });
          dbError = error;
        } catch (e) {
          dbError = e;
        }
        
        if (dbError) {
          await writeLog('requirements', 'UPSERT_BR_ERROR', 'failed', `Error saving BR ${autoReqId}: ${dbError.message || dbError}`);
        } else {
          processedBRs++;
          await writeLog('requirements', 'PARSED_BR_ROW', 'success', `Successfully loaded BR ID: ${autoReqId} (UUID: ${jdUuid}) from ${file}`);
        }
      }
    } catch (err: any) {
      await writeLog('requirements', 'PARSE_BR_FILE_FAILED', 'failed', `Failed parsing BR file ${file}: ${err.message}`);
    }
  }
  
  // Scenario B: If only JD exists in docs/JD, convert to BR and save to docs/BR
  for (const file of actualJdFiles) {
    // Check if BR already exists in docs/BR (same name ending with _BR.xlsx or same base name)
    const base = file.replace(/\.[^/.]+$/, "");
    const matchingBr = xlsxBrFiles.find(bf => bf.toLowerCase().startsWith(base.toLowerCase()) || bf.includes(base));
    if (matchingBr) {
      // Prioritize BR, skip JD conversion
      continue;
    }
    
    try {
      const filePath = join(jdPath, file);
      const buffer = await readFile(filePath);
      const jdText = await resumeService.extractTextFromBuffer(buffer);
      
      if (!jdText.trim()) continue;
      
      // Call JD to BR extraction
      const details = await extractJdDetails(jdText, file);
      
      const newAutoReqId = details.auto_req_id || `${Math.floor(40000 + Math.random() * 9999)}BR`;
      const allSkills = [
        ...(details.skills || []),
        ...(details.monitoring_tools || []),
        ...(details.cloud_platforms || [])
      ];
      const uniqueSkills = [...new Set(allSkills)].join(', ');
      
      // Load spreadsheet template and append row
      const workbook = await loadTemplateWorkbook();
      const sheet = workbook.getWorksheet("BR _Raw Data") || workbook.worksheets[0];
      
      // Find last row
      let lastRow = 1;
      sheet.eachRow((row, rowNumber) => {
        lastRow = Math.max(lastRow, rowNumber);
      });
      const newRowIdx = lastRow + 1;
      const newRow = sheet.getRow(newRowIdx);
      
      // Standard BR Columns: ID, Status, Grade, Title, Recruiter, Dept, BU, Interview, Skills, Entity, Client, Billing, Project, Requester, TAG, RM, JD, Location
      newRow.getCell(1).value = newAutoReqId;
      newRow.getCell(2).value = "Open";
      newRow.getCell(3).value = details.experience?.includes("5") ? "E2" : "E1";
      newRow.getCell(4).value = details.job_title || "Technical Role";
      newRow.getCell(6).value = "Technical";
      newRow.getCell(7).value = "ITS - TMH - Delivery";
      newRow.getCell(8).value = "Yes";
      newRow.getCell(9).value = uniqueSkills;
      newRow.getCell(10).value = "OFFSHORE";
      newRow.getCell(11).value = "IRON MOUNTAIN";
      newRow.getCell(12).value = "Billable";
      newRow.getCell(13).value = "IM DXP-IDP 2025";
      newRow.getCell(16).value = "Hippargi, Anil (1017237)";
      newRow.getCell(17).value = jdText.substring(0, 5000);
      newRow.getCell(18).value = "Bangalore - Global Axis";
      newRow.commit();
      
      // Save converted BR spreadsheet back to BR folder
      const outputBrName = `${base}_BR.xlsx`;
      const finalBuffer = await workbook.xlsx.writeBuffer();
      await writeFile(join(brPath, outputBrName), finalBuffer as any);
      
      const jdUuid = brIdToUuid(newAutoReqId);
      const newLocalJd = {
        id: jdUuid,
        jdText: jdText,
        rmEmail: "admin@infinite.com",
        fileName: `${newAutoReqId} | ${file}`,
        createdAt: new Date().toISOString()
      };
      const existingIdx = localJds.findIndex((j: any) => j.id === jdUuid);
      if (existingIdx !== -1) {
        localJds[existingIdx] = newLocalJd;
      } else {
        localJds.push(newLocalJd);
      }

      try {
        await supabase.from('job_descriptions').upsert({
          id: jdUuid,
          jd_text: jdText,
          rm_email: "admin@infinite.com",
          file_name: `${newAutoReqId} | ${file}`,
          created_at: newLocalJd.createdAt
        });
      } catch (dbErr) {
        console.warn("Failed to save converted JD to Supabase:", dbErr);
      }
      
      convertedJDs++;
      await writeLog('requirements', 'CONVERTED_JD_TO_BR', 'success', `Automatically converted JD ${file} to BR ${outputBrName}`);
    } catch (err: any) {
      await writeLog('requirements', 'CONVERT_JD_FAILED', 'failed', `Error converting JD ${file}: ${err.message}`);
    }
  }

  try {
    await writeFile(localJdPath, JSON.stringify(localJds, null, 2), "utf8");
  } catch (writeErr) {
    console.error("Failed to write local backup for requirements refresh:", writeErr);
  }
  
  return { success: true, processedBRs, convertedJDs };
}

/**
 * 2. Candidates Refresh: Scans /docs/Resumes
 */
export async function refreshCandidates(activeJdId?: string): Promise<{ success: boolean; processed: number; duplicates: number }> {
  await ensureDocsDirectories();
  const dirPath = join(process.cwd(), "docs", "Resumes");
  const files = await readdir(dirPath);
  
  let processed = 0;
  let duplicates = 0;
  
  const resumeFiles = files.filter(f => f.endsWith(".pdf") || f.endsWith(".docx") || f.endsWith(".doc"));
  
  // Resolve JD
  let jdId = activeJdId;
  let jdText = "";
  if (!jdId || jdId === "all") {
    const { data: latestJd } = await supabase.from('job_descriptions').select('id, jd_text').order('created_at', { ascending: false }).limit(1);
    if (latestJd && latestJd.length > 0) {
      jdId = latestJd[0].id;
      jdText = latestJd[0].jd_text;
    }
  } else {
    const { data: dbJd } = await supabase.from('job_descriptions').select('jd_text').eq('id', jdId).single();
    if (dbJd) jdText = dbJd.jd_text;
  }
  
  for (const file of resumeFiles) {
    try {
      const filePath = join(dirPath, file);
      const buffer = await readFile(filePath);
      
      // Compute hash
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      
      // Prevent duplicates only if the resume was already processed for this exact JD
      const { data: existing } = await supabase.from('resumes').select('id, filename, report').eq('file_hash', fileHash);
      if (existing && existing.length > 0) {
        const existingJdId = existing[0].report?.jdId;
        if (existingJdId === jdId) {
          duplicates++;
          continue;
        }
      }
      
      // Construct mock File
      const mockFile = {
        name: file,
        arrayBuffer: async () => buffer
      } as unknown as File;
      
      // Process CV
      const result = await resumeService.processResumeSync(mockFile, jdText, jdId, "admin@infinite.com", false);
      processed++;
      
      const score = result.report?.jdMatchScore ?? result.analysis?.overallScore ?? 0;
      const isSuitable = score >= 40;
      const category = isSuitable ? "SUITABLE" : "UNSUITABLE";
      const candidateName = result.parsed?.personal?.fullName || file.replace(/\.[^/.]+$/, "");
      
      await writeLog('candidate-processing', `SCREENED_${category}_CANDIDATE`, 'success', `Candidate ${candidateName} matches ${score}% for JD ${jdId || 'latest'}`);
    } catch (err: any) {
      await writeLog('candidate-processing', 'SCREENING_FAILED', 'failed', `Error screening CV ${file}: ${err.message}`);
    }
  }
  
  return { success: true, processed, duplicates };
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object" && value && "text" in (value as any)) {
    return String((value as any).text || "").trim();
  }
  if (typeof value === "object" && value && "richText" in (value as any)) {
    return ((value as any).richText || []).map((t: any) => t.text || "").join("").trim();
  }
  return String(value).trim();
}

function decodeSpreadsheetText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString("utf16le");
  }
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, "").trim());
}

function detectCsvDelimiter(headerLine: string): string {
  const candidates: Array<[string, number]> = [
    [",", (headerLine.match(/,/g) || []).length],
    [";", (headerLine.match(/;/g) || []).length],
    ["\t", (headerLine.match(/\t/g) || []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}

function parseCorpPoolCsv(buffer: Buffer): string[][] {
  const text = decodeSpreadsheetText(buffer);
  const rawLines = text.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
  if (rawLines.length === 0) return [];
  const delimiter = detectCsvDelimiter(rawLines[0]);
  return rawLines.map((line) => parseCsvLine(line, delimiter));
}

function isLikelyPhoneNumber(value: string): boolean {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 || digits.length === 12;
}

function isGeneratedCorpPoolId(value: string): boolean {
  return /^CV[a-f0-9]{8,}$/i.test(String(value || "").trim());
}

function isLikelyYear(value: string): boolean {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 4) return false;
  const year = Number(digits);
  return year >= 1970 && year <= 2035;
}

function isPlausibleEmployeeId(value: string): boolean {
  const id = String(value || "").trim();
  if (!/^[A-Za-z]?\d{4,12}$/.test(id)) return false;
  if (isLikelyPhoneNumber(id) || isLikelyYear(id)) return false;
  return true;
}

function extractEmployeeIdFromCv(text: string, file: string): string {
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

  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(lines.length - 1, 20); i++) {
    if (/^(employee\s*(?:id|code|number|no)|emp(?:loyee)?\s*(?:id|no)|staff\s*id)\s*[:#.\-]*$/i.test(lines[i])) {
      const next = lines[i + 1].match(/^([A-Za-z]?\d{4,12})\b/);
      if (next?.[1] && isPlausibleEmployeeId(next[1])) return next[1];
    }
  }

  const nearby = normalized.match(/employee\s*id[\s\S]{0,120}?(\d{5,10})/i);
  if (nearby?.[1] && isPlausibleEmployeeId(nearby[1])) return nearby[1];

  const fromFile = String(file || "").match(/\b([A-Za-z]?\d{5,10})\b/);
  if (fromFile?.[1] && isPlausibleEmployeeId(fromFile[1])) return fromFile[1];

  // Infinite CVs often start with "1033925 Jithender" and never say "Employee ID".
  for (const line of lines.slice(0, 12)) {
    const leading = line.match(/^([A-Za-z]?\d{5,8})(?:\s+[A-Za-z].*)?$/);
    if (leading?.[1] && isPlausibleEmployeeId(leading[1])) return leading[1];
  }
  return "";
}

const CV_NAME_BLOCKLIST =
  /^(career objectives?|objective|summary|professional summary|profile|experience|work experience|education|skills|technical skills|contact|contacts|declaration|projects|certifications?|about me|resume|curriculum vitae|personal details|employment history|key skills|highlights|achievements?)$/i;

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
  if (!text || CV_NAME_BLOCKLIST.test(text)) return false;
  if (text.length < 3 || text.length > 50) return false;
  if (/@|https?:|www\./i.test(text)) return false;
  if (/[|]/.test(raw)) return false;
  if (/^(successfully|experienced|worked|developed|led|responsible|managed|supporting)\b/i.test(text)) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (words.length === 1 && words[0].length < 3) return false;
  if (words.some((word) => /^20\d{2}$/.test(word) || /^infinite$/i.test(word))) return false;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(text)) return false;
  const titleCaseWords = words.filter((word) => /^[A-Z][a-zA-Z'.-]*$/.test(word) || /^[A-Z]\.?$/.test(word));
  return titleCaseWords.length >= Math.ceil(words.length / 2);
}

const CV_SKILL_CATALOG = [
  "typescript", "javascript", "python", "java", "sql", "ms sql", "mysql", "postgresql",
  "windows", "linux", "unix", "protractor", "selenium", "cypress", "playwright",
  "jira", "git", "jenkins", "agile", "scrum", "waterfall", "stlc", "sdlc",
  "html", "css", "react", "angular", "node.js", "aws", "azure", "docker",
  "rest", "api", "postman", "manual testing", "automation testing",
];

function skillsFromCvText(text: string): string[] {
  const lower = ` ${String(text || "").toLowerCase()} `;
  const found: string[] = [];
  for (const skill of CV_SKILL_CATALOG) {
    const needle = skill.replace(".", "\\.");
    if (new RegExp(`[^a-z0-9]${needle}[^a-z0-9]`, "i").test(lower) && !found.includes(skill)) {
      found.push(skill);
    }
  }
  return found;
}

function labeledCvValue(text: string, labels: string[]): string {
  const joined = labels.map((label) => label.replace(/\s+/g, "\\s*")).join("|");
  const match = text.match(new RegExp(`(?:^|[\\n\\r])\\s*(?:${joined})\\s*[:|#]\\s*([^\\n\\r]{2,80})`, "i"));
  return match?.[1]?.trim() || "";
}

function corpPoolProfileFromCv(file: string, text: string): {
  name: string;
  designation: string;
  email: string;
  employeeId: string;
} {
  const base = file.replace(/\.[^/.]+$/, "");
  const designationFromFile =
    base.match(/\b(SDET|QA|Quality\s*Analyst|Developer|Engineer|Lead|Manager|Architect|Analyst|Consultant|Tester)\b/i)?.[0] ||
    "";
  const fromFileRaw = base
    .replace(/[_-]+/g, " ")
    .replace(/\b\d+\s*(yoe|yrs?|years?)\b/gi, "")
    .replace(/\b(SDET|QA|resume|cv|curriculum vitae|infinite)\b/gi, "")
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const fromFile = stripLeadingEmployeeId(fromFileRaw);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeledName = stripLeadingEmployeeId(
    labeledCvValue(text, ["name", "candidate name", "employee name"]).replace(/employee\s*id.*/i, "")
  );
  const nameFromLine = lines.slice(0, 15).find((line) => looksLikePersonName(line));
  const nameFromLineClean = nameFromLine ? stripLeadingEmployeeId(nameFromLine) : { id: "", rest: "" };
  const labeledTitle = labeledCvValue(text, ["title", "designation", "role", "position"]);
  const titleLine = lines.find(
    (line) =>
      line.length < 60 &&
      !/[|]/.test(line) &&
      /\b(SDET|engineer|developer|lead|manager|analyst|architect|tester)\b/i.test(line) &&
      !/employee\s*id|years? of|successfully|interoperability/i.test(line) &&
      !looksLikePersonName(line)
  );
  const email =
    labeledCvValue(text, ["email id", "email", "mail id", "e-mail"]) ||
    text.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] ||
    "";
  const cleanEmail = email.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] || "";
  const employeeId =
    extractEmployeeIdFromCv(text, file) ||
    labeledName.id ||
    nameFromLineClean.id ||
    fromFile.id;
  const name =
    (looksLikePersonName(labeledName.rest) ? labeledName.rest : "") ||
    nameFromLineClean.rest ||
    (looksLikePersonName(fromFile.rest) ? fromFile.rest : "") ||
    "Unknown";
  return {
    name,
    designation: labeledTitle || designationFromFile || titleLine || "Engineer",
    email: cleanEmail,
    employeeId,
  };
}

export function sanitizeCorpPoolFileName(name: string): string {
  const base = String(name || "").split(/[/\\]/).pop() || "resume";
  const cleaned = base
    .replace(/\u00a0/g, " ")
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim();
  const fallback = cleaned || "resume";
  if (fallback.length <= 180) return fallback;
  const ext = fallback.includes(".") ? fallback.slice(fallback.lastIndexOf(".")) : "";
  return `${fallback.slice(0, Math.max(1, 180 - ext.length))}${ext}`;
}

export function isCorpPoolRosterFileName(name: string): boolean {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[_'`’]/g, " ");
  if (!/\.(xlsx|xls|csv)$/i.test(n)) return false;
  return n.includes("corp pool") || n.includes("active list") || n.includes("employee list");
}

function looksLikeCorpPoolHeaderCell(value: unknown): boolean {
  const str = cellText(value).toLowerCase();
  return (
    str.includes("emp no") ||
    str.includes("emp_no") ||
    str.includes("employee id") ||
    str.includes("emp id") ||
    str.includes("emp name") ||
    str.includes("employee name")
  );
}

export async function excelLooksLikeCorpPoolRoster(buffer: Buffer): Promise<boolean> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    for (const ws of workbook.worksheets) {
      const last = Math.min(10, Math.max(ws.rowCount || 0, ws.actualRowCount || 0, 1));
      for (let n = 1; n <= last; n++) {
        const values = ((ws.getRow(n).values as any[]) || []);
        if (values.some(looksLikeCorpPoolHeaderCell)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function reclaimMisfiledCorpPoolRosters(): Promise<string[]> {
  await ensureDocsStorage();
  const moved: string[] = [];
  const resumeFiles = await listDocFiles("Resumes");
  for (const file of resumeFiles) {
    if (!isCorpPoolRosterFileName(file)) continue;
    try {
      const buffer = await readDocFileBuffer("Resumes", file);
      const stored = sanitizeCorpPoolFileName(file);
      await writeDocFile("Corp Pool", stored, buffer);
      await deleteDocFile("Resumes", file);
      moved.push(stored);
      await writeLog(
        "employee",
        "RECLAIMED_CORP_POOL_ROSTER",
        "success",
        `Moved ${file} from Resumes to Corp Pool as ${stored}`
      );
    } catch (err: any) {
      await writeLog(
        "employee",
        "RECLAIM_CORP_POOL_FAILED",
        "failed",
        `Could not move ${file} out of Resumes: ${err?.message || "unknown error"}`
      );
    }
  }
  return moved;
}

function corpPoolFileKey(name: string): string {
  return sanitizeCorpPoolFileName(name).toLowerCase();
}

function uniqueCorpPoolFileName(name: string, used: Set<string>): string {
  const safe = sanitizeCorpPoolFileName(name);
  const lower = safe.toLowerCase();
  if (!used.has(lower)) {
    used.add(lower);
    return safe;
  }
  const extIdx = safe.lastIndexOf(".");
  const stem = extIdx >= 0 ? safe.slice(0, extIdx) : safe;
  const ext = extIdx >= 0 ? safe.slice(extIdx) : "";
  let i = 2;
  let next = `${stem}_${i}${ext}`;
  while (used.has(next.toLowerCase())) {
    i += 1;
    next = `${stem}_${i}${ext}`;
  }
  used.add(next.toLowerCase());
  return next;
}

/**
 * 3. Employee Pool Refresh: Scans /docs/Corp Pool
 */
function looksLikeExcelBuffer(buffer: Buffer): boolean {
  return Boolean(buffer?.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b);
}

export async function refreshEmployees(
  activeJdId?: string,
  opts?: {
    incomingCorpPoolFiles?: string[];
    incomingFileBuffers?: Array<{ filename: string; buffer: Buffer }>;
  }
): Promise<{
  success: boolean;
  loaded: number;
  added?: number;
  updated?: number;
  skippedDeleted?: number;
  employees?: EmployeeRecord[];
}> {
  await ensureDocsStorage();
  const reclaimed = await reclaimMisfiledCorpPoolRosters();
  const incomingSet = new Set(
    (opts?.incomingCorpPoolFiles || []).map((f) => corpPoolFileKey(f))
  );
  const fileBuffers = new Map<string, Buffer>();
  for (const item of opts?.incomingFileBuffers || []) {
    const stored = sanitizeCorpPoolFileName(item.filename);
    fileBuffers.set(stored, item.buffer);
    incomingSet.add(corpPoolFileKey(stored));
  }
  if (incomingSet.size > 0) {
    for (const file of reclaimed) incomingSet.add(corpPoolFileKey(file));
  }
  let files = await listDocFiles("Corp Pool");
  if (incomingSet.size > 0) {
    files = files.filter((f) => incomingSet.has(corpPoolFileKey(f)));
  }
  for (const stored of fileBuffers.keys()) {
    if (!files.some((f) => corpPoolFileKey(f) === corpPoolFileKey(stored))) {
      files.push(stored);
    }
  }

  const expandedFiles: string[] = [];
  const usedZipNames = new Set<string>();
  for (const file of files) {
    if (!/\.zip$/i.test(file)) {
      expandedFiles.push(file);
      continue;
    }
    let extracted = 0;
    let skipped = 0;
    try {
      const zipBuffer = fileBuffers.get(file) || await readDocFileBuffer("Corp Pool", file);
      const zip = new AdmZip(zipBuffer);
      for (const entry of zip.getEntries()) {
        try {
          if (entry.isDirectory) continue;
          const entryName = String(entry.entryName || "").replace(/\\/g, "/");
          if (
            entryName.startsWith("__MACOSX") ||
            entryName.split("/").some((part) => part.startsWith("."))
          ) {
            skipped++;
            continue;
          }
          const baseName = entryName.split("/").pop() || "";
          if (!/\.(pdf|docx|doc|txt|csv|xlsx|xls)$/i.test(baseName)) {
            skipped++;
            continue;
          }
          let data: Buffer;
          try {
            data = entry.getData();
          } catch (entryErr: any) {
            skipped++;
            await writeLog(
              "employee",
              "UNZIP_ENTRY_FAILED",
              "failed",
              `Skipped ZIP entry ${baseName}: ${entryErr?.message || "unreadable"}`
            );
            continue;
          }
          if (!data?.length) {
            skipped++;
            continue;
          }
          const storedName = uniqueCorpPoolFileName(baseName, usedZipNames);
          try {
            await writeDocFile("Corp Pool", storedName, data);
          } catch (writeErr: any) {
            await writeLog(
              "employee",
              "UNZIP_STORE_FAILED",
              "failed",
              `Parsed ${storedName} in memory after storage failed: ${writeErr?.message || "write error"}`
            );
          }
          fileBuffers.set(storedName, data);
          expandedFiles.push(storedName);
          extracted++;
        } catch (entryErr: any) {
          skipped++;
          await writeLog(
            "employee",
            "UNZIP_ENTRY_FAILED",
            "failed",
            `Skipped ZIP entry: ${entryErr?.message || "unknown error"}`
          );
        }
      }
      await writeLog(
        "employee",
        "UNZIPPED_CORP_POOL",
        extracted > 0 ? "success" : "failed",
        extracted > 0
          ? `Extracted ${extracted} file(s) from ${file}${skipped ? ` (skipped ${skipped})` : ""}`
          : `ZIP ${file} had no resume/Excel/CSV files inside`
      );
    } catch (err: any) {
      await writeLog(
        "employee",
        "UNZIP_CORP_POOL_FAILED",
        "failed",
        `Failed reading ZIP ${file}: ${err.message}`
      );
    }
  }
  files = Array.from(new Set(expandedFiles));
  if (incomingSet.size > 0 && files.length === 0) {
    const zipUpload = Array.from(incomingSet).some((name) => name.endsWith(".zip"));
    throw new Error(
      zipUpload
        ? "The ZIP had no resume PDF/DOCX or employee Excel/CSV files inside. Put those files in the ZIP and upload again."
        : "The uploaded Corp Pool file could not be read after storage. Try renaming it (avoid apostrophes) and upload again."
    );
  }
  
  let loaded = 0;
  const parsedEmployees: EmployeeRecord[] = [];
  
  // Resolve active JD skills for match score computation
  let jdSkills = "";
  let jdId = activeJdId;
  if (!jdId || jdId === "all") {
    const { data: latestJd } = await supabase.from('job_descriptions').select('id, jd_text').order('created_at', { ascending: false }).limit(1);
    if (latestJd && latestJd.length > 0) {
      jdId = latestJd[0].id;
      jdSkills = latestJd[0].jd_text;
    }
  } else {
    const { data: dbJd } = await supabase.from('job_descriptions').select('jd_text').eq('id', jdId).single();
    if (dbJd) jdSkills = dbJd.jd_text;
  }
  
  const bufferFor = (file: string): Buffer | undefined => {
    const direct = fileBuffers.get(file);
    if (direct) return direct;
    const key = corpPoolFileKey(file);
    for (const [name, buf] of fileBuffers) {
      if (corpPoolFileKey(name) === key) return buf;
    }
    return undefined;
  };

  const csvFiles = files.filter((f) => f.toLowerCase().endsWith(".csv"));
  const xlsxFiles = files.filter((f) => {
    const name = f.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return true;
    const buf = bufferFor(f);
    return Boolean(buf && looksLikeExcelBuffer(buf) && !/\.(pdf|docx|doc|txt|csv)$/i.test(name));
  });
  const cvFiles = files.filter((f) => /\.(pdf|docx|doc|txt)$/i.test(f));

  // A. Process Excel files
  for (const file of xlsxFiles) {
    try {
      const buffer = bufferFor(file) || await readDocFileBuffer("Corp Pool", file);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      let rows: any[][] = [];
      let headerRow: any[] = [];
      let headerRowIdx = -1;

      const collectSheetRows = (ws: ExcelJS.Worksheet): any[][] => {
        const last = Math.max(ws.rowCount || 0, ws.actualRowCount || 0, 1);
        const collected: any[][] = [];
        for (let n = 1; n <= last; n++) {
          const row = ws.getRow(n);
          if (n > 1 && !row.hasValues) {
            collected.push([]);
            continue;
          }
          collected.push((row.values as any[]) || []);
        }
        return collected;
      };

      const looksLikeEmpHeader = (r: any[]) =>
        Array.isArray(r) &&
        r.some((h) => {
          const str = cellText(h).toLowerCase();
          return (
            str.includes("emp no") ||
            str.includes("emp_no") ||
            str.includes("employee id") ||
            str.includes("emp id") ||
            str.includes("emp name") ||
            str.includes("employee name")
          );
        });

      for (const ws of workbook.worksheets) {
        const tempRows = collectSheetRows(ws);
        const foundIdx = tempRows.findIndex((r, i) => i < 10 && looksLikeEmpHeader(r));
        if (foundIdx !== -1) {
          rows = tempRows;
          headerRowIdx = foundIdx;
          headerRow = tempRows[foundIdx];
          break;
        }
      }

      if (headerRowIdx === -1 && workbook.worksheets.length > 0) {
        rows = collectSheetRows(workbook.worksheets[0]);
        headerRowIdx = 0;
        headerRow = rows[0] || [];
      }

      if (rows.length <= headerRowIdx + 1) continue;

      const normalizeHeader = (value: unknown) =>
        cellText(value).toLowerCase().replace(/[_-]/g, " ").replace(/\.+$/, "").replace(/\s+/g, " ").trim();

      const getIdx = (names: string[]) => {
        const normalizedNames = names.map((n) => n.trim().toLowerCase().replace(/[_-]/g, " "));
        return headerRow.findIndex((h: any) => {
          const normalizedH = normalizeHeader(h);
          if (!normalizedH) return false;
          return normalizedNames.some((name) => {
            if (name.length <= 3) return normalizedH === name;
            return normalizedH === name || normalizedH.includes(name);
          });
        });
      };

      const findColumnIdx = (namesInOrderOfPriority: string[]) => {
        for (const name of namesInOrderOfPriority) {
          const idx = getIdx([name]);
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const idIdx = findColumnIdx(["emp no", "employee id", "emp id", "employee code"]);
      const nameIdx = findColumnIdx(["emp name", "employee name", "full name", "name"]);
      const deptIdx = findColumnIdx(["business unit", "sbu", "bu", "department", "dept"]);
      const skillsIdx = findColumnIdx(["detailed skills", "skills bucket", "top 3 skills", "skills"]);
      const statusIdx = findColumnIdx(["status", "availability"]);
      const gradeIdx = findColumnIdx(["grade", "level"]);
      const mailIdx = findColumnIdx(["official mail id", "official email", "email", "mail id"]);
      const roleIdx = findColumnIdx(["designation", "role", "position"]);

      let kept = 0;
      let skippedBlank = 0;
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;

        const empNo = idIdx !== -1 ? cellText(row[idIdx]) : "";
        const empName = nameIdx !== -1 ? cellText(row[nameIdx]) : "";
        if (!empNo && !empName) {
          skippedBlank++;
          continue;
        }

        const department = deptIdx !== -1 ? cellText(row[deptIdx]) : "Engineering";
        const skills = skillsIdx !== -1 ? cellText(row[skillsIdx]) : "";
        const status = statusIdx !== -1 ? cellText(row[statusIdx]) : "Active";
        const grade = gradeIdx !== -1 ? cellText(row[gradeIdx]) : "E1";
        const email = mailIdx !== -1 ? cellText(row[mailIdx]) : "";
        const designation = roleIdx !== -1 ? cellText(row[roleIdx]) : "Support Engineer";
        const employeeId = empNo || `EMP${createHash("md5").update(`${file}:${empName}:${r}`).digest("hex").slice(0, 10)}`;

        const matchResult = calculateSkillMatch(
          employeeMatchText({ skills, designation, grade }),
          jdSkills
        );

        parsedEmployees.push({
          employee_id: employeeId,
          full_name: empName || "Unknown Employee",
          email: email || `${employeeId}@example.com`,
          department: department || "Engineering",
          skills,
          grade: grade || "E1",
          designation: designation || "Support Engineer",
          status: status || "Active",
          shortlisted: false,
          score: matchResult.score,
          matchingSkills: matchResult.matchingSkills,
          source_file: file,
        });
        kept++;
      }
      loaded += kept;
      await writeLog(
        "employee",
        "PARSED_CORP_POOL_EXCEL",
        "success",
        `Parsed ${kept} people from ${file} (${skippedBlank} blank rows skipped)`
      );
    } catch (err: any) {
      await writeLog('employee', 'PARSE_EXCEL_FAILED', 'failed', `Error parsing xlsx employee pool ${file}: ${err.message}`);
    }
  }
  
  // B. Process CSV files
  for (const file of csvFiles) {
    try {
      const buffer = bufferFor(file) || await readDocFileBuffer("Corp Pool", file);
      const rows = parseCorpPoolCsv(buffer);
      if (rows.length <= 1) continue;

      const headerRow = rows[0].map((h) => String(h || "").trim().toLowerCase().replace(/[_-]/g, " "));
      const getIdx = (names: string[]) => {
        const normalizedNames = names.map((n) => n.trim().toLowerCase().replace(/[_-]/g, " "));
        return headerRow.findIndex((h: string) => {
          if (!h) return false;
          return normalizedNames.some((name) => {
            if (name.length <= 3) return h === name;
            return h === name || h.includes(name) || name.includes(h);
          });
        });
      };

      const findColumnIdx = (namesInOrderOfPriority: string[]) => {
        for (const name of namesInOrderOfPriority) {
          const idx = getIdx([name]);
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const idIdx = findColumnIdx(["emp no", "employee id", "emp id", "employee code", "id"]);
      const nameIdx = findColumnIdx(["emp name", "employee name", "full name", "name"]);
      const deptIdx = findColumnIdx(["business unit", "sbu", "bu", "department", "dept"]);
      const skillsIdx = findColumnIdx(["detailed skills", "skills bucket", "top 3 skills", "primary skill", "skills"]);
      const statusIdx = findColumnIdx(["status", "availability"]);
      const gradeIdx = findColumnIdx(["grade", "level"]);
      const mailIdx = findColumnIdx(["official mail id", "official email", "email", "mail id", "mail"]);
      const roleIdx = findColumnIdx(["designation", "role", "position"]);

      for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!cells || cells.length === 0 || cells.every((c) => !String(c || "").trim())) continue;

        const empNo = idIdx !== -1 ? String(cells[idIdx] || "").trim() : "";
        const empName = nameIdx !== -1 ? String(cells[nameIdx] || "").trim() : "";
        if (!empNo && !empName) continue;
        const employeeId = empNo || `EMP${createHash("md5").update(`${file}:${empName}:${r}`).digest("hex").slice(0, 10)}`;
        const department = deptIdx !== -1 && cells[deptIdx] ? String(cells[deptIdx]).trim() : "Engineering";
        const skills = skillsIdx !== -1 && cells[skillsIdx] ? String(cells[skillsIdx]).trim() : "";
        const status = statusIdx !== -1 && cells[statusIdx] ? String(cells[statusIdx]).trim() : "Active";
        const grade = gradeIdx !== -1 && cells[gradeIdx] ? String(cells[gradeIdx]).trim() : "E1";
        const email = mailIdx !== -1 && cells[mailIdx] ? String(cells[mailIdx]).trim() : "";
        const designation = roleIdx !== -1 && cells[roleIdx] ? String(cells[roleIdx]).trim() : "Support Engineer";

        const matchResult = calculateSkillMatch(
          employeeMatchText({ skills, designation, grade }),
          jdSkills
        );

        parsedEmployees.push({
          employee_id: employeeId,
          full_name: empName || "Unknown Employee",
          email: email || `${employeeId}@example.com`,
          department,
          skills,
          grade,
          designation,
          status,
          shortlisted: false,
          score: matchResult.score,
          matchingSkills: matchResult.matchingSkills,
          source_file: file,
        });
        loaded++;
      }
    } catch (err: any) {
      await writeLog('employee', 'PARSE_CSV_FAILED', 'failed', `Error parsing csv employee pool ${file}: ${err.message}`);
    }
  }

  for (const file of cvFiles) {
    try {
      const buffer = bufferFor(file) || await readDocFileBuffer("Corp Pool", file);
      if (!buffer?.length) {
        await writeLog("employee", "PARSE_CV_EMPTY", "failed", `Corp Pool CV ${file} is empty`);
        continue;
      }
      const text = (await resumeService.extractTextFromBuffer(buffer)).trim();
      if (!text) {
        await writeLog("employee", "PARSE_CV_EMPTY", "failed", `No text extracted from Corp Pool CV ${file}`);
        continue;
      }

      const profile = corpPoolProfileFromCv(file, text);
      const matchResult = calculateSkillMatch(
        employeeMatchText({
          skills: text,
          designation: profile.designation,
          grade: "",
        }),
        jdSkills
      );
      const resumeSkills = skillsFromCvText(text);
      const employeeId =
        profile.employeeId ||
        `CV${createHash("md5").update(file.toLowerCase()).digest("hex").slice(0, 10)}`;
      parsedEmployees.push({
        employee_id: employeeId,
        full_name: profile.name,
        email: profile.email || `${employeeId}@corp-pool.local`,
        department: "Engineering",
        skills: resumeSkills.join(", "),
        grade: "",
        designation: profile.designation,
        status: "Active",
        shortlisted: false,
        score: matchResult.score,
        matchingSkills: matchResult.matchingSkills.length ? matchResult.matchingSkills : resumeSkills,
        source_file: file,
      });
      loaded++;
      await writeLog(
        "employee",
        "PARSED_CORP_POOL_CV",
        "success",
        `Added ${profile.name} to Corp Pool from ${file}`
      );
    } catch (err: any) {
      await writeLog("employee", "PARSE_CV_FAILED", "failed", `Error parsing Corp Pool CV ${file}: ${err.message}`);
    }
  }
  
  // De-duplicate parsedEmployees by employee_id to avoid key collision
  const seen = new Set<string>();
  const uniqueParsedEmployees: EmployeeRecord[] = [];
  for (const emp of parsedEmployees) {
    if (!seen.has(emp.employee_id)) {
      seen.add(emp.employee_id);
      uniqueParsedEmployees.push(emp);
    }
  }
  
  loaded = uniqueParsedEmployees.length;
  const incomingUpload = incomingSet.size > 0;
  // A new Excel/CSV/resume upload restores only the people in THAT file.
  // Other previously deleted Emp IDs stay out, so leftover Corp Pool files
  // cannot bring old deleted rows back on a full scan.
  if (incomingUpload) {
    await unmarkCorpPoolDeleted(
      uniqueParsedEmployees.map((emp) => emp.employee_id),
      [...incomingSet, ...files]
    );
  }
  const deletedPool = await loadDeletedCorpPool();
  if (!incomingUpload) {
    const liveParsed = uniqueParsedEmployees.filter(
      (emp) => !isCorpPoolDeleted(deletedPool, { id: emp.employee_id })
    );
    uniqueParsedEmployees.length = 0;
    uniqueParsedEmployees.push(...liveParsed);
  }
  loaded = uniqueParsedEmployees.length;

  const jsonPath = join(getUploadsRoot(), "employees.json");
  let existingList: EmployeeRecord[] = [];
  try {
    existingList = await loadCorpPoolRoster<EmployeeRecord>();
  } catch {}
  if (existingList.length === 0) {
    try {
      const persisted = await readPersistedJson("employees.json");
      if (persisted) existingList = JSON.parse(persisted) as EmployeeRecord[];
    } catch {}
  }
  if (existingList.length === 0) {
    try {
      const raw = await readFile(jsonPath, "utf8");
      existingList = JSON.parse(raw) as EmployeeRecord[];
    } catch {}
  }
  if (!Array.isArray(existingList)) existingList = [];
  existingList = existingList.filter(
    (emp) => emp?.employee_id && !isCorpPoolDeleted(deletedPool, { id: emp.employee_id })
  );

  if (uniqueParsedEmployees.length === 0) {
    if (incomingUpload) {
      await writeLog(
        "employee",
        "INCOMING_CORP_POOL_EMPTY",
        "failed",
        "Uploaded Corp Pool file produced 0 people; left the existing list unchanged"
      );
      throw new Error(
        "The file was stored, but nobody was added to Corp Pool. Use a readable resume PDF/DOCX, an employee Excel/CSV, or a ZIP of those files."
      );
    }
    await writeLog(
      "employee",
      "SKIP_EMPTY_CORP_POOL",
      "success",
      "Skipped empty Corp Pool refresh to preserve Employee Portal roster and tests"
    );
    return {
      success: true,
      loaded: existingList.length,
      added: 0,
      updated: 0,
      skippedDeleted: 0,
      employees: existingList,
    };
  }

  const byId = new Map<string, EmployeeRecord>();
  const byEmail = new Map<string, string>();
  for (const emp of existingList) {
    byId.set(String(emp.employee_id), emp);
    const email = String(emp.email || "").trim().toLowerCase();
    if (email) byEmail.set(email, String(emp.employee_id));
  }

  let added = 0;
  let updated = 0;
  const uploadBatchAt = new Date().toISOString();
  for (const parsed of uniqueParsedEmployees) {
    const email = String(parsed.email || "").trim().toLowerCase();
    const existingId = byId.has(parsed.employee_id)
      ? parsed.employee_id
      : email && byEmail.has(email)
        ? byEmail.get(email)
        : undefined;
    if (existingId && byId.has(existingId)) {
      const previous = byId.get(existingId)!;
      const keepId =
        isGeneratedCorpPoolId(existingId) && !isGeneratedCorpPoolId(parsed.employee_id)
          ? parsed.employee_id
          : existingId;
      if (keepId !== existingId) byId.delete(existingId);
      byId.set(keepId, {
        ...parsed,
        employee_id: keepId,
        shortlisted: previous.shortlisted,
        score_override: previous.score_override,
        score_override_jd_id: previous.score_override_jd_id,
        manually_edited: previous.manually_edited,
        uploaded_at: previous.uploaded_at || (incomingUpload ? uploadBatchAt : previous.uploaded_at),
        upload_batch: incomingUpload ? uploadBatchAt : previous.upload_batch,
        ...(previous.manually_edited
          ? {
              full_name: previous.full_name,
              email: previous.email,
              department: previous.department,
              skills: previous.skills,
              designation: previous.designation,
              grade: previous.grade,
              product: previous.product,
              status: previous.status,
            }
          : {}),
        score:
          typeof previous.score_override === "number"
            ? previous.score_override
            : parsed.score,
      });
      if (email) byEmail.set(email, keepId);
      updated++;
    } else {
      byId.set(parsed.employee_id, {
        ...parsed,
        uploaded_at: uploadBatchAt,
        upload_batch: uploadBatchAt,
      });
      if (email) byEmail.set(email, parsed.employee_id);
      added++;
    }
  }

  const finalEmployees = Array.from(byId.values()).filter(
    (emp) => !isCorpPoolDeleted(deletedPool, { id: emp.employee_id })
  );
  loaded = finalEmployees.length;

  const serialized = JSON.stringify(finalEmployees, null, 2);
  await writeFile(jsonPath, serialized, "utf8");
  await writePersistedJson("employees.json", serialized);
  await saveCorpPoolRoster(finalEmployees);
  cacheStore.invalidate("employees");
  await writeLog(
    "employee",
    "SYNC_EMPLOYEE_POOL",
    "success",
    incomingUpload
      ? `Corp Pool now has ${loaded} people (added ${added}, updated ${updated})`
      : `Successfully loaded ${loaded} employees from /docs/Corp Pool`
  );

  return { success: true, loaded, added, updated, skippedDeleted: 0, employees: finalEmployees };
}

/**
 * 4. Refresh Interviews: Synchronizes CSV, statuses and results
 */
export async function refreshInterviews(): Promise<{ success: boolean; count: number }> {
  try {
    await interviewCSVService.syncAllInterviewsToCSV();
    
    // Read the sync results
    const csvContent = await interviewCSVService.getCSVContent();
    const rowsCount = csvContent.split('\n').filter(Boolean).length - 1; // subtract headers
    
    await writeLog('interview', 'REFRESH_INTERVIEWS', 'success', `Successfully synchronized ${rowsCount} interview rows to CSV`);
    return { success: true, count: rowsCount };
  } catch (err: any) {
    await writeLog('interview', 'REFRESH_INTERVIEWS_FAILED', 'failed', `Failed to sync interview CSV: ${err.message}`);
    return { success: false, count: 0 };
  }
}
