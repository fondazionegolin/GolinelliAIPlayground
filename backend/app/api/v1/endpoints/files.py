from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.file import File
from app.models.enums import OwnerType, Scope
from app.schemas.file import (
    UploadUrlRequest, UploadUrlResponse,
    FileCompleteRequest, FileResponse,
    DownloadUrlResponse,
)

router = APIRouter()


@router.post("/upload-url", response_model=UploadUrlResponse)
async def get_upload_url(
    request: UploadUrlRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    # Validate mime type
    if request.mime_type not in settings.ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mime type not allowed: {request.mime_type}",
        )
    
    # Validate size
    max_size = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if request.size_bytes > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE_MB}MB",
        )
    
    scope = Scope(request.scope)
    file_id = uuid4()
    
    if auth.is_student:
        if scope != Scope.USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only upload USER scope files",
            )
        tenant_id = auth.student.tenant_id
        owner_type = OwnerType.STUDENT
        owner_student_id = auth.student.id
        owner_teacher_id = None
        session_id = auth.student.session_id
        class_id = None
    else:
        tenant_id = auth.teacher.tenant_id
        owner_type = OwnerType.TEACHER
        owner_teacher_id = auth.teacher.id
        owner_student_id = None
        session_id = request.session_id
        class_id = request.class_id
    
    # Generate storage key
    timestamp = datetime.utcnow().strftime("%Y/%m/%d")
    storage_key = f"{tenant_id}/{timestamp}/{file_id}/{request.filename}"
    
    # Create file record (pending)
    file = File(
        id=file_id,
        tenant_id=tenant_id,
        owner_type=owner_type,
        owner_teacher_id=owner_teacher_id,
        owner_student_id=owner_student_id,
        scope=scope,
        session_id=session_id,
        class_id=class_id,
        storage_key=storage_key,
        filename=request.filename,
        mime_type=request.mime_type,
        size_bytes=request.size_bytes,
        checksum_sha256="pending",
    )
    db.add(file)
    await db.commit()
    
    # TODO: Generate presigned URL from MinIO
    # For now, return placeholder
    upload_url = f"http://{settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}/{storage_key}?presigned=true"
    
    return UploadUrlResponse(
        upload_url=upload_url,
        file_id=file_id,
        storage_key=storage_key,
        expires_in=3600,
    )


@router.post("/complete", response_model=FileResponse)
async def complete_upload(
    request: FileCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(File).where(File.id == request.file_id))
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    
    # Verify ownership
    if auth.is_student:
        if file.owner_student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if file.owner_teacher_id != auth.teacher.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Update checksum
    file.checksum_sha256 = request.checksum_sha256
    await db.commit()
    await db.refresh(file)
    
    return file


@router.get("/{file_id}/download-url", response_model=DownloadUrlResponse)
async def get_download_url(
    file_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(File).where(File.id == file_id))
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    
    # Verify access based on scope
    if auth.is_student:
        if file.scope == Scope.USER and file.owner_student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        if file.scope == Scope.SESSION and file.session_id != auth.student.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # TODO: Generate presigned download URL from MinIO
    download_url = f"http://{settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}/{file.storage_key}?presigned=true"
    
    return DownloadUrlResponse(
        download_url=download_url,
        expires_in=3600,
    )
