from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.detector import Detector, DetectorUnavailable, InvalidFrame

router = APIRouter(tags=["detection"])
MAX_FRAME_BYTES = 2 * 1024 * 1024


class Detection(BaseModel):
    label: Literal["person", "dining table"]
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
async def detect(request: Request, detector: Annotated[Detector, Depends(get_detector)]):
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "image/jpeg":
        raise HTTPException(
            status_code=415, detail="Send a JPEG frame with Content-Type image/jpeg."
        )
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_FRAME_BYTES:
            raise HTTPException(status_code=413, detail="Camera frames must be 2 MiB or smaller.")
        content.extend(chunk)
    try:
        return await run_in_threadpool(detector.predict, bytes(content))
    except InvalidFrame as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DetectorUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
