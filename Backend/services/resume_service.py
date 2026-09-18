import json
from typing import Optional

from services.supabase_client import get_supabase


def get_resume_report(resume_id: str) -> Optional[dict]:
    res = get_supabase().table("resumes").select("report").eq("id", resume_id).maybe_single().execute()
    if not res or not res.data:
        return None
    report = res.data.get("report")
    if not report:
        return {}
    return json.loads(report) if isinstance(report, str) else report


def update_resume_report(resume_id: str, report: dict) -> None:
    get_supabase().table("resumes").update({"report": json.dumps(report)}).eq("id", resume_id).execute()


def get_resume(resume_id: str) -> Optional[dict]:
    res = get_supabase().table("resumes").select("*").eq("id", resume_id).maybe_single().execute()
    return res.data if res and res.data else None
