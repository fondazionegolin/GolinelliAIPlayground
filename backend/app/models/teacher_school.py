from sqlalchemy import Column, DateTime, Enum, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import InvitationStatus


class TeacherSchoolMembership(Base):
    """Many-to-many membership between a teacher and a SCHOOL tenant."""

    __tablename__ = "teacher_school_memberships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    added_by_admin_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    teacher = relationship("User", foreign_keys=[teacher_id], back_populates="school_memberships")
    school = relationship("Tenant", foreign_keys=[school_tenant_id], back_populates="teacher_memberships")
    added_by_admin = relationship("User", foreign_keys=[added_by_admin_id])

    __table_args__ = (
        UniqueConstraint("teacher_id", "school_tenant_id", name="uq_teacher_school_membership"),
    )


class TeacherSchoolInvitation(Base):
    """Pending invitation for a registered teacher to join a school."""

    __tablename__ = "teacher_school_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    school_tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    invited_by_admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(
        Enum(InvitationStatus, values_callable=lambda values: [item.value for item in values]),
        default=InvitationStatus.PENDING,
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    responded_at = Column(DateTime(timezone=True), nullable=True)

    teacher = relationship("User", foreign_keys=[teacher_id])
    school = relationship("Tenant", foreign_keys=[school_tenant_id])
    invited_by_admin = relationship("User", foreign_keys=[invited_by_admin_id])

    __table_args__ = (
        UniqueConstraint("teacher_id", "school_tenant_id", name="uq_teacher_school_invitation"),
    )
