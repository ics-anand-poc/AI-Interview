import { NextRequest, NextResponse } from "next/server";
import { getEmployeeAccountAsync, hasPassword, verifyPassword, signToken, syncEmployeeToSupabase } from "@/lib/employee-auth";
import { cacheEmployeeAccount } from "@/services/employee-account-store";
import { getClientIp, isRateLimitedAny, rateLimitedResponse } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";
import { asEmployeeId, asPassword, readJsonObject } from "@/lib/input-validation";
import { jsonPublicError } from "@/lib/api-errors";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const ipLimit = isRateLimitedAny([`auth:ip:${ip}`], 10, 60_000);
  if (ipLimit.limited) {
    return rateLimitedResponse(ipLimit, "Too many login attempts. Please try again later.");
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const employee_id = asEmployeeId(parsed.body.employee_id);
    const password = asPassword(
      typeof parsed.body.password === "string" ? parsed.body.password.trim() : parsed.body.password,
      { allowEmpty: true }
    );

    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }
    if (password === null) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const accountLimit = isRateLimitedAny([`auth:acct:${employee_id.toUpperCase()}`], 8, 60_000);
    if (accountLimit.limited) {
      return rateLimitedResponse(accountLimit, "Too many login attempts. Please try again later.");
    }

    const employee = await getEmployeeAccountAsync(employee_id);
    if (!employee) {
      return NextResponse.json({ error: "Invalid Employee ID" }, { status: 401 });
    }

    const isHashValid = hasPassword(employee) && verifyPassword(password, employee.password_salt ?? "", employee.password_hash ?? "");
    const isFirstLogin = employee.is_first_login ?? (!hasPassword(employee));
    const isBlankPassword = password === "";
    const isEmpIdAsPassword = password.toUpperCase() === employee.employee_id.trim().toUpperCase();

    const isAllowedFirstTime = isFirstLogin && (isBlankPassword || isEmpIdAsPassword || isHashValid);

    if (!isHashValid && !isAllowedFirstTime) {
      await auditLogService.addLog({
        actorEmail: employee.email || employee.employee_id,
        action: "EMPLOYEE_LOGIN_FAILURE",
        target: "Employee Portal",
        details: "Invalid password provided",
        ipAddress: ip
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = signToken(employee.employee_id);
    cacheEmployeeAccount(employee);
    await syncEmployeeToSupabase(employee);

    if (isFirstLogin) {
      await auditLogService.addLog({
        actorEmail: employee.email || employee.employee_id,
        action: "EMPLOYEE_LOGIN_FIRST_TIME_SUCCESS",
        target: "Employee Portal",
        details: "First time login with initial or blank password. Prompting to keep or change password.",
        ipAddress: ip
      });
      return NextResponse.json({
        status: "first_time_modal",
        token,
        employee: { employee_id: employee.employee_id, full_name: employee.full_name }
      });
    }

    await auditLogService.addLog({
      actorEmail: employee.email || employee.employee_id,
      action: "EMPLOYEE_LOGIN_SUCCESS",
      target: "Employee Portal",
      details: "Employee logged in and synced successfully",
      ipAddress: ip
    });

    return NextResponse.json({ status: "ok", token, employee: { employee_id: employee.employee_id, full_name: employee.full_name } });
  } catch (e) {
    return jsonPublicError(e, "Unable to verify credentials");
  }
}
