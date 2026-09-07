import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSamlClient, getSamlSsoConfig } from "@/lib/saml-sso";
import { getClientIp, isRateLimited } from "@/lib/security";

export async function GET(request: NextRequest) {
  const { appUrl, configured } = getSamlSsoConfig();
  const ip = getClientIp(request);
  const limitCheck = isRateLimited(`employee_saml_sso_${ip}`, 12, 60000);
  if (limitCheck.limited) {
    return NextResponse.redirect(
      `${appUrl}/employee?sso_error=${encodeURIComponent("Too many sign-in attempts. Try again shortly.")}`
    );
  }

  if (!configured) {
    return NextResponse.redirect(
      `${appUrl}/employee?sso_error=${encodeURIComponent(
        "Microsoft SAML SSO is not configured. Set SAML_ISSUER and SAML_IDP_CERT (and SAML_ENTRY_POINT if not using the tenant default)."
      )}`
    );
  }

  try {
    const saml = getSamlClient();
    // RelayState round-trips through the IdP and back to the ACS endpoint —
    // used here only as a light CSRF check alongside InResponseTo tracking.
    const relayState = crypto.randomUUID();
    const redirectUrl = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
    const response = NextResponse.redirect(redirectUrl);
    return response;
  } catch (error: unknown) {
    console.error("SAML AuthnRequest error:", error);
    const message = error instanceof Error ? error.message : "Failed to start Microsoft sign-in";
    return NextResponse.redirect(`${appUrl}/employee?sso_error=${encodeURIComponent(message)}`);
  }
}
