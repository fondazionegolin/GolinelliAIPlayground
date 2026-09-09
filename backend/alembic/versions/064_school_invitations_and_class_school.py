"""school invitations and explicit class school

Revision ID: 064_school_invites
Revises: 063_teacher_school_memberships
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "064_school_invites"
down_revision = "063_teacher_school_memberships"
branch_labels = None
depends_on = None


def upgrade():
    invitation_status = postgresql.ENUM(
        "pending", "accepted", "declined", "expired",
        name="invitationstatus", create_type=False,
    )
    op.add_column(
        "classes",
        sa.Column("school_tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_classes_school_tenant_id", "classes", ["school_tenant_id"])
    op.create_table(
        "teacher_school_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("school_tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_by_admin_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", invitation_status, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("teacher_id", "school_tenant_id", name="uq_teacher_school_invitation"),
    )
    op.create_index("ix_teacher_school_invitations_teacher_id", "teacher_school_invitations", ["teacher_id"])
    op.create_index("ix_teacher_school_invitations_school_tenant_id", "teacher_school_invitations", ["school_tenant_id"])
    op.execute("""
        UPDATE classes
        SET school_tenant_id = classes.tenant_id
        FROM tenants
        WHERE tenants.id = classes.tenant_id AND tenants.tenant_type = 'SCHOOL'
    """)
    op.execute("""
        WITH single_school AS (
            SELECT teacher_id, min(school_tenant_id::text)::uuid AS school_tenant_id
            FROM teacher_school_memberships
            GROUP BY teacher_id
            HAVING count(*) = 1
        )
        UPDATE classes
        SET school_tenant_id = single_school.school_tenant_id
        FROM single_school
        WHERE classes.teacher_id = single_school.teacher_id AND classes.school_tenant_id IS NULL
    """)


def downgrade():
    op.drop_table("teacher_school_invitations")
    op.drop_index("ix_classes_school_tenant_id", table_name="classes")
    op.drop_column("classes", "school_tenant_id")
