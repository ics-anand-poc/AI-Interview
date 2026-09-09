const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_ID_RE = /^[A-Za-z0-9._-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export const INPUT_LIMITS = {
  email: 254,
  password: 256,
  employeeId: 40,
  name: 120,
  filename: 180,
  textField: 2000,
  jsonBodyChars: 200_000,
  jdText: 500_000,
} as const;

export function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function asBoundedString(value: unknown, max: number, min = 0): string | null {
  if (typeof value !== "string") return null;
  if (value.length < min || value.length > max) return null;
  return value;
}

export function asEmail(value: unknown): string | null {
  const email = asTrimmedString(value, INPUT_LIMITS.email).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}

export function asInfiniteEmail(value: unknown): string | null {
  const email = asEmail(value);
  if (!email || !email.endsWith("@infinite.com")) return null;
  return email;
}

export function asEmployeeId(value: unknown): string | null {
  const id = asTrimmedString(value, INPUT_LIMITS.employeeId);
  if (!id || !EMPLOYEE_ID_RE.test(id)) return null;
  return id;
}

export function asUuid(value: unknown): string | null {
  const id = asTrimmedString(value, 36);
  if (!UUID_RE.test(id)) return null;
  return id;
}

/** Safe id for filesystem / storage object names (UUIDs, employee test ids). */
export function asPathId(value: unknown): string | null {
  const id = asTrimmedString(value, 80);
  if (!id || !PATH_ID_RE.test(id)) return null;
  return id;
}

export function asPassword(value: unknown, opts?: { allowEmpty?: boolean }): string | null {
  if (typeof value !== "string") return null;
  if (value.length > INPUT_LIMITS.password) return null;
  if (!opts?.allowEmpty && value.length === 0) return null;
  return value;
}

export function parseJsonObject(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export async function readJsonObject(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > INPUT_LIMITS.jsonBodyChars) {
    return { ok: false, error: "Request body is too large" };
  }
  try {
    const body = await request.json();
    const obj = parseJsonObject(body);
    if (!obj) return { ok: false, error: "Invalid JSON payload" };
    return { ok: true, body: obj };
  } catch {
    return { ok: false, error: "Invalid JSON payload" };
  }
}
