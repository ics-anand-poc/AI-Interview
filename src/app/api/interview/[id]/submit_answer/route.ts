export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { interviewService } from '@/services/interview-service';
import { asPathId } from '@/lib/input-validation';
import { logServerError, publicErrorMessage } from '@/lib/api-errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = asPathId(rawId);
    if (!id) {
      return NextResponse.json({ status: "error", message: "Invalid interview id" }, { status: 400 });
    }
    const data = await request.json();
    
    let question_index = parseInt(data.question_index);
    if (isNaN(question_index)) {
      return NextResponse.json({ status: "error", message: "question_index must be an integer" }, { status: 400 });
    }

    let question = data.question;
    if (!question || typeof question !== 'string' || question.length > 20000) {
      return NextResponse.json({ status: "error", message: "question text is required" }, { status: 400 });
    }

    let answer = data.answer || "";
    if (typeof answer !== 'string') answer = String(answer);
    if (answer.length > 100000) {
      return NextResponse.json({ status: "error", message: "Answer is too long" }, { status: 400 });
    }

    await interviewService.evaluateAnswer(id, question_index, question, answer);

    return NextResponse.json({ status: "success" });
  } catch (err: unknown) {
    logServerError("interview/submit_answer", err);
    return NextResponse.json({ status: "error", message: publicErrorMessage(err, "Submit failed") }, { status: 500 });
  }
}
