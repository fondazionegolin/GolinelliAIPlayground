"""add password hash to session students

Revision ID: 033_student_pw_hash
Revises: 032_admin_backend_features
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa


revision = "033_student_pw_hash"
down_revision = "032_admin_backend_features"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("session_students", sa.Column("password_hash", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("session_students", "password_hash")
