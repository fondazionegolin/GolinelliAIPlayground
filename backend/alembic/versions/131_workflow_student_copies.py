"""Students get their own editable copy of workflows shared by the teacher."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "131_workflow_student_copies"
down_revision = "130_workflow_sharing"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agentic_workflows", sa.Column("source_workflow_id", postgresql.UUID(as_uuid=True),
                                                 sa.ForeignKey("agentic_workflows.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_agentic_workflows_source_workflow_id", "agentic_workflows", ["source_workflow_id"])
    op.create_index("uq_workflow_student_source", "agentic_workflows", ["owner_student_id", "source_workflow_id"], unique=True,
                    postgresql_where=sa.text("source_workflow_id IS NOT NULL AND owner_student_id IS NOT NULL"))


def downgrade():
    op.drop_index("uq_workflow_student_source", table_name="agentic_workflows")
    op.drop_index("ix_agentic_workflows_source_workflow_id", table_name="agentic_workflows")
    op.drop_column("agentic_workflows", "source_workflow_id")
