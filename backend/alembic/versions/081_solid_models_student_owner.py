"""3D Lab: students can own solid-modeler projects

Revision ID: 081_solid_models_student
Revises: 080_solid_models
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "081_solid_models_student"
down_revision = "080_solid_models"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("solid_models", "owner_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column(
        "solid_models",
        sa.Column(
            "owner_student_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("session_students.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_solid_models_owner_student_updated", "solid_models", ["owner_student_id", "updated_at"])
    op.create_check_constraint(
        "ck_solid_models_single_owner",
        "solid_models",
        "(owner_id IS NOT NULL) <> (owner_student_id IS NOT NULL)",
    )


def downgrade():
    op.drop_constraint("ck_solid_models_single_owner", "solid_models", type_="check")
    op.drop_index("ix_solid_models_owner_student_updated", table_name="solid_models")
    op.drop_column("solid_models", "owner_student_id")
    op.execute("DELETE FROM solid_models WHERE owner_id IS NULL")
    op.alter_column("solid_models", "owner_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
