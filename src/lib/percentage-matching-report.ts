import ExcelJS from "exceljs";

export type MatchBucketCounts = {
  rejected: number;
  evaluate: number;
  l1: number;
  shortlisted: number;
  total: number;
};

export type PercentageMatchRow = {
  title: string;
  demand: number | null;
  scores: number[];
};

const HEADER = {
  title: "Corp Pool Resource's Scores against NOKIA's JD",
  demand: "Demand against Each JD",
  rejected: "Score <30 % is Rejected",
  evaluate: "Score 30 to 50% To evaluate",
  l1: "Score 51 to 70% - Direct L1 Interview",
  shortlisted: "Score >70 % Shortlisted",
  total: "Total (Percentage)",
};

const FILL = {
  blueLight: "BDD7EE",
  blueMid: "5B9BD5",
  green: "C6E0B4",
  yellow: "FFE699",
  headerText: "1F4E79",
};

function cellToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/\u00a0/g, " ").trim();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.replace(/\u00a0/g, " ").trim();
    if (Array.isArray(o.richText)) {
      return o.richText.map((p: any) => p.text || "").join("").replace(/\u00a0/g, " ").trim();
    }
    if (typeof o.result !== "undefined") return String(o.result ?? "").replace(/\u00a0/g, " ").trim();
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

function parseScore(raw: string): number | null {
  const n = Number(String(raw || "").replace(/%/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function headerKey(h: string): string {
  return h.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}

function findCol(headers: string[], names: string[]): number {
  for (const name of names) {
    const idx = headers.findIndex((h) => h === name || h.includes(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function bucketScores(scores: number[]): MatchBucketCounts {
  const counts: MatchBucketCounts = {
    rejected: 0,
    evaluate: 0,
    l1: 0,
    shortlisted: 0,
    total: scores.length,
  };
  for (const score of scores) {
    if (score < 30) counts.rejected++;
    else if (score <= 50) counts.evaluate++;
    else if (score <= 70) counts.l1++;
    else counts.shortlisted++;
  }
  return counts;
}

export function labelAndDemandFromName(fileName: string): { title: string; demand: number | null } {
  const title = String(fileName || "").replace(/^.*[\\/]/, "").trim() || "Requirement";
  return { title, demand: null };
}

export async function parseMatchResultWorkbook(
  buffer: Buffer,
  fileName: string
): Promise<{ title: string; demand: number | null; scores: number[] }> {
  const { title, demand } = labelAndDemandFromName(fileName);
  const lower = fileName.toLowerCase();
  let table: string[][] = [];
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    table = parseCsv(buffer.toString("utf8"));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    if (!sheet) return { title, demand, scores: [] };
    sheet.eachRow((row) => {
      const vals = ((row.values as unknown[]) || []).slice(1).map(cellToText);
      if (vals.some(Boolean)) table.push(vals);
    });
  }
  if (table.length < 2) return { title, demand, scores: [] };
  const headers = table[0].map(headerKey);
  const scoreCol = findCol(headers, ["match score", "percentage", "score %", "score"]);
  const idCol = findCol(headers, ["emp no", "employee id", "employee_id", "emp id", "id"]);
  const nameCol = findCol(headers, ["emp name", "full name", "name"]);
  if (scoreCol < 0) return { title, demand, scores: [] };
  const scores: number[] = [];
  for (const vals of table.slice(1)) {
    const hasPerson =
      (idCol >= 0 && String(vals[idCol] || "").trim()) ||
      (nameCol >= 0 && String(vals[nameCol] || "").trim()) ||
      vals.some((v) => String(v || "").trim());
    if (!hasPerson) continue;
    const score = parseScore(vals[scoreCol] || "");
    scores.push(score == null ? 0 : score);
  }
  return { title, demand, scores };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur.trim());
      cur = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  row.push(cur.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function fillCell(
  cell: ExcelJS.Cell,
  value: string | number,
  bg: string,
  opts?: { bold?: boolean; wrap?: boolean; center?: boolean }
) {
  cell.value = value;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bg}` } };
  cell.font = { bold: Boolean(opts?.bold), color: { argb: `FF${FILL.headerText}` }, name: "Calibri", size: 11 };
  cell.alignment = {
    vertical: "middle",
    horizontal: opts?.center ? "center" : "left",
    wrapText: Boolean(opts?.wrap),
  };
  cell.border = {
    top: { style: "thin", color: { argb: "FF8FAADC" } },
    left: { style: "thin", color: { argb: "FF8FAADC" } },
    bottom: { style: "thin", color: { argb: "FF8FAADC" } },
    right: { style: "thin", color: { argb: "FF8FAADC" } },
  };
}

function pctReady(counts: MatchBucketCounts): string {
  if (!counts.total) return "0%";
  const ready = counts.l1 + counts.shortlisted;
  return `${Math.round((ready / counts.total) * 1000) / 10}%`;
}

export async function buildPercentageMatchingWorkbook(rows: PercentageMatchRow[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HR Screening Console";
  const ws = wb.addWorksheet("Percentage summary");
  ws.columns = [
    { width: 56 },
    { width: 24 },
    { width: 28 },
    { width: 30 },
    { width: 36 },
    { width: 28 },
    { width: 22 },
  ];
  ws.getRow(1).height = 36;

  const headers = [
    HEADER.title,
    HEADER.demand,
    HEADER.rejected,
    HEADER.evaluate,
    HEADER.l1,
    HEADER.shortlisted,
    HEADER.total,
  ];
  const headerFills = [
    FILL.blueLight,
    FILL.blueMid,
    FILL.green,
    FILL.green,
    FILL.green,
    FILL.green,
    FILL.yellow,
  ];
  headers.forEach((text, i) => {
    fillCell(ws.getRow(1).getCell(i + 1), text, headerFills[i], { bold: true, wrap: true, center: true });
  });

  const sum: MatchBucketCounts = { rejected: 0, evaluate: 0, l1: 0, shortlisted: 0, total: 0 };

  rows.forEach((row, idx) => {
    const counts = bucketScores(row.scores);
    const excelRow = ws.getRow(idx + 2);
    excelRow.height = 22;
    fillCell(excelRow.getCell(1), row.title, FILL.blueLight, { bold: true, wrap: true });
    fillCell(excelRow.getCell(2), "", FILL.blueMid, { center: true });
    fillCell(excelRow.getCell(3), counts.rejected, FILL.green, { center: true });
    fillCell(excelRow.getCell(4), counts.evaluate, FILL.green, { center: true });
    fillCell(excelRow.getCell(5), counts.l1, FILL.green, { center: true });
    fillCell(excelRow.getCell(6), counts.shortlisted, FILL.green, { center: true });
    fillCell(excelRow.getCell(7), pctReady(counts), FILL.yellow, { center: true, bold: true });
    sum.rejected += counts.rejected;
    sum.evaluate += counts.evaluate;
    sum.l1 += counts.l1;
    sum.shortlisted += counts.shortlisted;
    sum.total += counts.total;
  });

  const totalRow = ws.getRow(rows.length + 2);
  totalRow.height = 22;
  fillCell(totalRow.getCell(1), HEADER.total, FILL.blueLight, { bold: true });
  fillCell(totalRow.getCell(2), "", FILL.blueMid, { center: true });
  fillCell(totalRow.getCell(3), sum.rejected, FILL.green, { center: true, bold: true });
  fillCell(totalRow.getCell(4), sum.evaluate, FILL.green, { center: true, bold: true });
  fillCell(totalRow.getCell(5), sum.l1, FILL.green, { center: true, bold: true });
  fillCell(totalRow.getCell(6), sum.shortlisted, FILL.green, { center: true, bold: true });
  fillCell(totalRow.getCell(7), pctReady(sum), FILL.yellow, { center: true, bold: true });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb;
}

export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
