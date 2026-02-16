from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import InvitationStatus


class ClassTeacher(Base):
    """Association table for teachers who have access to a class (besides the owner)"""
    __tablename__ = "class_teachers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    added_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    __table_args__ = (
        UniqueConstraint('class_id', 'teacher_id', name='uq_class_teacher'),
    )

    # Relationships
    class_ = relationship("Class", back_populates="teachers")
    teacher = relationship("User", foreign_keys=[teacher_id])
    added_by = relationship("User", foreign_keys=[added_by_id])


class ClassInvitation(Base):
    """Invitation for a teacher to join a class"""
    __tablename__ = "class_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    inviter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    invitee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    status = Column(Enum(InvitationStatus, values_callable=lambda x: [e.value for e in x]),
                   default=InvitationStatus.PENDING, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    responded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint('class_id', 'invitee_id', name='uq_class_invitation'),
    )

    # Relationships
    class_ = relationship("Class", back_populates="invitations")
    inviter = relationship("User", foreign_keys=[inviter_id])
    invitee = relationship("User", foreign_keys=[invitee_id])


class SessionTeacher(Base):
    """Association table for teachers who have access to a session (besides the class owner/teachers)"""
    __tablename__ = "session_teachers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    added_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    __table_args__ = (
        UniqueConstraint('session_id', 'teacher_id', name='uq_session_teacher'),
    )

    # Relationships
    session = relationship("Session", back_populates="teachers")
    teacher = relationship("User", foreign_keys=[teacher_id])
    added_by = relationship("User", foreign_keys=[added_by_id])


class SessionInvitation(Base):
    """Invitation for a teacher to join a session"""
    __tablename__ = "session_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    inviter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    invitee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    status = Column(Enum(InvitationStatus, values_callable=lambda x: [e.value for e in x]),
                   default=InvitationStatus.PENDING, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    responded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint('session_id', 'invitee_id', name='uq_session_invitation'),
    )

    # Relationships
    session = relationship("Session", back_populates="invitations")
    inviter = relationship("User", foreign_keys=[inviter_id])
    invitee = relationship("User", foreign_keys=[invitee_id])


class PlatformInvitation(Base):
    """Invitation for a new teacher to join the platform (sent by Admin)"""
    __tablename__ = "platform_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    
    email = Column(String, nullable=False, index=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    school = Column(String, nullable=True)  # Info from CSV
    role = Column(String, default="TEACHER") # Usually TEACHER
    
    token = Column(String, unique=True, nullable=False, index=True)
    
    # Kept as plain string for compatibility with legacy DB schema where this
    # column is VARCHAR (not PostgreSQL ENUM).
    status = Column(String, default=InvitationStatus.PENDING.value, nullable=False)
    
    invited_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    responded_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    invited_by = relationship("User", foreign_keys=[invited_by_id])
