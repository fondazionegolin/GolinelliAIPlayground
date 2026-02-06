from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
from datetime import datetime
from uuid import UUID, uuid4

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.core.permissions import teacher_can_access_session
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.chat import ChatRoom, ChatMessage
from app.models.enums import ChatRoomType, SenderType
from app.schemas.chat import ChatRoomResponse, ChatMessageCreate, ChatMessageResponse, DMRoomCreate, SessionMessageCreate
from app.realtime.gateway import sio

router = APIRouter()


async def get_or_create_public_room(db: AsyncSession, session_id: UUID, tenant_id: UUID) -> ChatRoom:
    """Get or create the public chat room for a session"""
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.session_id == session_id)
        .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
    )
    room = result.scalar_one_or_none()
    if not room:
        room = ChatRoom(
            tenant_id=tenant_id,
            session_id=session_id,
            room_type=ChatRoomType.PUBLIC,
        )
        db.add(room)
        await db.commit()
        await db.refresh(room)
    return room


@router.get("/session/{session_id}/messages")
async def get_session_messages(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    limit: int = Query(100, le=200),
):
    """Get public chat messages for a session"""
    # Verify access
    if auth.is_student:
        if auth.student.session_id != session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        tenant_id = auth.student.tenant_id
    else:
        if not await teacher_can_access_session(db, auth.teacher, session_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        tenant_id = auth.teacher.tenant_id
    
    # Get or create public room
    room = await get_or_create_public_room(db, session_id, tenant_id)
    
    # Get messages with sender info
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.room_id == room.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    messages = result.scalars().all()
    
    # Get sender metadata (student + teacher)
    student_ids = [m.sender_student_id for m in messages if m.sender_student_id]
    teacher_ids = [m.sender_teacher_id for m in messages if m.sender_teacher_id]
    nicknames = {}
    avatars = {}
    accents = {}
    if student_ids:
        result = await db.execute(
            select(SessionStudent).where(SessionStudent.id.in_(student_ids))
        )
        for student in result.scalars().all():
            nicknames[str(student.id)] = student.nickname
            if student.avatar_url:
                avatars[str(student.id)] = student.avatar_url
            if student.ui_accent:
                accents[str(student.id)] = student.ui_accent
    if teacher_ids:
        result = await db.execute(
            select(User).where(User.id.in_(teacher_ids))
        )
        for teacher_user in result.scalars().all():
            if teacher_user.ui_accent:
                accents[str(teacher_user.id)] = teacher_user.ui_accent
    
    def extract_notification_info(attachments):
        """Extract notification info from attachments"""
        if isinstance(attachments, dict):
            return (
                attachments.get("is_notification", False),
                attachments.get("notification_type"),
                attachments.get("notification_data")
            )
        elif isinstance(attachments, list):
            # Check if any attachment is a task_link (document notification)
            for att in attachments:
                if isinstance(att, dict) and att.get("type") == "task_link":
                    return (
                        True,
                        att.get("task_type", "lesson"),
                        {"task_id": att.get("task_id"), "title": att.get("title"), "task_type": att.get("task_type")}
                    )
        return (False, None, None)

    formatted_messages = []
    for m in reversed(messages):
        is_notif, notif_type, notif_data = extract_notification_info(m.attachments)
        formatted_messages.append({
            "id": str(m.id),
            "sender_type": m.sender_type.value,
            "sender_id": str(m.sender_student_id or m.sender_teacher_id or "system"),
            "sender_name": nicknames.get(str(m.sender_student_id), "Docente") if m.sender_student_id else "Docente",
            "sender_avatar_url": avatars.get(str(m.sender_student_id)) if m.sender_student_id else None,
            "sender_accent": accents.get(str(m.sender_student_id or m.sender_teacher_id)),
            "text": m.message_text,
            "attachments": m.attachments,
            "created_at": m.created_at.isoformat(),
            "is_notification": is_notif,
            "notification_type": notif_type,
            "notification_data": notif_data,
        })

    return {
        "room_id": str(room.id),
        "messages": formatted_messages
    }


@router.post("/session/{session_id}/messages")
async def send_session_message(
    session_id: UUID,
    request: SessionMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Send a message to the public chat"""
    # Verify access
    if auth.is_student:
        if auth.student.session_id != session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        tenant_id = auth.student.tenant_id
        sender_type = SenderType.STUDENT
        sender_student_id = auth.student.id
        sender_teacher_id = None
        sender_name = auth.student.nickname
        sender_accent = auth.student.ui_accent
    else:
        if not await teacher_can_access_session(db, auth.teacher, session_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        tenant_id = auth.teacher.tenant_id
        sender_type = SenderType.TEACHER
        sender_teacher_id = auth.teacher.id
        sender_student_id = None
        sender_name = "Docente"
        sender_accent = auth.teacher.ui_accent
    
    # Get or create public room
    room = await get_or_create_public_room(db, session_id, tenant_id)
    
    # Build attachments with notification info and user attachments
    attachments = request.attachments if request.attachments else []
    
    # If it's a notification, also include notification metadata
    if request.is_notification:
        # Store notification info in the first attachment or create one
        notification_meta = {
            "is_notification": True,
            "notification_type": request.notification_type,
            "notification_data": request.notification_data,
        }
        if not attachments:
            attachments = [notification_meta]
        else:
            # Merge with first attachment
            attachments[0].update(notification_meta)
    
    message = ChatMessage(
        tenant_id=tenant_id,
        session_id=session_id,
        room_id=room.id,
        sender_type=sender_type,
        sender_teacher_id=sender_teacher_id,
        sender_student_id=sender_student_id,
        message_text=request.text,
        attachments=attachments,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    
    return {
        "id": str(message.id),
        "sender_type": sender_type.value,
        "sender_id": str(sender_student_id or sender_teacher_id),
        "sender_name": sender_name,
        "sender_accent": sender_accent,
        "text": request.text,
        "attachments": attachments,
        "created_at": message.created_at.isoformat(),
        "is_notification": request.is_notification,
        "notification_type": request.notification_type,
        "notification_data": request.notification_data,
    }


@router.delete("/session/{session_id}/messages")
async def clear_session_messages(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Clear all messages in the public chat room for a session (Teacher only)"""
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # Get public room
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.session_id == session_id)
        .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
    )
    room = result.scalar_one_or_none()
    
    if room:
        # Delete messages
        await db.execute(
            ChatMessage.__table__.delete().where(ChatMessage.room_id == room.id)
        )
        await db.commit()
    
    return {"status": "cleared"}
    if auth.is_teacher:
        # Teacher can see all rooms in session
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        
        result = await db.execute(
            select(ChatRoom).where(ChatRoom.session_id == session_id)
        )
    else:
        # Student can see public room and their DMs
        if auth.student.session_id != session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
        result = await db.execute(
            select(ChatRoom)
            .where(ChatRoom.session_id == session_id)
            .where(
                or_(
                    ChatRoom.room_type == ChatRoomType.PUBLIC,
                    ChatRoom.student_id == auth.student.id,
                )
            )
        )
    
    return result.scalars().all()


@router.post("/rooms/dm", response_model=ChatRoomResponse)
async def create_or_get_dm_room(
    request: DMRoomCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify access to session
    if not await teacher_can_access_session(db, teacher, request.session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    result = await db.execute(select(Session).where(Session.id == request.session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # Verify student exists in session
    result = await db.execute(
        select(SessionStudent)
        .where(SessionStudent.id == request.student_id)
        .where(SessionStudent.session_id == request.session_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    
    # Check if DM room already exists
    result = await db.execute(
        select(ChatRoom)
        .where(ChatRoom.session_id == request.session_id)
        .where(ChatRoom.room_type == ChatRoomType.DM)
        .where(ChatRoom.student_id == request.student_id)
        .where(ChatRoom.teacher_id == teacher.id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    
    # Create new DM room
    room = ChatRoom(
        tenant_id=session.tenant_id,
        session_id=request.session_id,
        room_type=ChatRoomType.DM,
        student_id=request.student_id,
        teacher_id=teacher.id,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return room


@router.get("/rooms/{room_id}/messages", response_model=list[ChatMessageResponse])
async def get_room_messages(
    room_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    cursor: Optional[str] = None,
    limit: int = Query(50, le=100),
):
    # Get room and verify access
    result = await db.execute(select(ChatRoom).where(ChatRoom.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    
    if auth.is_student:
        if room.session_id != auth.student.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        if room.room_type == ChatRoomType.DM and room.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if not await teacher_can_access_session(db, auth.teacher, room.session_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    query = (
        select(ChatMessage)
        .where(ChatMessage.room_id == room_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    
    if cursor:
        query = query.where(ChatMessage.created_at < datetime.fromisoformat(cursor))
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    return list(reversed(messages))


@router.post("/rooms/{room_id}/messages", response_model=ChatMessageResponse)
async def send_message(
    room_id: UUID,
    request: ChatMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    # Get room and verify access
    result = await db.execute(select(ChatRoom).where(ChatRoom.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    
    if auth.is_student:
        if room.session_id != auth.student.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        if room.room_type == ChatRoomType.DM and room.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
        sender_type = SenderType.STUDENT
        sender_student_id = auth.student.id
        sender_teacher_id = None
        tenant_id = auth.student.tenant_id
        session_id = auth.student.session_id
    else:
        if not await teacher_can_access_session(db, auth.teacher, room.session_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        result = await db.execute(select(Session).where(Session.id == room.session_id))
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
        sender_type = SenderType.TEACHER
        sender_teacher_id = auth.teacher.id
        sender_student_id = None
        tenant_id = session.tenant_id
        session_id = session.id
    
    message = ChatMessage(
        tenant_id=tenant_id,
        session_id=session_id,
        room_id=room_id,
        sender_type=sender_type,
        sender_teacher_id=sender_teacher_id,
        sender_student_id=sender_student_id,
        message_text=request.message_text,
        attachments=request.attachments,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    
    return message


@router.post("/upload")
async def upload_chat_files(
    session_id: str = Query(...),
    files: list[UploadFile] = File(default=[]),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
):
    """Upload files for chat messages (simple direct upload to local storage)"""
    import aiofiles
    from pathlib import Path
    import hashlib
    from app.models.file import File as FileModel
    from app.models.enums import OwnerType, Scope

    print(f"[UPLOAD] Received upload request for session {session_id}")
    print(f"[UPLOAD] Number of files: {len(files)}")

    # Parse session_id
    try:
        session_uuid = UUID(session_id)
    except:
        print(f"[UPLOAD] Invalid session_id: {session_id}")
        raise HTTPException(status_code=400, detail="Invalid session_id")

    # Verify access
    if auth.is_student:
        if auth.student.session_id != session_uuid:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if not await teacher_can_access_session(db, auth.teacher, session_uuid):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Create upload directory if not exists
    upload_dir = Path("uploads/chat") / str(session_uuid)
    upload_dir.mkdir(parents=True, exist_ok=True)
    print(f"[UPLOAD] Upload directory: {upload_dir}")

    # Get tenant_id and owner info
    if auth.is_student:
        tenant_id = auth.student.tenant_id
        owner_type = OwnerType.STUDENT
        owner_student_id = auth.student.id
        owner_teacher_id = None
    else:
        tenant_id = auth.teacher.tenant_id
        owner_type = OwnerType.TEACHER
        owner_teacher_id = auth.teacher.id
        owner_student_id = None

    uploaded_urls = []
    for file in files:
        try:
            print(f"[UPLOAD] Processing file: {file.filename}, content_type: {file.content_type}")
            if not file.content_type or file.content_type not in settings.ALLOWED_MIME_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Mime type not allowed: {file.content_type}",
                )

            # Generate unique filename
            file_ext = file.filename.split('.')[-1] if '.' in file.filename and file.filename else 'bin'
            unique_filename = f"{uuid4()}.{file_ext}"
            file_path = upload_dir / unique_filename

            # Save file
            max_size = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
            size_bytes = 0
            hasher = hashlib.sha256()
            async with aiofiles.open(file_path, 'wb') as f:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    size_bytes += len(chunk)
                    if size_bytes > max_size:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE_MB}MB",
                        )
                    hasher.update(chunk)
                    await f.write(chunk)

            print(f"[UPLOAD] Saved file to {file_path}")

            # Generate URL (relative to backend)
            file_url = f"/uploads/chat/{session_uuid}/{unique_filename}"
            uploaded_urls.append(file_url)
            print(f"[UPLOAD] Generated URL: {file_url}")

            # Save to database for session files listing
            file_record = FileModel(
                tenant_id=tenant_id,
                owner_type=owner_type,
                owner_teacher_id=owner_teacher_id,
                owner_student_id=owner_student_id,
                scope=Scope.SESSION,
                session_id=session_uuid,
                storage_key=f"chat/{session_uuid}/{unique_filename}",
                filename=file.filename or unique_filename,
                mime_type=file.content_type or "application/octet-stream",
                size_bytes=size_bytes,
                checksum_sha256=hasher.hexdigest(),
            )
            db.add(file_record)
            
        except Exception as e:
            print(f"[UPLOAD] Failed to upload file {file.filename if file.filename else 'unknown'}: {e}")
            import traceback
            traceback.print_exc()
            try:
                if 'file_path' in locals() and file_path.exists():
                    file_path.unlink()
            except Exception:
                pass
            continue

    # Commit all file records
    if uploaded_urls:
        await db.commit()

    print(f"[UPLOAD] Returning {len(uploaded_urls)} URLs")
    return {"urls": uploaded_urls}
