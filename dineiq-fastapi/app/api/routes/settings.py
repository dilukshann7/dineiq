from fastapi import APIRouter, Request

from app.alerts.configuration import (
    TelegramInput,
    read_telegram_settings,
    save_telegram_settings,
)
from app.auth.dependencies import AdminUser
from app.db.session import SessionDep

router = APIRouter(prefix="/admin/settings", tags=["settings"])


@router.get("/telegram")
def telegram_settings(request: Request, actor: AdminUser, db: SessionDep):
    return read_telegram_settings(db, request.app.state.settings).public()


@router.put("/telegram")
def update_telegram_settings(
    request: Request, actor: AdminUser, db: SessionDep, data: TelegramInput
):
    return save_telegram_settings(db, request.app.state.settings, actor, data)
