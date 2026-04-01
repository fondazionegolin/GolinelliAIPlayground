from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

from app.core.database import Base


class UserDesktop(Base):
    __tablename__ = "user_desktops"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    # Exactly one of these is set
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id", ondelete="CASCADE"), nullable=True, index=True)

    title = Column(String(100), nullable=False, default="Desktop")
    wallpaper_key = Column(Text, nullable=False, default="solid_neutral")
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class DesktopWidget(Base):
    __tablename__ = "desktop_widgets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    desktop_id = Column(UUID(as_uuid=True), ForeignKey("user_desktops.id", ondelete="CASCADE"), nullable=False, index=True)

    widget_type = Column(String(32), nullable=False)  # CLOCK, CALENDAR, NOTE, TASKLIST, FILE_REF, IMAGE_REF

    grid_x = Column(Integer, nullable=False, default=0)
    grid_y = Column(Integer, nullable=False, default=0)
    grid_w = Column(Integer, nullable=False, default=4)
    grid_h = Column(Integer, nullable=False, default=3)

    config_json = Column(JSONB, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
