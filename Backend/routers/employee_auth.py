import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import extract_bearer_token, require_employee, sign_token, verify_token
from security import get_client_ip, is_rate_limited
from services import employee_account_service as accounts
from services.audit_log import add_log

router = APIRouter(prefix="/api/employee/auth", tags=["employee-auth"])

PASSWORD_RE = {
    "upper": re.compile(r"[A-Z]"),
    "lower": re.compile(r"[a-z]"),
    "digit": re.compile(r"[0-9]"),
    "special": re.compile(r"[^A-Za-z0-9]"),
}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _validate_password_strength(password: str) -> bool:
    return (
        len(password) >= 8
        and bool(PASSWORD_RE["upper"].search(password))
        and bool(PASSWORD_RE["lower"].search(password))
        and bool(PASSWORD_RE["digit"].search(password))
        and bool(PASSWORD_RE["special"].search(password))
    )


class LoginRequest(BaseModel):
    employee_id: str
    password: str = ""


@router.post("/login")
def login(request: Request, body: LoginRequest):
    ip = get_client_ip(request)
    if is_rate_limited(f"employee_login_{ip}", limit=10, window_seconds=60):
        return JSONResponse(status_code=429, content={"error": "Too many login attempts. Please try again after a minute."})

    employee_id = (body.employee_id or "").strip()
    if not employee_id:
        return JSONResponse(status_code=400, content={"error": "Employee ID is required"})

    try:
        employee = accounts.get_employee_account(employee_id)
        if not employee:
            accounts.add_employee_account({"employee_id": employee_id, "full_name": employee_id, "email": "", "is_first_login": True})
            employee = accounts.get_employee_account(employee_id)
    except Exception as err:
        return JSONResponse(status_code=503, content={"error": "Service temporarily unavailable. Please try again shortly.", "detail": str(err)})

    if not employee or not accounts.has_password(employee) or employee.get("is_first_login"):
        add_log(employee.get("email") or employee_id if employee else employee_id, "EMPLOYEE_LOGIN_FIRST_TIME", "Employee Portal", "Redirected to set initial password", ip)
        return {"status": "first_time", "employee": {"employee_id": employee_id, "full_name": (employee or {}).get("full_name", employee_id)}}

    if not accounts.verify_password(body.password, employee.get("password_salt") or "", employee.get("password_hash") or ""):
        add_log(employee.get("email") or employee["employee_id"], "EMPLOYEE_LOGIN_FAILURE", "Employee Portal", "Invalid password provided", ip)
        return JSONResponse(status_code=401, content={"error": "Invalid credentials"})

    token = sign_token(employee["employee_id"])
    add_log(employee.get("email") or employee["employee_id"], "EMPLOYEE_LOGIN_SUCCESS", "Employee Portal", "Employee logged in successfully", ip)
    return {"status": "ok", "token": token, "employee": {"employee_id": employee["employee_id"], "full_name": employee.get("full_name")}}


@router.get("/validate")
def validate(employee_id: str = Depends(require_employee)):
    try:
        employee = accounts.get_employee_account(employee_id)
    except Exception as err:
        return JSONResponse(status_code=503, content={"error": "Service temporarily unavailable. Please try again shortly.", "detail": str(err)})
    if not employee:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    return {
        "employee": {
            "employee_id": employee["employee_id"],
            "full_name": employee.get("full_name"),
            "email": employee.get("email"),
            "department": employee.get("department"),
            "role": employee.get("role"),
            "is_first_login": employee.get("is_first_login"),
            "product": employee.get("product") or "",
            "product_qb_eligible": accounts.is_product_qb_employee(employee),
            "assessment_only": accounts.is_assessment_only_employee(employee),
        }
    }


class ConfirmPasswordRequest(BaseModel):
    action: str = "keep"
    password: Optional[str] = None


@router.post("/confirm-password")
def confirm_password(body: ConfirmPasswordRequest, authorization: Optional[str] = Header(default=None), employee_id: str = Depends(require_employee)):
    action = (body.action or "keep").lower()
    token = extract_bearer_token(authorization) or ""

    try:
        employee = accounts.get_employee_account(employee_id)
    except Exception as err:
        return JSONResponse(status_code=503, content={"error": "Service temporarily unavailable. Please try again shortly.", "detail": str(err)})
    if not employee:
        return JSONResponse(status_code=401, content={"error": "Unauthorized access or expired session."})

    if action == "keep":
        updated = accounts.complete_first_time_login(employee_id) or employee
        return {
            "status": "ok",
            "message": "Initial password retained.",
            "token": token,
            "employee": {"employee_id": updated["employee_id"], "full_name": updated.get("full_name")},
        }

    if action == "change":
        new_password = (body.password or "").strip()
        if not new_password:
            return JSONResponse(status_code=400, content={"error": "Please enter a new password."})
        if not _validate_password_strength(new_password):
            return JSONResponse(status_code=400, content={"error": "Password must be at least 8 characters long, contain uppercase, lowercase, number, and special character."})

        updated = accounts.save_employee_password(employee_id, new_password)
        if not updated:
            return JSONResponse(status_code=500, content={"error": "Failed to update password."})

        return {
            "status": "ok",
            "message": "Password updated successfully.",
            "token": token,
            "employee": {"employee_id": updated["employee_id"], "full_name": updated.get("full_name")},
        }

    return JSONResponse(status_code=400, content={"error": "Invalid action type."})


class SetPasswordRequest(BaseModel):
    employee_id: str
    password: str = ""
    full_name: str = ""
    email: str = ""


@router.post("/set-password")
def set_password(body: SetPasswordRequest):
    employee_id = (body.employee_id or "").strip()
    full_name = (body.full_name or "").strip()
    email = (body.email or "").strip()
    password = body.password or ""

    if not employee_id:
        return JSONResponse(status_code=400, content={"error": "Employee ID is required"})
    if not full_name:
        return JSONResponse(status_code=400, content={"error": "Full Name is required"})
    if not email or not EMAIL_RE.match(email):
        return JSONResponse(status_code=400, content={"error": "A valid email address is required"})
    if not _validate_password_strength(password):
        return JSONResponse(status_code=400, content={"error": "Password does not meet the strength requirements"})

    try:
        employee = accounts.get_employee_account(employee_id)
        if not employee:
            accounts.add_employee_account({
                "employee_id": employee_id, "full_name": full_name, "email": email,
                "is_first_login": True, "product_qb_eligible": True,
            })
            employee = accounts.get_employee_account(employee_id)
    except Exception as err:
        return JSONResponse(status_code=503, content={"error": "Service temporarily unavailable. Please try again shortly.", "detail": str(err)})

    if not employee:
        return JSONResponse(status_code=404, content={"error": "Employee not found"})
    if not employee.get("is_first_login"):
        return JSONResponse(status_code=400, content={"error": "Password setup has already been completed"})

    updated = accounts.save_employee_password(employee_id, password, full_name=full_name, email=email)
    if not updated:
        return JSONResponse(status_code=500, content={"error": "Failed to save password"})

    token = sign_token(updated["employee_id"])
    return {
        "status": "ok",
        "token": token,
        "employee": {"employee_id": updated["employee_id"], "full_name": updated.get("full_name"), "email": updated.get("email")},
    }
