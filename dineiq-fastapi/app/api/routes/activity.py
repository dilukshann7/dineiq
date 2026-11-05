from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from sqlmodel import Session, select

from app.auth.dependencies import OperationalUser
from app.models.auth import Activity

router = APIRouter(tags=["accounts"])


def epoch(value: datetime) -> float:
    return value.replace(tzinfo=UTC).timestamp() if value.tzinfo is None else value.timestamp()


@router.get("/activity")
def activity(
    request: Request,
    actor: OperationalUser,
    user_id: str | None = None,
    action: str | None = None,
    table_id: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    if actor.role != "ADMIN" and user_id not in (None, actor.id):
        raise HTTPException(403, "You can view only your own activity.")
    if since and until and epoch(since) > epoch(until):
        raise HTTPException(422, "Start date must be before end date.")
    with Session(request.app.state.engine) as db:
        query = select(Activity)
        chosen = user_id if actor.role == "ADMIN" else actor.id
        if chosen:
            query = query.where(Activity.actor_id == chosen)
        for column, value in ((Activity.action, action), (Activity.table_id, table_id)):
            if value is not None:
                query = query.where(column == value)
        if since:
            query = query.where(Activity.created_at >= epoch(since))
        if until:
            query = query.where(Activity.created_at <= epoch(until))
        if before:
            query = query.where(Activity.id < before)
        rows = db.exec(query.order_by(Activity.id.desc()).limit(limit + 1)).all()
        page = rows[:limit]
        return {
            "events": [
                {
                    "id": row.id,
                    "actor": {
                        "id": row.actor_id,
                        "username": row.actor_username,
                        "display_name": row.actor_name,
                    },
                    "target_user_id": row.target_user_id,
                    "action": row.action,
                    "at": datetime.fromtimestamp(row.created_at, UTC).isoformat(),
                    "camera_id": row.camera_id,
                    "table_id": row.table_id,
                    "visit_id": row.visit_id,
                    "alert_id": row.alert_id,
                    "data": row.data,
                }
                for row in page
            ],
            "next_before": page[-1].id if len(rows) > limit else None,
        }
