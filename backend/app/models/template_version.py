from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base


class TenantTemplateVersion(Base):
    __tablename__ = "tenant_template_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    template_key = Column(String(64), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    subject = Column(Text, nullable=True)
    html = Column(Text, nullable=True)
    text = Column(Text, nullable=True)
    updated_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "template_key", "version", name="uq_tenant_template_version"),
    )

    tenant = relationship("Tenant")
    updated_by = relationship("User")
