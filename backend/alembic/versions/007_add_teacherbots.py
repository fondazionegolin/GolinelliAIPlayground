"""add teacherbots tables

Revision ID: 007_add_teacherbots
Revises: 006_teacher_chat_persistence
Create Date: 2026-02-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '007_add_teacherbots'
down_revision: Union[str, None] = '006_teacher_chat_persistence'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create teacherbotstatus enum
    teacherbot_status = postgresql.ENUM('draft', 'testing', 'published', 'archived', name='teacherbotstatus')
    teacherbot_status.create(op.get_bind())

    # Create teacherbots table
    op.create_table('teacherbots',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('synopsis', sa.String(length=255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(length=50), server_default='bot', nullable=False),
        sa.Column('color', sa.String(length=20), server_default='indigo', nullable=False),
        sa.Column('system_prompt', sa.Text(), nullable=False),
        sa.Column('is_proactive', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('proactive_message', sa.Text(), nullable=True),
        sa.Column('enable_reporting', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('report_prompt', sa.Text(), nullable=True),
        sa.Column('llm_provider', sa.String(), nullable=True),
        sa.Column('llm_model', sa.String(), nullable=True),
        sa.Column('temperature', sa.Float(), server_default='0.7', nullable=False),
        sa.Column('status', postgresql.ENUM('draft', 'testing', 'published', 'archived', name='teacherbotstatus', create_type=False), server_default='draft', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], name=op.f('fk_teacherbots_teacher_id_users')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_teacherbots_tenant_id_tenants')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_teacherbots'))
    )
    op.create_index('ix_teacherbots_tenant_id', 'teacherbots', ['tenant_id'], unique=False)
    op.create_index('ix_teacherbots_teacher_id', 'teacherbots', ['teacher_id'], unique=False)
    op.create_index('ix_teacherbots_teacher_status', 'teacherbots', ['teacher_id', 'status'], unique=False)

    # Create teacherbot_publications table
    op.create_table('teacherbot_publications',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacherbot_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('published_by_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], name=op.f('fk_teacherbot_publications_class_id_classes')),
        sa.ForeignKeyConstraint(['published_by_id'], ['users.id'], name=op.f('fk_teacherbot_publications_published_by_id_users')),
        sa.ForeignKeyConstraint(['teacherbot_id'], ['teacherbots.id'], name=op.f('fk_teacherbot_publications_teacherbot_id_teacherbots')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_teacherbot_publications_tenant_id_tenants')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_teacherbot_publications'))
    )
    op.create_index('ix_teacherbot_publications_tenant_id', 'teacherbot_publications', ['tenant_id'], unique=False)
    op.create_index('ix_teacherbot_publications_teacherbot_id', 'teacherbot_publications', ['teacherbot_id'], unique=False)
    op.create_index('ix_teacherbot_publications_class_id', 'teacherbot_publications', ['class_id'], unique=False)
    op.create_index('ix_teacherbot_publications_class_active', 'teacherbot_publications', ['class_id', 'is_active'], unique=False)

    # Create teacherbot_conversations table
    op.create_table('teacherbot_conversations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacherbot_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('report_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('report_generated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], name=op.f('fk_teacherbot_conversations_session_id_sessions')),
        sa.ForeignKeyConstraint(['student_id'], ['session_students.id'], name=op.f('fk_teacherbot_conversations_student_id_session_students')),
        sa.ForeignKeyConstraint(['teacherbot_id'], ['teacherbots.id'], name=op.f('fk_teacherbot_conversations_teacherbot_id_teacherbots')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_teacherbot_conversations_tenant_id_tenants')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_teacherbot_conversations'))
    )
    op.create_index('ix_teacherbot_conversations_tenant_id', 'teacherbot_conversations', ['tenant_id'], unique=False)
    op.create_index('ix_teacherbot_conversations_teacherbot_id', 'teacherbot_conversations', ['teacherbot_id'], unique=False)
    op.create_index('ix_teacherbot_conversations_student_id', 'teacherbot_conversations', ['student_id'], unique=False)
    op.create_index('ix_teacherbot_conversations_session_id', 'teacherbot_conversations', ['session_id'], unique=False)
    op.create_index('ix_teacherbot_conversations_teacherbot_student', 'teacherbot_conversations', ['teacherbot_id', 'student_id'], unique=False)
    op.create_index('ix_teacherbot_conversations_session', 'teacherbot_conversations', ['session_id', 'created_at'], unique=False)

    # Create teacherbot_messages table
    op.create_table('teacherbot_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('model', sa.String(), nullable=True),
        sa.Column('token_usage_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['teacherbot_conversations.id'], name=op.f('fk_teacherbot_messages_conversation_id_teacherbot_conversations')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_teacherbot_messages_tenant_id_tenants')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_teacherbot_messages'))
    )
    op.create_index('ix_teacherbot_messages_conversation_id', 'teacherbot_messages', ['conversation_id'], unique=False)


def downgrade() -> None:
    # Drop teacherbot_messages
    op.drop_index('ix_teacherbot_messages_conversation_id', table_name='teacherbot_messages')
    op.drop_table('teacherbot_messages')

    # Drop teacherbot_conversations
    op.drop_index('ix_teacherbot_conversations_session', table_name='teacherbot_conversations')
    op.drop_index('ix_teacherbot_conversations_teacherbot_student', table_name='teacherbot_conversations')
    op.drop_index('ix_teacherbot_conversations_session_id', table_name='teacherbot_conversations')
    op.drop_index('ix_teacherbot_conversations_student_id', table_name='teacherbot_conversations')
    op.drop_index('ix_teacherbot_conversations_teacherbot_id', table_name='teacherbot_conversations')
    op.drop_index('ix_teacherbot_conversations_tenant_id', table_name='teacherbot_conversations')
    op.drop_table('teacherbot_conversations')

    # Drop teacherbot_publications
    op.drop_index('ix_teacherbot_publications_class_active', table_name='teacherbot_publications')
    op.drop_index('ix_teacherbot_publications_class_id', table_name='teacherbot_publications')
    op.drop_index('ix_teacherbot_publications_teacherbot_id', table_name='teacherbot_publications')
    op.drop_index('ix_teacherbot_publications_tenant_id', table_name='teacherbot_publications')
    op.drop_table('teacherbot_publications')

    # Drop teacherbots
    op.drop_index('ix_teacherbots_teacher_status', table_name='teacherbots')
    op.drop_index('ix_teacherbots_teacher_id', table_name='teacherbots')
    op.drop_index('ix_teacherbots_tenant_id', table_name='teacherbots')
    op.drop_table('teacherbots')

    # Drop enum
    postgresql.ENUM('draft', 'testing', 'published', 'archived', name='teacherbotstatus').drop(op.get_bind())
