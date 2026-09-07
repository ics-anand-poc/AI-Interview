import { NextResponse } from "next/server";

// Replaced by real Microsoft Entra ID SSO (see /api/employee/auth/microsoft).
// This route previously accepted any email address, auto-provisioned a new
// employee account for it with zero verification, and signed a valid
// session token — kept only as a disabled stub so old clients/bookmarks
// get a clear error instead of a silent 404.
export async function POST() {
  return NextResponse.json(
    { error: "Use Sign in with Microsoft. Email-only SSO is disabled." },
    { status: 410 }
  );
}
