import threading
import time
from typing import Dict, Tuple

_tracker: Dict[str, Tuple[int, float]] = {}
_lock = threading.Lock()


def is_rate_limited(key: str, limit: int = 60, window_seconds: float = 60.0) -> bool:
    now = time.time()
    with _lock:
        count, reset_time = _tracker.get(key, (0, 0.0))
        if now > reset_time:
            _tracker[key] = (1, now + window_seconds)
            return False
        if count >= limit:
            return True
        _tracker[key] = (count + 1, reset_time)
        return False


def get_client_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
