import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { getClientIp, isRateLimited, rateLimitedResponse } from "@/lib/security";
import { asEmail, asPassword, readJsonObject } from "@/lib/input-validation";
import { auditLogService } from "@/services/audit-log-service";
import { adminCanChangePassword, changeNamedAdminPassword } from "@/lib/admin-accounts-server";

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const limitCheck = isRateLimited(`admin_change_password_${ip}`, 5, 60000);
  if (limitCheck.limited) {
    return rateLimitedResponse(limitCheck, "Too many attempts. Please try again later.");
  }

  try {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const email = asEmail(parsed.body.email) || "";
    const currentPassword = asPassword(
      typeof parsed.body.currentPassword === "string" ? parsed.body.currentPassword : "",
      { allowEmpty: true }
    );
    const newPassword = asPassword(
      typeof parsed.body.newPassword === "string" ? parsed.body.newPassword : "",
      { allowEmpty: true }
    );
    if (currentPassword === null || newPassword === null) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!(await adminCanChangePassword(email))) {
      await auditLogService.addLog({
        actorEmail: email || "unknown",
        action: "ADMIN_PASSWORD_CHANGE_DENIED",
        target: "Admin Console",
        details: "Account is not allowed to change password",
        ipAddress: ip,
      });
      return NextResponse.json(
        { error: "This account cannot change its password here." },
        { status: 403 }
      );
    }

    const result = await changeNamedAdminPassword(email, currentPassword, newPassword);
    if (!result.ok) {
      await auditLogService.addLog({
        actorEmail: email,
        action: "ADMIN_PASSWORD_CHANGE_FAILURE",
        target: "Admin Console",
        details: result.error,
        ipAddress: ip,
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await auditLogService.addLog({
      actorEmail: email,
      action: "ADMIN_PASSWORD_CHANGE_SUCCESS",
      target: "Admin Console",
      details: "Named admin password updated",
      ipAddress: ip,
    });

    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("Admin password change error:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
