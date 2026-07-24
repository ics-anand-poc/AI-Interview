import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { EmployeeRecord, calculateSkillMatch, refineCandidateShortlistWithAI, TalentShortlistCandidate } from '@/services/automation-service';
import { supabase } from '@/lib/db';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getEmployeesJsonPath = () => {
  return join(getUploadsRoot(), "employees.json");
};

/**
 * Two-stage talent matching for a given JD:
 *   Stage 1 (hardcoded, runs over the full employee roster): keyword-overlap scoring
 *     via calculateSkillMatch — fast and free, used to narrow hundreds of employees
 *     down to a shortlist.
 *   Stage 2 (LLM, runs ONLY on the shortlist): refineCandidateShortlistWithAI grounds
 *     its assessment in each shortlisted candidate's actual skills text and the actual
 *     JD text, producing a refined score, matched skills, and skill gaps.
 *
 * Body: { jdId: string, topN?: number (default 10, max 25) }
 */
export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const jdId = body?.jdId;
    const topN = Math.max(1, Math.min(25, Number(body?.topN) || 10));

    if (!jdId) {
      return NextResponse.json({ error: "jdId is required" }, { status: 400 });
    }

    const { data: dbJd, error: jdError } = await supabase
      .from('job_descriptions')
      .select('jd_text')
      .eq('id', jdId)
      .single();

    if (jdError || !dbJd?.jd_text) {
      return NextResponse.json({ error: "Job description not found" }, { status: 404 });
    }

    const raw = await readFile(getEmployeesJsonPath(), "utf8").catch(() => "[]");
    const employees: EmployeeRecord[] = JSON.parse(raw);

    // Stage 1: hardcoded keyword scoring across the full roster.
    const scored = employees.map((emp) => {
      const match = calculateSkillMatch(emp.skills || '', dbJd.jd_text);
      return { emp, score: match.score, matchingSkills: match.matchingSkills };
    });
    scored.sort((a, b) => b.score - a.score);
    const shortlist = scored.slice(0, topN);

    // Stage 2: LLM-grounded refinement of just the shortlist.
    const candidates: TalentShortlistCandidate[] = shortlist.map((s) => ({
      employeeId: s.emp.employee_id,
      fullName: s.emp.full_name,
      skillsText: s.emp.skills || '',
      keywordScore: s.score,
      matchingSkills: s.matchingSkills,
    }));

    const refined = await refineCandidateShortlistWithAI(dbJd.jd_text, candidates);

    return NextResponse.json({ success: true, shortlist: refined });
  } catch (err: any) {
    console.error("Talent shortlist rerank error:", err);
    return NextResponse.json({ error: err.message || "Rerank failed" }, { status: 500 });
  }
}
