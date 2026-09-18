from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import require_employee
from services import faceproj_client

router = APIRouter(prefix="/api/employee/tests", tags=["employee"])


class MonitorRequest(BaseModel):
    frame: str


@router.post("/{test_id}/monitor")
def monitor(test_id: str, body: MonitorRequest, _: str = Depends(require_employee)):
    try:
        return faceproj_client.monitor(body.frame)
    except Exception as err:
        return JSONResponse(status_code=500, content={"error": str(err)})
