from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class Board(Base):
    __tablename__ = "boards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    template_key = Column(String(40), nullable=True)
    coding_project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    columns_json = Column(JSONB, default=list, nullable=False)
    visibility = Column(String(20), nullable=False, default="private")  # private|session_shared
    students_can_edit = Column(Boolean, nullable=False, default=False)
    created_by_display_name = Column(String(256), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class BoardCard(Base):
    __tablename__ = "board_cards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True)
    column_id = Column(String(64), nullable=False, index=True)
    title = Column(String(220), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(24), nullable=True)
    coding_project_id = Column(UUID(as_uuid=True), ForeignKey("coding_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    coding_status = Column(String(40), nullable=True)
    created_by_display_name = Column(String(256), nullable=True)
    last_actor_display_name = Column(String(256), nullable=True)
    sort_order = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
