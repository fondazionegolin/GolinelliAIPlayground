"""add classroom Turing test experiments

Revision ID: 068_turing_test
Revises: 067_uda_task_source
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "068_turing_test"
down_revision = "067_uda_task_source"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "turing_experiments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ACTIVE"),
        sa.Column("persona_prompt", sa.Text(), nullable=False),
        sa.Column("max_questions", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("human_student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("participant_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("max_questions >= 1 AND max_questions <= 10", name="ck_turing_experiments_turing_max_questions"),
    )
    op.create_index("ix_turing_experiments_tenant_id", "turing_experiments", ["tenant_id"])
    op.create_index("ix_turing_experiments_session_id", "turing_experiments", ["session_id"])
    op.create_index("ix_turing_experiments_teacher_id", "turing_experiments", ["teacher_id"])
    op.create_index("ix_turing_experiments_status", "turing_experiments", ["status"])
    op.create_index("ix_turing_experiments_session_status", "turing_experiments", ["session_id", "status"])

    op.create_table(
        "turing_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("turing_experiments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_human", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ACTIVE"),
        sa.Column("question_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("guess", sa.String(length=12), nullable=True),
        sa.Column("confidence", sa.Integer(), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("guessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("experiment_id", "student_id", name="uq_turing_participants_experiment_student"),
        sa.CheckConstraint("question_count >= 0", name="ck_turing_participants_turing_question_count"),
        sa.CheckConstraint("confidence IS NULL OR (confidence >= 1 AND confidence <= 5)", name="ck_turing_participants_turing_confidence"),
    )
    op.create_index("ix_turing_participants_experiment_id", "turing_participants", ["experiment_id"])
    op.create_index("ix_turing_participants_student_id", "turing_participants", ["student_id"])
    op.create_index("ix_turing_participants_experiment_status", "turing_participants", ["experiment_id", "status"])

    op.create_table(
        "turing_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("experiment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("turing_experiments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("turing_participants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_role", sa.String(length=12), nullable=False),
        sa.Column("message_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("sender_role IN ('STUDENT', 'TEACHER', 'AI', 'SYSTEM')", name="ck_turing_messages_turing_sender_role"),
    )
    op.create_index("ix_turing_messages_experiment_id", "turing_messages", ["experiment_id"])
    op.create_index("ix_turing_messages_participant_id", "turing_messages", ["participant_id"])
    op.create_index("ix_turing_messages_participant_created", "turing_messages", ["participant_id", "created_at"])


def downgrade():
    op.drop_table("turing_messages")
    op.drop_table("turing_participants")
    op.drop_table("turing_experiments")
