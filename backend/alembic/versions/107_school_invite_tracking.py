"""Track the school onboarding funnel: e-mail delivery and opening, partial acceptance, organizations outside the MIM registry.

Activation tokens (teachers invited by a principal or by the admin) get the same delivery fields.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "107_school_invite_tracking"
down_revision = "106_visual_sessions"
branch_labels = None
depends_on = None

DELIVERY = ("email_status", "email_error", "email_attempts", "email_opened_at")


def _delivery_columns():
    return [
        sa.Column("email_status", sa.String(16), nullable=True),  # SENT | FAILED (NULL = never attempted)
        sa.Column("email_error", sa.Text(), nullable=True),
        sa.Column("email_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("email_opened_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade():
    for column in _delivery_columns():
        op.add_column("school_onboarding_invites", column)
    op.add_column("school_onboarding_invites", sa.Column("organization_name", sa.String(255), nullable=True))
    op.add_column("school_onboarding_invites", sa.Column("organization_comune", sa.String(128), nullable=True))
    op.add_column("school_onboarding_invites", sa.Column("organization_province", sa.String(64), nullable=True))
    op.add_column("school_onboarding_invites", sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("school_onboarding_invites", sa.Column("open_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("school_onboarding_invites", sa.Column("progress", postgresql.JSONB(), nullable=False, server_default="{}"))
    # Invites sent before this migration: a recorded send time means the e-mail left.
    op.execute("UPDATE school_onboarding_invites SET email_status = 'SENT', email_attempts = 1 WHERE email_sent_at IS NOT NULL")

    for column in _delivery_columns():
        op.add_column("activation_tokens", column)
    op.add_column("activation_tokens", sa.Column("email_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("activation_tokens", "email_sent_at")
    for name in DELIVERY:
        op.drop_column("activation_tokens", name)
    for name in ("progress", "open_count", "last_opened_at", "organization_province", "organization_comune", "organization_name", *DELIVERY):
        op.drop_column("school_onboarding_invites", name)
