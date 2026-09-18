import { NextRequest, NextResponse } from "next/server";
import { getEmployeeAccountAsync, getEmployeeByEmailAsync, signToken, syncEmployeeToSupabase } from "@/lib/employee-auth";
import { cacheEmployeeAccount } from "@/services/employee-account-store";
import { getSamlClient, getSamlSsoConfig, samlEmails, samlLocalPart, samlSsoCookies, ssoCookieOptions } from "@/lib/saml-sso";
import { getClientIp, isRateLimited } from "@/lib/security";
import { auditLogService } from "@/services/audit-log-service";

function errorRedirect(message: string) {
  const { appUrl } = getSamlSsoConfig();
  return NextResponse.redirect(`${appUrl}/employee?sso_error=${encodeURIComponent(message)}`);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limitCheck = isRateLimited(`employee_saml_sso_acs_${ip}`, 20, 60000);
  if (limitCheck.limited) {
    return errorRedirect("Too many sign-in attempts. Try again shortly.");
  }

  const { configured } = getSamlSsoConfig();
  if (!configured) {
    return errorRedirect("Microsoft SAML SSO is not configured.");
  }

  let body: Record<string, string> = {};
  try {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") body[key] = value;
    }
  } catch {
    return errorRedirect("Malformed SAML response.");
  }

  if (!body.SAMLResponse) {
    return errorRedirect("Missing SAML response from Microsoft.");
  }

  try {
    const saml = getSamlClient();
    // Verifies the XML signature against SAML_IDP_CERT, checks
    // NotBefore/NotOnOrAfter and Audience conditions, and (with
    // validateInResponseTo above) rejects replayed responses.
    const { profile, loggedOut } = await saml.validatePostResponseAsync(body);
    if (loggedOut || !profile) {
      return errorRedirect("Microsoft sign-in did not return a valid session.");
    }

    const emails = samlEmails(profile);

    // Match the signed-in Microsoft account to an existing Employee Portal
    // roster record — by email first, then by Employee ID derived from the
    // NameID local-part. No account is ever auto-created here: SSO only
    // grants access to people HR has already provisioned.
    let employee = null;
    for (const email of emails) {
      employee = await getEmployeeByEmailAsync(email);
      if (employee) break;
    }
    if (!employee) {
      const local = samlLocalPart(profile);
      if (local) employee = await getEmployeeAccountAsync(local);
    }

    if (!employee) {
      await auditLogService.addLog({
        actorEmail: emails[0] || profile.nameID || "unknown",
        action: "EMPLOYEE_SAML_SSO_FAILURE",
        target: "Employee Portal",
        details: "Microsoft account is not linked to an Employee Portal roster email or ID.",
        ipAddress: ip,
      });
      return errorRedirect(
        "No Employee Portal account is linked to this Microsoft email. Sign in with your Employee ID or ask HR to map your work email."
      );
    }

    const token = signToken(employee.employee_id);
    cacheEmployeeAccount(employee);
    await syncEmployeeToSupabase(employee);
    await auditLogService.addLog({
      actorEmail: employee.email || emails[0] || employee.employee_id,
      action: "EMPLOYEE_SAML_SSO_SUCCESS",
      target: "Employee Portal",
      details: `Microsoft SAML SSO login as ${employee.full_name} (${employee.employee_id}).`,
      ipAddress: ip,
    });

    // Hand the session token off via a short-lived httpOnly cookie rather
    // than a redirect query string (the ACS response is a same-site POST,
    // so a Set-Cookie here is reliably applied before the next GET).
    const { appUrl } = getSamlSsoConfig();
    const response = NextResponse.redirect(`${appUrl}/employee/sso-complete`, { status: 303 });
    response.cookies.set(samlSsoCookies.handoff, token, ssoCookieOptions(120));
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Microsoft SAML SSO failed";
    console.error("SAML ACS error:", error);
    return errorRedirect(message);
  }
}
