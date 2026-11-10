"""Student smart boards become private until their owner shares them.

Until now a student's board was created already linked to a live session canvas, so it looked "shared" although
classmates could not open it. Sharing is now a deliberate action: a board is shared exactly when it has a live
session canvas. Existing student boards keep their content (copied back into the board row) and become private.
"""
from alembic import op

revision = "122_smart_canvas_private"
down_revision = "121_calendar_recurrence"
branch_labels = None
depends_on = None


def upgrade():
    # 1. copy the live content back into the board (lossless), 2. drop the live canvas, 3. mark private.
    op.execute("""
        UPDATE smart_canvases sc SET content_json = c.content_json
        FROM session_canvas c
        WHERE sc.owner_student_id IS NOT NULL AND sc.canvas_key IS NOT NULL
          AND c.session_id = sc.session_id AND c.canvas_key = sc.canvas_key
    """)
    op.execute("""
        DELETE FROM session_canvas c USING smart_canvases sc
        WHERE sc.owner_student_id IS NOT NULL AND sc.canvas_key IS NOT NULL
          AND c.session_id = sc.session_id AND c.canvas_key = sc.canvas_key
    """)
    op.execute("UPDATE smart_canvases SET canvas_key = NULL WHERE owner_student_id IS NOT NULL")


def downgrade():
    pass  # private boards stay private; the owner can share them again
