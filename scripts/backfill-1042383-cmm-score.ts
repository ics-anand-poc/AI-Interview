/**
 * If 1042383 has no visible CMM score in admin, set 23/25 from the employee
 * results screenshot and write 23 correct / 2 incorrect attempts.
 *
 * Usage:
 *   npx tsx scripts/backfill-1042383-cmm-score.ts
 */
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const EMPLOYEE_CODE = "1042383";
const CORRECT = 23;
const TOTAL = 25;
const PERCENT = 92;
const MANIFEST_TEST_ID = "6d01bc2c-90a9-49cf-8db7-17ecaf3c2ddf";
const TOPIC_ID = "resource-product-assessment";

loadProjectEnv();
const { url, key } = getSupabaseConfig();
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

function seededShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, employee_id, full_name, email")
    .eq("employee_id", EMPLOYEE_CODE)
    .maybeSingle();
  if (empErr) throw empErr;
  if (!emp?.id) {
    console.error(`Employee ${EMPLOYEE_CODE} not found`);
    process.exit(1);
  }
  console.log(`Employee ${emp.full_name} uuid=${emp.id}`);

  const { data: tests, error: testErr } = await supabase
    .from("tests")
    .select(
      "id, employee_id, employee_code, status, score_correct, score_total, score_percent, total_questions, topic_id, topic_title, completed_at, started_at"
    )
    .or(`employee_code.eq.${EMPLOYEE_CODE},employee_id.eq.${emp.id}`);
  if (testErr) throw testErr;

  console.log(`Found ${tests?.length || 0} test row(s)`);
  for (const t of tests || []) {
    console.log(
      `  ${t.id} status=${t.status} score=${t.score_correct}/${t.score_total || t.total_questions} topic=${t.topic_title || t.topic_id}`
    );
  }

  const completedWithScore = (tests || []).find(
    (t) =>
      t.status === "completed" &&
      Number(t.score_correct) === CORRECT &&
      Number(t.score_total ?? t.total_questions) === TOTAL
  );

  let test =
    completedWithScore ||
    (tests || []).find((t) => t.status === "completed") ||
    (tests || []).find((t) => t.id === MANIFEST_TEST_ID) ||
    (tests || []).find((t) => t.topic_id === TOPIC_ID) ||
    (tests || [])[0];

  if (!test) {
    console.error("No test row found for this employee");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const startedAt = test.started_at || now;
  const completedAt = test.completed_at || now;

  if (
    test.status !== "completed" ||
    Number(test.score_correct) !== CORRECT ||
    Number(test.score_total ?? test.total_questions) !== TOTAL
  ) {
    const { error: updErr } = await supabase
      .from("tests")
      .update({
        status: "completed",
        employee_code: EMPLOYEE_CODE,
        score_correct: CORRECT,
        score_total: TOTAL,
        score_percent: PERCENT,
        total_questions: TOTAL,
        started_at: startedAt,
        completed_at: completedAt,
        topic_id: test.topic_id || TOPIC_ID,
        topic_title: test.topic_title || "CMM",
      })
      .eq("id", test.id);
    if (updErr) throw updErr;
    console.log(`Updated test ${test.id} to ${CORRECT}/${TOTAL} (${PERCENT}%)`);
  } else {
    console.log(`Test ${test.id} already has ${CORRECT}/${TOTAL}`);
  }

  const { data: questions, error: qErr } = await supabase
    .from("test_questions")
    .select("id, question_index, question_text, options, correct_option_index")
    .eq("test_id", test.id)
    .order("question_index");
  if (qErr) throw qErr;

  const usable = (questions || []).filter(
    (q) => Array.isArray(q.options) && q.options.length > 1 && q.correct_option_index != null
  );
  if (usable.length < TOTAL) {
    console.error(`Only ${usable.length} usable questions; need ${TOTAL}`);
    process.exit(1);
  }
  const qList = usable.slice(0, TOTAL);
  const shuffled = seededShuffle(qList, `ss-fill:${EMPLOYEE_CODE}:${test.id}:${CORRECT}`);
  const correctSet = new Set(shuffled.slice(0, CORRECT).map((q) => q.id));

  const payload = qList.map((question) => {
    const isCorrect = correctSet.has(question.id);
    const options = question.options as string[];
    const correctIndex = Number(question.correct_option_index);
    let selectedIndex = correctIndex;
    if (!isCorrect) {
      selectedIndex = options.findIndex((_, idx) => idx !== correctIndex);
      if (selectedIndex < 0) selectedIndex = (correctIndex + 1) % options.length;
    }
    return {
      test_id: test.id,
      employee_id: emp.id,
      question_id: question.id,
      selected_option_index: selectedIndex,
      is_correct: isCorrect,
      time_taken_seconds: 20 + (Number(question.question_index) % 25),
      session_key: String(test.id).slice(0, 8),
      created_at: completedAt,
    };
  });

  const payloadCorrect = payload.filter((row) => row.is_correct).length;
  if (payloadCorrect !== CORRECT || payload.length !== TOTAL) {
    console.error(`Generated ${payloadCorrect}/${payload.length}, expected ${CORRECT}/${TOTAL}`);
    process.exit(1);
  }

  const { error: delErr } = await supabase.from("test_attempts").delete().eq("test_id", test.id);
  if (delErr) throw delErr;
  const { error: insErr } = await supabase.from("test_attempts").insert(payload);
  if (insErr) throw insErr;

  console.log(
    `Wrote ${payload.length} answers for ${EMPLOYEE_CODE}: ${CORRECT} correct, ${TOTAL - CORRECT} incorrect`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
