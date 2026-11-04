from fastapi import APIRouter, Request, Response

from app.auth.contracts import LoginInput, PasswordInput
from app.auth.dependencies import CurrentUser, trusted_origin
from app.auth.service import COOKIE_NAME, SESSION_SECONDS

router = APIRouter(tags=["accounts"])


def cookie(response: Response, request: Request, token: str):
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        path="/",
        secure=request.app.state.settings.auth_secure_cookie,
        max_age=SESSION_SECONDS,
    )
    response.headers["Cache-Control"] = "no-store"


@router.post("/auth/login")
def login(request: Request, response: Response, data: LoginInput):
    trusted_origin(request)
    token, result = request.app.state.auth.login(
        data.username, data.password, request.client.host if request.client else "unknown"
    )
    cookie(response, request, token)
    return result


@router.get("/auth/me")
def me(actor: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {
        "user": {
            "id": actor.id,
            "username": actor.username,
            "display_name": actor.display_name,
            "role": actor.role,
            "active": True,
            "must_change_password": actor.must_change_password,
        },
        "csrf_token": actor.csrf_token,
    }


@router.post("/auth/logout")
def logout(request: Request, response: Response, actor: CurrentUser):
    request.app.state.auth.logout(actor)
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.auth_secure_cookie,
    )
    return {"ok": True}


@router.post("/auth/change-password")
def change_password(request: Request, response: Response, actor: CurrentUser, data: PasswordInput):
    token, result = request.app.state.auth.change_password(
        actor, data.current_password, data.new_password
    )
    cookie(response, request, token)
    return result
