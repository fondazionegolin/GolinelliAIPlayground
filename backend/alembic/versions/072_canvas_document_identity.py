"""scope collaborative canvases by document identity

Revision ID: 072_canvas_document_identity
Revises: 071_turing_personas
"""

import sqlalchemy as sa
from alembic import op


revision = "072_canvas_document_identity"
down_revision = "071_turing_personas"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "session_canvas",
        sa.Column("canvas_key", sa.String(length=240), nullable=False, server_default="lavagna collaborativa"),
    )
    op.execute(
        "UPDATE session_canvas SET canvas_key = LEFT(LOWER(REGEXP_REPLACE(TRIM(title), '\\s+', ' ', 'g')), 240) "
        "WHERE TRIM(COALESCE(title, '')) <> ''"
    )
    op.drop_index("ix_session_canvas_session_id", table_name="session_canvas")
    op.create_index("ix_session_canvas_session_id", "session_canvas", ["session_id"], unique=False)
    op.create_index("ix_session_canvas_canvas_key", "session_canvas", ["canvas_key"], unique=False)
    op.create_unique_constraint("uq_session_canvas_session_key", "session_canvas", ["session_id", "canvas_key"])
    op.alter_column("session_canvas", "canvas_key", server_default=None)


def downgrade():
    op.drop_constraint("uq_session_canvas_session_key", "session_canvas", type_="unique")
    op.drop_index("ix_session_canvas_canvas_key", table_name="session_canvas")
    op.drop_index("ix_session_canvas_session_id", table_name="session_canvas")
    op.create_index("ix_session_canvas_session_id", "session_canvas", ["session_id"], unique=True)
    op.drop_column("session_canvas", "canvas_key")
