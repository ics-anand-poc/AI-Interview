import base64
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services import faceproj_client, resume_service, session_service
from services.audit_log import add_log
from services.supabase_client import get_supabase
from security import get_client_ip

router = APIRouter(prefix="/api/interview", tags=["interview"])


class AccessRequest(BaseModel):
    email: str


def _db_unavailable(detail: str):
    """Consistent handling for the 'Supabase itself is unreachable/misconfigured'
    case (network down, bad key, etc.) — distinct from the request-validation and
    not-found cases each handler already returns explicitly below. Every route in
    this file that touches the DB before doing anything else now goes through this
    instead of letting the exception reach FastAPI's default (plain-text, not even
    JSON) 500 handler — found via live testing with Supabase intentionally
    unreachable; see API_INVENTORY.md.
    """
    print(f"Database unavailable: {detail}")
    return JSONResponse(status_code=503, content={"success": False, "error": "Service temporarily unavailable. Please try again shortly.", "detail": detail})


@router.post("/access")
def access(body: AccessRequest):
    email = (body.email or "").strip().lower()
    if not email:
        return JSONResponse(status_code=400, content={"success": False, "message": "Email address is required"})

    try:
        session = session_service.get_session_by_email(email)
    except Exception as err:
        return _db_unavailable(str(err))

    if not session:
        return JSONResponse(status_code=404, content={
            "success": False,
            "message": "This email is not registered for an interview session. Please contact HR or ensure it matches the email on your CV.",
        })

    if session.get("used"):
        return JSONResponse(status_code=403, content={
            "success": False,
            "message": "You have already completed this interview. Duplicate participation or re-entry is not permitted.",
        })

    resume_id = session.get("resume_id")
    try:
        resume_missing = resume_id and not resume_service.get_resume(resume_id)
    except Exception as err:
        return _db_unavailable(str(err))
    if resume_missing:
        return JSONResponse(status_code=404, content={
            "success": False,
            "message": "Associated resume record was not found. Please contact HR.",
        })

    return {"success": True, "resumeId": resume_id}


class MonitorRequest(BaseModel):
    frame: str


@router.post("/{resume_id}/monitor")
def monitor(resume_id: str, body: MonitorRequest):
    try:
        return faceproj_client.monitor(body.frame)
    except Exception as err:
        return JSONResponse(status_code=500, content={"error": str(err)})


class VerifyIdRequest(BaseModel):
    idImage: str
    selfieImage: str


def _jsonable(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return value


@router.post("/{resume_id}/verify_id")
def verify_id(resume_id: str, body: VerifyIdRequest, request: Request):
    ip = get_client_ip(request)
    try:
        resume = resume_service.get_resume(resume_id)
    except Exception as err:
        return _db_unavailable(str(err))
    if not resume:
        return JSONResponse(status_code=404, content={"error": "Resume record not found"})

    if not body.idImage or not body.selfieImage:
        return JSONResponse(status_code=400, content={"error": "ID image and Selfie snapshot are required"})

    try:
        for filename, data_url in ((f"{resume_id}_id.png", body.idImage), (f"{resume_id}_selfie.png", body.selfieImage)):
            match = data_url.split(",", 1)
            raw = base64.b64decode(match[1] if len(match) > 1 else data_url)
            try:
                get_supabase().storage.from_("verifications").upload(
                    filename, raw, {"upsert": "true"}
                )
            except Exception as upload_err:
                print(f"Verification image upload failed for {filename}: {upload_err}")
    except Exception as err:
        print(f"Verification image handling error: {err}")

    is_system_error = False
    try:
        match_result = faceproj_client.compare(body.idImage, body.selfieImage)
    except Exception as err:
        print(f"Local face verification error: {err}")
        is_system_error = True
        match_result = {
            "matched": False,
            "confidence": 0,
            "reason": "Local biometric matching engine encountered an error. Images have been saved for manual audit.",
        }

    report = resume.get("report")
    report = (json.loads(report) if isinstance(report, str) else report) or {} if report else {}
    report["verification"] = {
        "status": "system_error" if is_system_error else ("verified" if match_result.get("matched") else "failed"),
        "matched": match_result.get("matched"),
        "confidence": match_result.get("confidence"),
        "reason": match_result.get("reason"),
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "idImageUrl": f"/api/interview/{resume_id}/verification/id",
        "selfieImageUrl": f"/api/interview/{resume_id}/verification/selfie",
        "systemError": is_system_error,
    }

    try:
        get_supabase().table("resumes").update({"report": json.dumps(report)}).eq("id", resume_id).execute()
    except Exception as err:
        return JSONResponse(status_code=500, content={"error": f"Database Error: {err}"})

    parsed = resume.get("parsed")
    parsed = json.loads(parsed) if isinstance(parsed, str) else parsed
    actor_email = (parsed or {}).get("personal", {}).get("email") or f"candidate_{resume_id}"
    action = (
        "CANDIDATE_IDENTITY_SYSTEM_ERROR"
        if is_system_error
        else ("CANDIDATE_IDENTITY_VERIFIED" if match_result.get("matched") else "CANDIDATE_IDENTITY_FAILED")
    )
    details = (
        "Biometric service unavailable. ID and Selfie saved for manual review."
        if is_system_error
        else f"Confidence: {match_result.get('confidence')}%. Rationale: {match_result.get('reason')}"
    )
    add_log(actor_email, action, resume_id, details, ip)

    return {
        "success": True,
        "matched": match_result.get("matched"),
        "confidence": match_result.get("confidence"),
        "reason": match_result.get("reason"),
        "isSystemError": is_system_error,
    }


class ProctorViolationRequest(BaseModel):
    violationType: str
    warningCount: int
    timestamp: Optional[str] = None
    duration: Optional[float] = None
    confidence: Optional[float] = None
    description: Optional[str] = None
    videoTimestamp: Optional[float] = None


@router.post("/{resume_id}/proctor_violation")
def proctor_violation(resume_id: str, body: ProctorViolationRequest):
    try:
        report = resume_service.get_resume_report(resume_id)
    except Exception as err:
        return _db_unavailable(str(err))
    if report is None:
        return JSONResponse(status_code=404, content={"error": "Candidate record not found"})

    if "proctoring" not in report:
        report["proctoring"] = {"warningCount": 0, "violations": [], "autoSubmitted": False}

    report["proctoring"]["warningCount"] = body.warningCount
    report["proctoring"]["violations"].append({
        "type": body.violationType,
        "timestamp": body.timestamp or datetime.now(timezone.utc).isoformat(),
        "warningCount": body.warningCount,
        "duration": body.duration,
        "confidence": body.confidence,
        "description": body.description,
        "videoTimestamp": body.videoTimestamp,
    })

    if body.warningCount >= 3:
        report["proctoring"]["autoSubmitted"] = True

    try:
        resume_service.update_resume_report(resume_id, report)
    except Exception as err:
        return _db_unavailable(str(err))
    return {"success": True, "proctoring": report["proctoring"]}


@router.post("/{resume_id}/conclude")
def conclude(resume_id: str):
    try:
        resume = resume_service.get_resume(resume_id)
    except Exception as err:
        return _db_unavailable(str(err))
    if not resume:
        return JSONResponse(status_code=404, content={"error": "Resume record not found"})

    parsed = resume.get("parsed")
    parsed = json.loads(parsed) if isinstance(parsed, str) else parsed
    email = (parsed or {}).get("personal", {}).get("email")
    if email:
        try:
            session_service.mark_email_session_used(email)
        except Exception as err:
            # Best-effort, same convention as audit_log.add_log: the interview is
            # already effectively concluded from the candidate's side by this point
            # (they've submitted), so a session-bookkeeping failure shouldn't turn
            # into a 500 for them — log it server-side and still report success.
            print(f"Failed to mark session used for {email}: {err}")

    return {"success": True}
