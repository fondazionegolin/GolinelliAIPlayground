"""add user_desktops and desktop_widgets tables

Revision ID: 026_add_desktop
Revises: 025_add_chat_reply
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '026_add_desktop'
down_revision = '025_add_chat_reply'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_desktops',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('owner_teacher_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_student_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('session_students.id', ondelete='CASCADE'), nullable=True),
        sa.Column('title', sa.String(100), nullable=False, server_default='Desktop'),
        sa.Column('wallpaper_key', sa.String(200), nullable=False, server_default='gradient_midnight'),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('ix_user_desktops_teacher', 'user_desktops', ['owner_teacher_id'])
    op.create_index('ix_user_desktops_student', 'user_desktops', ['owner_student_id'])
    op.create_index('ix_user_desktops_tenant', 'user_desktops', ['tenant_id'])

    op.create_table(
        'desktop_widgets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('desktop_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('user_desktops.id', ondelete='CASCADE'), nullable=False),
        sa.Column('widget_type', sa.String(32), nullable=False),  # CLOCK, CALENDAR, NOTE, TASKLIST, FILE_REF, IMAGE_REF
        sa.Column('grid_x', sa.Integer, nullable=False, server_default='0'),
        sa.Column('grid_y', sa.Integer, nullable=False, server_default='0'),
        sa.Column('grid_w', sa.Integer, nullable=False, server_default='4'),
        sa.Column('grid_h', sa.Integer, nullable=False, server_default='3'),
        sa.Column('config_json', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_desktop_widgets_desktop', 'desktop_widgets', ['desktop_id'])


def downgrade():
    op.drop_table('desktop_widgets')
    op.drop_table('user_desktops')
