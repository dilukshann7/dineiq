"""Persist camera layouts, monitoring sessions, table states and event history."""

import sqlalchemy as sa

from alembic import op

revision = "20261103_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "camera_layout",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("camera_id", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("needs_reconfirmation", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.UniqueConstraint("camera_id", "revision"),
    )
    op.create_index("ix_camera_layout_camera_id", "camera_layout", ["camera_id"])
    op.create_table(
        "table_region",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("layout_id", sa.String(), sa.ForeignKey("camera_layout.id"), nullable=False),
        sa.Column("table_key", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("polygon", sa.JSON(), nullable=False),
        sa.UniqueConstraint("layout_id", "table_key"),
    )
    op.create_index("ix_table_region_layout_id", "table_region", ["layout_id"])
    op.create_table(
        "seat_region",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("table_region_id", sa.String(), sa.ForeignKey("table_region.id"), nullable=False),
        sa.Column("seat_key", sa.String(), nullable=False),
        sa.Column("polygon", sa.JSON(), nullable=False),
        sa.UniqueConstraint("table_region_id", "seat_key"),
    )
    op.create_index("ix_seat_region_table_region_id", "seat_region", ["table_region_id"])
    op.create_table(
        "capture_session",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("camera_id", sa.String(), nullable=False),
        sa.Column("active_camera", sa.String(), nullable=True, unique=True),
        sa.Column("layout_id", sa.String(), sa.ForeignKey("camera_layout.id"), nullable=False),
        sa.Column("owner", sa.String(), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("token_expires", sa.Float(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.Float(), nullable=False),
        sa.Column("stopped_at", sa.Float(), nullable=True),
        sa.Column("interrupted", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_capture_session_camera_id", "capture_session", ["camera_id"])
    op.create_table(
        "table_snapshot",
        sa.Column("camera_id", sa.String(), primary_key=True),
        sa.Column("table_key", sa.String(), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_table(
        "monitoring_event",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("camera_id", sa.String(), nullable=False),
        sa.Column("table_key", sa.String(), nullable=True),
        sa.Column("session_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    for column in ("camera_id", "table_key", "session_id", "created_at"):
        op.create_index(f"ix_monitoring_event_{column}", "monitoring_event", [column])


def downgrade():
    for name in (
        "monitoring_event",
        "table_snapshot",
        "capture_session",
        "seat_region",
        "table_region",
        "camera_layout",
    ):
        op.drop_table(name)
