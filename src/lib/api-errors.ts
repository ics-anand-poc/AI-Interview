import { NextResponse } from "next/server";

const LEAK_RE =
  /at\s+\S+\s+\(|[A-Z]:\\|\/home\/|\/var\/|\/tmp\/|node_modules|postgres|sqlstate|permission denied for|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|supabase\.co|service_role|stack trace/i;

export function logServerError(scope: string, error: unknown): void {
  console.error(`[${scope}]`, error);
}

export function isSafeClientMessage(message: string): boolean {
  const msg = String(message || "").trim();
  if (!msg || msg.length > 320) return false;
  if (LEAK_RE.test(msg)) return false;
  if (msg.includes("\n") && msg.length > 160) return false;
  return true;
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (isSafeClientMessage(msg)) return msg;
  return fallback;
}

export function jsonPublicError(
  error: unknown,
  fallback: string,
  status = 500,
  extra?: Record<string, unknown>
): NextResponse {
  logServerError("api", error);
  return NextResponse.json(
    { ...extra, error: publicErrorMessage(error, fallback) },
    { status }
  );
}
