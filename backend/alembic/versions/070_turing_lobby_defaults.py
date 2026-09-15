"""set Turing lobby defaults

Revision ID: 070_turing_lobby_defaults
Revises: 069_turing_lobby_settings
"""

from alembic import op


revision = "070_turing_lobby_defaults"
down_revision = "069_turing_lobby_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("turing_experiments", "status", server_default="LOBBY")
    op.alter_column("turing_participants", "status", server_default="INVITED")


def downgrade():
    op.alter_column("turing_participants", "status", server_default="ACTIVE")
    op.alter_column("turing_experiments", "status", server_default="ACTIVE")
