from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import UserRole, TeacherRequestStatus


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    email = Column(String, nullable=True, index=True)
    password_hash = Column(String, nullable=True)
    role = Column(Enum(UserRole), nullable=False)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    classes = relationship("Class", back_populates="teacher", lazy="dynamic")
    reviewed_requests = relationship("TeacherRequest", back_populates="reviewed_by_admin", lazy="dynamic")


class TeacherRequest(Base):
    __tablename__ = "teacher_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    email = Column(String, nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    status = Column(Enum(TeacherRequestStatus), default=TeacherRequestStatus.PENDING, nullable=False)
    reviewed_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    tenant = relationship("Tenant")
    reviewed_by_admin = relationship("User", back_populates="reviewed_requests")
