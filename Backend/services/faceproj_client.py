import os

import httpx

FACEPROJ_URL = os.environ.get("FACEPROJ_SERVICE_URL", "http://127.0.0.1:8000")
FACE_MATCH_KEY = os.environ.get("FACE_MATCH_KEY")


def _headers() -> dict:
    return {"X-Face-Match-Key": FACE_MATCH_KEY} if FACE_MATCH_KEY else {}


def compare(id_image: str, selfie_image: str) -> dict:
    res = httpx.post(
        f"{FACEPROJ_URL}/compare",
        json={"idImage": id_image, "selfieImage": selfie_image},
        headers=_headers(),
        timeout=15.0,
    )
    res.raise_for_status()
    return res.json()


def monitor(frame: str) -> dict:
    res = httpx.post(
        f"{FACEPROJ_URL}/monitor",
        json={"frame": frame},
        headers=_headers(),
        timeout=15.0,
    )
    res.raise_for_status()
    return res.json()
