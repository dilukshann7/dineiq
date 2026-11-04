"""Issue fresh installation access without exposing stored credentials."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.exc import SQLAlchemyError  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import create_db_engine  # noqa: E402
from app.setup.service import issue_setup_code  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("issue-code",))
    parser.parse_args()
    engine = create_db_engine(get_settings())
    try:
        code = issue_setup_code(engine)
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    except SQLAlchemyError:
        parser.exit(1, "Setup unavailable. Check PostgreSQL and apply migrations.\n")
    finally:
        engine.dispose()
    print("Single-use setup code (expires in 30 minutes):")
    print(code)


if __name__ == "__main__":
    main()
