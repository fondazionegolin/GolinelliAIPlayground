"""add teacherbot escape room mode

Revision ID: 077_teacherbot_escape_room
Revises: 076_student_consents
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "077_teacherbot_escape_room"
down_revision = "076_student_consents"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "teacherbots",
        sa.Column("enable_escape_room", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "teacherbot_conversations",
        sa.Column("escape_room_state_json", postgresql.JSONB(), nullable=True),
    )


def downgrade():
    op.drop_column("teacherbot_conversations", "escape_room_state_json")
    op.drop_column("teacherbots", "enable_escape_room")
