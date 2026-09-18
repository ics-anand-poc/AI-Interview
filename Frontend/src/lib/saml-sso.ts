// SAML 2.0 SSO for the Employee Portal, using Microsoft Entra ID (Azure AD)
// as the Identity Provider. Replaces the earlier OIDC (authorization-code)
// implementation — Entra ID is configured as a SAML app instead of an app
// registration with a client secret.
//
// Required env vars (see .env.example / .env.azure.example):
//   MICROSOFT_TENANT_ID   - Azure AD tenant ID (used to derive the default
//                            entry point if SAML_ENTRY_POINT isn't set)
//   SAML_ENTRY_POINT      - IdP SSO URL. Defaults to
//                            https://login.microsoftonline.com/{tenant}/saml2
//   SAML_ISSUER           - SP Entity ID / Identifier — must match what's
//                            registered on the Entra ID Enterprise
//                            Application's "Identifier (Entity ID)" field
//   SAML_IDP_CERT         - IdP's SAML signing certificate (base64 DER or
//                            PEM, no BEGIN/END wrapper needed) from the
//                            Entra ID app's "SAML Signing Certificate"
//                            section. Required — assertions are rejected
//                            without it.
//   SAML_CALLBACK_URL     - optional override; defaults to
//                            {NEXT_PUBLIC_APP_URL}/api/employee/auth/saml/acs
//   SAML_SP_PRIVATE_KEY / SAML_SP_CERT - optional, only needed if the IdP
//                            requires signed AuthnRequests
//
// SSO stays disabled (redirects with a clear config error) until
// SAML_ISSUER and SAML_IDP_CERT are both set.

import { SAML, type SamlConfig, type Profile, ValidateInResponseTo } from "@node-saml/node-saml";

export function getSamlSsoConfig() {
  const tenant = String(process.env.MICROSOFT_TENANT_ID || "").trim();
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const entryPoint =
    String(process.env.SAML_ENTRY_POINT || "").trim() ||
    (tenant ? `https://login.microsoftonline.com/${tenant}/saml2` : "");
  const issuer = String(process.env.SAML_ISSUER || "").trim();
  const idpCert = String(process.env.SAML_IDP_CERT || "").trim();
  const callbackUrl =
    String(process.env.SAML_CALLBACK_URL || "").trim() || `${appUrl}/api/employee/auth/saml/acs`;
  const spPrivateKey = String(process.env.SAML_SP_PRIVATE_KEY || "").trim();
  const spCert = String(process.env.SAML_SP_CERT || "").trim();

  return {
    tenant,
    appUrl,
    entryPoint,
    issuer,
    idpCert,
    callbackUrl,
    spPrivateKey,
    spCert,
    // Both the SP identifier and the IdP's signing cert are required before
    // we'll attempt the flow — without idpCert we cannot verify assertions
    // are genuinely from Microsoft, and the tenant ID alone isn't enough.
    configured: Boolean(entryPoint && issuer && idpCert),
  };
}

let cachedSaml: SAML | null = null;
let cachedKey = "";

export function getSamlClient(): SAML {
  const cfg = getSamlSsoConfig();
  const cacheKey = JSON.stringify([cfg.entryPoint, cfg.issuer, cfg.idpCert, cfg.callbackUrl, cfg.spPrivateKey]);
  if (cachedSaml && cachedKey === cacheKey) return cachedSaml;

  const samlConfig: SamlConfig = {
    entryPoint: cfg.entryPoint,
    issuer: cfg.issuer,
    callbackUrl: cfg.callbackUrl,
    idpCert: cfg.idpCert,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs: 5 * 60 * 1000,
    // Track each AuthnRequest's ID (in-memory cache) so a captured
    // SAMLResponse can't be replayed later. "ifPresent" rather than
    // "always" so IdP-initiated logins (no prior request on our side)
    // still work.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
  };
  if (cfg.spPrivateKey) {
    samlConfig.privateKey = cfg.spPrivateKey;
    if (cfg.spCert) samlConfig.publicCert = cfg.spCert;
  }

  cachedSaml = new SAML(samlConfig);
  cachedKey = cacheKey;
  return cachedSaml;
}

/** Both possible email-ish identifiers a Microsoft SAML assertion can carry, lower-cased and de-duped. */
export function samlEmails(profile: Profile): string[] {
  const values = [profile.nameID, profile.email, profile.mail]
    .map((value) => String(value || "").trim())
    .filter((value) => value.includes("@"));
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

export function samlLocalPart(profile: Profile): string {
  const identifier = String(profile.nameID || profile.email || profile.mail || "").trim();
  return identifier.split("@")[0]?.trim() || "";
}

export const samlSsoCookies = {
  relayState: "saml_sso_relay",
  handoff: "saml_sso_handoff",
};

export function ssoCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
