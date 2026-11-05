from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.api.frames import read_jpeg
from app.auth.dependencies import AdminUser
from app.detector import Detector, DetectorUnavailable, InvalidFrame

router = APIRouter(tags=["detection"])


class Detection(BaseModel):
    label: Literal["person", "dining table", "chair"]
    confidence: float = Field(ge=0, le=1)
    box: tuple[float, float, float, float]
    polygon: list[tuple[float, float]] | None = None


class DetectionResponse(BaseModel):
    width: int
    height: int
    detections: list[Detection]


def get_detector(request: Request) -> Detector:
    return request.app.state.detector


@router.post("/detect", response_model=DetectionResponse, response_model_exclude_none=True)
async def detect(
    request: Request, actor: AdminUser, detector: Annotated[Detector, Depends(get_detector)]
):
    content = await read_jpeg(request)
    try:
        _, calibration = await run_in_threadpool(request.app.state.monitoring.calibration.snapshot)
        return await run_in_threadpool(detector.predict, content, calibration)
    except InvalidFrame as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DetectorUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
