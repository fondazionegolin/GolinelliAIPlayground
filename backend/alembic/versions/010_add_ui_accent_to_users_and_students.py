"""add ui accent to users and session students

Revision ID: 010_ui_accent_profiles
Revises: 009_add_document_drafts
Create Date: 2026-02-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010_ui_accent_profiles"
down_revision: Union[str, None] = "009_add_document_drafts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ui_accent", sa.String(length=32), nullable=True))
    op.add_column("session_students", sa.Column("ui_accent", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("session_students", "ui_accent")
    op.drop_column("users", "ui_accent")
