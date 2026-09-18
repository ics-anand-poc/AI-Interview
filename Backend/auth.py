import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import Header, HTTPException

AUTH_SECRET = os.environ.get("EMPLOYEE_AUTH_SECRET") or "dev-employee-auth-secret"


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def sign_token(employee_id: str, expires_in_ms: int = 7 * 24 * 60 * 60 * 1000) -> str:
    expires_at = int(time.time() * 1000) + expires_in_ms
    payload = json.dumps({"employee_id": employee_id.strip().upper(), "exp": expires_at}, separators=(",", ":"))
    encoded = _b64url_encode(payload.encode("utf-8"))
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def verify_token(token: Optional[str]) -> Optional[str]:
    if not token or "." not in token:
        return None
    encoded, signature = token.rsplit(".", 1)
    expected = hmac.new(AUTH_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        data = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except Exception:
        return None
    if time.time() * 1000 > data.get("exp", 0):
        return None
    return data.get("employee_id")


def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    return authorization[7:] if authorization.startswith("Bearer ") else authorization


def require_admin(
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = None,
) -> str:
    candidate = extract_bearer_token(authorization) or token
    employee_id = verify_token(candidate)
    if employee_id != "ADMIN":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return employee_id


def require_employee(authorization: Optional[str] = Header(default=None)) -> str:
    employee_id = verify_token(extract_bearer_token(authorization))
    if not employee_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return employee_id
