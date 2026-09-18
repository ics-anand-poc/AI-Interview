export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { checkCsrf } from "@/lib/security";
import { supabase } from "@/lib/db";
import { loadCorpPoolRoster, saveCorpPoolRoster } from "@/lib/corp-pool-store";
import { writePersistedJson, getRuntimeUploadsRoot } from "@/lib/runtime-data";
import { cacheStore } from "@/lib/cache-store";
import { scorePersonAgainstJdsWithLlm } from "@/lib/corp-pool-llm";
import { jsonPublicError } from "@/lib/api-errors";
import type { EmployeeRecord } from "@/services/automation-service";

let activeEvaluateScanId = "";

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const jdId = String(body.jdId || "").trim();
    if (!jdId || jdId === "all" || jdId.includes("@")) {
      return NextResponse.json({ error: "Select one requirement first." }, { status: 400 });
    }

    const { data: jd, error: jdErr } = await supabase
      .from("job_descriptions")
      .select("id, file_name, jd_text")
      .eq("id", jdId)
      .maybeSingle();
    if (jdErr || !jd?.jd_text) {
      return NextResponse.json({ error: "Could not load that job description." }, { status: 404 });
    }

    const employees = await loadCorpPoolRoster<EmployeeRecord>();
    if (!employees.length) {
      return NextResponse.json({ error: "Corp Pool is empty." }, { status: 400 });
    }

    const requestedIds = Array.isArray(body.employeeIds)
      ? (body.employeeIds as unknown[]).map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const idSet = requestedIds.length ? new Set(requestedIds) : null;
    if (!idSet) {
      return NextResponse.json({ error: "Select a pool of people first, then Analyze." }, { status: 400 });
    }
    const scoreTargets = employees.filter((emp) => idSet.has(emp.employee_id));
    if (!scoreTargets.length) {
      return NextResponse.json({ error: "None of the selected pool people are in Corp Pool." }, { status: 400 });
    }

    const force = body.force !== false;
    const offset = Math.max(0, Number(body.offset) || 0);
    const hasLimit = body.limit != null && body.limit !== "";
    const limit = hasLimit ? Math.min(5, Math.max(1, Number(body.limit) || 1)) : scoreTargets.length;
    const scanId = String(body.scanId || "").trim();
    if (offset === 0 || !activeEvaluateScanId) {
      activeEvaluateScanId = scanId || `${jdId}-${Date.now()}`;
    } else if (scanId && scanId !== activeEvaluateScanId) {
      return NextResponse.json({
        success: true,
        aborted: true,
        jdFileName: jd.file_name,
        scored: 0,
        skipped: 0,
        failed: 0,
        total: scoreTargets.length,
        offset,
        nextOffset: offset,
        done: false,
        results: [],
      });
    }

    const persist = async (filesToo: boolean) => {
      await saveCorpPoolRoster(employees);
      if (!filesToo) return;
      const serialized = JSON.stringify(employees, null, 2);
      await writeFile(join(getRuntimeUploadsRoot(), "employees.json"), serialized, "utf8").catch(() => {});
      await writePersistedJson("employees.json", serialized);
      cacheStore.invalidate("employees");
    };

    const batch = scoreTargets.slice(offset, offset + limit);
    const results = [];
    let skipped = 0;
    const errors: string[] = [];
    for (const emp of batch) {
      if (scanId && scanId !== activeEvaluateScanId) {
        return NextResponse.json({
          success: true,
          aborted: true,
          jdFileName: jd.file_name,
          scored: results.length,
          skipped,
          failed: errors.length,
          total: scoreTargets.length,
          offset,
          nextOffset: offset + results.length + skipped + errors.length,
          done: false,
          results,
        });
      }
      const already =
        !force &&
        emp.score_override_jd_id === jdId &&
        typeof emp.score_override === "number";
      if (already) {
        skipped += 1;
        continue;
      }
      try {
        const scored = await scorePersonAgainstJdsWithLlm({
          selectedJdFileName: jd.file_name || "JD",
          selectedJdText: jd.jd_text,
          otherJds: [],
          person: {
            employee_id: emp.employee_id,
            full_name: emp.full_name,
            designation: emp.designation,
            grade: emp.grade,
            skills: emp.skills,
          },
        });
        emp.score = scored.score;
        emp.score_override = scored.score;
        emp.score_override_jd_id = jdId;
        (emp as any).llm_rationale = scored.rationale;
        (emp as any).llm_best_jd = scored.bestJdFileName;
        (emp as any).llm_best_jd_why = scored.bestJdWhy;
        results.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          ...scored,
        });
        await persist(false);
      } catch (err: any) {
        errors.push(`${emp.employee_id}: ${err?.message || "score failed"}`);
        await persist(true);
      }
    }

    await persist(true);

    const nextOffset = offset + batch.length;
    return NextResponse.json({
      success: true,
      jdFileName: jd.file_name,
      scored: results.length,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 8),
      total: scoreTargets.length,
      offset,
      nextOffset,
      done: nextOffset >= scoreTargets.length,
      results,
    });
  } catch (error: any) {
    return jsonPublicError(error, error?.message || "Qwen scoring failed");
  }
}
