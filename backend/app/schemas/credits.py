from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID
from app.models.enums import CreditTransactionType, LimitLevel, CreditRequestStatus, InvitationStatus

# --- Credit Limits ---
class CreditLimitBase(BaseModel):
    level: LimitLevel
    amount_cap: float
    reset_frequency: str = "MONTHLY" # MONTHLY, NEVER
    
class CreditLimitUpdate(BaseModel):
    amount_cap: float
    reset_frequency: Optional[str] = None

class CreditLimitResponse(CreditLimitBase):
    id: UUID
    tenant_id: UUID
    teacher_id: Optional[UUID] = None
    class_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    student_id: Optional[UUID] = None
    current_usage: float
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# --- Transactions ---
class CreditTransactionResponse(BaseModel):
    id: UUID
    timestamp: datetime
    transaction_type: CreditTransactionType
    cost: float
    provider: Optional[str] = None
    model: Optional[str] = None
    usage_details: Optional[Dict[str, Any]] = None
    teacher_id: Optional[UUID] = None
    class_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    student_id: Optional[UUID] = None

    class Config:
        from_attributes = True

# --- Requests ---
class CreditRequestCreate(BaseModel):
    amount_requested: float
    reason: Optional[str] = None

class CreditRequestReview(BaseModel):
    status: CreditRequestStatus # APPROVED, REJECTED
    admin_notes: Optional[str] = None

class CreditRequestResponse(BaseModel):
    id: UUID
    requester_id: UUID
    requester_name: Optional[str] = None # Helper
    amount_requested: float
    reason: Optional[str] = None
    status: CreditRequestStatus
    created_at: datetime
    reviewed_by_id: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    admin_notes: Optional[str] = None

    class Config:
        from_attributes = True

# --- Analytics ---
class ConsumptionStats(BaseModel):
    total_cost: float
    provider_breakdown: Dict[str, float] # e.g. {"openai": 12.5, "anthropic": 5.0}
    model_breakdown: Dict[str, float]
    daily_usage: List[Dict[str, Any]] # [{"date": "2023-10-01", "cost": 1.2}]

# --- Invitations ---
class PlatformInvitationCreate(BaseModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    school: Optional[str] = None
    group_tag: Optional[str] = None
    custom_message: Optional[str] = None

class BulkInvitationCreate(BaseModel):
    teachers: List["PlatformInvitationCreate"]
    group_tag: Optional[str] = None
    custom_message: Optional[str] = None

class PlatformInvitationResponse(BaseModel):
    id: UUID
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    school: Optional[str] = None
    group_tag: Optional[str] = None
    status: InvitationStatus
    token: str
    created_at: datetime
    expires_at: datetime
    responded_at: Optional[datetime] = None   # when the teacher accepted/activated
    invited_by_id: Optional[UUID] = None

    class Config:
        from_attributes = True
