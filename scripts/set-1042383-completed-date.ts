import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig, loadProjectEnv } from "./load-env";

const EMPLOYEE_CODE = "1042383";
const COMPLETED_AT = "2026-08-19T12:00:00.000+05:30";

loadProjectEnv();
const { url, key } = getSupabaseConfig();
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

async function main() {
  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, employee_id, full_name")
    .eq("employee_id", EMPLOYEE_CODE)
    .maybeSingle();
  if (empErr) throw empErr;
  if (!emp?.id) throw new Error(`Employee ${EMPLOYEE_CODE} not found`);

  const { data: tests, error: testErr } = await supabase
    .from("tests")
    .select("id, status, completed_at, started_at, employee_code")
    .or(`employee_code.eq.${EMPLOYEE_CODE},employee_id.eq.${emp.id}`);
  if (testErr) throw testErr;
  if (!tests?.length) throw new Error("No tests found");

  for (const test of tests) {
    const startedAt = test.started_at && new Date(test.started_at) < new Date(COMPLETED_AT)
      ? test.started_at
      : "2026-08-19T10:30:00.000+05:30";
    const { error } = await supabase
      .from("tests")
      .update({
        completed_at: COMPLETED_AT,
        started_at: startedAt,
      })
      .eq("id", test.id);
    if (error) throw error;
    console.log(`Updated ${test.id} completed_at -> ${COMPLETED_AT}`);
  }

  const testIds = tests.map((t) => t.id);
  const { error: attemptErr } = await supabase
    .from("test_attempts")
    .update({ created_at: COMPLETED_AT })
    .in("test_id", testIds);
  if (attemptErr) throw attemptErr;
  console.log(`Updated attempts created_at for ${testIds.length} test(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
