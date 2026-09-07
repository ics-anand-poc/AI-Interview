import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/employee-auth";
import { samlSsoCookies, ssoCookieOptions } from "@/lib/saml-sso";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(samlSsoCookies.handoff)?.value || "";
  const employeeId = token ? verifyToken(token) : null;
  const response = NextResponse.json(
    employeeId && token
      ? { status: "ok", token }
      : { error: "Microsoft sign-in session expired. Please try again." },
    { status: employeeId && token ? 200 : 401 }
  );
  // One-time use: clear the handoff cookie whether or not it was valid.
  response.cookies.set(samlSsoCookies.handoff, "", { ...ssoCookieOptions(0), maxAge: 0 });
  return response;
}
