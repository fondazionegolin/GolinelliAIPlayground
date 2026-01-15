from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class ClassCreate(BaseModel):
    name: str


class ClassResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    teacher_id: UUID
    name: str
    created_at: datetime

    class Config:
        from_attributes = True


class SessionCreate(BaseModel):
    title: str
    is_persistent: bool = False
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    is_persistent: Optional[bool] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class SessionResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    class_id: UUID
    title: str
    join_code: str
    status: str
    is_persistent: bool
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class SessionModuleUpdate(BaseModel):
    module_key: str
    is_enabled: bool
    config_json: Optional[dict[str, Any]] = None


class SessionModulesRequest(BaseModel):
    modules: list[SessionModuleUpdate]


class SessionModuleResponse(BaseModel):
    id: UUID
    session_id: UUID
    module_key: str
    is_enabled: bool
    config_json: dict[str, Any]
    updated_at: datetime

    class Config:
        from_attributes = True


class SessionStudentResponse(BaseModel):
    id: UUID
    session_id: UUID
    nickname: str
    is_frozen: bool
    frozen_reason: Optional[str]
    created_at: datetime
    last_seen_at: Optional[datetime]

    class Config:
        from_attributes = True


class SessionLiveSnapshot(BaseModel):
    session_id: UUID
    online_students: list[SessionStudentResponse]
    enabled_modules: list[SessionModuleResponse]
    total_students: int
