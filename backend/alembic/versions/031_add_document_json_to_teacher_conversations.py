"""add document_json to teacher_conversations

Revision ID: 031_teacher_conv_doc
Revises: 030_nb_proj_settings
Create Date: 2026-04-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = '031_teacher_conv_doc'
down_revision = '030_nb_proj_settings'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('teacher_conversations', sa.Column('document_json', JSONB, nullable=True))


def downgrade():
    op.drop_column('teacher_conversations', 'document_json')
