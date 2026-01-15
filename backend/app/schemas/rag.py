from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class RAGDocumentCreate(BaseModel):
    scope: str
    class_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    file_id: UUID
    title: str
    doc_type: str


class RAGDocumentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    scope: str
    class_id: Optional[UUID]
    session_id: Optional[UUID]
    owner_teacher_id: Optional[UUID]
    owner_student_id: Optional[UUID]
    file_id: UUID
    title: str
    doc_type: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class RAGChunkResponse(BaseModel):
    id: UUID
    document_id: UUID
    chunk_index: int
    page: Optional[int]
    text: str
    meta_json: dict[str, Any]

    class Config:
        from_attributes = True


class RAGSearchRequest(BaseModel):
    query: str
    session_id: UUID
    scope: Optional[str] = None
    top_k: int = 5


class RAGSearchResult(BaseModel):
    chunk_id: UUID
    document_id: UUID
    document_title: str
    text: str
    page: Optional[int]
    score: float


class RAGCitationResponse(BaseModel):
    id: UUID
    document_id: UUID
    chunk_id: UUID
    quote: str
    page: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
