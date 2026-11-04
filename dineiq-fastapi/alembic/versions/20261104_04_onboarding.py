"""Persist installation lifecycle, bootstrap grants, and successful frame proof."""

import time

import sqlalchemy as sa

from alembic import op

revision = "20261104_04"
down_revision = "20261103_03"
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table(
        "installation_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("checkpoint", sa.String(), nullable=False),
        sa.Column("completed_at", sa.Float(), nullable=True),
        sa.Column("code_hash", sa.String(), nullable=True),
        sa.Column("code_expires_at", sa.Float(), nullable=True),
        sa.Column("grant_hash", sa.String(), nullable=True),
        sa.Column("grant_expires_at", sa.Float(), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_installation_singleton"),
    )
    existing_admin = (
        op.get_bind().execute(sa.text("SELECT 1 FROM account WHERE role = 'ADMIN' LIMIT 1")).first()
    )
    op.bulk_insert(
        table,
        [
            {
                "id": 1,
                "generation": 1,
                "checkpoint": "review" if existing_admin else "camera",
                "completed_at": time.time() if existing_admin else None,
            }
        ],
    )
    op.add_column("capture_session", sa.Column("last_valid_frame_at", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("capture_session", "last_valid_frame_at")
    op.drop_table("installation_state")
