"""allow students to create private studentbots

Revision ID: 066_studentbots
Revises: 065_session_creator
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "066_studentbots"
down_revision = "065_session_creator"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("teacherbots", "teacher_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column(
        "teacherbots",
        sa.Column(
            "creator_student_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("session_students.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_teacherbots_creator_student_id", "teacherbots", ["creator_student_id"])
    op.create_index("ix_teacherbots_student_status", "teacherbots", ["creator_student_id", "status"])
    op.create_check_constraint(
        "ck_teacherbots_exactly_one_creator",
        "teacherbots",
        "(teacher_id IS NOT NULL) != (creator_student_id IS NOT NULL)",
    )


def downgrade():
    op.drop_constraint("ck_teacherbots_exactly_one_creator", "teacherbots", type_="check")
    op.drop_index("ix_teacherbots_student_status", table_name="teacherbots")
    op.drop_index("ix_teacherbots_creator_student_id", table_name="teacherbots")
    op.drop_column("teacherbots", "creator_student_id")
    op.alter_column("teacherbots", "teacher_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
