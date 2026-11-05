"""Versioned runtime calibration; singleton pointer serializes apply and frame commits."""

import sqlalchemy as sa

from alembic import op

revision = "20261105_06"
down_revision = "20261104_05"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "calibration_revision",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("account.id")),
        sa.Column("actor_username", sa.String()),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    table = op.create_table(
        "active_calibration",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision_id", sa.Integer(), sa.ForeignKey("calibration_revision.id")),
        sa.CheckConstraint("id = 1", name="ck_calibration_singleton"),
    )
    op.bulk_insert(table, [{"id": 1, "revision_id": None}])


def downgrade():
    op.drop_table("active_calibration")
    op.drop_table("calibration_revision")
