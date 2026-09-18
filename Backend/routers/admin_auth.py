import os

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import require_admin, sign_token
from security import get_client_ip, is_rate_limited
from services.audit_log import add_log

router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(request: Request, body: LoginRequest):
    ip = get_client_ip(request)

    if is_rate_limited(f"admin_login_{ip}", limit=5, window_seconds=60):
        return JSONResponse(status_code=429, content={"error": "Too many login attempts. Please try again after a minute."})

    email = body.email.strip().lower()
    password = body.password

    if not email.endswith("@infinite.com"):
        add_log(email or "unknown", "ADMIN_LOGIN_FAILURE", "Admin Console", "Unauthorized email domain extension", ip)
        return JSONResponse(status_code=400, content={"error": "Unauthorized domain. Please enter your @infinite.com email."})

    admin_password = os.environ.get("ADMIN_PASSWORD", "12345")
    if password == admin_password:
        token = sign_token("admin", 60 * 60 * 1000)
        add_log(email, "ADMIN_LOGIN_SUCCESS", "Admin Console", "Admin session generated successfully", ip)
        return {"status": "ok", "token": token}

    add_log(email, "ADMIN_LOGIN_FAILURE", "Admin Console", "Invalid password provided", ip)
    return JSONResponse(status_code=401, content={"error": "Invalid Password"})


@router.get("/validate")
def validate(_: str = Depends(require_admin)):
    return {"status": "ok"}
