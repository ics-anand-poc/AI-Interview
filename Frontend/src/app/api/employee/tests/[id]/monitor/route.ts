import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { monitorFrame } from "@/lib/faceproj-client";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequestAsync(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { frame } = await request.json().catch(() => ({}));
    if (!frame) {
      return NextResponse.json({ error: "frame is required" }, { status: 400 });
    }

    const result = await monitorFrame(frame);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Monitor frame error:", error);
    const message = error instanceof Error ? error.message : "Monitoring failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
