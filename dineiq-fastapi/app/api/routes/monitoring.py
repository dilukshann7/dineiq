from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app.api.frames import read_jpeg
from app.auth.dependencies import AdminUser, OperationalUser
from app.detector import DetectorUnavailable, InvalidFrame
from app.monitoring.contracts import (
    AcknowledgeInput,
    CorrectionInput,
    Identifier,
    LayoutInput,
    ServiceInput,
    StartInput,
)
from app.monitoring.service import MonitorError

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def invoke(request, method, *args):
    service = request.app.state.monitoring
    try:
        return getattr(service, method)(*args)
    except MonitorError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    except InvalidFrame as exc:
        raise HTTPException(422, str(exc)) from exc
    except DetectorUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(
            409, "Configuration or capture session changed. Reload and retry."
        ) from exc
    except SQLAlchemyError as exc:
        service.database_failed()
        raise HTTPException(
            503,
            "Monitoring database unavailable. Check PostgreSQL and apply "
            "the monitoring migration, then restart monitoring.",
        ) from exc


@router.post("/suggestions")
async def suggestions(request: Request, actor: AdminUser):
    content = await read_jpeg(request)
    return await run_in_threadpool(invoke, request, "suggest", content)


@router.get("/layout")
def get_layout(request: Request, actor: OperationalUser, camera_id: Identifier = "main"):
    return invoke(request, "get_layout", camera_id)


@router.put("/layout")
def save_layout(request: Request, data: LayoutInput, actor: AdminUser):
    return invoke(request, "save_layout", data, actor)


@router.post("/sessions")
def start(request: Request, data: StartInput, actor: AdminUser):
    return invoke(request, "start", data.camera_id, data.expected_revision, actor)


@router.delete("/sessions/{session_id}")
def stop(request: Request, session_id: Identifier, actor: AdminUser):
    return invoke(request, "stop", session_id, actor)


@router.post("/sessions/{session_id}/frames")
async def frame(
    request: Request,
    session_id: Identifier,
    actor: AdminUser,
    sequence: Annotated[int, Query(ge=1)],
    token: Annotated[str, Query(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
):
    try:
        content = await read_jpeg(request)
    except HTTPException:
        await run_in_threadpool(
            request.app.state.monitoring.invalidate_session,
            session_id,
            "Invalid observation request",
        )
        raise
    return await run_in_threadpool(invoke, request, "process", session_id, sequence, token, content)


@router.get("/tables")
def states(request: Request, actor: OperationalUser, camera_id: Identifier = "main"):
    return invoke(request, "states", camera_id)


@router.get("/history")
def history(
    request: Request,
    actor: AdminUser,
    camera_id: Identifier = "main",
    table_id: Identifier | None = None,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    return invoke(request, "history", camera_id, table_id, before, limit)


@router.post("/tables/{table_id}/correction")
def correct(request: Request, table_id: Identifier, data: CorrectionInput, actor: OperationalUser):
    return invoke(request, "correct", data.camera_id, table_id, data.action, actor)


@router.post("/tables/{table_id}/service")
def serve(request: Request, table_id: Identifier, data: ServiceInput, actor: OperationalUser):
    return invoke(request, "mark_served", data.camera_id, table_id, data.visit_id, actor)


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(
    request: Request, alert_id: Identifier, data: AcknowledgeInput, actor: OperationalUser
):
    return invoke(request, "acknowledge_alert", data.camera_id, alert_id, actor)
