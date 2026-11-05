import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.auth.service import COOKIE_NAME, Principal


def trusted_origin(request: Request):
    if request.headers.get("origin") not in request.app.state.settings.cors_origins:
        raise HTTPException(403, "Request origin is not allowed.")


def current_user(request: Request) -> Principal:
    actor = request.app.state.auth.authenticate(request.cookies.get(COOKIE_NAME))
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        trusted_origin(request)
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), actor.csrf_token):
            raise HTTPException(403, "Invalid CSRF token. Reload and retry.")
    return actor


def operational_user(
    request: Request, actor: Annotated[Principal, Depends(current_user)]
) -> Principal:
    if actor.must_change_password:
        raise HTTPException(
            403,
            {"code": "password_change_required", "message": "Change your password to continue."},
        )
    from app.setup.state import installation

    with Session(request.app.state.engine) as db:
        incomplete = installation(db).completed_at is None
    if incomplete:
        path = request.url.path
        setup_allowed = actor.role == "ADMIN" and (
            path.startswith("/setup/") or path == "/admin/reset"
            or path.startswith("/admin/settings/")
            or path.startswith("/admin/staff") or path == "/detect" or path == "/health/db"
            or path in ("/monitoring/layout", "/monitoring/suggestions", "/monitoring/sessions")
            or path.startswith("/monitoring/sessions/")
        )
        if not setup_allowed:
            raise HTTPException(403, {"code": "setup_required", "message": "Setup in progress."})
    return actor


def admin_user(actor: Annotated[Principal, Depends(operational_user)]) -> Principal:
    if actor.role != "ADMIN":
        raise HTTPException(403, "Admin access required.")
    return actor


CurrentUser = Annotated[Principal, Depends(current_user)]
OperationalUser = Annotated[Principal, Depends(operational_user)]
AdminUser = Annotated[Principal, Depends(admin_user)]
