"""allow teacherbot publications to target a single student, not just a whole class

Revision ID: 058_teacherbot_student_pub
Revises: 057_teacherbot_share_links
Create Date: 2026-07-17 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "058_teacherbot_student_pub"
down_revision = "057_teacherbot_share_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("teacherbot_publications", "class_id", nullable=True)
    op.add_column(
        "teacherbot_publications",
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_teacherbot_publications_student_id",
        "teacherbot_publications",
        "session_students",
        ["student_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_teacherbot_publications_student_active",
        "teacherbot_publications",
        ["student_id", "is_active"],
    )
    op.create_check_constraint(
        "ck_teacherbot_publications_one_target",
        "teacherbot_publications",
        "(class_id IS NOT NULL) != (student_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_teacherbot_publications_one_target", "teacherbot_publications", type_="check")
    op.drop_index("ix_teacherbot_publications_student_active", table_name="teacherbot_publications")
    op.drop_constraint("fk_teacherbot_publications_student_id", "teacherbot_publications", type_="foreignkey")
    op.drop_column("teacherbot_publications", "student_id")
    op.alter_column("teacherbot_publications", "class_id", nullable=False)
