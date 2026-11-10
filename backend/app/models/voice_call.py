from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.database import Base


class VoiceCall(Base):
    """A class video call reachable through an invite link `/call/<code>`.

    The audience is the bound session/class plus everyone invited to the calendar events that link it
    (`calendar_events.voice_call_id`). With `open_to_teachers`, any signed-in teacher holding the link may
    join too; students always need to belong to the audience. Disabling the link (or regenerating the code)
    invalidates every copy already shared. The live room state is in-memory in the gateway (key `call:<id>`).
    """
    __tablename__ = "voice_calls"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    # Short human-friendly id, e.g. "kqf-mxta-vbe": the invite link and the code typed in "Partecipa".
    code = Column(String(16), nullable=False, unique=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id", ondelete="SET NULL"), nullable=True, index=True)
    link_enabled = Column(Boolean, nullable=False, default=True)
    open_to_teachers = Column(Boolean, nullable=False, default=False)
    last_started_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
