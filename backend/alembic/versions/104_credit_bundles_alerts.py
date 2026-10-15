"""Credit bundles (bonus_credits), low-balance alerts, bundle requests.

Revision ID: 104_credit_bundles_alerts
Revises: 103_school_onboarding
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "104_credit_bundles_alerts"
down_revision = "103_school_onboarding"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "credit_limits",
        sa.Column("bonus_credits", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "credit_requests",
        sa.Column("limit_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_credit_requests_limit_id", "credit_requests", "credit_limits",
        ["limit_id"], ["id"], ondelete="SET NULL",
    )
    op.create_table(
        "credit_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column("limit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("credit_limits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("severity", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="OPEN"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("cap_snapshot", sa.Float(), nullable=False, server_default="0"),
        sa.Column("usage_snapshot", sa.Float(), nullable=False, server_default="0"),
        sa.Column("email_sent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_credit_alerts_tenant_id", "credit_alerts", ["tenant_id"])
    op.create_index("ix_credit_alerts_limit_id", "credit_alerts", ["limit_id"])
    op.create_index("ix_credit_alerts_status", "credit_alerts", ["status"])
    op.create_index("ix_credit_alerts_created_at", "credit_alerts", ["created_at"])


def downgrade():
    op.drop_table("credit_alerts")
    op.drop_constraint("fk_credit_requests_limit_id", "credit_requests", type_="foreignkey")
    op.drop_column("credit_requests", "limit_id")
    op.drop_column("credit_limits", "bonus_credits")
