from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class TenantCreate(BaseModel):
    name: str
    slug: str


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class TenantResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True
