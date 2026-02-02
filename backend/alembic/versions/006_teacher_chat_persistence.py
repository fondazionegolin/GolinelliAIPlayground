"""add teacher conversations and user preferences

Revision ID: 006_teacher_chat_persistence
Revises: 005_teacher_invitations
Create Date: 2026-02-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '006_teacher_chat_persistence'
down_revision: Union[str, None] = '005_teacher_invitations'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add preferences_json to users table
    op.add_column('users', sa.Column('preferences_json', postgresql.JSONB(astext_type=sa.Text()), 
                                      server_default='{}', nullable=False))
    
    # Create teacher_conversations table
    op.create_table('teacher_conversations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=True),
        sa.Column('agent_mode', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], name=op.f('fk_teacher_conversations_teacher_id_users')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_teacher_conversations_tenant_id_tenants')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_teacher_conversations'))
    )
    op.create_index('ix_teacher_conversations_teacher_id', 'teacher_conversations', ['teacher_id'], unique=False)
    op.create_index('ix_teacher_conversations_tenant_id', 'teacher_conversations', ['tenant_id'], unique=False)
    op.create_index('ix_teacher_conversations_teacher_updated', 'teacher_conversations', ['teacher_id', 'updated_at'], unique=False)
    
    # Create teacher_conversation_messages table
    # Use VARCHAR for role to avoid conflict with existing messagerole enum
    op.create_table('teacher_conversation_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),  # 'user' or 'assistant'
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('attachments_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('model', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['teacher_conversations.id'], name=op.f('fk_teacher_conversation_messages_conversation_id')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_teacher_conversation_messages_tenant_id_tenants')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_teacher_conversation_messages'))
    )
    op.create_index('ix_teacher_conversation_messages_conversation_id', 'teacher_conversation_messages', ['conversation_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_teacher_conversation_messages_conversation_id', table_name='teacher_conversation_messages')
    op.drop_table('teacher_conversation_messages')
    op.drop_index('ix_teacher_conversations_teacher_updated', table_name='teacher_conversations')
    op.drop_index('ix_teacher_conversations_tenant_id', table_name='teacher_conversations')
    op.drop_index('ix_teacher_conversations_teacher_id', table_name='teacher_conversations')
    op.drop_table('teacher_conversations')
    op.drop_column('users', 'preferences_json')
