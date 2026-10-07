from sqlalchemy import false as sa_false
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
import uuid

from app.core.database import Base


class AIModel(Base):
    """Admin-managed LLM catalogue entry: list price (USD per 1M tokens), quality score and scan state.

    Prices stored here override the static ``core.pricing`` catalogue at runtime, so every credit calculation
    follows the admin's decisions. Prices found by the scanner never apply on their own: they wait in ``proposed_*``."""
    __tablename__ = "ai_models"
    __table_args__ = (UniqueConstraint("provider", "model_id", name="uq_ai_models_provider_model"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(20), nullable=False, index=True)  # openai | anthropic | deepseek
    model_id = Column(String(120), nullable=False)
    display_name = Column(String(160), nullable=False)
    status = Column(String(12), nullable=False, default="active")  # active | available | deprecated
    kind = Column(String(12), nullable=False, default="text", server_default="text")  # text | image | realtime | transcribe
    offered = Column(Boolean, nullable=False, default=False, server_default=sa_false())  # shown in the users' model selectors
    price_note = Column(String(200), nullable=True)  # human-readable price for non-text kinds (per minute, audio tokens…)
    input_usd = Column(Float, nullable=True)
    output_usd = Column(Float, nullable=True)
    cached_input_usd = Column(Float, nullable=True)
    context_window = Column(Integer, nullable=True)
    quality_score = Column(Float, nullable=True)  # 0-100, admin-maintained (e.g. Artificial Analysis Intelligence Index)
    quality_source = Column(String(200), nullable=True)
    pricing_url = Column(String(300), nullable=True)
    notes = Column(Text, nullable=True)
    proposed_input_usd = Column(Float, nullable=True)
    proposed_output_usd = Column(Float, nullable=True)
    proposed_at = Column(DateTime(timezone=True), nullable=True)
    price_checked_at = Column(DateTime(timezone=True), nullable=True)
    seen_in_api = Column(Boolean, nullable=True)  # result of the last provider /models scan; null = never scanned
    acknowledged = Column(Boolean, nullable=False, default=True)  # false = new model the admin hasn't looked at yet
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    @property
    def blended_usd_value(self):
        """3:1 input:output cost per 1M tokens (None for non-text kinds or when unpriced)."""
        if self.kind != "text" or self.input_usd is None or self.output_usd is None:
            return None
        return (3 * self.input_usd + self.output_usd) / 4


class AIModelScan(Base):
    __tablename__ = "ai_model_scans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ran_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    trigger = Column(String(12), nullable=False, default="manual")  # manual | scheduled
    summary_json = Column(JSONB, nullable=False, default=dict)


class AIModelRole(Base):
    """Admin override of the model used by one platform feature (see ``app.services.model_roles``)."""
    __tablename__ = "ai_model_roles"

    role = Column(String(40), primary_key=True)
    provider = Column(String(20), nullable=False)
    model_id = Column(String(120), nullable=False)
    updated_by = Column(String(120), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
