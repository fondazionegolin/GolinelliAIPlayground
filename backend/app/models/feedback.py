from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class FeedbackReport(Base):
    __tablename__ = "feedback_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_type = Column(String(20), nullable=False)  # "student" | "teacher"
    user_id_ref = Column(String(64), nullable=True)
    user_display_name = Column(String(256), nullable=True)
    user_email = Column(String(256), nullable=True)
    message = Column(Text, nullable=False)
    page_url = Column(String(512), nullable=True)
    browser_info = Column(JSONB, default=dict, nullable=False)
    console_errors = Column(JSONB, default=list, nullable=False)
    status = Column(String(20), nullable=False, default="new")  # "new" | "reviewed"
    source = Column(String(20), nullable=False, default="feedback")  # feedback|manual
    created_by_display_name = Column(String(256), nullable=True)
    last_actor_display_name = Column(String(256), nullable=True)
    # Project-management board fields
    board_status = Column(String(20), nullable=False, default="inbox")  # inbox|triage|ready|in_progress|qa|approved|released
    category = Column(String(20), nullable=True)  # bug|feature|ui|ux
    urgency = Column(String(10), nullable=True)  # alta|media|bassa
    internal_note = Column(Text, nullable=True)
    auto_classified = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FeedbackBoardCollaborator(Base):
    """Teachers granted access to the shared feedback board (besides admins)."""
    __tablename__ = "feedback_board_collaborators"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    added_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FeedbackBoardConfig(Base):
    """Shared board layout: columns can be replaced by templates or edited manually."""
    __tablename__ = "feedback_board_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope = Column(String(64), nullable=False, default="global", unique=True, index=True)
    title = Column(String(160), nullable=False, default="Board sviluppo")
    columns_json = Column(JSONB, default=list, nullable=False)
    is_shared_with_class = Column(Boolean, nullable=False, default=False)
    students_can_contribute = Column(Boolean, nullable=False, default=False)
    updated_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
