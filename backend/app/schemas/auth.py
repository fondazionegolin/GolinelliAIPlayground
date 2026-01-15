from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: UUID
    role: str
    tenant_id: Optional[UUID] = None


class TeacherRequestCreate(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    tenant_slug: Optional[str] = None


class TeacherRequestResponse(BaseModel):
    id: UUID
    email: str
    first_name: str
    last_name: str
    status: str
    tenant_id: UUID
    created_at: str

    class Config:
        from_attributes = True


class StudentJoinRequest(BaseModel):
    join_code: str
    nickname: str


class StudentJoinResponse(BaseModel):
    join_token: str
    student_id: UUID
    session_id: UUID
    session_title: str
