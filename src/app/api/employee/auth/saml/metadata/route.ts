import { NextResponse } from "next/server";
import { getSamlClient, getSamlSsoConfig } from "@/lib/saml-sso";

// Gives whoever sets up the Azure AD Enterprise Application (Non-gallery
// SAML app) an SP metadata XML they can upload directly instead of
// hand-typing the Entity ID / ACS URL. Safe to expose — contains no secrets.
export async function GET() {
  const { issuer, callbackUrl } = getSamlSsoConfig();
  if (!issuer) {
    return NextResponse.json(
      { error: "Set SAML_ISSUER before requesting SP metadata." },
      { status: 503 }
    );
  }
  try {
    const saml = getSamlClient();
    const xml = saml.generateServiceProviderMetadata(null, null);
    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate SP metadata";
    console.error("SAML metadata error:", error, callbackUrl);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
