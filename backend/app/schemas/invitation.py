from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime


class InviteTeacherRequest(BaseModel):
    email: EmailStr


class InvitationResponseRequest(BaseModel):
    accept: bool


class TeacherBasicInfo(BaseModel):
    id: UUID
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class ClassBasicInfo(BaseModel):
    id: UUID
    name: str

    class Config:
        from_attributes = True


class SessionBasicInfo(BaseModel):
    id: UUID
    title: str
    class_name: Optional[str] = None

    class Config:
        from_attributes = True


class ClassInvitationResponse(BaseModel):
    id: UUID
    class_id: UUID
    class_name: str
    inviter: TeacherBasicInfo
    status: str
    created_at: datetime
    responded_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SessionInvitationResponse(BaseModel):
    id: UUID
    session_id: UUID
    session_title: str
    class_name: str
    inviter: TeacherBasicInfo
    status: str
    created_at: datetime
    responded_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClassTeacherResponse(BaseModel):
    id: UUID
    teacher: TeacherBasicInfo
    added_at: datetime
    added_by: TeacherBasicInfo
    is_owner: bool = False

    class Config:
        from_attributes = True


class SessionTeacherResponse(BaseModel):
    id: UUID
    teacher: TeacherBasicInfo
    added_at: datetime
    added_by: TeacherBasicInfo
    is_owner: bool = False

    class Config:
        from_attributes = True


class PendingInvitationInfo(BaseModel):
    id: UUID
    type: str  # 'class' or 'session'
    target_name: str
    class_name: str
    inviter: TeacherBasicInfo
    created_at: datetime


class InvitationsListResponse(BaseModel):
    class_invitations: list[ClassInvitationResponse]
    session_invitations: list[SessionInvitationResponse]
    total_pending: int
