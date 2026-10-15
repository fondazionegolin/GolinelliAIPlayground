import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class VideoProject(Base):
    """Video Studio (admin testing): educational mini-documentary built from a source text.

    `script` holds the whole production state as JSON:
      {logline, style_bible, entities: [{id, name, kind, description, sheet_key, sheet_uuid}],
       shots: [{n, title, narration, visual, motion, entities, status, keyframe_key, keyframe_uuid,
                video_key, cost, error}]}
    """

    __tablename__ = "video_projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False, default="Nuovo video")
    source_text = Column(Text, nullable=False, default="")
    brief = Column(Text, nullable=True)  # what to convey and how (director's note)
    style_key = Column(String(40), nullable=False, default="flat_2d")
    aspect = Column(String(8), nullable=False, default="16:9")
    language = Column(String(8), nullable=False, default="it")
    target_shots = Column(Float, nullable=False, default=6)
    status = Column(String(20), nullable=False, default="draft")  # draft|scripting|script_ready|storyboarding|storyboard_ready|rendering|done|failed
    phase_label = Column(String(160), nullable=True)
    script = Column(JSONB, nullable=False, default=dict)
    final_key = Column(String(256), nullable=True)
    cost_usd = Column(Float, nullable=False, default=0.0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
