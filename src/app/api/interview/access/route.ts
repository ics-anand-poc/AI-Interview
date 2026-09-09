export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/services/session-service';
import { resumeService } from '@/services/resume-service';
import { getClientIp, isRateLimitedAny, rateLimitedResponse } from '@/lib/security';
import { asEmail, readJsonObject } from '@/lib/input-validation';
import { logServerError } from '@/lib/api-errors';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ipLimit = isRateLimitedAny([`public:ip:${ip}`], 30, 60_000);
  if (ipLimit.limited) {
    return rateLimitedResponse(ipLimit, "Too many attempts. Please try again later.");
  }

  try {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, message: parsed.error }, { status: 400 });
    }
    const cleanEmail = asEmail(parsed.body.email);
    if (!cleanEmail) {
      return NextResponse.json({ success: false, message: 'Email address is required' }, { status: 400 });
    }

    const accountLimit = isRateLimitedAny([`public:acct:${cleanEmail}`], 15, 60_000);
    if (accountLimit.limited) {
      return rateLimitedResponse(accountLimit, "Too many attempts. Please try again later.");
    }

    const session = await sessionService.getSessionByEmail(cleanEmail);

    if (!session) {
      return NextResponse.json({
        success: false,
        message: 'This email is not registered for an interview session. Please contact HR or ensure it matches the email on your CV.'
      }, { status: 404 });
    }

    if (session.used) {
      return NextResponse.json({
        success: false,
        message: 'You have already completed this interview. Duplicate participation or re-entry is not permitted.'
      }, { status: 403 });
    }

    // Verify if the associated resume exists
    if (session.resumeId) {
      const resume = await resumeService.getCachedResume(session.resumeId);
      if (!resume) {
        return NextResponse.json({
          success: false,
          message: 'Associated resume record was not found. Please contact HR.'
        }, { status: 404 });
      }
    }

    return NextResponse.json({
      success: true,
      resumeId: session.resumeId
    });
  } catch (error: unknown) {
    logServerError("interview/access", error);
    return NextResponse.json({ success: false, message: "Verification failed" }, { status: 500 });
  }
}
