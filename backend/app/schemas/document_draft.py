from pydantic import BaseModel
from typing import Optional
from uuid import UUID


class DocumentDraftCreate(BaseModel):
    title: str
    doc_type: str  # document | presentation
    content_json: str
    session_id: Optional[UUID] = None


class DocumentDraftUpdate(BaseModel):
    title: Optional[str] = None
    doc_type: Optional[str] = None
    content_json: Optional[str] = None
    session_id: Optional[UUID] = None


class DocumentDraftResponse(BaseModel):
    id: UUID
    title: str
    doc_type: str
    content_json: str
    session_id: Optional[UUID] = None
    created_at: str
    updated_at: str
