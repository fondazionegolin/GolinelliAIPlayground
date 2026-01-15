from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class UploadUrlRequest(BaseModel):
    filename: str
    mime_type: str
    size_bytes: int
    scope: str
    session_id: Optional[UUID] = None
    class_id: Optional[UUID] = None


class UploadUrlResponse(BaseModel):
    upload_url: str
    file_id: UUID
    storage_key: str
    expires_in: int


class FileCompleteRequest(BaseModel):
    file_id: UUID
    checksum_sha256: str


class FileResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    owner_type: str
    scope: str
    session_id: Optional[UUID]
    class_id: Optional[UUID]
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime

    class Config:
        from_attributes = True


class DownloadUrlResponse(BaseModel):
    download_url: str
    expires_in: int
