import hashlib
import secrets
import time
from dataclasses import dataclass
from threading import RLock

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException
from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.models.auth import Account, Activity, BrowserSession, LoginFailure

COOKIE_NAME = "dineiq_session"
SESSION_SECONDS = 12 * 60 * 60
hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(hashed: str, password: str) -> bool:
    try:
        return hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def public_user(user: Account) -> dict:
    return {
        key: getattr(user, key)
        for key in ("id", "username", "display_name", "role", "active", "must_change_password")
    }


@dataclass(frozen=True)
class Principal:
    id: str
    username: str
    display_name: str
    role: str
    session_hash: str
    must_change_password: bool
    csrf_token: str


def validate_actor(db: Session, actor: Principal, *, lock=True) -> Account:
    query = select(Account).where(Account.id == actor.id)
    user = db.exec(query.with_for_update() if lock else query).first()
    session = db.get(BrowserSession, actor.session_hash, populate_existing=True)
    if (
        not user
        or not user.active
        or not session
        or session.revoked
        or session.expires_at <= time.time()
        or session.account_id != user.id
    ):
        raise HTTPException(401, "Session expired. Please sign in again.")
    return user


def record_activity(
    db: Session,
    actor: Principal,
    action: str,
    *,
    target_user_id=None,
    camera_id=None,
    table_id=None,
    visit_id=None,
    alert_id=None,
    data=None,
):
    user = validate_actor(db, actor)
    db.add(
        Activity(
            actor_id=user.id,
            actor_username=user.username,
            actor_name=user.display_name,
            action=action,
            target_user_id=target_user_id,
            created_at=time.time(),
            camera_id=camera_id,
            table_id=table_id,
            visit_id=visit_id,
            alert_id=alert_id,
            data=data or {},
        )
    )


def revoke_sessions(db: Session, user_id: str):
    for session in db.exec(
        select(BrowserSession).where(BrowserSession.account_id == user_id)
    ).all():
        session.revoked = True
        db.add(session)


def create_admin(db: Session, username: str, display_name: str, password: str, *, commit=True):
    from app.setup.state import installation

    state = installation(db, lock=True)
    if len(password) < 12 or len(password) > 1024:
        raise ValueError("Password must contain 12 to 1024 characters.")
    if db.exec(select(Account).where(Account.role == "ADMIN")).first():
        raise ValueError("An admin already exists. Use reset-admin-password for recovery.")
    user = Account(
        username=username.strip().lower(),
        display_name=display_name,
        password_hash=hash_password(password),
        role="ADMIN",
        created_at=time.time(),
    )
    db.add(user)
    db.flush()
    state.completed_at = None
    state.checkpoint = "camera"
    state.code_hash = state.code_expires_at = None
    state.grant_hash = state.grant_expires_at = None
    db.add(state)
    if commit:
        db.commit()
    return user


class AuthService:
    def __init__(self, engine):
        self.engine = engine
        self.clock = time.time
        self.lock = RLock()
        self.dummy_hash = hash_password(secrets.token_urlsafe(32))

    def authenticate(self, token: str | None) -> Principal:
        if not token or len(token) > 128:
            raise HTTPException(401, "Please sign in.")
        with Session(self.engine) as db:
            session = db.get(BrowserSession, digest(token))
            user = db.get(Account, session.account_id) if session else None
            if (
                not session
                or session.revoked
                or session.expires_at <= self.clock()
                or not user
                or not user.active
            ):
                raise HTTPException(401, "Session expired. Please sign in again.")
            return Principal(
                user.id,
                user.username,
                user.display_name,
                user.role,
                session.token_hash,
                user.must_change_password,
                session.csrf_token,
            )

    def issue(self, db: Session, user: Account):
        token = secrets.token_urlsafe(32)
        now = self.clock()
        session = BrowserSession(
            token_hash=digest(token),
            account_id=user.id,
            csrf_token=secrets.token_urlsafe(32),
            created_at=now,
            expires_at=now + SESSION_SECONDS,
        )
        db.add(session)
        return token, {"user": public_user(user), "csrf_token": session.csrf_token}

    def login(self, username: str, password: str, ip: str):
        with self.lock, Session(self.engine) as db:
            now = self.clock()
            db.exec(delete(LoginFailure).where(LoginFailure.created_at <= now - 900))
            failures = select(func.count()).select_from(LoginFailure).where(LoginFailure.ip == ip)
            ip_count = db.exec(failures).one()
            pair_count = db.exec(failures.where(LoginFailure.username == username)).one()
            if ip_count >= 30 or pair_count >= 5:
                db.commit()
                raise HTTPException(
                    429,
                    "Too many login attempts. Try again in 15 minutes.",
                    headers={"Retry-After": "900"},
                )
            user = db.exec(
                select(Account).where(Account.username == username).with_for_update()
            ).first()
            valid = verify_password(user.password_hash if user else self.dummy_hash, password)
            if not user or not valid or not user.active:
                db.add(LoginFailure(username=username, ip=ip, created_at=now))
                db.commit()
                raise HTTPException(401, "Invalid username or password.")
            if hasher.check_needs_rehash(user.password_hash):
                user.password_hash = hash_password(password)
                db.add(user)
            token, result = self.issue(db, user)
            db.add(
                Activity(
                    actor_id=user.id,
                    actor_username=user.username,
                    actor_name=user.display_name,
                    action="login",
                    created_at=now,
                )
            )
            db.commit()
            return token, result

    def logout(self, actor: Principal):
        with Session(self.engine) as db:
            record_activity(db, actor, "logout")
            session = db.get(BrowserSession, actor.session_hash)
            session.revoked = True
            db.add(session)
            db.commit()

    def change_password(self, actor: Principal, current: str, password: str):
        with Session(self.engine) as db:
            user = validate_actor(db, actor)
            if not verify_password(user.password_hash, current):
                raise HTTPException(400, "Current password is incorrect.")
            if verify_password(user.password_hash, password):
                raise HTTPException(422, "Choose a different password.")
            record_activity(db, actor, "password_changed")
            user.password_hash = hash_password(password)
            user.must_change_password = False
            db.add(user)
            revoke_sessions(db, user.id)
            token, result = self.issue(db, user)
            db.commit()
            return token, result
