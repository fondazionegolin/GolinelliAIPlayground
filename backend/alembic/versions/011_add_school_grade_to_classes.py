"""add school_grade to classes

Revision ID: 011_add_school_grade
Revises: 010_ui_accent_profiles
Create Date: 2026-02-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "011_add_school_grade"
down_revision: Union[str, None] = "010_ui_accent_profiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("classes", sa.Column("school_grade", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("classes", "school_grade")

