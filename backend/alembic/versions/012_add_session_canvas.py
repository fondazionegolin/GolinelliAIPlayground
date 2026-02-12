"""add session canvas table

Revision ID: 012_add_session_canvas
Revises: 011_add_school_grade
Create Date: 2026-02-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "012_add_session_canvas"
down_revision: Union[str, None] = "011_add_school_grade"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_canvas",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_by_teacher_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_student_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["updated_by_student_id"], ["session_students.id"]),
        sa.ForeignKeyConstraint(["updated_by_teacher_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index(op.f("ix_session_canvas_session_id"), "session_canvas", ["session_id"], unique=True)
    op.create_index(op.f("ix_session_canvas_tenant_id"), "session_canvas", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_session_canvas_updated_by_student_id"), "session_canvas", ["updated_by_student_id"], unique=False)
    op.create_index(op.f("ix_session_canvas_updated_by_teacher_id"), "session_canvas", ["updated_by_teacher_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_session_canvas_updated_by_teacher_id"), table_name="session_canvas")
    op.drop_index(op.f("ix_session_canvas_updated_by_student_id"), table_name="session_canvas")
    op.drop_index(op.f("ix_session_canvas_tenant_id"), table_name="session_canvas")
    op.drop_index(op.f("ix_session_canvas_session_id"), table_name="session_canvas")
    op.drop_table("session_canvas")
