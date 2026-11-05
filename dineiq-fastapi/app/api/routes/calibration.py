from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from app.api.frames import read_jpeg
from app.auth.dependencies import AdminUser
from app.calibration.contracts import ApplyCalibration, PreviewInput
from app.detector import DetectorUnavailable, InvalidFrame
from app.monitoring.contracts import Identifier

router = APIRouter(prefix="/admin/settings/calibration", tags=["calibration"])


@router.get("")
def current(request: Request, actor: AdminUser):
    return request.app.state.monitoring.calibration.public()


@router.put("")
def apply(request: Request, data: ApplyCalibration, actor: AdminUser):
    return request.app.state.monitoring.calibration.apply(data, actor)


@router.get("/history")
def history(
    request: Request,
    actor: AdminUser,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    return request.app.state.monitoring.calibration.history(before, limit)


@router.post("/previews")
def start(request: Request, data: PreviewInput, actor: AdminUser):
    return request.app.state.monitoring.previews.start(data, actor)


@router.delete("/previews/{preview_id}")
def stop(request: Request, preview_id: Identifier, actor: AdminUser):
    return request.app.state.monitoring.previews.stop(preview_id, actor)


@router.post("/previews/{preview_id}/frames")
async def frame(
    request: Request,
    preview_id: Identifier,
    actor: AdminUser,
    sequence: Annotated[int, Query(ge=1)],
):
    content = await read_jpeg(request)
    try:
        return await run_in_threadpool(
            request.app.state.monitoring.previews.process, preview_id, actor, sequence, content
        )
    except InvalidFrame as exc:
        raise HTTPException(422, str(exc)) from exc
    except DetectorUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
