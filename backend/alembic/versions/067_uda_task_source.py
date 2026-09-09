"""link per-session UDA task copies back to their template

Revision ID: 067_uda_task_source
Revises: 066_studentbots

UDA child tasks used to live only at class level (session_id NULL, class_id set)
and were surfaced to every session of the class — including sessions created
long after the UDA was published. Publishing a UDA now clones each child into a
per-session copy; `source_task_id` ties the copy to the template it came from so
re-publishing is idempotent and never wipes student submissions.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "067_uda_task_source"
down_revision = "066_studentbots"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tasks",
        sa.Column(
            "source_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_tasks_source_task_id", "tasks", ["source_task_id"])


def downgrade():
    op.drop_index("ix_tasks_source_task_id", table_name="tasks")
    op.drop_column("tasks", "source_task_id")
