"""Smart canvases: sharing with a session, student-owned boards."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "110_smart_canvas_sharing"
down_revision = "109_smart_canvases"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("smart_canvases", "owner_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("smart_canvases", sa.Column("owner_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True))
    op.add_column("smart_canvases", sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True))
    op.add_column("smart_canvases", sa.Column("canvas_key", sa.String(240), nullable=True))
    op.create_index("ix_smart_canvases_owner_student_id", "smart_canvases", ["owner_student_id"])
    op.create_index("ix_smart_canvases_session_id", "smart_canvases", ["session_id"])


def downgrade():
    op.drop_index("ix_smart_canvases_session_id", table_name="smart_canvases")
    op.drop_index("ix_smart_canvases_owner_student_id", table_name="smart_canvases")
    op.drop_column("smart_canvases", "canvas_key")
    op.drop_column("smart_canvases", "session_id")
    op.drop_column("smart_canvases", "owner_student_id")
    op.alter_column("smart_canvases", "owner_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
