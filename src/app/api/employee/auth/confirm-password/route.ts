import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync, completeFirstTimeLoginAsync, saveEmployeePasswordAsync, syncEmployeeToSupabase } from "@/lib/employee-auth";
import { getClientIp, isRateLimitedAny, rateLimitedResponse } from "@/lib/security";
import { asBoundedString, asPassword, readJsonObject } from "@/lib/input-validation";
import { jsonPublicError } from "@/lib/api-errors";

function validatePassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ipLimit = isRateLimitedAny([`auth:ip:${ip}`], 8, 60_000);
  if (ipLimit.limited) {
    return rateLimitedResponse(ipLimit, "Too many attempts. Please try again later.");
  }

  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized access or expired session." }, { status: 401 });
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const action = (asBoundedString(parsed.body.action, 20) || "keep").toLowerCase();

    if (action === "keep") {
      await completeFirstTimeLoginAsync(auth.employeeId);
      await syncEmployeeToSupabase(auth.employee);
      return NextResponse.json({
        status: "ok",
        message: "Initial password retained.",
        token: request.headers.get("authorization")?.replace("Bearer ", "") || "",
        employee: { employee_id: auth.employee.employee_id, full_name: auth.employee.full_name }
      });
    }

    if (action === "change") {
      const newPassword = asPassword(parsed.body.password);
      if (!newPassword) {
        return NextResponse.json({ error: "Please enter a new password." }, { status: 400 });
      }
      if (!validatePassword(newPassword)) {
        return NextResponse.json({ error: "Password must be at least 8 characters long, contain uppercase, lowercase, number, and special character." }, { status: 400 });
      }

      const saved = await saveEmployeePasswordAsync(auth.employeeId, newPassword);
      if (!saved) {
        return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
      }

      await syncEmployeeToSupabase(auth.employee);
      return NextResponse.json({
        status: "ok",
        message: "Password updated successfully.",
        token: request.headers.get("authorization")?.replace("Bearer ", "") || "",
        employee: { employee_id: auth.employee.employee_id, full_name: auth.employee.full_name }
      });
    }

    return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
  } catch (e: unknown) {
    return jsonPublicError(e, "Failed to process request.");
  }
}
