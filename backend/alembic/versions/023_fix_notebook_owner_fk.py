"""remove FK on notebooks.owner_id — owner can be teacher (users) or student (session_students)

Revision ID: 023_fix_notebook_owner_fk
Revises: 022_add_notebooks
Create Date: 2026-03-26
"""
from alembic import op

revision = '023_fix_notebook_owner_fk'
down_revision = '022_add_notebooks'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the FK constraint so owner_id can hold either a User.id or a SessionStudent.id
    op.drop_constraint('fk_notebooks_owner_id_users', 'notebooks', type_='foreignkey')


def downgrade():
    op.create_foreign_key(
        'notebooks_owner_id_fkey', 'notebooks', 'users', ['owner_id'], ['id'], ondelete='CASCADE'
    )
