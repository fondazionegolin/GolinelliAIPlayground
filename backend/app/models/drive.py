import uuid

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class DriveItem(Base):
    """A node of a teacher's drive: a folder, an uploaded/imported file, or a link to a platform artifact.

    Every teacher owns one drive. Class and session folders, plus every file and artifact produced in a
    session (chat attachments, documents, 3D models…), are mirrored in automatically: those rows carry a
    ``system_key`` so the sync stays idempotent and never re-creates what the teacher moved or deleted.
    """

    __tablename__ = "drive_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("drive_items.id", ondelete="CASCADE"), nullable=True, index=True)
    kind = Column(String(16), nullable=False)  # folder | file | link
    name = Column(String(255), nullable=False)
    # kind=file: the stored blob. kind=link: source_type/source_id point at a platform artifact.
    file_id = Column(UUID(as_uuid=True), ForeignKey("files.id", ondelete="CASCADE"), nullable=True, index=True)
    source_type = Column(String(32), nullable=True)  # upload | chat | document | presentation | solid_model
    source_id = Column(UUID(as_uuid=True), nullable=True)
    mime_type = Column(String(255), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="SET NULL"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    system_key = Column(String(160), nullable=True)
    is_system = Column(Boolean, nullable=False, default=False, server_default="false")  # auto folder: not movable/deletable
    is_hidden = Column(Boolean, nullable=False, default=False, server_default="false")  # tombstone of a purged auto-import
    starred = Column(Boolean, nullable=False, default=False, server_default="false")
    trashed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_by_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="SET NULL"), nullable=True)
    public_token = Column(String(64), nullable=True, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("owner_teacher_id", "system_key", name="uq_drive_items_owner_system_key"),
        Index("ix_drive_items_owner_parent", "owner_teacher_id", "parent_id"),
        Index("ix_drive_items_source", "source_type", "source_id"),
    )


class DriveShare(Base):
    """Grants a session, a class or a colleague teacher access to a drive item and everything below it."""

    __tablename__ = "drive_shares"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id = Column(UUID(as_uuid=True), ForeignKey("drive_items.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type = Column(String(16), nullable=False)  # session | class | teacher
    target_id = Column(UUID(as_uuid=True), nullable=False)
    role = Column(String(16), nullable=False, default="viewer")  # viewer | editor
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("item_id", "target_type", "target_id", name="uq_drive_shares_target"),
        Index("ix_drive_shares_target", "target_type", "target_id"),
    )
