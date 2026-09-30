"""Public teacherbot links open the full student chat (hidden guest session per link)

Revision ID: 091_share_link_guest_session
Revises: 090_inquiry_suspects
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "091_share_link_guest_session"
down_revision = "090_inquiry_suspects"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("classes", sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column(
        "teacherbot_share_links",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade():
    op.drop_column("teacherbot_share_links", "session_id")
    op.drop_column("classes", "is_system")
