from logging.config import fileConfig

from sqlalchemy import pool
from sqlmodel import SQLModel, create_engine

from alembic import context
from app.core.config import get_settings
from app.models import (
    auth,  # noqa: F401 -- register account and activity tables
    monitoring,  # noqa: F401 -- register monitoring tables
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import SQLModel table modules here so their metadata is registered for autogeneration.
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=str(get_settings().database_url),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        context.configure(
            connection=supplied_connection, target_metadata=target_metadata, compare_type=True
        )
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(
        str(get_settings().database_url),
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": 5},
    )
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
