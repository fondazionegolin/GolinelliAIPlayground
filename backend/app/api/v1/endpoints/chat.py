from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from typing import Annotated, Optional
from datetime import datetime
from uuid import UUID

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.chat import ChatRoom, ChatMessage
from app.models.enums import ChatRoomType, SenderType
from app.schemas.chat import ChatRoomResponse, ChatMessageCreate, ChatMessageResponse, DMRoomCreate

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
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        tenant_id = session.tenant_id
    
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
    
    # Get student nicknames
    student_ids = [m.sender_student_id for m in messages if m.sender_student_id]
    nicknames = {}
    if student_ids:
        result = await db.execute(
            select(SessionStudent).where(SessionStudent.id.in_(student_ids))
        )
        for student in result.scalars().all():
            nicknames[str(student.id)] = student.nickname
    
    return {
        "room_id": str(room.id),
        "messages": [
            {
                "id": str(m.id),
                "sender_type": m.sender_type.value,
                "sender_id": str(m.sender_student_id or m.sender_teacher_id or "system"),
                "sender_name": nicknames.get(str(m.sender_student_id), "Docente") if m.sender_student_id else "Docente",
                "text": m.message_text,
                "attachments": m.attachments,
                "created_at": m.created_at.isoformat(),
                "is_notification": m.attachments.get("is_notification", False) if isinstance(m.attachments, dict) else False,
                "notification_type": m.attachments.get("notification_type") if isinstance(m.attachments, dict) else None,
                "notification_data": m.attachments.get("notification_data") if isinstance(m.attachments, dict) else None,
            }
            for m in reversed(messages)
        ]
    }


@router.post("/session/{session_id}/messages")
async def send_session_message(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    text: str,
    is_notification: bool = False,
    notification_type: Optional[str] = None,
    notification_data: Optional[dict] = None,
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
    else:
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        tenant_id = session.tenant_id
        sender_type = SenderType.TEACHER
        sender_teacher_id = auth.teacher.id
        sender_student_id = None
        sender_name = "Docente"
    
    # Get or create public room
    room = await get_or_create_public_room(db, session_id, tenant_id)
    
    # Build attachments with notification info
    attachments = {}
    if is_notification:
        attachments = {
            "is_notification": True,
            "notification_type": notification_type,
            "notification_data": notification_data,
        }
    
    message = ChatMessage(
        tenant_id=tenant_id,
        session_id=session_id,
        room_id=room.id,
        sender_type=sender_type,
        sender_teacher_id=sender_teacher_id,
        sender_student_id=sender_student_id,
        message_text=text,
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
        "text": text,
        "created_at": message.created_at.isoformat(),
        "is_notification": is_notification,
        "notification_type": notification_type,
        "notification_data": notification_data,
    }


@router.get("/rooms", response_model=list[ChatRoomResponse])
async def list_rooms(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
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
    # Verify session ownership
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == request.session_id)
        .where(Class.teacher_id == teacher.id)
    )
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
        # Verify teacher owns session
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == room.session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        if not result.scalar_one_or_none():
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
        # Verify teacher owns session
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == room.session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
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
