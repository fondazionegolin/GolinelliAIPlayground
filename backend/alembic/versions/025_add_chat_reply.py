"""add reply_to_id and reply_preview to chat_messages

Revision ID: 025_add_chat_reply
Revises: 024_add_password_reset_tokens
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '025_add_chat_reply'
down_revision = '024_add_password_reset_tokens'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('chat_messages', sa.Column(
        'reply_to_id',
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey('chat_messages.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.add_column('chat_messages', sa.Column(
        'reply_preview',
        sa.Text,
        nullable=True,
    ))
    op.create_index('ix_chat_messages_reply_to_id', 'chat_messages', ['reply_to_id'])


def downgrade():
    op.drop_index('ix_chat_messages_reply_to_id', table_name='chat_messages')
    op.drop_column('chat_messages', 'reply_preview')
    op.drop_column('chat_messages', 'reply_to_id')
