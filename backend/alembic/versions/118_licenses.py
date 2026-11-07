"""Licence term per teacher and per school: start, expiry, auto-renew, term length."""
from alembic import op
import sqlalchemy as sa

revision = "118_licenses"
down_revision = "117_background_audio"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("users", "tenants"):
        op.add_column(table, sa.Column("license_started_at", sa.DateTime(timezone=True), nullable=True))
        # NULL = no expiry (every account that existed before licences were introduced).
        op.add_column(table, sa.Column("license_expires_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column("license_auto_renew", sa.Boolean(), nullable=False, server_default=sa.true()))
        op.add_column(table, sa.Column("license_term_months", sa.Integer(), nullable=False, server_default="12"))
        op.create_index(f"ix_{table}_license_expires_at", table, ["license_expires_at"])
    op.add_column("platform_invitations", sa.Column("license_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("school_onboarding_invites", sa.Column("license_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("school_onboarding_invites", "license_expires_at")
    op.drop_column("platform_invitations", "license_expires_at")
    for table in ("tenants", "users"):
        op.drop_index(f"ix_{table}_license_expires_at", table_name=table)
        for col in ("license_term_months", "license_auto_renew", "license_expires_at", "license_started_at"):
            op.drop_column(table, col)
