"""Students keep their own dataset library."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "132_student_datasets"
down_revision = "131_workflow_student_copies"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("agentic_datasets", "created_by_user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("agentic_datasets", sa.Column("owner_student_id", postgresql.UUID(as_uuid=True),
                                                sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_agentic_datasets_owner_student_id", "agentic_datasets", ["owner_student_id"])


def downgrade():
    op.drop_index("ix_agentic_datasets_owner_student_id", table_name="agentic_datasets")
    op.drop_column("agentic_datasets", "owner_student_id")
