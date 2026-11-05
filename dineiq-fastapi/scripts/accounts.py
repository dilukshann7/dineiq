import argparse
import getpass
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import TypeAdapter, ValidationError  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.auth.contracts import DisplayName, Username  # noqa: E402
from app.auth.service import create_admin, hash_password, revoke_sessions  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.session import create_db_engine  # noqa: E402
from app.models.auth import Account, Activity  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("create-admin", "reset-admin-password"))
    parser.add_argument("--username", required=True)
    parser.add_argument("--display-name", default="Administrator")
    args = parser.parse_args(argv)
    try:
        username = TypeAdapter(Username).validate_python(args.username)
        name = TypeAdapter(DisplayName).validate_python(args.display_name)
    except ValidationError:
        parser.error(
            "Use a 3-64 character username (letters, numbers, _, ., -) "
            "and a non-empty display name."
        )
    password = getpass.getpass("New admin password (at least 12 characters): ")
    if not 12 <= len(password) <= 1024:
        parser.error("Password must contain 12 to 1024 characters.")
    if password != getpass.getpass("Confirm password: "):
        parser.error("Passwords do not match.")
    engine = create_db_engine(get_settings())
    try:
        with Session(engine) as db:
            if args.command == "create-admin":
                create_admin(db, username, name, password)
            else:
                user = db.exec(
                    select(Account)
                    .where(Account.username == username, Account.role == "ADMIN")
                    .with_for_update()
                ).first()
                if not user:
                    raise ValueError("Admin account not found.")
                revoke_sessions(db, user.id)
                user.password_hash = hash_password(password)
                user.must_change_password = False
                user.active = True
                db.add(user)
                db.add(
                    Activity(
                        actor_id=user.id,
                        actor_username=user.username,
                        actor_name=user.display_name,
                        target_user_id=user.id,
                        action="admin_password_recovered",
                        created_at=time.time(),
                    )
                )
                db.commit()
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    except SQLAlchemyError:
        parser.exit(
            1, "Account command failed. Check PostgreSQL, migrations, and username uniqueness.\n"
        )
    finally:
        engine.dispose()
    print(
        "Admin account created."
        if args.command == "create-admin"
        else "Admin password reset; previous sessions revoked."
    )


if __name__ == "__main__":
    main()
