from sqlalchemy import Column, String, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class FeedbackReport(Base):
    __tablename__ = "feedback_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_type = Column(String(20), nullable=False)  # "student" | "teacher"
    user_id_ref = Column(String(64), nullable=True)
    user_display_name = Column(String(256), nullable=True)
    message = Column(Text, nullable=False)
    page_url = Column(String(512), nullable=True)
    browser_info = Column(JSONB, default=dict, nullable=False)
    console_errors = Column(JSONB, default=list, nullable=False)
    status = Column(String(20), nullable=False, default="new")  # "new" | "reviewed"
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
