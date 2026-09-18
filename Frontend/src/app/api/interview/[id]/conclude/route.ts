export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/services/session-service';
import { resumeService } from '@/services/resume-service';
import { interviewCSVService } from '@/services/interview-csv-service';
import { interviewService } from '@/services/interview-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resume = await resumeService.getCachedResume(id, true);
    if (!resume) {
      return NextResponse.json({ error: 'Resume record not found' }, { status: 404 });
    }

    const email = resume.parsed?.personal?.email;
    if (email) {
      await sessionService.markEmailSessionUsed(email);
      // Auto-sync interview results to CSV after status is marked Completed
      await interviewCSVService.syncAllInterviewsToCSV();
    }

    // Synthesize a holistic, recruiter-facing interview summary from the per-question
    // scores now that the interview is complete. Failure here must never block the
    // candidate's conclude flow, so it's caught and logged rather than surfaced.
    interviewService.generateOverallFeedback(id).catch((err) => {
      console.error('Failed to generate overall interview feedback:', err);
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Conclude interview error:', error);
    return NextResponse.json({ error: error.message || 'Conclude failed' }, { status: 500 });
  }
}
