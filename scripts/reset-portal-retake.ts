/**
 * Reset product assessments for a fixed Emp ID list so they can retake.
 * Archives the finished attempt in full first (questions + answers + score).
 * Does not wipe Employee Portal. Does not change questions. Does not touch Corp Pool.
 *
 * Usage:
 *   npx tsx scripts/reset-portal-retake.ts
 */
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const TOPIC_ID = "resource-product-assessment";
const HISTORY_TOPIC_ID = "resource-product-assessment-history";

const EMPLOYEE_IDS = [
  "1041963", // Mayank Shekhar
  "1039210", // Venkata Vinay T
  "1040910", // Ravi Shankar
  "1041219", // Deepak Kumar Tiwari
  "1034770", // Chegoni Dhanusha
  "1037034", // Perisetti Mohan Naga Sai Kumar
  "1706607", // Mahima Bharti
  "1706846", // Ayush Chauhan
  "1041392", // Mohit Shukla
  "1042020", // Shubham Sharma
  "1039180", // Kul Shreshth
  "1035049", // Bipin Kumar
];

async function archiveTestAsHistory(supabase: ReturnType<typeof createClient>, testId: string): Promise<string | null> {
  const { data: test, error } = await supabase.from("tests").select("*").eq("id", testId).maybeSingle();
  if (error || !test) return null;
  if (String(test.topic_id || "").startsWith(HISTORY_TOPIC_ID)) return null;

  const { data: attempts } = await supabase.from("test_attempts").select("*").eq("test_id", testId);
  const attemptRows = attempts || [];
  const hasResult =
    String(test.status || "") === "completed" ||
    test.score_percent != null ||
    Boolean(test.completed_at) ||
    attemptRows.length > 0;
  if (!hasResult) return null;

  const { data: questions } = await supabase
    .from("test_questions")
    .select("*")
    .eq("test_id", testId)
    .order("question_index");
  const questionRows = questions || [];

  const historyId = randomUUID();
  const title = String(test.topic_title || "Product Assessment").replace(/\s*\(previous(?: attempt)?\)\s*$/i, "");
  const { id: _id, created_at: _created, ...rest } = test as Record<string, unknown> & {
    id: string;
    created_at?: string;
  };

  const { error: insErr } = await supabase.from("tests").insert({
    ...rest,
    id: historyId,
    topic_id: `${HISTORY_TOPIC_ID}:${historyId}`,
    topic_title: `${title} (previous)`,
    status: "completed",
    completed_at: test.completed_at || new Date().toISOString(),
  });
  if (insErr) {
    console.warn("archive insert failed:", insErr.message);
    return null;
  }

  const qIdMap = new Map<string, string>();
  if (questionRows.length) {
    const copied = questionRows.map((q: { id: string }) => {
      const newId = randomUUID();
      qIdMap.set(String(q.id), newId);
      return { ...q, id: newId, test_id: historyId };
    });
    const { error: qErr } = await supabase.from("test_questions").insert(copied);
    if (qErr) console.warn("archive questions failed:", qErr.message);
  }

  if (attemptRows.length) {
    const copiedAttempts = attemptRows.map((a: { id?: string; question_id: string }) => ({
      ...a,
      id: randomUUID(),
      test_id: historyId,
      question_id: qIdMap.get(String(a.question_id)) || a.question_id,
    }));
    const { error: aErr } = await supabase.from("test_attempts").insert(copiedAttempts);
    if (aErr) console.warn("archive attempts failed:", aErr.message);
  }

  return historyId;
}

async function main() {
  loadProjectEnv();
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);
  const now = new Date().toISOString();

  const results: Array<Record<string, string>> = [];

  for (const employeeId of EMPLOYEE_IDS) {
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, employee_id, full_name")
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (empErr) throw new Error(empErr.message);
    if (!emp?.id) {
      results.push({ employee_id: employeeId, status: "missing", detail: "not in employees table" });
      continue;
    }

    const { data: tests, error: testErr } = await supabase
      .from("tests")
      .select("id, status, score_percent")
      .eq("employee_id", emp.id)
      .eq("topic_id", TOPIC_ID);
    if (testErr) throw new Error(testErr.message);
    if (!tests?.length) {
      results.push({
        employee_id: employeeId,
        name: String(emp.full_name || ""),
        status: "no_test",
        detail: "no resource-product-assessment test",
      });
      continue;
    }

    const archived: string[] = [];
    for (const test of tests) {
      const historyId = await archiveTestAsHistory(supabase, test.id);
      if (historyId) archived.push(historyId);

      const { error: attErr } = await supabase.from("test_attempts").delete().eq("test_id", test.id);
      if (attErr) throw new Error(attErr.message);

      const { error: updErr } = await supabase
        .from("tests")
        .update({
          status: "pending",
          in_progress: null,
          current_question_index: 0,
          started_at: null,
          completed_at: null,
          session_recording_url: null,
          proctoring: null,
          score_correct: null,
          score_total: null,
          score_percent: null,
          ai_analysis: null,
        })
        .eq("id", test.id);
      if (updErr) throw new Error(updErr.message);
    }

    await supabase
      .from("employees")
      .update({
        ai_readiness_score: 0,
        xp_points: 0,
        skill_level: "beginner",
        updated_at: now,
      })
      .eq("id", emp.id);

    results.push({
      employee_id: employeeId,
      name: String(emp.full_name || ""),
      status: "reset",
      tests: String(tests.length),
      archived: String(archived.length),
      previous: tests.map((t) => `${t.status}${t.score_percent != null ? ` ${t.score_percent}%` : ""}`).join(", "),
    });
  }

  console.log(JSON.stringify({ count: EMPLOYEE_IDS.length, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
