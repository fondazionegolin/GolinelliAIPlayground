"""Store escape room answers for the teacher report.

Revision ID: 092_live_escape_answers
Revises: 091_share_link_guest_session
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "092_live_escape_answers"
down_revision = "091_share_link_guest_session"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "live_escape_participants",
        sa.Column("answers_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade():
    op.drop_column("live_escape_participants", "answers_json")
