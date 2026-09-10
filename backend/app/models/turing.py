import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class TuringExperiment(Base):
    __tablename__ = "turing_experiments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False, default="Test di Turing")
    status = Column(String(24), nullable=False, default="LOBBY", index=True)
    persona_prompt = Column(Text, nullable=False)
    max_questions = Column(Integer, nullable=False, default=5)
    human_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True)
    participant_count = Column(Integer, nullable=False, default=0)
    temperature = Column(Float, nullable=False, default=0.7)
    confidence_style = Column(Integer, nullable=False, default=3)
    response_length = Column(Integer, nullable=False, default=2)
    emoji_usage = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    participants = relationship("TuringParticipant", back_populates="experiment", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("max_questions >= 1 AND max_questions <= 10", name="turing_max_questions"),
        Index("ix_turing_experiments_session_status", "session_id", "status"),
    )


class TuringParticipant(Base):
    __tablename__ = "turing_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey("turing_experiments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False, index=True)
    is_human = Column(Boolean, nullable=False, default=False)
    status = Column(String(24), nullable=False, default="INVITED")
    question_count = Column(Integer, nullable=False, default=0)
    guess = Column(String(12), nullable=True)
    confidence = Column(Integer, nullable=True)
    rationale = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    guessed_at = Column(DateTime(timezone=True), nullable=True)

    experiment = relationship("TuringExperiment", back_populates="participants")
    student = relationship("SessionStudent")
    messages = relationship("TuringMessage", back_populates="participant", cascade="all, delete-orphan", order_by="TuringMessage.created_at")

    __table_args__ = (
        UniqueConstraint("experiment_id", "student_id", name="uq_turing_participants_experiment_student"),
        CheckConstraint("question_count >= 0", name="turing_question_count"),
        CheckConstraint("confidence IS NULL OR (confidence >= 1 AND confidence <= 5)", name="turing_confidence"),
        Index("ix_turing_participants_experiment_status", "experiment_id", "status"),
    )


class TuringMessage(Base):
    __tablename__ = "turing_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    experiment_id = Column(UUID(as_uuid=True), ForeignKey("turing_experiments.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_id = Column(UUID(as_uuid=True), ForeignKey("turing_participants.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_role = Column(String(12), nullable=False)
    message_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    participant = relationship("TuringParticipant", back_populates="messages")

    __table_args__ = (
        CheckConstraint("sender_role IN ('STUDENT', 'TEACHER', 'AI', 'SYSTEM')", name="turing_sender_role"),
        Index("ix_turing_messages_participant_created", "participant_id", "created_at"),
    )


class TuringTeacherSettings(Base):
    __tablename__ = "turing_teacher_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    persona_prompt = Column(Text, nullable=False)
    temperature = Column(Float, nullable=False, default=0.7)
    confidence_style = Column(Integer, nullable=False, default=3)
    response_length = Column(Integer, nullable=False, default=2)
    emoji_usage = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("temperature >= 0 AND temperature <= 1.2", name="turing_settings_temperature"),
        CheckConstraint("confidence_style >= 1 AND confidence_style <= 5", name="turing_settings_confidence"),
        CheckConstraint("response_length >= 1 AND response_length <= 5", name="turing_settings_length"),
        CheckConstraint("emoji_usage >= 0 AND emoji_usage <= 3", name="turing_settings_emoji"),
    )
