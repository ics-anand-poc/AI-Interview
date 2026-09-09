import { NextRequest, NextResponse } from "next/server";
import { INPUT_LIMITS } from "@/lib/input-validation";

export function checkCsrf(request: NextRequest): boolean {
  const method = request.method;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return true;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (!origin && !referer) {
    return false;
  }

  const targetOrigin = origin || (referer ? new URL(referer).origin : "");
  if (!targetOrigin) return false;

  const hostUrl = new URL(request.url).origin;
  return targetOrigin === hostUrl;
}

type RateRecord = {
  count: number;
  resetTime: number;
  strikes: number;
  blockedUntil: number;
};

const tracker = new Map<string, RateRecord>();

if (typeof setInterval !== "undefined" && !(globalThis as unknown as { __rlCleanup?: boolean }).__rlCleanup) {
  (globalThis as unknown as { __rlCleanup?: boolean }).__rlCleanup = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of tracker.entries()) {
      if (now > val.resetTime && now > val.blockedUntil) {
        tracker.delete(key);
      }
    }
  }, 60000);
}

export type RateLimitTier = "auth" | "public" | "user" | "upload";

export const RATE_LIMIT_TIERS: Record<RateLimitTier, { limit: number; windowMs: number }> = {
  auth: { limit: 8, windowMs: 60_000 },
  public: { limit: 90, windowMs: 60_000 },
  user: { limit: 240, windowMs: 60_000 },
  upload: { limit: 60, windowMs: 60 * 60_000 },
};

export function isRateLimited(
  ip: string,
  limit = 60,
  windowMs = 60000
): { limited: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const record = tracker.get(ip);

  if (record && now < record.blockedUntil) {
    return { limited: true, remaining: 0, reset: record.blockedUntil };
  }

  if (!record || now > record.resetTime) {
    const resetTime = now + windowMs;
    tracker.set(ip, {
      count: 1,
      resetTime,
      strikes: record && now > (record.blockedUntil || 0) ? Math.max(0, record.strikes - 1) : 0,
      blockedUntil: 0,
    });
    return { limited: false, remaining: limit - 1, reset: resetTime };
  }

  if (record.count >= limit) {
    record.strikes = Math.min(record.strikes + 1, 6);
    const backoffMs = windowMs * Math.pow(2, Math.min(record.strikes - 1, 4));
    record.blockedUntil = now + backoffMs;
    record.resetTime = record.blockedUntil;
    return { limited: true, remaining: 0, reset: record.blockedUntil };
  }

  record.count++;
  return { limited: false, remaining: limit - record.count, reset: record.resetTime };
}

/** Per-IP and optional per-account check. First limited key wins. */
export function isRateLimitedAny(
  keys: Array<string | null | undefined>,
  limit: number,
  windowMs: number
): { limited: boolean; remaining: number; reset: number } {
  let worst: { limited: boolean; remaining: number; reset: number } = {
    limited: false,
    remaining: limit,
    reset: Date.now() + windowMs,
  };
  for (const key of keys) {
    if (!key) continue;
    const result = isRateLimited(key, limit, windowMs);
    if (result.limited) return result;
    if (result.remaining < worst.remaining) worst = result;
  }
  return worst;
}

export function rateLimitedResponse(
  check: { reset: number },
  message = "Too many attempts. Please try again later."
): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((check.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: message, message },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Reset": String(Math.ceil(check.reset / 1000)),
      },
    }
  );
}

export function checkTierRateLimit(
  request: NextRequest,
  tier: RateLimitTier,
  accountKey?: string | null
): NextResponse | null {
  const { limit, windowMs } = RATE_LIMIT_TIERS[tier];
  const ip = getClientIp(request);
  const check = isRateLimitedAny(
    [`${tier}:ip:${ip}`, accountKey ? `${tier}:acct:${accountKey}` : null],
    limit,
    windowMs
  );
  if (!check.limited) return null;
  return rateLimitedResponse(check);
}

export function validateFileSignature(buffer: Buffer, filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext || !buffer || buffer.length === 0) return false;

  const header = buffer.toString("hex", 0, 8).toUpperCase();
  const prefix4 = header.slice(0, 8);

  if (ext === "pdf") {
    return prefix4.startsWith("25504446");
  }
  if (ext === "docx" || ext === "xlsx" || ext === "xlsm" || ext === "zip") {
    return prefix4.startsWith("504B0304") || prefix4.startsWith("504B0506") || prefix4.startsWith("504B0708");
  }
  if (ext === "doc" || ext === "xls") {
    return prefix4.startsWith("D0CF11E0");
  }
  if (ext === "png") {
    return prefix4.startsWith("89504E47");
  }
  if (ext === "jpg" || ext === "jpeg") {
    return prefix4.startsWith("FFD8FF");
  }
  if (ext === "webm" || ext === "mkv") {
    return prefix4.startsWith("1A45DFA3");
  }
  if (ext === "txt" || ext === "html" || ext === "htm" || ext === "csv") {
    try {
      const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
      return !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(sample);
    } catch {
      return false;
    }
  }
  return false;
}

export const UPLOAD_ALLOWED_EXTS = [
  "pdf",
  "doc",
  "docx",
  "txt",
  "html",
  "htm",
  "xlsx",
  "xls",
  "csv",
  "zip",
] as const;

export function safeStorageFileName(name: string): string {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const cleaned = base.replace(/\0/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) {
    return "";
  }
  if (cleaned.length <= INPUT_LIMITS.filename) return cleaned;
  const ext = cleaned.includes(".") ? cleaned.slice(cleaned.lastIndexOf(".")) : "";
  return `${cleaned.slice(0, Math.max(1, INPUT_LIMITS.filename - ext.length))}${ext}`;
}

export function inspectUpload(
  buffer: Buffer,
  filename: string,
  opts: { maxBytes: number; allowedExts?: readonly string[] }
): { ok: true; safeName: string } | { ok: false; error: string } {
  const safeName = safeStorageFileName(filename);
  if (!safeName) {
    return { ok: false, error: "Invalid file name" };
  }
  const ext = safeName.split(".").pop()?.toLowerCase() || "";
  const allowed = opts.allowedExts || UPLOAD_ALLOWED_EXTS;
  if (!allowed.includes(ext)) {
    return { ok: false, error: "Invalid file type" };
  }
  if (!buffer || buffer.length === 0) {
    return { ok: false, error: "File is empty" };
  }
  if (buffer.length > opts.maxBytes) {
    return { ok: false, error: `File too large (max ${Math.round(opts.maxBytes / (1024 * 1024))}MB)` };
  }
  if (!validateFileSignature(buffer, safeName)) {
    return { ok: false, error: "File verification failed: content does not match the file type" };
  }
  return { ok: true, safeName };
}

export function getClientIp(request: NextRequest): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }
  return (request as NextRequest & { ip?: string }).ip || "127.0.0.1";
}
