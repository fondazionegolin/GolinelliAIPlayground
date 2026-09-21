"""add student consents table

Revision ID: 076_student_consents
Revises: 075_agentic_datasets
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "076_student_consents"
down_revision = "075_agentic_datasets"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "student_consents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("session_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("consent_key", sa.String(80), nullable=False),
        sa.Column("consent_version", sa.String(32), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_student_consents_tenant_id", "student_consents", ["tenant_id"])
    op.create_index("ix_student_consents_session_student_id", "student_consents", ["session_student_id"])
    op.create_unique_constraint(
        "uq_student_consents_student_key_version", "student_consents",
        ["session_student_id", "consent_key", "consent_version"],
    )


def downgrade():
    op.drop_table("student_consents")
