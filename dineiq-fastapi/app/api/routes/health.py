from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import SQLModel, select

from app.auth.dependencies import AdminUser
from app.db.session import SessionDep

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(SQLModel):
    status: str = "ok"


class DatabaseHealthResponse(HealthResponse):
    database: str = "connected"


@router.get("", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@router.get(
    "/db",
    response_model=DatabaseHealthResponse,
    responses={503: {"description": "Database unavailable"}},
)
def database_health(session: SessionDep, actor: AdminUser) -> DatabaseHealthResponse:
    try:
        session.exec(select(1)).one()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        ) from exc
    return DatabaseHealthResponse()
