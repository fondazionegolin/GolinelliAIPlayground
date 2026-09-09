"""add many-to-many teacher school memberships

Revision ID: 063_teacher_school_memberships
Revises: 062_task_feedback_read_at
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "063_teacher_school_memberships"
down_revision = "062_task_feedback_read_at"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "teacher_school_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("school_tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_admin_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("teacher_id", "school_tenant_id", name="uq_teacher_school_membership"),
    )
    op.create_index("ix_teacher_school_memberships_teacher_id", "teacher_school_memberships", ["teacher_id"])
    op.create_index("ix_teacher_school_memberships_school_tenant_id", "teacher_school_memberships", ["school_tenant_id"])

    # Existing SCHOOL users keep their current school membership. Individual/legacy
    # users intentionally remain without a school until an admin assigns one.
    op.execute("""
        INSERT INTO teacher_school_memberships (id, teacher_id, school_tenant_id, created_at)
        SELECT gen_random_uuid(), users.id, users.tenant_id, now()
        FROM users
        JOIN tenants ON tenants.id = users.tenant_id
        WHERE users.role = 'TEACHER' AND tenants.tenant_type = 'SCHOOL'
        ON CONFLICT (teacher_id, school_tenant_id) DO NOTHING
    """)


def downgrade():
    op.drop_table("teacher_school_memberships")
