"""Dataflow assistant chats for students."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "129_student_dataflow_assist"
down_revision = "128_student_dataflow"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agentic_assistant_conversations", sa.Column(
        "owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_agentic_assistant_conversations_owner_student_id", "agentic_assistant_conversations", ["owner_student_id"])
    op.alter_column("agentic_assistant_conversations", "created_by_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)


def downgrade():
    op.execute("DELETE FROM agentic_assistant_conversations WHERE created_by_user_id IS NULL")
    op.alter_column("agentic_assistant_conversations", "created_by_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_index("ix_agentic_assistant_conversations_owner_student_id", table_name="agentic_assistant_conversations")
    op.drop_column("agentic_assistant_conversations", "owner_student_id")
