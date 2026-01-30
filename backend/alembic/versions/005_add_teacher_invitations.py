"""Add teacher invitations tables

Revision ID: 005_teacher_invitations
Revises: 004_add_student_avatar
Create Date: 2026-01-30

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '005_teacher_invitations'
down_revision = '004_add_student_avatar'
branch_labels = None
depends_on = None

# Define the enum - create_type=False means don't auto-create when binding to a column
invitationstatus_enum = postgresql.ENUM(
    'pending', 'accepted', 'declined', 'expired',
    name='invitationstatus',
    create_type=False
)


def upgrade() -> None:
    # Create invitation_status enum (check if it already exists)
    conn = op.get_bind()
    result = conn.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'invitationstatus'"))
    if not result.fetchone():
        invitationstatus_enum.create(conn, checkfirst=True)

    # Create class_teachers table
    op.create_table(
        'class_teachers',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('added_by_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['added_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('class_id', 'teacher_id', name='uq_class_teacher'),
    )
    op.create_index('ix_class_teachers_tenant_id', 'class_teachers', ['tenant_id'])
    op.create_index('ix_class_teachers_class_id', 'class_teachers', ['class_id'])
    op.create_index('ix_class_teachers_teacher_id', 'class_teachers', ['teacher_id'])

    # Create class_invitations table
    op.create_table(
        'class_invitations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('inviter_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('invitee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', invitationstatus_enum, nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['inviter_id'], ['users.id']),
        sa.ForeignKeyConstraint(['invitee_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('class_id', 'invitee_id', name='uq_class_invitation'),
    )
    op.create_index('ix_class_invitations_tenant_id', 'class_invitations', ['tenant_id'])
    op.create_index('ix_class_invitations_class_id', 'class_invitations', ['class_id'])
    op.create_index('ix_class_invitations_inviter_id', 'class_invitations', ['inviter_id'])
    op.create_index('ix_class_invitations_invitee_id', 'class_invitations', ['invitee_id'])

    # Create session_teachers table
    op.create_table(
        'session_teachers',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('added_by_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['added_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', 'teacher_id', name='uq_session_teacher'),
    )
    op.create_index('ix_session_teachers_tenant_id', 'session_teachers', ['tenant_id'])
    op.create_index('ix_session_teachers_session_id', 'session_teachers', ['session_id'])
    op.create_index('ix_session_teachers_teacher_id', 'session_teachers', ['teacher_id'])

    # Create session_invitations table
    op.create_table(
        'session_invitations',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('inviter_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('invitee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', invitationstatus_enum, nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['inviter_id'], ['users.id']),
        sa.ForeignKeyConstraint(['invitee_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', 'invitee_id', name='uq_session_invitation'),
    )
    op.create_index('ix_session_invitations_tenant_id', 'session_invitations', ['tenant_id'])
    op.create_index('ix_session_invitations_session_id', 'session_invitations', ['session_id'])
    op.create_index('ix_session_invitations_inviter_id', 'session_invitations', ['inviter_id'])
    op.create_index('ix_session_invitations_invitee_id', 'session_invitations', ['invitee_id'])


def downgrade() -> None:
    # Drop session_invitations table
    op.drop_index('ix_session_invitations_invitee_id', table_name='session_invitations')
    op.drop_index('ix_session_invitations_inviter_id', table_name='session_invitations')
    op.drop_index('ix_session_invitations_session_id', table_name='session_invitations')
    op.drop_index('ix_session_invitations_tenant_id', table_name='session_invitations')
    op.drop_table('session_invitations')

    # Drop session_teachers table
    op.drop_index('ix_session_teachers_teacher_id', table_name='session_teachers')
    op.drop_index('ix_session_teachers_session_id', table_name='session_teachers')
    op.drop_index('ix_session_teachers_tenant_id', table_name='session_teachers')
    op.drop_table('session_teachers')

    # Drop class_invitations table
    op.drop_index('ix_class_invitations_invitee_id', table_name='class_invitations')
    op.drop_index('ix_class_invitations_inviter_id', table_name='class_invitations')
    op.drop_index('ix_class_invitations_class_id', table_name='class_invitations')
    op.drop_index('ix_class_invitations_tenant_id', table_name='class_invitations')
    op.drop_table('class_invitations')

    # Drop class_teachers table
    op.drop_index('ix_class_teachers_teacher_id', table_name='class_teachers')
    op.drop_index('ix_class_teachers_class_id', table_name='class_teachers')
    op.drop_index('ix_class_teachers_tenant_id', table_name='class_teachers')
    op.drop_table('class_teachers')

    # Drop enum
    invitationstatus_enum.drop(op.get_bind(), checkfirst=True)
