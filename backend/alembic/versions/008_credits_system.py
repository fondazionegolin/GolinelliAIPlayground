"""add credit system tables

Revision ID: 007_credits_system
Revises: 006_teacher_chat_persistence
Create Date: 2026-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '008_credits_system'
down_revision: Union[str, None] = '007_add_teacherbots'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Credit Limits ---
    op.create_table('credit_limits',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('level', sa.String(length=50), nullable=False), # GLOBAL, TEACHER, CLASS, etc.
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('amount_cap', sa.Float(), nullable=False, default=0.0),
        sa.Column('current_usage', sa.Float(), nullable=False, default=0.0),
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reset_frequency', sa.String(length=50), nullable=True, default="MONTHLY"),
        sa.Column('last_updated', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_credit_limits_tenant_id_tenants')),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], name=op.f('fk_credit_limits_teacher_id_users')),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], name=op.f('fk_credit_limits_class_id_classes')),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], name=op.f('fk_credit_limits_session_id_sessions')),
        sa.ForeignKeyConstraint(['student_id'], ['session_students.id'], name=op.f('fk_credit_limits_student_id_session_students')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_credit_limits'))
    )
    op.create_index(op.f('ix_credit_limits_tenant_id'), 'credit_limits', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_credit_limits_teacher_id'), 'credit_limits', ['teacher_id'], unique=False)
    op.create_index(op.f('ix_credit_limits_class_id'), 'credit_limits', ['class_id'], unique=False)

    # --- Credit Transactions ---
    op.create_table('credit_transactions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('transaction_type', sa.String(length=50), nullable=False), # API_CALL, ADJUSTMENT, etc.
        sa.Column('cost', sa.Float(), nullable=False, default=0.0),
        sa.Column('provider', sa.String(length=100), nullable=True),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('usage_details', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('student_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_credit_transactions_tenant_id_tenants')),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], name=op.f('fk_credit_transactions_teacher_id_users')),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], name=op.f('fk_credit_transactions_class_id_classes')),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], name=op.f('fk_credit_transactions_session_id_sessions')),
        sa.ForeignKeyConstraint(['student_id'], ['session_students.id'], name=op.f('fk_credit_transactions_student_id_session_students')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_credit_transactions'))
    )
    op.create_index(op.f('ix_credit_transactions_timestamp'), 'credit_transactions', ['timestamp'], unique=False)
    op.create_index(op.f('ix_credit_transactions_tenant_id'), 'credit_transactions', ['tenant_id'], unique=False)

    # --- Credit Requests ---
    op.create_table('credit_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('requester_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('amount_requested', sa.Float(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='PENDING'),
        sa.Column('reviewed_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('admin_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_credit_requests_tenant_id_tenants')),
        sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name=op.f('fk_credit_requests_requester_id_users')),
        sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id'], name=op.f('fk_credit_requests_reviewed_by_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_credit_requests'))
    )
    
    # --- Platform Invitations ---
    op.create_table('platform_invitations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('first_name', sa.String(), nullable=True),
        sa.Column('last_name', sa.String(), nullable=True),
        sa.Column('school', sa.String(), nullable=True),
        sa.Column('role', sa.String(), nullable=True, server_default='TEACHER'),
        sa.Column('token', sa.String(), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='PENDING'),
        sa.Column('invited_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], name=op.f('fk_platform_invitations_tenant_id_tenants')),
        sa.ForeignKeyConstraint(['invited_by_id'], ['users.id'], name=op.f('fk_platform_invitations_invited_by_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_platform_invitations')),
        sa.UniqueConstraint('token', name=op.f('uq_platform_invitations_token'))
    )
    op.create_index(op.f('ix_platform_invitations_email'), 'platform_invitations', ['email'], unique=False)
    op.create_index(op.f('ix_platform_invitations_token'), 'platform_invitations', ['token'], unique=False)


def downgrade() -> None:
    op.drop_table('platform_invitations')
    op.drop_table('credit_requests')
    op.drop_table('credit_transactions')
    op.drop_table('credit_limits')
