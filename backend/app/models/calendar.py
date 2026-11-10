from sqlalchemy import Boolean, Column, String, Date, Time, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
import uuid

from app.core.database import Base


class SessionCalendarEvent(Base):
    __tablename__ = "session_calendar_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    event_date = Column(Date, nullable=False, index=True)
    event_time = Column(Time, nullable=True)
    color = Column(String(20), nullable=False, default="#6366f1")

    created_by_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CalendarEvent(Base):
    """Teacher-authored calendar event shared with classes, sessions and co-teachers."""
    __tablename__ = "calendar_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    all_day = Column(Boolean, nullable=False, default=False)
    color = Column(String(20), nullable=False, default="#6366f1")
    # Recurring events are materialized: every occurrence is a row sharing series_id and the rule.
    series_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    recurrence = Column(JSONB, nullable=True)
    # Set once the 10-minute reminder has gone out; reset when the start time moves.
    reminder_sent_at = Column(DateTime(timezone=True), nullable=True, index=True)
    # Optional class video call (invite link) attached to the event; shared by every occurrence of a series.
    voice_call_id = Column(UUID(as_uuid=True), ForeignKey("voice_calls.id", ondelete="SET NULL"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CalendarEventTarget(Base):
    """Who an event is shared with: a class (all its sessions), a session or a teacher."""
    __tablename__ = "calendar_event_targets"
    __table_args__ = (UniqueConstraint("event_id", "target_type", "target_id", name="uq_calendar_event_target"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type = Column(String(16), nullable=False)  # class | session | teacher
    target_id = Column(UUID(as_uuid=True), nullable=False, index=True)
