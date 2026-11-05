from fastapi import APIRouter, HTTPException, Request, Response

from app.api.routes.auth import cookie
from app.auth.dependencies import AdminUser, trusted_origin
from app.auth.service import COOKIE_NAME
from app.setup.contracts import AccessInput, AdminInput, CompleteInput, ProgressInput, ResetInput
from app.setup.service import SETUP_COOKIE, SETUP_SECONDS

router = APIRouter(tags=["setup"])


def setup_cookie(response, request, token):
    response.set_cookie(
        SETUP_COOKIE,
        token,
        httponly=True,
        samesite="strict",
        path="/",
        secure=request.app.state.settings.auth_secure_cookie,
        max_age=SETUP_SECONDS,
    )


def ip(request):
    return request.client.host if request.client else "unknown"


@router.get("/setup/status")
def status(request: Request):
    actor = None
    if token := request.cookies.get(COOKIE_NAME):
        try:
            actor = request.app.state.auth.authenticate(token)
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
    return request.app.state.setup.status(request.cookies.get(SETUP_COOKIE), actor)


@router.post("/setup/access")
def access(request: Request, response: Response, data: AccessInput):
    trusted_origin(request)
    token, result = request.app.state.setup.access(data.code, ip(request))
    setup_cookie(response, request, token)
    return result


@router.post("/setup/admin", status_code=201)
def admin(request: Request, response: Response, data: AdminInput):
    trusted_origin(request)
    token, result = request.app.state.setup.create_admin(
        data, request.cookies.get(SETUP_COOKIE), request.headers.get("x-csrf-token", "")
    )
    cookie(response, request, token)
    response.delete_cookie(
        SETUP_COOKIE,
        path="/",
        httponly=True,
        samesite="strict",
        secure=request.app.state.settings.auth_secure_cookie,
    )
    return result


@router.post("/setup/progress")
def progress(request: Request, data: ProgressInput, actor: AdminUser):
    return request.app.state.setup.progress(actor, data.checkpoint)


@router.post("/setup/complete")
def complete(request: Request, data: CompleteInput, actor: AdminUser):
    return request.app.state.setup.complete(actor, data)


@router.post("/admin/reset")
def reset(request: Request, response: Response, data: ResetInput, actor: AdminUser):
    token, result = request.app.state.setup.reset(actor, data, ip(request))
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.auth_secure_cookie,
    )
    setup_cookie(response, request, token)
    return result
