"""
Employee account storage + password hashing, ported from
Frontend/src/lib/employee-auth.ts and employee-account-store.ts.

Scope decision: the original TS code supports two storage modes — Supabase
("useSupabasePrimary") or a local JSON file fallback for offline/local dev.
This port is Supabase-only, matching every other service in Backend/ (none
of which have a local-file fallback) — the local-file mode was a
Next.js-serverless-specific accommodation (surviving cold starts without a
DB) that doesn't apply to this always-on FastAPI process. If you need the
local-file fallback preserved, port readStore()/writeStore() from
employee-auth.ts separately.

Password hashing must stay byte-for-byte compatible with existing rows in
the `employees` table, since it's shared with the (still-live, unmigrated)
Next.js employee-auth flows: Node's `crypto.pbkdf2Sync(password, salt, ...)`
takes `salt` as the base64-encoded *string* itself (its UTF-8 bytes), not
the decoded bytes it represents — hashlib.pbkdf2_hmac() below replicates
that exactly. Getting this wrong wouldn't show up in tests that only create
fresh accounts (as this file's own tests do); it would only break logins
for accounts created by the original Node code, so it's worth flagging
loudly rather than leaving implicit.
"""
import base64
import hashlib
import hmac
import os
from typing import Optional, TypedDict

from services.supabase_client import get_supabase

PBKDF2_ITERATIONS = 120_000
PBKDF2_KEY_LENGTH = 64  # bytes
PBKDF2_DIGEST = "sha512"

EMPLOYEE_COLUMNS = (
    "employee_id, full_name, email, department, role, is_first_login, "
    "password_hash, password_salt, xp_points, streak_days, skill_level, "
    "ai_readiness_score, product, product_qb_eligible, assessment_only"
)


class EmployeeAccount(TypedDict, total=False):
    employee_id: str
    full_name: str
    email: str
    department: str
    role: str
    is_first_login: bool
    password_hash: Optional[str]
    password_salt: Optional[str]
    xp_points: int
    streak_days: int
    skill_level: str
    ai_readiness_score: int
    product: Optional[str]
    product_qb_eligible: bool
    assessment_only: bool


def _normalize_id(employee_id: str) -> str:
    return employee_id.strip().upper()


def hash_password(password: str) -> tuple[str, str]:
    """Returns (hash_b64, salt_b64)."""
    salt_b64 = base64.b64encode(os.urandom(16)).decode("ascii")
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_DIGEST, password.encode("utf-8"), salt_b64.encode("utf-8"), PBKDF2_ITERATIONS, dklen=PBKDF2_KEY_LENGTH
    )
    return base64.b64encode(digest).decode("ascii"), salt_b64


def verify_password(password: str, salt_b64: str, expected_hash_b64: str) -> bool:
    if not salt_b64 or not expected_hash_b64:
        return False
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_DIGEST, password.encode("utf-8"), salt_b64.encode("utf-8"), PBKDF2_ITERATIONS, dklen=PBKDF2_KEY_LENGTH
    )
    candidate_b64 = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(candidate_b64, expected_hash_b64)


def has_password(employee: EmployeeAccount) -> bool:
    return bool(employee.get("password_hash") and employee.get("password_salt"))


def is_product_qb_employee(employee: EmployeeAccount) -> bool:
    if employee.get("role") == "admin":
        return False
    return bool(employee.get("product_qb_eligible"))


def is_assessment_only_employee(employee: EmployeeAccount) -> bool:
    if employee.get("role") == "admin":
        return False
    return bool(employee.get("assessment_only"))


def _map_row(row: dict) -> EmployeeAccount:
    return {
        "employee_id": str(row.get("employee_id") or ""),
        "full_name": str(row.get("full_name") or row.get("employee_id") or ""),
        "email": str(row.get("email") or ""),
        "department": str(row.get("department") or "general"),
        "role": str(row.get("role") or "employee"),
        "is_first_login": bool(row.get("is_first_login") or False),
        "password_hash": row.get("password_hash") or None,
        "password_salt": row.get("password_salt") or None,
        "xp_points": row.get("xp_points") if isinstance(row.get("xp_points"), int) else 0,
        "streak_days": row.get("streak_days") if isinstance(row.get("streak_days"), int) else 0,
        "skill_level": str(row.get("skill_level") or "beginner"),
        "ai_readiness_score": row.get("ai_readiness_score") if isinstance(row.get("ai_readiness_score"), int) else 0,
        "product": row.get("product") or None,
        "product_qb_eligible": bool(row.get("product_qb_eligible") or False),
        "assessment_only": bool(row.get("assessment_only") or False),
    }


def get_employee_account(employee_id: str) -> Optional[EmployeeAccount]:
    res = (
        get_supabase()
        .table("employees")
        .select(EMPLOYEE_COLUMNS)
        .eq("employee_id", employee_id.strip())
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        return None
    return _map_row(res.data)


def add_employee_account(account: EmployeeAccount) -> bool:
    """Creates a bare new-account placeholder (no password set yet) — mirrors
    the auto-provisioning behavior in the original login/set-password routes,
    where a first-ever login for an unknown employee_id creates the row."""
    payload = {
        "employee_id": account["employee_id"],
        "email": account.get("email") or f"{account['employee_id']}@nokia.com",
        "full_name": account.get("full_name") or account["employee_id"],
        "department": account.get("department") or "general",
        "role": account.get("role") or "employee",
        "is_first_login": account.get("is_first_login", True),
        "password_hash": account.get("password_hash") or None,
        "password_salt": account.get("password_salt") or None,
        "xp_points": account.get("xp_points", 0),
        "streak_days": account.get("streak_days", 0),
        "skill_level": account.get("skill_level") or "beginner",
        "ai_readiness_score": account.get("ai_readiness_score", 0),
    }
    try:
        get_supabase().table("employees").upsert(payload, on_conflict="employee_id").execute()
        return True
    except Exception as err:
        print(f"Failed to create employee account {account['employee_id']}: {err}")
        return False


def save_employee_password(
    employee_id: str, password: str, full_name: Optional[str] = None, email: Optional[str] = None
) -> Optional[EmployeeAccount]:
    employee = get_employee_account(employee_id)
    if not employee:
        return None

    hash_b64, salt_b64 = hash_password(password)
    employee["password_hash"] = hash_b64
    employee["password_salt"] = salt_b64
    employee["is_first_login"] = False
    employee["product_qb_eligible"] = True
    if full_name and full_name.strip():
        employee["full_name"] = full_name.strip()
    if email and email.strip():
        employee["email"] = email.strip()

    payload = {
        "employee_id": employee["employee_id"],
        "email": employee.get("email") or f"{employee['employee_id']}@nokia.com",
        "full_name": employee.get("full_name") or employee["employee_id"],
        "department": employee.get("department") or "general",
        "role": employee.get("role") or "employee",
        "is_first_login": False,
        "password_hash": hash_b64,
        "password_salt": salt_b64,
        "product_qb_eligible": True,
    }
    try:
        get_supabase().table("employees").upsert(payload, on_conflict="employee_id").execute()
    except Exception as err:
        print(f"Failed to save password for {employee_id}: {err}")
        return None
    return employee


def complete_first_time_login(employee_id: str) -> Optional[EmployeeAccount]:
    employee = get_employee_account(employee_id)
    if not employee:
        return None
    employee["is_first_login"] = False
    try:
        get_supabase().table("employees").update({"is_first_login": False}).eq(
            "employee_id", employee["employee_id"]
        ).execute()
    except Exception as err:
        print(f"Failed to complete first-time login for {employee_id}: {err}")
    return employee
