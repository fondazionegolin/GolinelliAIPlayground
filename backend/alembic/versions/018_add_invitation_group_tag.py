"""add group_tag and custom_message to platform_invitations

Revision ID: 018_add_invitation_group_tag
Revises: 017_add_uda_support
Create Date: 2026-03-18
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '018_add_invitation_group_tag'
down_revision: Union[str, None] = '017_add_uda_support'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('platform_invitations', sa.Column('group_tag', sa.String(120), nullable=True))
    op.add_column('platform_invitations', sa.Column('custom_message', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('platform_invitations', 'group_tag')
    op.drop_column('platform_invitations', 'custom_message')
