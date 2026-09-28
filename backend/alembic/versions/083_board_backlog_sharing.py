"""Boards: AI backlog (framework, labels, card metadata), per-user sharing, assignees

Revision ID: 083_board_backlog_sharing
Revises: 082_agentic_node_run_visits
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "083_board_backlog_sharing"
down_revision = "082_agentic_node_run_visits"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("boards", sa.Column("framework", sa.String(20), nullable=True))
    op.add_column("boards", sa.Column("labels_json", postgresql.JSONB(), nullable=False, server_default="[]"))

    op.add_column("board_cards", sa.Column("labels", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.add_column("board_cards", sa.Column("assignees", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.add_column("board_cards", sa.Column("card_type", sa.String(16), nullable=True))
    op.add_column("board_cards", sa.Column("priority", sa.String(16), nullable=True))
    op.add_column("board_cards", sa.Column("story_points", sa.Integer(), nullable=True))
    op.add_column(
        "board_cards",
        sa.Column("parent_card_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("board_cards.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_board_cards_parent_card_id", "board_cards", ["parent_card_id"])

    op.create_table(
        "board_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("board_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("(user_id IS NULL) <> (student_id IS NULL)", name="ck_board_shares_one_target"),
        sa.UniqueConstraint("board_id", "user_id", name="uq_board_shares_user"),
        sa.UniqueConstraint("board_id", "student_id", name="uq_board_shares_student"),
    )
    op.create_index("ix_board_shares_board_id", "board_shares", ["board_id"])
    op.create_index("ix_board_shares_user_id", "board_shares", ["user_id"])
    op.create_index("ix_board_shares_student_id", "board_shares", ["student_id"])


def downgrade():
    op.drop_index("ix_board_shares_student_id", table_name="board_shares")
    op.drop_index("ix_board_shares_user_id", table_name="board_shares")
    op.drop_index("ix_board_shares_board_id", table_name="board_shares")
    op.drop_table("board_shares")
    op.drop_index("ix_board_cards_parent_card_id", table_name="board_cards")
    for col in ("parent_card_id", "story_points", "priority", "card_type", "assignees", "labels"):
        op.drop_column("board_cards", col)
    op.drop_column("boards", "labels_json")
    op.drop_column("boards", "framework")
