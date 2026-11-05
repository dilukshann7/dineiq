"""Add accounts, sessions, activity, and nullable monitoring attribution."""

import sqlalchemy as sa

from alembic import op

revision = "20261103_03"
down_revision = "20261103_02"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("must_change_password", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.CheckConstraint("role IN ('ADMIN', 'STAFF')", name="ck_account_role"),
    )
    op.create_index("ix_account_username", "account", ["username"], unique=True)
    op.create_table(
        "browser_session",
        sa.Column("token_hash", sa.String(), primary_key=True),
        sa.Column("account_id", sa.String(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("csrf_token", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("expires_at", sa.Float(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "login_failure",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("ip", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )
    op.create_table(
        "activity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("actor_username", sa.String(), nullable=False),
        sa.Column("actor_name", sa.String(), nullable=False),
        sa.Column("target_user_id", sa.String(), sa.ForeignKey("account.id"), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("camera_id", sa.String(), nullable=True),
        sa.Column("table_id", sa.String(), nullable=True),
        sa.Column("visit_id", sa.String(), nullable=True),
        sa.Column("alert_id", sa.String(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    for table, columns in (
        ("browser_session", ("account_id", "expires_at")),
        ("login_failure", ("username", "ip", "created_at")),
        ("activity", ("actor_id", "target_user_id", "action", "created_at", "table_id")),
    ):
        for column in columns:
            op.create_index(f"ix_{table}_{column}", table, [column])
    with op.batch_alter_table("monitoring_event") as batch:
        batch.add_column(sa.Column("actor_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("actor_username", sa.String(), nullable=True))
        batch.add_column(sa.Column("actor_name", sa.String(), nullable=True))
        batch.add_column(
            sa.Column("actor_kind", sa.String(), nullable=False, server_default="legacy")
        )
        batch.create_foreign_key("fk_monitoring_event_actor", "account", ["actor_id"], ["id"])
        batch.create_index("ix_monitoring_event_actor_id", ["actor_id"])
    with op.batch_alter_table("monitoring_event") as batch:
        batch.alter_column("actor_kind", server_default=None)


def downgrade():
    with op.batch_alter_table("monitoring_event") as batch:
        batch.drop_index("ix_monitoring_event_actor_id")
        batch.drop_constraint("fk_monitoring_event_actor", type_="foreignkey")
        for column in ("actor_id", "actor_username", "actor_name", "actor_kind"):
            batch.drop_column(column)
    for table in ("activity", "login_failure", "browser_session", "account"):
        op.drop_table(table)
