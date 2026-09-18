import uuid
from datetime import datetime, timezone

from services.supabase_client import get_supabase


def add_log(actor_email: str, action: str, target: str, details: str, ip_address: str) -> None:
    record = {
        "id": str(uuid.uuid4()),
        "actor_email": actor_email.strip().lower(),
        "action": action,
        "target": target,
        "details": details,
        "ip_address": ip_address,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        get_supabase().table("audit_logs").insert(record).execute()
    except Exception as err:
        print(f"Failed to write audit log: {err}")
