export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { checkCsrf, inspectUpload, UPLOAD_ALLOWED_EXTS } from "@/lib/security";
import { classifyHrFileWithLlm, excelSheetPreview } from "@/lib/corp-pool-llm";
import { jsonPublicError } from "@/lib/api-errors";

async function previewFromUpload(fileName: string, buffer: Buffer): Promise<string> {
  const lower = fileName.toLowerCase();
  if (/\.(xlsx|xls)$/i.test(lower)) {
    return excelSheetPreview(buffer);
  }
  if (/\.(docx|doc)$/i.test(lower)) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return String(result.value || "").slice(0, 6500);
  }
  if (/\.pdf$/i.test(lower)) {
    const pdfParse = (await import("pdf-parse")).default as (buf: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(buffer);
    return String(parsed.text || "").slice(0, 6500);
  }
  return buffer.toString("utf8").slice(0, 6500);
}

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const inspected = inspectUpload(buffer, file.name, {
      maxBytes: 25 * 1024 * 1024,
      allowedExts: UPLOAD_ALLOWED_EXTS,
    });
    if (!inspected.ok) {
      return NextResponse.json({ error: inspected.error }, { status: 400 });
    }

    const preview = await previewFromUpload(inspected.safeName || file.name, buffer);
    const placement = await classifyHrFileWithLlm({
      fileName: file.name,
      preview,
    });
    return NextResponse.json({ success: true, placement });
  } catch (error: any) {
    return jsonPublicError(error, error?.message || "Could not classify file");
  }
}
