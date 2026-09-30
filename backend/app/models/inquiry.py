from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class InquirySession(Base):
    """One investigative-interview run between a student (or the teacher, in test) and an inquiry NPC.

    Holds the server-side game state (unlocked clues, trust/pressure) so the hidden truth and the
    locked clues never have to live in the browser, and so the interview can be resumed.
    """
    __tablename__ = "inquiry_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacherbot_id = Column(UUID(as_uuid=True), ForeignKey("teacherbots.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    status = Column(String(16), nullable=False, default="active")  # active | solved | failed
    unlocked_clue_ids = Column(JSONB, nullable=False, default=list)
    trust = Column(Integer, nullable=False, default=0)
    pressure = Column(Integer, nullable=False, default=0)
    suspect_state = Column(JSONB, nullable=False, default=dict)  # {suspect_id: {trust, pressure}}
    accused_suspect_id = Column(String(40), nullable=True)
    turn_count = Column(Integer, nullable=False, default=0)
    attempts = Column(Integer, nullable=False, default=0)
    final_answer = Column(Text, nullable=True)
    verdict = Column(JSONB, nullable=True)
    transcript = Column(JSONB, nullable=False, default=list)  # [{role, text, flag?, ts}]
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_inquiry_sessions_bot_student", "teacherbot_id", "student_id"),
    )
