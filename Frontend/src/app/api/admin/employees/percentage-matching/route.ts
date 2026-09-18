import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { checkCsrf } from "@/lib/security";
import { jsonPublicError } from "@/lib/api-errors";
import {
  parseMatchResultWorkbook,
  buildPercentageMatchingWorkbook,
  workbookToBuffer,
  type PercentageMatchRow,
} from "@/lib/percentage-matching-report";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUMMARY_FILE = "Percentage summary.xlsx";

function xlsxResponse(buf: Buffer, fileName: string) {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .concat(form.getAll("file"))
      .filter((item): item is File => item instanceof File && item.size > 0);
    if (!files.length) {
      return NextResponse.json(
        { error: "Upload one or more JD/BR vs Corp Pool score workbooks." },
        { status: 400 }
      );
    }

    const rows: PercentageMatchRow[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const parsed = await parseMatchResultWorkbook(buf, file.name);
      if (!parsed.scores.length) {
        return NextResponse.json(
          { error: `No Match Score column/rows found in ${file.name}.` },
          { status: 400 }
        );
      }
      rows.push({ ...parsed, demand: null });
    }

    const wb = await buildPercentageMatchingWorkbook(rows);
    const buf = await workbookToBuffer(wb);
    return xlsxResponse(buf, SUMMARY_FILE);
  } catch (error: any) {
    return jsonPublicError(error, error?.message || "Failed to build percentage matching file");
  }
}
