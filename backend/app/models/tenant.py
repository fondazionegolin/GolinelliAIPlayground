from sqlalchemy import Column, String, Enum, DateTime, func, Integer, Float, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import TenantStatus, TenantType


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False, index=True)
    status = Column(Enum(TenantStatus), default=TenantStatus.ACTIVE, nullable=False)
    email_templates_json = Column(JSONB, default=dict, nullable=False, server_default='{}')
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # ── Tipo di tenant ──────────────────────────────────────────────────────
    tenant_type = Column(
        Enum(TenantType, native_enum=False),
        default=TenantType.INDIVIDUAL,
        nullable=False,
        server_default=TenantType.INDIVIDUAL.value,
    )

    # ── Owner (solo per SCHOOL): persona fisica che gestisce gli inviti ─────
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # ── Limiti strutturali (configurabili dall'admin) ────────────────────────
    max_teachers = Column(Integer, nullable=False, default=5, server_default="5")
    max_students_per_teacher = Column(Integer, nullable=False, default=100, server_default="100")
    max_students_per_class = Column(Integer, nullable=False, default=30, server_default="30")

    # ── Budget mensile ────────────────────────────────────────────────────────
    # SCHOOL: pool condiviso docenti + studenti (default €10)
    # INDIVIDUAL: pool studenti separato (default €10); il docente ha teacher_monthly_cap
    monthly_credit_pool = Column(Float, nullable=False, default=10.0, server_default="10.0")
    # Solo per INDIVIDUAL: cap mensile del docente stesso (default €3)
    teacher_monthly_cap = Column(Float, nullable=False, default=3.0, server_default="3.0")

    # Relationships
    users = relationship("User", back_populates="tenant", lazy="dynamic",
                         foreign_keys="User.tenant_id")
    teacher_memberships = relationship(
        "TeacherSchoolMembership",
        back_populates="school",
        cascade="all, delete-orphan",
    )
    owner = relationship("User", foreign_keys=[owner_user_id], lazy="select",
                         primaryjoin="Tenant.owner_user_id == User.id")
    classes = relationship("Class", back_populates="tenant", lazy="dynamic", foreign_keys="Class.tenant_id")
    sessions = relationship("Session", back_populates="tenant", lazy="dynamic")
