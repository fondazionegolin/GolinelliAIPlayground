from sqlalchemy import Column, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class PlatformSetting(Base):
    """Admin-managed platform-wide key/value setting (JSON value)."""
    __tablename__ = "platform_settings"

    key = Column(String(80), primary_key=True)
    value = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
