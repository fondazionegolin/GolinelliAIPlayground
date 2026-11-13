"""Dataflow Studio for students: workflows owned by a session student instead of a teacher account."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "128_student_dataflow"
down_revision = "127_document_share_links"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agentic_workflows", sa.Column(
        "owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_agentic_workflows_owner_student_id", "agentic_workflows", ["owner_student_id"])
    op.alter_column("agentic_workflows", "created_by_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)


def downgrade():
    op.execute("DELETE FROM agentic_workflows WHERE created_by_user_id IS NULL")
    op.alter_column("agentic_workflows", "created_by_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_index("ix_agentic_workflows_owner_student_id", table_name="agentic_workflows")
    op.drop_column("agentic_workflows", "owner_student_id")
