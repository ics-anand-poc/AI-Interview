import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/employee-auth";
import { getClientIp, isRateLimitedAny, rateLimitedResponse } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";
import { authenticateAdminCredentials } from "@/lib/admin-accounts-server";
import { asEmail, asPassword, readJsonObject } from "@/lib/input-validation";
import { jsonPublicError } from "@/lib/api-errors";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const ipLimit = isRateLimitedAny([`auth:ip:${ip}`], 8, 60_000);
  if (ipLimit.limited) {
    return rateLimitedResponse(ipLimit, "Too many login attempts. Please try again later.");
  }

  try {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const email = asEmail(parsed.body.email);
    const password = asPassword(parsed.body.password, { allowEmpty: true });
    if (password === null) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!email || !email.endsWith("@infinite.com")) {
      await auditLogService.addLog({
        actorEmail: email || "unknown",
        action: "ADMIN_LOGIN_FAILURE",
        target: "Admin Console",
        details: "Unauthorized email domain extension",
        ipAddress: ip
      });
      return NextResponse.json(
        { error: "Unauthorized domain. Please enter your @infinite.com email." },
        { status: 400 }
      );
    }

    const accountLimit = isRateLimitedAny([`auth:acct:${email}`], 5, 60_000);
    if (accountLimit.limited) {
      return rateLimitedResponse(accountLimit, "Too many login attempts. Please try again later.");
    }

    const access = await authenticateAdminCredentials(email, password);
    if (access) {
      // 1 hour session time-bound token
      const token = signToken("admin", 1 * 60 * 60 * 1000);
      
      await auditLogService.addLog({
        actorEmail: access.email,
        action: "ADMIN_LOGIN_SUCCESS",
        target: "Admin Console",
        details: access.canViewEmployeePortal
          ? "Admin session generated successfully"
          : "Admin session generated without Employee Portal access",
        ipAddress: ip
      });

      return NextResponse.json({
        status: "ok",
        token,
        canViewEmployeePortal: access.canViewEmployeePortal,
        canChangePassword: access.canChangePassword,
      });
    } else {
      await auditLogService.addLog({
        actorEmail: email,
        action: "ADMIN_LOGIN_FAILURE",
        target: "Admin Console",
        details: "Invalid password provided",
        ipAddress: ip
      });
      return NextResponse.json({ error: "Invalid Password" }, { status: 401 });
    }
  } catch (error: unknown) {
    return jsonPublicError(error, "Unable to sign in");
  }
}
