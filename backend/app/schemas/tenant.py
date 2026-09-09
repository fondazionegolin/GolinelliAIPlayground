from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class TenantCreate(BaseModel):
    name: str
    slug: str


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class TenantLimitsUpdate(BaseModel):
    max_teachers: Optional[int] = None
    max_students_per_teacher: Optional[int] = None
    max_students_per_class: Optional[int] = None
    monthly_credit_pool: Optional[float] = None
    teacher_monthly_cap: Optional[float] = None


class SchoolTenantCreate(BaseModel):
    """Crea un tenant SCHOOL con owner in un'unica chiamata."""
    school_name: str
    slug: str
    owner_first_name: str
    owner_last_name: str
    owner_email: str
    # Limiti opzionali (usa default da config se omessi)
    max_teachers: Optional[int] = 5
    max_students_per_teacher: Optional[int] = 100
    max_students_per_class: Optional[int] = 30
    monthly_credit_pool: Optional[float] = 10.0


class TeacherSchoolBulkUpdate(BaseModel):
    teacher_ids: list[UUID] = Field(min_length=1)
    school_tenant_id: UUID
    action: str


class TeacherCreditLimitBulkUpdate(BaseModel):
    teacher_ids: list[UUID] = Field(min_length=1)
    amount_cap: float = Field(ge=0)


class TenantResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    status: str
    tenant_type: str = "INDIVIDUAL"
    created_at: datetime
    owner_user_id: Optional[UUID] = None
    max_teachers: int = 5
    max_students_per_teacher: int = 100
    max_students_per_class: int = 30
    monthly_credit_pool: float = 10.0
    teacher_monthly_cap: float = 3.0

    class Config:
        from_attributes = True
