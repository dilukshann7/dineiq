"""Persist table visits and staff alert delivery episodes."""

import sqlalchemy as sa

from alembic import op

revision = "20261103_02"
down_revision = "20261103_01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "table_visit",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("active_key", sa.String(), nullable=True, unique=True),
        sa.Column("camera_id", sa.String(), nullable=False),
        sa.Column("table_key", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), sa.ForeignKey("capture_session.id"), nullable=False),
        sa.Column("arrived_at", sa.Float(), nullable=False),
        sa.Column("served_at", sa.Float(), nullable=True),
        sa.Column("ended_at", sa.Float(), nullable=True),
    )
    for column in ("camera_id", "session_id"):
        op.create_index(f"ix_table_visit_{column}", "table_visit", [column])
    op.create_table(
        "staff_alert",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("episode_key", sa.String(), nullable=False, unique=True),
        sa.Column("active_key", sa.String(), nullable=True, unique=True),
        sa.Column("camera_id", sa.String(), nullable=False),
        sa.Column("table_key", sa.String(), nullable=False),
        sa.Column("table_name", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), sa.ForeignKey("capture_session.id"), nullable=False),
        sa.Column("visit_id", sa.String(), sa.ForeignKey("table_visit.id"), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("acknowledged_at", sa.Float(), nullable=True),
        sa.Column("resolved_at", sa.Float(), nullable=True),
        sa.Column("delivery_status", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_retry_at", sa.Float(), nullable=False),
        sa.Column("telegram_message_id", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
    )
    for column in ("camera_id", "session_id"):
        op.create_index(f"ix_staff_alert_{column}", "staff_alert", [column])


def downgrade():
    op.drop_table("staff_alert")
    op.drop_table("table_visit")
