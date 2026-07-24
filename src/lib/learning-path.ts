import { supabase } from "@/lib/db";
import { generateAIText } from "@/lib/ai-providers";

/**
 * Personalized Learning Path: aggregates an employee's actual quiz/test history
 * (deterministic — a straightforward DB aggregation, no LLM needed for that part) and
 * uses ONE LLM call to synthesize a prioritized, narrative study plan from it. This is
 * the right split: gathering and computing per-topic accuracy is mechanical, but turning
 * "here's your performance across N topics" into a coherent, prioritized recommendation
 * of what to study next and why is a genuinely generative synthesis task.
 */

interface TopicPerformance {
  topicTitle: string;
  subjectTitle: string;
  difficulty: string;
  accuracy: number; // 0-100
  attempted: number;
  correct: number;
  completedAt: string | null;
}

async function aggregateEmployeePerformance(employeeId: string): Promise<TopicPerformance[]> {
  const { data: tests, error: testsError } = await supabase
    .from("tests")
    .select("id, topic_id, subject_id, difficulty, status, completed_at, total_questions, learning_topics(title), learning_subjects(title)")
    .eq("employee_id", employeeId)
    .eq("status", "completed");

  if (testsError || !tests || tests.length === 0) return [];

  const testIds = tests.map((t: any) => t.id);
  const { data: attempts, error: attemptsError } = await supabase
    .from("test_attempts")
    .select("test_id, is_correct")
    .in("test_id", testIds);

  if (attemptsError) return [];

  const byTest = new Map<string, { correct: number; total: number }>();
  (attempts || []).forEach((a: any) => {
    const entry = byTest.get(a.test_id) || { correct: 0, total: 0 };
    entry.total += 1;
    if (a.is_correct) entry.correct += 1;
    byTest.set(a.test_id, entry);
  });

  return tests.map((t: any) => {
    const stats = byTest.get(t.id) || { correct: 0, total: t.total_questions || 0 };
    return {
      topicTitle: t.learning_topics?.title || "Unknown Topic",
      subjectTitle: t.learning_subjects?.title || "Unknown Subject",
      difficulty: t.difficulty,
      accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      attempted: stats.total,
      correct: stats.correct,
      completedAt: t.completed_at,
    };
  });
}

export interface LearningPath {
  overallSummary: string;
  priorityTopics: { topic: string; reason: string }[];
  suggestedOrder: string[];
  encouragement: string;
  gradedBy: "llm" | "no-history" | "local-aggregate";
}

export async function generateLearningPath(employeeId: string): Promise<LearningPath> {
  const performance = await aggregateEmployeePerformance(employeeId);

  if (performance.length === 0) {
    return {
      overallSummary: "No completed quizzes yet — take a few topic quizzes to get a personalized study plan.",
      priorityTopics: [],
      suggestedOrder: [],
      encouragement: "Every expert started as a beginner. Pick a subject and take your first quiz to get started.",
      gradedBy: "no-history",
    };
  }

  try {
    const prompt = `
You are a learning & development coach. Based ONLY on this employee's actual quiz performance history below, write a prioritized, personalized study plan. Ground every recommendation in the specific topics/accuracy data provided — do not invent topics they haven't attempted.

Performance history (JSON):
${JSON.stringify(performance, null, 2)}

Return ONLY a raw JSON object with this exact structure:
{
  "overallSummary": "2-3 sentence summary of their overall learning performance and trajectory.",
  "priorityTopics": [{ "topic": "exact topic title from the data", "reason": "why this should be prioritized, grounded in their actual accuracy on it" }],
  "suggestedOrder": ["topic titles from the data, in the order they should revisit/study them"],
  "encouragement": "A brief, genuine, specific one-liner of encouragement referencing something concrete from their data."
}
`;
    const raw = await generateAIText(prompt);
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { ...parsed, gradedBy: "llm" };
  } catch (err) {
    console.warn("LLM learning path synthesis failed, using local aggregate fallback.", err);
    const sorted = [...performance].sort((a, b) => a.accuracy - b.accuracy);
    const weakest = sorted.slice(0, 3);
    return {
      overallSummary: `Completed ${performance.length} quiz(zes) across ${new Set(performance.map(p => p.subjectTitle)).size} subject(s). Average accuracy: ${Math.round(performance.reduce((s, p) => s + p.accuracy, 0) / performance.length)}%.`,
      priorityTopics: weakest.map(t => ({ topic: t.topicTitle, reason: `Lowest recorded accuracy at ${t.accuracy}% (${t.correct}/${t.attempted} correct).` })),
      suggestedOrder: weakest.map(t => t.topicTitle),
      encouragement: "Keep going — revisiting your lowest-scoring topics first tends to build the strongest foundation.",
      gradedBy: "local-aggregate",
    };
  }
}
