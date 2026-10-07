from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
import uuid

from app.core.database import Base


class MLImageProject(Base):
    """A saved ML Lab image-classifier project (the library entry).

    ``data_json`` keeps what is needed to keep training later without the original photos: per class, the sample
    thumbnails and their quantised MobileNet embeddings. The lightweight classifier head is re-trained on open, so no
    model weights are stored. ``summary_json`` is the small card shown in the library."""
    __tablename__ = "ml_image_projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(120), nullable=False)
    engine = Column(String(40), nullable=False, default="mobilenet-v1-050/1")
    class_count = Column(Integer, nullable=False, default=0)
    sample_count = Column(Integer, nullable=False, default=0)
    accuracy = Column(Float, nullable=True)  # cross-validated, 0..1
    summary_json = Column(JSONB, nullable=False, default=list)
    data_json = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
