"""drop legacy session-only canvas uniqueness

Revision ID: 073_canvas_multi_doc
Revises: 072_canvas_document_identity
"""

from alembic import op


revision = "073_canvas_multi_doc"
down_revision = "072_canvas_document_identity"
branch_labels = None
depends_on = None


def upgrade():
    # Older databases contain both ix_session_canvas_session_id and this
    # constraint.  The document-scoped composite constraint introduced in 072
    # is now the only uniqueness rule that should remain.
    op.execute("ALTER TABLE session_canvas DROP CONSTRAINT IF EXISTS uq_session_canvas_session_id")


def downgrade():
    # Downgrading is only safe when each session has at most one canvas.
    op.create_unique_constraint("uq_session_canvas_session_id", "session_canvas", ["session_id"])
