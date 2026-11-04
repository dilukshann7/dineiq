import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth.contracts import StaffInput, StaffPatch
from app.auth.dependencies import AdminUser
from app.auth.service import (
    hash_password,
    public_user,
    record_activity,
    revoke_sessions,
    validate_actor,
)
from app.models.auth import Account

router = APIRouter(tags=["accounts"])


@router.get("/admin/staff")
def staff_list(request: Request, actor: AdminUser):
    with Session(request.app.state.engine) as db:
        return {
            "users": [
                public_user(user)
                for user in db.exec(
                    select(Account).where(Account.role == "STAFF").order_by(Account.username)
                ).all()
            ]
        }


@router.post("/admin/staff", status_code=201)
def create_staff(request: Request, response: Response, actor: AdminUser, data: StaffInput):
    password = secrets.token_urlsafe(18)
    with Session(request.app.state.engine) as db:
        validate_actor(db, actor)
        user = Account(
            username=data.username,
            display_name=data.display_name,
            role="STAFF",
            password_hash=hash_password(password),
            must_change_password=True,
            created_at=time.time(),
        )
        try:
            db.add(user)
            db.flush()
            record_activity(db, actor, "staff_created", target_user_id=user.id)
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(409, "Username already exists.") from exc
        response.headers["Cache-Control"] = "no-store"
        return {"user": public_user(user), "temporary_password": password}


def staff_account(db, user_id):
    user = db.exec(
        select(Account).where(Account.id == user_id, Account.role == "STAFF").with_for_update()
    ).first()
    if not user:
        raise HTTPException(404, "Staff account not found.")
    return user


@router.patch("/admin/staff/{user_id}")
def edit_staff(request: Request, actor: AdminUser, user_id: str, data: StaffPatch):
    changes = data.model_dump(exclude_unset=True)
    if not changes or any(value is None for value in changes.values()):
        raise HTTPException(422, "Supply a non-empty account update without null values.")
    with Session(request.app.state.engine) as db:
        validate_actor(db, actor)
        user = staff_account(db, user_id)
        changes = {key: value for key, value in changes.items() if getattr(user, key) != value}
        if changes:
            try:
                for key, value in changes.items():
                    setattr(user, key, value)
                action = "staff_updated"
                if "active" in changes:
                    action = "staff_enabled" if user.active else "staff_disabled"
                    if not user.active:
                        revoke_sessions(db, user.id)
                record_activity(
                    db, actor, action, target_user_id=user.id, data={"fields": list(changes)}
                )
                db.add(user)
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(409, "Username already exists.") from exc
        return {"user": public_user(user)}


@router.post("/admin/staff/{user_id}/reset-password")
def reset_staff(request: Request, response: Response, actor: AdminUser, user_id: str):
    password = secrets.token_urlsafe(18)
    with Session(request.app.state.engine) as db:
        validate_actor(db, actor)
        user = staff_account(db, user_id)
        record_activity(db, actor, "staff_password_reset", target_user_id=user.id)
        user.password_hash = hash_password(password)
        user.must_change_password = True
        revoke_sessions(db, user.id)
        db.add(user)
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {"user": public_user(user), "temporary_password": password}
