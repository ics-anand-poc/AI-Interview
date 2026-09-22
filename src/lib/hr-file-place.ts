/**
 * Deterministic file placement for JD / BR / Corp Pool / Portal Mapping.
 * Works on hosted and local without Qwen or Laya.
 */

export type HrFileKind = "corp_pool" | "jd" | "br" | "portal_mapping" | "unknown";

export type HrFilePlacement = {
  kind: HrFileKind;
  category: "employee" | "jd" | "br" | "portal-mapping" | "resume";
  placeIn: string;
  why: string;
  peopleCount?: number;
  suggestedTitle?: string;
  columns?: Record<string, string>;
};

const KIND_TO_CATEGORY: Record<HrFileKind, HrFilePlacement["category"]> = {
  corp_pool: "employee",
  jd: "jd",
  br: "br",
  portal_mapping: "portal-mapping",
  unknown: "resume",
};

const KIND_TO_PLACE: Record<HrFileKind, string> = {
  corp_pool: "Corp Pool (people list)",
  jd: "Requirements JD/BR",
  br: "Requirements JD/BR (BR workbook)",
  portal_mapping: "Employee Portal mapping",
  unknown: "Do not auto-place — pick the tab yourself",
};

function normalizeName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[_'`’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerToken(line: string): string {
  return line.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function findColumn(preview: string, names: string[]): string {
  const lines = String(preview || "")
    .split(/\n/)
    .slice(0, 16);
  for (const line of lines) {
    const cells = line.split("|").map((c) => headerToken(c));
    for (const cell of cells) {
      if (!cell) continue;
      if (names.some((n) => cell === n || cell.includes(n))) return cell;
    }
  }
  return "";
}

function countDataRows(preview: string): number {
  return Math.max(
    0,
    String(preview || "")
      .split(/\n/)
      .filter((line) => line.includes("|") && !/^sheet:/i.test(line.trim())).length - 1
  );
}

function jobTitleFromPreview(preview: string): string {
  const match = String(preview || "").match(/job title\s*[:|#]\s*([^\n|]{3,80})/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

export function hrPlacement(kind: HrFileKind, why: string, extra?: Partial<HrFilePlacement>): HrFilePlacement {
  return {
    kind,
    category: KIND_TO_CATEGORY[kind],
    placeIn: KIND_TO_PLACE[kind],
    why,
    ...extra,
  };
}

/** Place an HR file from filename + text/Excel preview. No model required. */
export function placeHrFile(input: { fileName: string; preview?: string }): HrFilePlacement {
  const fileName = String(input.fileName || "").trim();
  const name = normalizeName(fileName);
  const collapsed = name.replace(/\s+/g, "_");
  const preview = String(input.preview || "");
  const blob = `${name}\n${preview}`.toLowerCase();

  const empNo = findColumn(preview, ["emp no", "employee id", "emp id", "employee code"]);
  const empName = findColumn(preview, ["emp name", "employee name", "full name"]);
  const skills = findColumn(preview, ["detailed skills", "skills bucket", "top 3 skills", "skills"]);
  const brId = findColumn(preview, ["auto req id", "br id", "requisition id"]);
  const assignedQ = /assigned question\s*\d+/i.test(preview);
  const jdProse =
    /job title\s*:/i.test(preview) ||
    /mandatory skills\s*:/i.test(preview) ||
    /job description/i.test(preview) ||
    /primary skills\s*:/i.test(preview);

  if (name.includes("user credential") || name.includes("employee user credential")) {
    return hrPlacement("unknown", "Credential workbooks are not uploaded. Use Resource_Question_Mapping.xlsx only.");
  }

  if (
    assignedQ ||
    name.includes("resource question mapping") ||
    name.includes("question mapping")
  ) {
    return hrPlacement("portal_mapping", "This workbook maps people to portal test questions, not Corp Pool.");
  }

  const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(name);
  const isJdDoc = /\.(docx|doc|pdf|txt|html|htm)$/i.test(name);
  const hasBrToken = /\d+\s*br\b/i.test(name) || /\d{5}br\b/i.test(name.replace(/\s+/g, ""));
  const previewHasBrValue = /\b\d{5}\s*br\b/i.test(preview);

  if (isJdDoc && hasBrToken) {
    return hrPlacement("jd", "Filename has a BR ID on a JD document.", {
      suggestedTitle: jobTitleFromPreview(preview) || undefined,
    });
  }

  if (isSpreadsheet && (hasBrToken || /br_rawdata/.test(collapsed))) {
    return hrPlacement("br", "BR / requisition workbook (Auto req ID rows).", {
      columns: brId ? { br_id: brId } : undefined,
    });
  }

  if (isSpreadsheet && (brId || previewHasBrValue) && !empNo) {
    return hrPlacement("br", "Excel has an Auto req ID / BR ID column.", {
      columns: brId ? { br_id: brId } : undefined,
    });
  }

  if (
    name.includes("corp pool") ||
    name.includes("active list") ||
    name.includes("employee list") ||
    (empNo && empName)
  ) {
    return hrPlacement("corp_pool", empNo ? "Roster columns: Emp No and name." : "Filename matches a Corp Pool roster.", {
      peopleCount: countDataRows(preview) || undefined,
      columns: {
        emp_no: empNo || "emp no",
        name: empName || "emp name",
        skills: skills || "",
      },
    });
  }

  if (jdProse && !empNo) {
    return hrPlacement("jd", "File reads as a job description (title / mandatory skills).", {
      suggestedTitle: jobTitleFromPreview(preview) || undefined,
    });
  }

  if (name.endsWith(".csv") && (empNo || /emp no|employee id/.test(blob))) {
    return hrPlacement("corp_pool", "CSV roster with employee IDs.", {
      columns: { emp_no: empNo || "emp no", name: empName, skills },
    });
  }

  if (/\.(pdf|docx|doc|txt|html|htm)$/i.test(name) && jdProse) {
    return hrPlacement("jd", "Document body is a job description.", {
      suggestedTitle: jobTitleFromPreview(preview) || undefined,
    });
  }

  return hrPlacement("unknown", "Could not tell Corp Pool, JD/BR, or Portal Mapping from the filename or preview.");
}
