from sqlalchemy import Column, String, Enum, DateTime, ForeignKey, func, Float, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import uuid

from app.core.database import Base
from app.models.enums import CreditTransactionType, LimitLevel, CreditRequestStatus


class CreditLimit(Base):
    __tablename__ = "credit_limits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    
    level = Column(Enum(LimitLevel, native_enum=False), nullable=False)
    
    # Entity references - only one should be set based on level
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True, index=True)
    
    amount_cap = Column(Float, nullable=False, default=0.0)
    current_usage = Column(Float, nullable=False, default=0.0)
    
    period_start = Column(DateTime(timezone=True), nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=True) # If null, no reset? Or ongoing
    reset_frequency = Column(String, default="MONTHLY") # MONTHLY, NONE
    
    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    teacher = relationship("User", foreign_keys=[teacher_id])
    class_ = relationship("Class", foreign_keys=[class_id])
    session = relationship("Session", foreign_keys=[session_id])
    student = relationship("SessionStudent", foreign_keys=[student_id])


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    transaction_type = Column(Enum(CreditTransactionType, native_enum=False), nullable=False)
    
    cost = Column(Float, nullable=False, default=0.0)
    
    # Provider info
    provider = Column(String, nullable=True) # openai, anthropic, ollama, flux
    model = Column(String, nullable=True)    # gpt-4, claude-3, etc.
    
    # Detail on usage (JSON)
    usage_details = Column(JSONB, default=dict) # {prompt_tokens: 100, completion_tokens: 50}
    
    # Attribution
    teacher_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=True, index=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("session_students.id"), nullable=True, index=True)

    # Relationships
    teacher = relationship("User", foreign_keys=[teacher_id])
    class_ = relationship("Class", foreign_keys=[class_id])
    session = relationship("Session", foreign_keys=[session_id])
    student = relationship("SessionStudent", foreign_keys=[student_id])


class CreditRequest(Base):
    __tablename__ = "credit_requests"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    
    requester_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount_requested = Column(Float, nullable=False)
    reason = Column(Text, nullable=True)
    
    status = Column(Enum(CreditRequestStatus, native_enum=False), default=CreditRequestStatus.PENDING, nullable=False)
    
    reviewed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    admin_notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    requester = relationship("User", foreign_keys=[requester_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_id])
