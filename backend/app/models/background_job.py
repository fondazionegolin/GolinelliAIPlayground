from sqlalchemy import Column, String, DateTime, Text, Float, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class BackgroundJob(Base):
    """A long AI generation that keeps running when the user leaves or reloads the page.

    The live event log lives in the API process (app.services.background_jobs); this row is the
    durable view used by the navbar indicator and to resume a page after a reload."""
    __tablename__ = "background_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    kind = Column(String(40), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    route = Column(String(300), nullable=True)  # frontend path that shows the job's result
    resource_id = Column(String(64), nullable=True, index=True)  # e.g. project id, used to resume a page
    status = Column(String(16), nullable=False, default="running")  # running|succeeded|failed|cancelled|interrupted
    progress = Column(Float, nullable=True)  # 0..1 when known
    progress_label = Column(String(300), nullable=True)
    expected_seconds = Column(Float, nullable=True)
    error = Column(Text, nullable=True)
    result_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    seen_at = Column(DateTime(timezone=True), nullable=True)
