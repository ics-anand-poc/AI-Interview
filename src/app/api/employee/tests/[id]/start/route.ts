import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db";
import { authenticateRequest } from "@/lib/employee-auth";
import { localTestsDb } from "@/services/local-tests-db";

/**
 * POST /api/employee/tests/:id/start
 * Body: { difficulty: "easy"|"medium"|"hard" }
 * Generates questions via Gemini and returns the first one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is ok
    }
    const difficulty = (body as any).difficulty ?? "medium";

    let testRow: any = null;
    let questions: any[] = [];

    try {
      const { data, error } = await supabase
        .from("tests")
        .select("*")
        .eq("id", id)
        .eq("employee_id", auth.employeeId)
        .single();

      if (error || !data) throw error || new Error("Test not found");
      testRow = data;

      const { data: qData, error: qErr } = await supabase
        .from("test_questions")
        .select("*")
        .eq("test_id", id)
        .order("question_index");

      if (qErr) throw qErr;
      questions = qData ?? [];
    } catch (dbErr) {
      console.warn("Supabase start test query failed, falling back to local database.", dbErr);
      const localTest = await localTestsDb.getTestById(id);
      if (!localTest || localTest.employee_id !== auth.employeeId) {
        return NextResponse.json({ error: "Test not found" }, { status: 404 });
      }
      testRow = localTest;
      questions = await localTestsDb.getQuestions(id);
    }

    if (!questions || questions.length === 0) {
      return NextResponse.json({ error: "Test has no questions" }, { status: 400 });
    }

    return NextResponse.json({
      test: testRow,
      questions,
      total: questions.length,
    });
  } catch (e) {
    console.error("start error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
