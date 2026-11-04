"""Persist Telegram settings edited by an administrator."""

import sqlalchemy as sa

from alembic import op

revision = "20261104_05"
down_revision = "20261104_04"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "telegram_configuration",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("bot_token", sa.String(), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_telegram_singleton"),
    )


def downgrade():
    op.drop_table("telegram_configuration")
