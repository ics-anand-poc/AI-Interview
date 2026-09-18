import base64
import os
import re
from io import BytesIO
from typing import Optional

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel

from pipeline import get_pipeline

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))  # project-root .env.local

app = FastAPI()

DATA_URL_PATTERN = re.compile(r"^data:image/\w+;base64,(.+)$")
FACE_MATCH_KEY = os.environ.get("FACE_MATCH_KEY")


class CompareRequest(BaseModel):
    idImage: str
    selfieImage: str


class MonitorRequest(BaseModel):
    frame: str


def decode_image(data_url: str) -> np.ndarray:
    match = DATA_URL_PATTERN.match(data_url)
    raw = base64.b64decode(match.group(1) if match else data_url)
    image = Image.open(BytesIO(raw)).convert("RGB")
    return np.array(image)


def check_key(x_face_match_key: Optional[str]):
    if FACE_MATCH_KEY and x_face_match_key != FACE_MATCH_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Face-Match-Key")


@app.on_event("startup")
def load_models():
    get_pipeline()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/compare")
def compare(request: CompareRequest, x_face_match_key: Optional[str] = Header(default=None)):
    check_key(x_face_match_key)
    pipeline = get_pipeline()
    id_image = decode_image(request.idImage)
    selfie_image = decode_image(request.selfieImage)
    return pipeline.compare(id_image, selfie_image)


@app.post("/monitor")
def monitor(request: MonitorRequest, x_face_match_key: Optional[str] = Header(default=None)):
    check_key(x_face_match_key)
    pipeline = get_pipeline()
    frame = decode_image(request.frame)
    return pipeline.monitor(frame)
