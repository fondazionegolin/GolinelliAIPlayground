from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, BigInteger, func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base
from app.models.enums import OwnerType, Scope


class File(Base):
    __tablename__ = "files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    owner_type = Column(Enum(OwnerType), nullable=False)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True)
    scope = Column(Enum(Scope), nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=True, index=True)
    storage_key = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    checksum_sha256 = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
