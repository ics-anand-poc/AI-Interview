export const runtime = 'nodejs';

import { NextResponse } from "next/server";
import { localLlmBaseUrl, localLlmIsUp, localLlmModelName } from "@/lib/local-llm";

export async function GET() {
  const llmUp = await localLlmIsUp();
  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: "resume-intelligence-api",
    localLlm: {
      url: localLlmBaseUrl(),
      up: llmUp,
      model: localLlmModelName(),
    },
  });
}
