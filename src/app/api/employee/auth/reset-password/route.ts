import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/employee-auth";
import fs from "fs";
import path from "path";
import { getClientIp, isRateLimitedAny, rateLimitedResponse } from "@/lib/security";
import { asEmail, asEmployeeId, asPassword, readJsonObject } from "@/lib/input-validation";
import { jsonPublicError } from "@/lib/api-errors";

const STATIC_ACCOUNT_FILE = path.join(process.cwd(), "src", "data", "employee-accounts.json");
function getAccountFilePath() {
  if (process.env.VERCEL === "1") {
    return "/tmp/employee-accounts.json";
  }
  return STATIC_ACCOUNT_FILE;
}

function readStore() {
  const filePath = getAccountFilePath();
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function validatePassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ipLimit = isRateLimitedAny([`auth:ip:${ip}`], 8, 60_000);
  if (ipLimit.limited) {
    return rateLimitedResponse(ipLimit, "Too many attempts. Please try again later.");
  }

  try {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const employee_id = asEmployeeId(parsed.body.employee_id);
    const email = asTrimmedEmailOrEmpty(parsed.body.email);
    const password = asPassword(parsed.body.password);

    if (!employee_id) {
      return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }
    if (password === null) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const accountLimit = isRateLimitedAny([`auth:acct:${employee_id.toUpperCase()}`], 5, 60_000);
    if (accountLimit.limited) {
      return rateLimitedResponse(accountLimit, "Too many attempts. Please try again later.");
    }

    const store = readStore();
    const employee = store.employees.find((item: { employee_id?: string }) => item.employee_id?.trim().toUpperCase() === employee_id.toUpperCase());

    if (!employee) {
      return NextResponse.json({ error: "Employee ID not found" }, { status: 404 });
    }

    if (employee.email) {
      if (!email || employee.email.toLowerCase().trim() !== email.toLowerCase().trim()) {
        return NextResponse.json({ error: "Provided email does not match our records for this Employee ID" }, { status: 400 });
      }
    }

    if (!validatePassword(password)) {
      return NextResponse.json({ error: "Password does not meet the strength requirements (Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char)" }, { status: 400 });
    }

    const { hash, salt } = hashPassword(password);
    employee.password_hash = hash;
    employee.password_salt = salt;
    employee.is_first_login = false;

    const filePath = getAccountFilePath();
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");

    return NextResponse.json({ status: "ok", message: "Password reset successful" });
  } catch (error: unknown) {
    return jsonPublicError(error, "Unable to reset password");
  }
}

function asTrimmedEmailOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return asEmail(value) || "";
}
