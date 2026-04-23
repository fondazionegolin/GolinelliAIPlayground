"""add admin backend widget templates and changelog releases

Revision ID: 032_admin_backend_features
Revises: 031_teacher_conv_doc
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '032_admin_backend_features'
down_revision = '031_teacher_conv_doc'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'admin_desktop_widget_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_admin_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('audience', sa.String(length=16), nullable=False, server_default='all'),
        sa.Column('title', sa.String(length=120), nullable=False, server_default='Widget'),
        sa.Column('widget_type', sa.String(length=32), nullable=False),
        sa.Column('target_desktop_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('grid_x', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('grid_y', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('grid_w', sa.Integer(), nullable=False, server_default='4'),
        sa.Column('grid_h', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('config_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_admin_desktop_widget_templates_tenant', 'admin_desktop_widget_templates', ['tenant_id'])
    op.create_index('ix_admin_desktop_widget_templates_audience', 'admin_desktop_widget_templates', ['audience'])

    op.add_column('desktop_widgets', sa.Column('source_template_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('desktop_widgets', sa.Column('is_locked', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.create_foreign_key(
        'fk_desktop_widgets_source_template',
        'desktop_widgets',
        'admin_desktop_widget_templates',
        ['source_template_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_desktop_widgets_source_template', 'desktop_widgets', ['source_template_id'])

    op.create_table(
        'platform_changelog_releases',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_admin_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('version_label', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('items_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('git_ref', sa.String(length=120), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_platform_changelog_releases_tenant', 'platform_changelog_releases', ['tenant_id'])
    op.create_index('ix_platform_changelog_releases_published_at', 'platform_changelog_releases', ['published_at'])


def downgrade():
    op.drop_index('ix_platform_changelog_releases_published_at', table_name='platform_changelog_releases')
    op.drop_index('ix_platform_changelog_releases_tenant', table_name='platform_changelog_releases')
    op.drop_table('platform_changelog_releases')

    op.drop_index('ix_desktop_widgets_source_template', table_name='desktop_widgets')
    op.drop_constraint('fk_desktop_widgets_source_template', 'desktop_widgets', type_='foreignkey')
    op.drop_column('desktop_widgets', 'is_locked')
    op.drop_column('desktop_widgets', 'source_template_id')

    op.drop_index('ix_admin_desktop_widget_templates_audience', table_name='admin_desktop_widget_templates')
    op.drop_index('ix_admin_desktop_widget_templates_tenant', table_name='admin_desktop_widget_templates')
    op.drop_table('admin_desktop_widget_templates')
