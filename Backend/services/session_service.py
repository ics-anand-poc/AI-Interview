from typing import Optional
from datetime import datetime, timezone

from services.supabase_client import get_supabase


def get_session_by_email(email: str) -> Optional[dict]:
    clean_email = email.strip().lower()
    res = (
        get_supabase()
        .table("candidate_sessions")
        .select("*")
        .eq("email", clean_email)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def mark_email_session_used(email: str) -> Optional[dict]:
    clean_email = email.strip().lower()
    used_at = datetime.now(timezone.utc).isoformat()
    res = (
        get_supabase()
        .table("candidate_sessions")
        .update({"used": True, "used_at": used_at})
        .eq("email", clean_email)
        .execute()
    )
    rows = res.data if res else []
    return rows[0] if rows else None
