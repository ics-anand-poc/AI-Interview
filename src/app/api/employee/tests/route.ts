import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest } from "@/lib/employee-auth";

export async function GET(request: NextRequest) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json([]);
    }

    const { data } = await supabase
      .from("tests")
      .select("id, topic_id, subject_id, difficulty, total_questions, status, started_at, completed_at")
      .eq("employee_id", auth.employeeId)
      .order("started_at", { ascending: false })
      .limit(10);

    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error("GET /employee/tests error:", e);
    return NextResponse.json([]);
  }
}
