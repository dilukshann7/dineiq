import secrets
import time
from threading import RLock

from fastapi import HTTPException
from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.auth.service import (
    create_admin,
    digest,
    validate_actor,
    verify_password,
)
from app.models.auth import Account, Activity, BrowserSession, LoginFailure
from app.models.monitoring import (
    CameraLayout,
    CaptureSession,
    MonitoringEvent,
    SeatRegion,
    StaffAlert,
    TableRegion,
    TableSnapshot,
    TableVisit,
)
from app.setup.state import installation

SETUP_COOKIE = "dineiq_setup"
SETUP_SECONDS = 30 * 60
CHECKPOINTS = ("camera", "tables", "staff", "review")
RESET_MODELS = (
    StaffAlert,
    TableVisit,
    MonitoringEvent,
    TableSnapshot,
    CaptureSession,
    SeatRegion,
    TableRegion,
    CameraLayout,
    Activity,
    BrowserSession,
    LoginFailure,
    Account,
)


def admin_exists(db):
    return db.exec(select(Account.id).where(Account.role == "ADMIN").limit(1)).first() is not None


def clear_access(state):
    state.code_hash = state.code_expires_at = None
    state.grant_hash = state.grant_expires_at = None


def issue_setup_code(engine):
    with Session(engine) as db:
        state = installation(db, lock=True)
        if admin_exists(db):
            raise ValueError("An admin already exists. Sign in or recover the admin password.")
        clear_access(state)
        code = secrets.token_urlsafe(32)
        state.code_hash = digest(code)
        state.code_expires_at = time.time() + SETUP_SECONDS
        db.add(state)
        db.commit()
        return code


def grant_valid(state, token):
    return bool(
        token
        and len(token) <= 128
        and state.grant_hash
        and state.grant_expires_at
        and state.grant_expires_at > time.time()
        and secrets.compare_digest(state.grant_hash, digest(token))
    )


def setup_csrf(token):
    return digest("setup-csrf:" + token)


def new_grant(state):
    clear_access(state)
    token = secrets.token_urlsafe(32)
    state.grant_hash = digest(token)
    state.grant_expires_at = time.time() + SETUP_SECONDS
    return token


def enforce_attempt_limit(db, label, ip):
    now = time.time()
    db.exec(delete(LoginFailure).where(LoginFailure.created_at <= now - 900))
    count = db.exec(
        select(func.count())
        .select_from(LoginFailure)
        .where(
            LoginFailure.username == label,
            LoginFailure.ip == ip,
            LoginFailure.created_at > now - 900,
        )
    ).one()
    if count >= 5:
        raise HTTPException(
            429, "Too many attempts. Try again in 15 minutes.", headers={"Retry-After": "900"}
        )


def failed_attempt(db, label, ip):
    db.add(LoginFailure(username=label, ip=ip, created_at=time.time()))
    db.commit()


class SetupService:
    def __init__(self, engine, auth, monitor, delivery, gate):
        self.engine, self.auth, self.monitor = engine, auth, monitor
        self.delivery, self.gate = delivery, gate
        self.reset_lock = RLock()

    def status(self, setup_token=None, actor=None):
        with Session(self.engine) as db:
            state = installation(db)
            phase = (
                "complete"
                if state.completed_at
                else ("in_progress" if admin_exists(db) else "needs_admin")
            )
            result = {"phase": phase}
            if actor:
                validate_actor(db, actor)
            if (actor and actor.role == "ADMIN") or grant_valid(state, setup_token):
                result.update(generation=state.generation, checkpoint=state.checkpoint)
            if not admin_exists(db) and grant_valid(state, setup_token):
                result["csrf_token"] = setup_csrf(setup_token)
            return result

    def access(self, code, ip):
        with self.auth.lock, Session(self.engine) as db:
            state = installation(db, lock=True)
            if admin_exists(db):
                raise HTTPException(409, "An admin already exists. Sign in instead.")
            enforce_attempt_limit(db, "setup:access", ip)
            if not (
                state.code_hash
                and state.code_expires_at
                and state.code_expires_at > time.time()
                and secrets.compare_digest(state.code_hash, digest(code))
            ):
                failed_attempt(db, "setup:access", ip)
                raise HTTPException(403, "Setup code is invalid or expired.")
            token = new_grant(state)
            db.add(state)
            db.commit()
            return token, {"csrf_token": setup_csrf(token)}

    def create_admin(self, data, token, csrf):
        with Session(self.engine) as db:
            state = installation(db, lock=True)
            if admin_exists(db):
                raise HTTPException(409, "An admin already exists. Sign in instead.")
            if not grant_valid(state, token) or not secrets.compare_digest(csrf, setup_csrf(token)):
                raise HTTPException(403, "Setup access expired. Request a new setup code.")
            user = create_admin(db, data.username, data.display_name, data.password, commit=False)
            clear_access(state)
            state.checkpoint, state.completed_at = "camera", None
            db.add(state)
            auth_token, result = self.auth.issue(db, user)
            db.commit()
            return auth_token, result

    def valid_layout(self, db):
        layout = self.monitor._latest(db, "main")
        if layout and not layout.needs_reconfirmation:
            tables = self.monitor._tables(db, layout)
            if tables and all(table["seats"] for table in tables):
                return layout
        raise HTTPException(409, "Save and review at least one table with seats first.")

    def progress(self, actor, checkpoint):
        with Session(self.engine) as db:
            state = installation(db, lock=True)
            validate_actor(db, actor)
            if state.completed_at:
                raise HTTPException(409, "Setup is already complete.")
            if checkpoint in ("staff", "review"):
                self.valid_layout(db)
            if CHECKPOINTS.index(checkpoint) > CHECKPOINTS.index(state.checkpoint) + 1:
                raise HTTPException(409, "Finish the current setup step first.")
            state.checkpoint = checkpoint
            db.add(state)
            db.commit()
        return self.status(actor=actor)

    def complete(self, actor, data):
        with self.monitor.lock, Session(self.engine) as db:
            state = installation(db, lock=True)
            validate_actor(db, actor)
            if not state.completed_at:
                if state.checkpoint != "review":
                    raise HTTPException(409, "Finish the setup steps first.")
                layout = self.valid_layout(db)
                record = db.get(CaptureSession, data.session_id)
                if not (
                    record
                    and record.layout_id == layout.id
                    and layout.revision == data.expected_revision
                    and record.active_camera == "main"
                    and record.stopped_at is None
                    and record.owner == self.monitor.owner
                    and not record.interrupted
                    and record.last_valid_frame_at is not None
                    and time.time() - record.last_valid_frame_at <= 5
                ):
                    raise HTTPException(
                        409, "Run a successful monitoring check on this layout first."
                    )
                state.completed_at = time.time()
                db.add(state)
                db.commit()
        return self.status(actor=actor)

    def authorize_reset(self, actor, data, ip):
        # An admitted staff write may hold the admin row. Waiting on that row
        # here would bypass the drain timeout. Revalidate under lock after drain.
        with self.gate.operation(), self.reset_lock, Session(self.engine) as db:
            state = installation(db)
            user = validate_actor(db, actor, lock=False)
            if state.generation != data.expected_generation:
                raise HTTPException(409, "Installation changed. Reload before resetting.")
            label = f"reset:{user.id}"
            enforce_attempt_limit(db, label, ip)
            if not verify_password(user.password_hash, data.current_password):
                failed_attempt(db, label, ip)
                raise HTTPException(400, "Current password is incorrect.")

    def reset(self, actor, data, ip):
        self.authorize_reset(actor, data, ip)
        with self.gate.exclusive(), self.monitor.lock, Session(self.engine) as db:
            state = installation(db, lock=True)
            validate_actor(db, actor)
            if state.generation != data.expected_generation:
                raise HTTPException(409, "Installation changed. Reload before resetting.")
            for model in RESET_MODELS:
                db.exec(delete(model))
            state.generation += 1
            state.checkpoint, state.completed_at = "camera", None
            token = new_grant(state)
            db.add(state)
            db.commit()
            self.monitor.machines.clear()
            self.monitor.in_flight.clear()
            self.monitor.initialized = False
            self.delivery.next_send_at = 0
            return token, {
                "phase": "needs_admin",
                "generation": state.generation,
                "checkpoint": "camera",
                "csrf_token": setup_csrf(token),
            }
