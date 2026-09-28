"""Chat history: per-row timestamps for chat messages

now() is the transaction start time, so a user message and the assistant reply saved in one
transaction got identical created_at values and the history order became arbitrary.
clock_timestamp() gives every row its own instant.

Revision ID: 085_chat_message_clock_ts
Revises: 084_board_sprints
"""

from alembic import op
import sqlalchemy as sa


revision = "085_chat_message_clock_ts"
down_revision = "084_board_sprints"
branch_labels = None
depends_on = None

TABLES = ("conversation_messages", "teacherbot_messages")


def upgrade():
    for table in TABLES:
        op.alter_column(table, "created_at", server_default=sa.text("clock_timestamp()"))


def downgrade():
    for table in TABLES:
        op.alter_column(table, "created_at", server_default=sa.text("now()"))
