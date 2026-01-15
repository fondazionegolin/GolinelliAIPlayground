from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class ChatRoomResponse(BaseModel):
    id: UUID
    session_id: UUID
    room_type: str
    student_id: Optional[UUID]
    teacher_id: Optional[UUID]
    created_at: datetime

    class Config:
        from_attributes = True


class ChatMessageCreate(BaseModel):
    message_text: str
    attachments: list[dict[str, Any]] = []


class ChatMessageResponse(BaseModel):
    id: UUID
    room_id: UUID
    sender_type: str
    sender_teacher_id: Optional[UUID]
    sender_student_id: Optional[UUID]
    message_text: str
    attachments: list[dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True


class DMRoomCreate(BaseModel):
    session_id: UUID
    student_id: UUID
