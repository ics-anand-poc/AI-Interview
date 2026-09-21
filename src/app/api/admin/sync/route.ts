import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { readDashboardSync } from "@/lib/dashboard-sync";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sync = await readDashboardSync();
  return NextResponse.json(sync);
}
