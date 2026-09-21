from sqlalchemy import Boolean, Column, String, Integer, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base


class LiveInteraction(Base):
    __tablename__ = "live_interactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    interaction_type = Column(String, default="slides", nullable=False)  # slides | escape_room
    teacherbot_id = Column(UUID(as_uuid=True), ForeignKey("teacherbots.id"), nullable=True, index=True)
    slides_json = Column(JSONB, default=list, nullable=False)
    escape_config_json = Column(JSONB, nullable=True)
    public_token = Column(String(64), unique=True, nullable=True, index=True)
    public_enabled = Column(Boolean, default=False, nullable=False)
    status = Column(String, default="DRAFT", nullable=False)  # DRAFT | ACTIVE | CLOSED
    current_slide_index = Column(Integer, default=0, nullable=False)
    current_slide_started_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    responses = relationship("LiveInteractionResponse", back_populates="live_interaction", cascade="all, delete-orphan")
    escape_participants = relationship("LiveEscapeParticipant", back_populates="live_interaction", cascade="all, delete-orphan")


class LiveInteractionResponse(Base):
    __tablename__ = "live_interaction_responses"
    __table_args__ = (
        UniqueConstraint("live_interaction_id", "slide_index", "student_id", name="uq_live_response"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    live_interaction_id = Column(UUID(as_uuid=True), ForeignKey("live_interactions.id"), nullable=False, index=True)
    slide_index = Column(Integer, nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=False)
    response_json = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    live_interaction = relationship("LiveInteraction", back_populates="responses")


class LiveEscapeParticipant(Base):
    __tablename__ = "live_escape_participants"
    __table_args__ = (
        UniqueConstraint("live_interaction_id", "student_id", name="uq_live_escape_participant"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    live_interaction_id = Column(UUID(as_uuid=True), ForeignKey("live_interactions.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=False, index=True)
    current_step = Column(Integer, default=0, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    inventory_json = Column(JSONB, default=list, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    live_interaction = relationship("LiveInteraction", back_populates="escape_participants")
