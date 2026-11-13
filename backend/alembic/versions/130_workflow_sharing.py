"""Share Dataflow workflows with classes, sessions or an anonymous link."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "130_workflow_sharing"
down_revision = "129_student_dataflow_assist"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("agentic_workflows", sa.Column("shared_class_ids", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.add_column("agentic_workflows", sa.Column("shared_session_ids", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.add_column("agentic_workflows", sa.Column("public_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("agentic_workflows", sa.Column("public_token", sa.String(64), nullable=True))
    op.create_index("ix_agentic_workflows_public_token", "agentic_workflows", ["public_token"], unique=True)


def downgrade():
    op.drop_index("ix_agentic_workflows_public_token", table_name="agentic_workflows")
    for column in ("public_token", "public_enabled", "shared_session_ids", "shared_class_ids"):
        op.drop_column("agentic_workflows", column)
