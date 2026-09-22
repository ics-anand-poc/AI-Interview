export const runtime = 'nodejs';

import { NextResponse } from "next/server";
import { localLlmBaseUrl, localLlmIsUp, localLlmModelName } from "@/lib/local-llm";
import { layaBaseUrl, layaIsUp } from "@/lib/laya";

export async function GET() {
  const [llmUp, layaUp] = await Promise.all([localLlmIsUp(), layaIsUp()]);
  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: "talentscope-api",
    localLlm: {
      url: localLlmBaseUrl(),
      up: llmUp,
      model: localLlmModelName(),
    },
    laya: {
      url: layaBaseUrl(),
      up: layaUp,
      model: "convaiinnovations/laya",
    },
  });
}
