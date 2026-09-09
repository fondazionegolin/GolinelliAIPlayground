import asyncio
import hashlib
import io
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File as UploadField, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.core.permissions import teacher_can_access_session
from app.models.file import File
from app.models.document_draft import DocumentDraft
from app.models.enums import OwnerType, Scope
from app.services.document_conversion import (
    MIME_BY_EXTENSION,
    SUPPORTED_IMPORT_EXTENSIONS,
    export_document,
    import_document,
    normalized_extension,
)
from app.services.storage_service import storage_service
from app.schemas.file import (
    UploadUrlRequest, UploadUrlResponse,
    FileCompleteRequest, FileResponse,
    DownloadUrlResponse,
)

router = APIRouter()


class DocumentExportRequest(BaseModel):
    title: str
    content_json: str
    target_format: str


def _draft_response(draft: DocumentDraft) -> dict:
    return {
        "id": str(draft.id),
        "title": draft.title,
        "doc_type": draft.doc_type,
        "content_json": draft.content_json,
        "session_id": str(draft.session_id) if draft.session_id else None,
        "created_at": draft.created_at.isoformat(),
        "updated_at": draft.updated_at.isoformat(),
    }


async def _can_access_file(db: AsyncSession, auth: StudentOrTeacher, stored_file: File) -> bool:
    if auth.is_student:
        if stored_file.owner_student_id == auth.student.id:
            return True
        return stored_file.scope == Scope.SESSION and stored_file.session_id == auth.student.session_id
    if stored_file.owner_teacher_id == auth.teacher.id:
        return True
    if stored_file.tenant_id != auth.teacher.tenant_id:
        return False
    if stored_file.scope == Scope.SESSION and stored_file.session_id:
        return await teacher_can_access_session(db, auth.teacher, stored_file.session_id)
    return False


@router.post("/documents/import")
async def import_lms_document(
    file: UploadFile = UploadField(...),
    session_id: str | None = Form(default=None),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
):
    """Preserve an Office/PDF source and create a separate native editable draft."""
    filename = Path(file.filename or "documento").name
    extension = normalized_extension(filename)
    if extension not in SUPPORTED_IMPORT_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Formato .{extension or '?'} non supportato")
    data = await file.read()
    max_size = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if not data or len(data) > max_size:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"File vuoto o superiore a {settings.MAX_UPLOAD_SIZE_MB} MB")

    parsed_session_id: UUID | None = None
    if auth.is_student:
        tenant_id = auth.student.tenant_id
        owner_type = OwnerType.STUDENT
        owner_student_id = auth.student.id
        owner_teacher_id = None
        parsed_session_id = auth.student.session_id
    else:
        tenant_id = auth.teacher.tenant_id
        owner_type = OwnerType.TEACHER
        owner_student_id = None
        owner_teacher_id = auth.teacher.id
        if session_id:
            try:
                parsed_session_id = UUID(session_id)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Sessione non valida") from exc
            if not await teacher_can_access_session(db, auth.teacher, parsed_session_id):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    file_id = uuid4()
    mime_type = file.content_type or MIME_BY_EXTENSION.get(extension, "application/octet-stream")
    storage_key = f"{tenant_id}/documents/originals/{file_id}/{filename}"
    checksum = hashlib.sha256(data).hexdigest()
    stored_file = File(
        id=file_id,
        tenant_id=tenant_id,
        owner_type=owner_type,
        owner_teacher_id=owner_teacher_id,
        owner_student_id=owner_student_id,
        scope=Scope.USER,
        session_id=parsed_session_id,
        class_id=None,
        storage_key=storage_key,
        filename=filename,
        mime_type=mime_type,
        size_bytes=len(data),
        checksum_sha256=checksum,
    )
    try:
        imported = await asyncio.to_thread(import_document, filename, data, mime_type, str(file_id))
        await asyncio.to_thread(storage_service.upload_file, storage_key, data, mime_type)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    draft = DocumentDraft(
        tenant_id=tenant_id,
        session_id=parsed_session_id,
        owner_teacher_id=owner_teacher_id,
        owner_student_id=owner_student_id,
        title=imported.title,
        doc_type=imported.doc_type,
        content_json=imported.content_json,
    )
    db.add(stored_file)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return {**_draft_response(draft), "source_file_id": str(file_id), "source_extension": extension}


@router.post("/documents/export")
async def export_native_document(
    request: DocumentExportRequest,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    del auth  # Authentication is the authorization boundary; no stored data is read here.
    try:
        exported = await asyncio.to_thread(export_document, request.content_json, request.title, request.target_format)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    disposition = f"attachment; filename*=UTF-8''{quote(exported.filename)}"
    return StreamingResponse(
        io.BytesIO(exported.content),
        media_type=exported.mime_type,
        headers={"Content-Disposition": disposition, "Content-Length": str(len(exported.content))},
    )


@router.get("/{file_id}/content")
async def stream_file_content(
    file_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(File).where(File.id == file_id))
    stored_file = result.scalar_one_or_none()
    if not stored_file or not await _can_access_file(db, auth, stored_file):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    data = await asyncio.to_thread(storage_service.download_file, stored_file.storage_key)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=stored_file.mime_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(stored_file.filename)}",
            "Content-Length": str(len(data)),
        },
    )


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


@router.get("/session/{session_id}")
async def list_session_files(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """List all shared files for a session"""
    # Verify access
    if auth.is_student:
        if auth.student.session_id != session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if not await teacher_can_access_session(db, auth.teacher, session_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    result = await db.execute(
        select(File)
        .where(File.session_id == session_id)
        .where(File.scope == Scope.SESSION)
        .order_by(File.created_at.desc())
    )
    files = result.scalars().all()
    
    return [
        {
            "id": str(f.id),
            "filename": f.filename,
            "mime_type": f.mime_type,
            "size_bytes": f.size_bytes,
            "url": f"/uploads/{f.storage_key}" if "chat/" in f.storage_key else f"/api/v1/files/{f.id}/download-url",
            "created_at": f.created_at.isoformat(),
            "owner_type": f.owner_type.value,
        }
        for f in files
    ]
