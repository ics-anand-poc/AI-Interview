/**
 * Add the latest wiped scores as extra history rows (unique topic ids so the
 * one-history-per-employee unique index is not hit). Existing detailed history stays.
 */
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { loadProjectEnv, getSupabaseConfig } from "./load-env";

const TOPIC_ID = "resource-product-assessment";
const HISTORY_TOPIC_ID = "resource-product-assessment-history";

const PREVIOUS_PERCENT: Record<string, number | null> = {
  "1041963": null,
  "1039210": 68,
  "1040910": null,
  "1041219": 76,
  "1034770": 16,
  "1037034": 68,
  "1706607": 48,
  "1706846": 76,
  "1041392": 72,
  "1042020": 76,
  "1039180": 76,
  "1035049": null,
};

function scoreFromPercent(percent: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((percent * total) / 100);
}

function isHistoryTopic(topicId: string | null | undefined): boolean {
  return String(topicId || "").startsWith(HISTORY_TOPIC_ID);
}

async function main() {
  loadProjectEnv();
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const supabase = createClient(url, key);
  const report: Array<Record<string, unknown>> = [];

  for (const [employeeId, percent] of Object.entries(PREVIOUS_PERCENT)) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (!emp?.id) {
      report.push({ employee_id: employeeId, status: "missing" });
      continue;
    }

    const { data: liveTest } = await supabase
      .from("tests")
      .select("*")
      .eq("employee_id", emp.id)
      .eq("topic_id", TOPIC_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: allTests } = await supabase
      .from("tests")
      .select("id, topic_id, score_percent, status")
      .eq("employee_id", emp.id)
      .eq("status", "completed");

    const histories = (allTests ?? []).filter((t) => isHistoryTopic(t.topic_id));
    const historyDetails: Array<Record<string, unknown>> = [];
    for (const h of histories) {
      const [{ count: qCount }, { count: aCount }] = await Promise.all([
        supabase.from("test_questions").select("id", { count: "exact", head: true }).eq("test_id", h.id),
        supabase.from("test_attempts").select("id", { count: "exact", head: true }).eq("test_id", h.id),
      ]);
      historyDetails.push({
        id: h.id,
        percent: h.score_percent,
        questions: qCount ?? 0,
        attempts: aCount ?? 0,
      });
    }

    const hasMatching =
      percent != null && histories.some((h) => Number(h.score_percent) === percent);

    let added: string | null = null;
    if (percent != null && liveTest && !hasMatching) {
      const { data: questions } = await supabase
        .from("test_questions")
        .select("*")
        .eq("test_id", liveTest.id)
        .order("question_index");
      const questionRows = questions || [];
      const historyId = randomUUID();
      const title = String(liveTest.topic_title || "Product Assessment").replace(
        /\s*\(previous(?: attempt)?\)\s*$/i,
        ""
      );
      const total = Number(liveTest.total_questions ?? questionRows.length ?? 25);
      const { id: _id, created_at: _created, ...rest } = liveTest as Record<string, unknown> & {
        id: string;
        created_at?: string;
      };
      const { error: insErr } = await supabase.from("tests").insert({
        ...rest,
        id: historyId,
        topic_id: `${HISTORY_TOPIC_ID}:${historyId}`,
        topic_title: `${title} (previous)`,
        status: "completed",
        current_question_index: total,
        started_at: null,
        completed_at: new Date(Date.now() - 60_000).toISOString(),
        in_progress: null,
        session_recording_url: null,
        proctoring: null,
        score_correct: scoreFromPercent(percent, total),
        score_total: total,
        score_percent: percent,
        ai_analysis: null,
      });
      if (insErr) {
        added = `failed:${insErr.message}`;
      } else {
        if (questionRows.length) {
          const copied = questionRows.map((q: { id: string }) => ({
            ...q,
            id: randomUUID(),
            test_id: historyId,
          }));
          const { error: qErr } = await supabase.from("test_questions").insert(copied);
          if (qErr) added = `partial:${qErr.message}`;
        }
        added = added ?? historyId;
      }
    }

    report.push({
      employee_id: employeeId,
      name: emp.full_name,
      live: liveTest?.status ?? null,
      wiped_percent: percent,
      histories: historyDetails,
      added,
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
