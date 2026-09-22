import os
from typing import Optional

try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

from supabase import Client, create_client

_client: Optional[Client] = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or ""
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
        if not url or not key:
            raise RuntimeError("Supabase URL/key not configured — check project-root .env.local")
        _client = create_client(url, key)
    return _client
