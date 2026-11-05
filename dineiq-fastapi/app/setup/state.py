from sqlmodel import select

from app.models.installation import InstallationState


def installation(db, *, lock=False) -> InstallationState:
    query = select(InstallationState).where(InstallationState.id == 1)
    if lock:
        query = query.with_for_update()
    return db.exec(query).one()
