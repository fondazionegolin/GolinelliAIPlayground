from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Annotated, Optional, List
from datetime import datetime
from uuid import UUID
import json
import base64
import logging

from app.core.database import get_db
from app.core.permissions import teacher_can_access_class, get_class_with_access_check
from app.api.deps import get_current_teacher, get_current_student
from app.models.user import User
from app.models.session import Class, Session, SessionStudent
from app.models.chat import ChatRoom, ChatMessage
from app.models.enums import ChatRoomType, SenderType
from app.models.teacherbot import (
    Teacherbot, TeacherbotStatus, TeacherbotPublication,
    TeacherbotConversation, TeacherbotMessage
)
from app.schemas.teacherbot import (
    TeacherbotCreate, TeacherbotUpdate, TeacherbotResponse, TeacherbotListResponse,
    TeacherbotPublishRequest, TeacherbotPublicationResponse,
    TeacherbotConversationCreate, TeacherbotConversationResponse, TeacherbotConversationWithDetails,
    TeacherbotMessageCreate, TeacherbotMessageResponse,
    TeacherbotTestMessage, TeacherbotTestResponse,
    TeacherbotReportResponse, StudentTeacherbotResponse,
)
from app.services.llm_service import llm_service
from app.services.credit_service import credit_service
from app.services.education_level import get_school_grade_instruction
from app.realtime.gateway import sio

router = APIRouter()
logger = logging.getLogger(__name__)

# Default report prompt for teacherbots with reporting enabled
DEFAULT_REPORT_PROMPT = """Genera un report sintetico di questa conversazione.
Includi:
1. SINTESI: Riassunto dell'interazione (2-3 frasi)
2. ARGOMENTI: Argomenti principali discussi
3. OSSERVAZIONI: Comprensione, difficoltà, punti di forza dello studente
4. SUGGERIMENTI: Consigli per il docente

Rispondi in formato JSON con chiavi: summary, topics (array), observations, suggestions"""


# ==================== TEACHER ENDPOINTS ====================

@router.get("/teacherbots", response_model=list[TeacherbotListResponse])
async def list_teacherbots(
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List all teacherbots created by this teacher"""
    result = await db.execute(
        select(
            Teacherbot,
            func.count(TeacherbotPublication.id.distinct()).label('publication_count'),
            func.count(TeacherbotConversation.id.distinct()).label('conversation_count')
        )
        .outerjoin(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
        .outerjoin(TeacherbotConversation, TeacherbotConversation.teacherbot_id == Teacherbot.id)
        .where(Teacherbot.teacher_id == teacher.id)
        .where(Teacherbot.tenant_id == teacher.tenant_id)
        .group_by(Teacherbot.id)
        .order_by(Teacherbot.updated_at.desc())
    )
    rows = result.all()

    return [
        TeacherbotListResponse(
            id=bot.id,
            name=bot.name,
            synopsis=bot.synopsis,
            icon=bot.icon,
            color=bot.color,
            status=bot.status.value,
            is_proactive=bot.is_proactive,
            enable_reporting=bot.enable_reporting,
            created_at=bot.created_at,
            updated_at=bot.updated_at,
            publication_count=pub_count,
            conversation_count=conv_count
        )
        for bot, pub_count, conv_count in rows
    ]


@router.post("/teacherbots", response_model=TeacherbotResponse)
async def create_teacherbot(
    request: TeacherbotCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Create a new teacherbot"""
    bot = Teacherbot(
        tenant_id=teacher.tenant_id,
        teacher_id=teacher.id,
        name=request.name,
        synopsis=request.synopsis,
        description=request.description,
        icon=request.icon,
        color=request.color,
        system_prompt=request.system_prompt,
        is_proactive=request.is_proactive,
        proactive_message=request.proactive_message,
        enable_reporting=request.enable_reporting,
        report_prompt=request.report_prompt,
        llm_provider=request.llm_provider,
        llm_model=request.llm_model,
        temperature=request.temperature,
        status=TeacherbotStatus.DRAFT,
    )
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return bot


@router.get("/teacherbots/{teacherbot_id}", response_model=TeacherbotResponse)
async def get_teacherbot(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get teacherbot details"""
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")
    return bot


@router.patch("/teacherbots/{teacherbot_id}", response_model=TeacherbotResponse)
async def update_teacherbot(
    teacherbot_id: UUID,
    request: TeacherbotUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Update a teacherbot"""
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    if request.name is not None:
        bot.name = request.name
    if request.synopsis is not None:
        bot.synopsis = request.synopsis
    if request.description is not None:
        bot.description = request.description
    if request.icon is not None:
        bot.icon = request.icon
    if request.color is not None:
        bot.color = request.color
    if request.system_prompt is not None:
        bot.system_prompt = request.system_prompt
    if request.is_proactive is not None:
        bot.is_proactive = request.is_proactive
    if request.proactive_message is not None:
        bot.proactive_message = request.proactive_message
    if request.enable_reporting is not None:
        bot.enable_reporting = request.enable_reporting
    if request.report_prompt is not None:
        bot.report_prompt = request.report_prompt
    if request.llm_provider is not None:
        bot.llm_provider = request.llm_provider
    if request.llm_model is not None:
        bot.llm_model = request.llm_model
    if request.temperature is not None:
        bot.temperature = request.temperature
    if request.status is not None and request.status in [s.value for s in TeacherbotStatus]:
        bot.status = TeacherbotStatus(request.status)

    await db.commit()
    await db.refresh(bot)
    return bot


@router.delete("/teacherbots/{teacherbot_id}")
async def delete_teacherbot(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Delete a teacherbot"""
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    await db.delete(bot)
    await db.commit()
    return {"message": "Teacherbot deleted"}


@router.post("/teacherbots/{teacherbot_id}/test", response_model=TeacherbotTestResponse)
async def test_teacherbot(
    teacherbot_id: UUID,
    request: TeacherbotTestMessage,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Test the teacherbot with a single message (for teacher testing before publishing)"""
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    # Check credits (Teacher level)
    allowed = await credit_service.check_availability(
        db, teacher.tenant_id, 0.0001, teacher_id=teacher.id
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Credit limit exceeded")

    # Build messages from history
    messages = []
    if request.history:
        for msg in request.history:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": request.content})

    # Call LLM with teacherbot's system prompt
    grade_instruction = get_school_grade_instruction(class_obj.school_grade)
    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=bot.system_prompt + grade_instruction,
        provider=bot.llm_provider,
        model=bot.llm_model,
        temperature=bot.temperature,
    )

    # Track usage (Context: Teacher only)
    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
        {"type": "teacherbot_test", "bot_id": str(bot.id)},
        teacher_id=teacher.id
    )

    # Mark as testing if still draft
    if bot.status == TeacherbotStatus.DRAFT:
        bot.status = TeacherbotStatus.TESTING
        await db.commit()

    return TeacherbotTestResponse(
        content=llm_response.content,
        provider=llm_response.provider,
        model=llm_response.model,
    )


@router.post("/teacherbots/{teacherbot_id}/publish", response_model=TeacherbotPublicationResponse)
async def publish_teacherbot(
    teacherbot_id: UUID,
    request: TeacherbotPublishRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Publish a teacherbot to a class"""
    # Verify teacherbot ownership
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    # Verify class access
    class_ = await get_class_with_access_check(db, teacher, request.class_id)
    if not class_:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")

    # Check if already published to this class
    result = await db.execute(
        select(TeacherbotPublication)
        .where(TeacherbotPublication.teacherbot_id == teacherbot_id)
        .where(TeacherbotPublication.class_id == request.class_id)
        .where(TeacherbotPublication.is_active == True)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already published to this class")

    # Create publication
    publication = TeacherbotPublication(
        tenant_id=teacher.tenant_id,
        teacherbot_id=teacherbot_id,
        class_id=request.class_id,
        published_by_id=teacher.id,
        is_active=True,
    )
    db.add(publication)

    # Update bot status to published
    if bot.status != TeacherbotStatus.PUBLISHED:
        bot.status = TeacherbotStatus.PUBLISHED
        bot.published_at = datetime.utcnow()

    await db.commit()
    await db.refresh(publication)

    # Send notification to all active sessions in the class
    sessions_result = await db.execute(
        select(Session)
        .where(Session.class_id == request.class_id)
    )
    sessions = sessions_result.scalars().all()

    for session in sessions:
        # Get or create public chat room
        room_result = await db.execute(
            select(ChatRoom)
            .where(ChatRoom.session_id == session.id)
            .where(ChatRoom.room_type == ChatRoomType.PUBLIC)
        )
        room = room_result.scalar_one_or_none()
        if not room:
            room = ChatRoom(
                tenant_id=session.tenant_id,
                session_id=session.id,
                room_type=ChatRoomType.PUBLIC,
            )
            db.add(room)
            await db.flush()

        # Create notification message
        notification_text = f"Nuovo assistente disponibile: {bot.name}"
        chat_message = ChatMessage(
            tenant_id=session.tenant_id,
            session_id=session.id,
            room_id=room.id,
            sender_type=SenderType.SYSTEM,
            message_text=notification_text,
            attachments=json.dumps({
                "is_notification": True,
                "notification_type": "teacherbot_published",
                "notification_data": {
                    "teacherbot_id": str(bot.id),
                    "name": bot.name,
                    "icon": bot.icon,
                    "color": bot.color,
                    "synopsis": bot.synopsis,
                },
            }),
        )
        db.add(chat_message)
        await db.flush()

        # Emit socket event
        await sio.emit(
            "chat_message",
            {
                "room_type": "PUBLIC",
                "session_id": str(session.id),
                "message": {
                    "id": str(chat_message.id),
                    "sender_type": "SYSTEM",
                    "text": notification_text,
                    "created_at": chat_message.created_at.isoformat(),
                    "is_notification": True,
                    "notification_type": "teacherbot_published",
                    "notification_data": {
                        "teacherbot_id": str(bot.id),
                        "name": bot.name,
                        "icon": bot.icon,
                        "color": bot.color,
                        "synopsis": bot.synopsis,
                    },
                },
            },
            room=f"session:{session.id}",
        )

    await db.commit()

    return TeacherbotPublicationResponse(
        id=publication.id,
        teacherbot_id=publication.teacherbot_id,
        class_id=publication.class_id,
        class_name=class_.name,
        is_active=publication.is_active,
        published_at=publication.published_at,
        published_by_id=publication.published_by_id,
    )


@router.get("/teacherbots/{teacherbot_id}/publications", response_model=list[TeacherbotPublicationResponse])
async def list_teacherbot_publications(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List all publications of a teacherbot"""
    # Verify ownership
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    result = await db.execute(
        select(TeacherbotPublication, Class)
        .join(Class, TeacherbotPublication.class_id == Class.id)
        .where(TeacherbotPublication.teacherbot_id == teacherbot_id)
        .order_by(TeacherbotPublication.published_at.desc())
    )
    rows = result.all()

    return [
        TeacherbotPublicationResponse(
            id=pub.id,
            teacherbot_id=pub.teacherbot_id,
            class_id=pub.class_id,
            class_name=cls.name,
            is_active=pub.is_active,
            published_at=pub.published_at,
            published_by_id=pub.published_by_id,
        )
        for pub, cls in rows
    ]


@router.delete("/teacherbots/{teacherbot_id}/publications/{publication_id}")
async def unpublish_teacherbot(
    teacherbot_id: UUID,
    publication_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Remove a publication (unpublish from a class)"""
    # Verify ownership
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    result = await db.execute(
        select(TeacherbotPublication)
        .where(TeacherbotPublication.id == publication_id)
        .where(TeacherbotPublication.teacherbot_id == teacherbot_id)
    )
    pub = result.scalar_one_or_none()
    if not pub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publication not found")

    pub.is_active = False
    await db.commit()
    return {"message": "Publication removed"}


@router.get("/teacherbots/{teacherbot_id}/reports", response_model=list[TeacherbotReportResponse])
async def get_teacherbot_reports(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
    limit: int = Query(50, le=100),
):
    """Get all reports for a teacherbot's conversations"""
    # Verify ownership
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    # Get conversations with reports
    result = await db.execute(
        select(
            TeacherbotConversation, SessionStudent, Session,
            func.count(TeacherbotMessage.id).label('message_count')
        )
        .join(SessionStudent, TeacherbotConversation.student_id == SessionStudent.id)
        .join(Session, TeacherbotConversation.session_id == Session.id)
        .outerjoin(TeacherbotMessage, TeacherbotMessage.conversation_id == TeacherbotConversation.id)
        .where(TeacherbotConversation.teacherbot_id == teacherbot_id)
        .where(TeacherbotConversation.report_json.isnot(None))
        .group_by(TeacherbotConversation.id, SessionStudent.id, Session.id)
        .order_by(TeacherbotConversation.report_generated_at.desc())
        .limit(limit)
    )
    rows = result.all()

    reports = []
    for conv, student, session, msg_count in rows:
        report_data = conv.report_json or {}
        reports.append(TeacherbotReportResponse(
            id=conv.id,
            conversation_id=conv.id,
            teacherbot_id=conv.teacherbot_id,
            teacherbot_name=bot.name,
            student_id=conv.student_id,
            student_nickname=student.nickname,
            session_id=conv.session_id,
            session_title=session.title,
            summary=report_data.get("summary"),
            observations=report_data.get("observations"),
            suggestions=report_data.get("suggestions"),
            topics=report_data.get("topics"),
            message_count=msg_count,
            report_generated_at=conv.report_generated_at,
            conversation_created_at=conv.created_at,
        ))

    return reports


# ==================== STUDENT ENDPOINTS ====================

@router.get("/student/teacherbots", response_model=list[StudentTeacherbotResponse])
async def list_available_teacherbots(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """List teacherbots available to the student in their current session's class"""
    # Get the session's class
    session_result = await db.execute(
        select(Session).where(Session.id == student.session_id)
    )
    session = session_result.scalar_one()

    # Get active publications for this class
    result = await db.execute(
        select(Teacherbot)
        .join(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
        .where(TeacherbotPublication.class_id == session.class_id)
        .where(TeacherbotPublication.is_active == True)
        .where(Teacherbot.status == TeacherbotStatus.PUBLISHED)
    )
    bots = result.scalars().all()

    return [
        StudentTeacherbotResponse(
            id=bot.id,
            name=bot.name,
            synopsis=bot.synopsis,
            description=bot.description,
            icon=bot.icon,
            color=bot.color,
            is_proactive=bot.is_proactive,
            proactive_message=bot.proactive_message if bot.is_proactive else None,
        )
        for bot in bots
    ]


@router.post("/student/teacherbots/{teacherbot_id}/conversations", response_model=TeacherbotConversationResponse)
async def start_teacherbot_conversation(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Start a new conversation with a teacherbot"""
    # Verify teacherbot is available to student
    session_result = await db.execute(
        select(Session).where(Session.id == student.session_id)
    )
    session = session_result.scalar_one()

    result = await db.execute(
        select(Teacherbot)
        .join(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
        .where(Teacherbot.id == teacherbot_id)
        .where(TeacherbotPublication.class_id == session.class_id)
        .where(TeacherbotPublication.is_active == True)
        .where(Teacherbot.status == TeacherbotStatus.PUBLISHED)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not available")

    # Create conversation
    conversation = TeacherbotConversation(
        tenant_id=student.tenant_id,
        teacherbot_id=teacherbot_id,
        student_id=student.id,
        session_id=student.session_id,
        title=f"Chat with {bot.name}",
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)

    # If proactive, add initial assistant message
    if bot.is_proactive and bot.proactive_message:
        proactive_msg = TeacherbotMessage(
            tenant_id=student.tenant_id,
            conversation_id=conversation.id,
            role="assistant",
            content=bot.proactive_message,
        )
        db.add(proactive_msg)
        await db.commit()

    return conversation


@router.get("/student/teacherbots/conversations", response_model=list[TeacherbotConversationResponse])
async def list_student_teacherbot_conversations(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """List all teacherbot conversations for the current student"""
    result = await db.execute(
        select(TeacherbotConversation)
        .where(TeacherbotConversation.student_id == student.id)
        .where(TeacherbotConversation.session_id == student.session_id)
        .order_by(TeacherbotConversation.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/student/teacherbots/conversations/{conversation_id}/messages", response_model=list[TeacherbotMessageResponse])
async def get_teacherbot_conversation_messages(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Get all messages in a teacherbot conversation"""
    # Verify ownership
    result = await db.execute(
        select(TeacherbotConversation)
        .where(TeacherbotConversation.id == conversation_id)
        .where(TeacherbotConversation.student_id == student.id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    result = await db.execute(
        select(TeacherbotMessage)
        .where(TeacherbotMessage.conversation_id == conversation_id)
        .order_by(TeacherbotMessage.created_at.asc())
    )
    return result.scalars().all()


@router.post("/student/teacherbots/conversations/{conversation_id}/message", response_model=TeacherbotMessageResponse)
async def send_teacherbot_message(
    conversation_id: UUID,
    request: TeacherbotMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Send a message to the teacherbot and get a response"""
    # Verify ownership
    result = await db.execute(
        select(TeacherbotConversation)
        .where(TeacherbotConversation.id == conversation_id)
        .where(TeacherbotConversation.student_id == student.id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    # Fetch context for credits (Session -> Class -> Teacher)
    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == conv.session_id)
    )
    session_rw = session_result.first()
    if not session_rw:
        # Should not happen as session is linked
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj, class_obj = session_rw

    # Check credit availability
    allowed = await credit_service.check_availability(
        db, 
        student.tenant_id, 
        estimated_cost=0.0001, # Minimal check
        teacher_id=class_obj.teacher_id,
        class_id=class_obj.id,
        session_id=session_obj.id,
        student_id=student.id
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED, 
            detail="Credit limit exceeded for this session/class."
        )

    # Get teacherbot
    result = await db.execute(
        select(Teacherbot).where(Teacherbot.id == conv.teacherbot_id)
    )
    bot = result.scalar_one()

    # Save user message
    user_msg = TeacherbotMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role="user",
        content=request.content,
    )
    db.add(user_msg)
    await db.flush()

    # Get conversation history
    result = await db.execute(
        select(TeacherbotMessage)
        .where(TeacherbotMessage.conversation_id == conversation_id)
        .order_by(TeacherbotMessage.created_at.asc())
    )
    history = result.scalars().all()
    messages = [{"role": msg.role, "content": msg.content} for msg in history]
    
    # history already includes user_msg because of db.add and flush
    # So we don't need to append request.content again if it's already in history
    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=bot.system_prompt,
        provider=bot.llm_provider,
        model=bot.llm_model,
        temperature=bot.temperature,
    )

    # Track usage
    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, student.tenant_id, llm_response.provider, llm_response.model, cost,
        {"type": "teacherbot_chat", "bot_id": str(bot.id)},
        teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id
    )

    # Save assistant message
    assistant_msg = TeacherbotMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role="assistant",
        content=llm_response.content,
        provider=llm_response.provider,
        model=llm_response.model,
        token_usage_json={
            "prompt_tokens": llm_response.prompt_tokens,
            "completion_tokens": llm_response.completion_tokens,
            "total_tokens": llm_response.prompt_tokens + llm_response.completion_tokens,
        },
    )
    db.add(assistant_msg)

    # Update conversation title if first exchange
    if len(history) <= 2:  # proactive message + user's first message
        conv.title = request.content[:50] + ('...' if len(request.content) > 50 else '')

    await db.commit()
    await db.refresh(assistant_msg)

    return assistant_msg


@router.post("/student/teacherbots/conversations/{conversation_id}/message-with-files", response_model=TeacherbotMessageResponse)
async def send_teacherbot_message_with_files(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
    content: str = Form(""),
    files: List[UploadFile] = File(default=[]),
):
    """Send a message with file attachments to a teacherbot conversation"""
    # Verify ownership
    result = await db.execute(
        select(TeacherbotConversation)
        .where(TeacherbotConversation.id == conversation_id)
        .where(TeacherbotConversation.student_id == student.id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    # Fetch context for credits (Session -> Class -> Teacher)
    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == conv.session_id)
    )
    session_rw = session_result.first()
    if not session_rw:
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj, class_obj = session_rw

    # Check credit availability
    allowed = await credit_service.check_availability(
        db, 
        student.tenant_id, 
        estimated_cost=0.0001, # Minimal check
        teacher_id=class_obj.teacher_id,
        class_id=class_obj.id,
        session_id=session_obj.id,
        student_id=student.id
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED, 
            detail="Credit limit exceeded for this session/class."
        )

    # Get teacherbot
    result = await db.execute(
        select(Teacherbot).where(Teacherbot.id == conv.teacherbot_id)
    )
    bot = result.scalar_one()

    # Process attached files
    file_contents = []
    for file in files:
        file_data = await file.read()
        filename = file.filename or "unknown"
        mime_type = file.content_type or "application/octet-stream"
        
        # Extract text content based on file type
        extracted_text = ""
        if mime_type.startswith("text/") or filename.endswith((".txt", ".md", ".csv", ".py", ".js", ".ts", ".html", ".css", ".json")):
            try:
                extracted_text = file_data.decode("utf-8")
            except:
                extracted_text = file_data.decode("latin-1", errors="ignore")
        elif mime_type == "application/pdf" or filename.endswith(".pdf"):
            # Try to extract text from PDF
            try:
                import fitz  # PyMuPDF
                pdf_doc = fitz.open(stream=file_data, filetype="pdf")
                extracted_text = ""
                for page in pdf_doc:
                    extracted_text += page.get_text()
                pdf_doc.close()
            except ImportError:
                extracted_text = "[PDF content - PyMuPDF not installed]"
            except Exception as e:
                extracted_text = f"[Error reading PDF: {str(e)}]"
        elif mime_type.startswith("image/"):
            # For images, we'll use vision API if available
            try:
                base64_image = base64.b64encode(file_data).decode("utf-8")
                # Use GPT-4 Vision to describe the image
                vision_model = "gpt-4o"
                
                # Check credits for vision
                if not await credit_service.check_availability(
                    db, student.tenant_id, 0.005, class_obj.teacher_id, class_obj.id, session_obj.id, student.id
                ):
                     extracted_text = "[Immagine non analizzata: credito insufficiente]"
                else:
                    vision_response = await llm_service.generate(
                        messages=[{
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "Descrivi dettagliatamente questa immagine in italiano."},
                                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}}
                            ]
                        }],
                        provider="openai",
                        model=vision_model,
                        temperature=0.3,
                        max_tokens=1000,
                    )
                    extracted_text = f"[Immagine: {filename}]\n{vision_response.content}"
                    
                    # Track Vision Usage
                    v_cost = credit_service.calculate_cost_for_model("openai", vision_model, vision_response.prompt_tokens, vision_response.completion_tokens)
                    await credit_service.track_usage(
                        db, student.tenant_id, "openai", vision_model, v_cost,
                        {"type": "vision_analysis", "filename": filename},
                        class_obj.teacher_id, class_obj.id, session_obj.id, student.id
                    )

            except Exception as e:
                extracted_text = f"[Immagine: {filename} - impossibile analizzare: {str(e)}]"
        
        file_contents.append({
            "filename": filename,
            "mime_type": mime_type,
            "content": extracted_text[:20000]  # Limit content size
        })

    # Build the full message with file context
    full_content = content
    if file_contents:
        files_context = "\n\n--- DOCUMENTI ALLEGATI ---\n"
        for fc in file_contents:
            files_context += f"\n📄 **{fc['filename']}** ({fc['mime_type']}):\n{fc['content']}\n"
        files_context += "\n--- FINE DOCUMENTI ---\n"
        full_content = files_context + "\n" + content if content else files_context

    # Save user message
    user_msg = TeacherbotMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role="user",
        content=content or "[Allegati caricati]",
    )
    db.add(user_msg)
    await db.flush()

    # Get conversation history
    result = await db.execute(
        select(TeacherbotMessage)
        .where(TeacherbotMessage.conversation_id == conversation_id)
        .order_by(TeacherbotMessage.created_at.asc())
    )
    history = result.scalars().all()
    
    # Build messages for LLM
    messages = []
    for msg in history:
        messages.append({
            "role": msg.role,
            "content": msg.content or "",
        })
    
    # history already includes user_msg because of db.add and flush
    # and we already processed the full_content with file extraction
    # We need to replace the last message in history with the one containing full_content
    if messages:
        messages[-1]["content"] = full_content

    # Check for image generation request
    import re
    image_request_patterns = [
        r"genera(?:mi)?\s+(?:una?\s+)?immagine",
        r"crea(?:mi)?\s+(?:una?\s+)?immagine",
        r"disegna(?:mi)?",
        r"generate\s+(?:an?\s+)?image",
        r"create\s+(?:an?\s+)?image",
        r"draw\s+(?:me\s+)?",
        r"rifallo",
        r"cambial[oa]",
        r"miglioral[oa]",
        r"aggiungi",
        r"modifica",
    ]
    is_image_request = any(re.search(p, content.lower()) for p in image_request_patterns)

    if is_image_request:
        try:
            # Look for image in attached files
            image_base64 = None
            for file in files:
                if file.content_type and file.content_type.startswith("image/"):
                    await file.seek(0)
                    img_data = await file.read()
                    image_base64 = base64.b64encode(img_data).decode("utf-8")
                    break

            # Prompt extraction using history
            extraction_messages = messages[:-1]
            extraction_messages.append({
                "role": "user",
                "content": f"Basandoti sulla conversazione precedente e su questa nuova richiesta, estrai una descrizione dettagliata in inglese per generare un'immagine. Se l'utente chiede modifiche a un'immagine precedente o fornisce un'immagine di riferimento, incorpora questi dettagli nella nuova descrizione. Rispondi SOLO con la descrizione in inglese, senza altro testo. Richiesta: {content}"
            })
            
            prompt_ext = await llm_service.generate(
                messages=extraction_messages,
                system_prompt="You are a helpful assistant that extracts image descriptions for FLUX. Respond only with the English description.",
                temperature=0.3,
                max_tokens=300
            )
            image_prompt = prompt_ext.content.strip()
            
            image_url = await llm_service.generate_image(
                image_prompt, 
                size="1024x1024", 
                provider="flux-schnell",
                image_base64=image_base64
            )
            
            assistant_content = f"🎨 Ecco l'immagine che hai richiesto:\n\n![Immagine generata]({image_url})\n\n*Generata con FLUX - Prompt: {image_prompt}*"
            
            # Save assistant message
            assistant_msg = TeacherbotMessage(
                tenant_id=student.tenant_id,
                conversation_id=conversation_id,
                role="assistant",
                content=assistant_content,
                provider="flux",
                model="flux-schnell",
            )
            db.add(assistant_msg)
            await db.commit()
            await db.refresh(assistant_msg)
            return assistant_msg

        except Exception as e:
            logger.error(f"Teacherbot image generation error: {e}")
            # Fallback to normal chat if image generation fails

    # Update system prompt to handle files
    grade_instruction = get_school_grade_instruction(class_obj.school_grade)
    system_prompt = (
        bot.system_prompt
        + grade_instruction
        + "\n\nQuando l'utente allega documenti, analizzali attentamente e rispondi in base al loro contenuto."
    )

    # Generate response
    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=bot.llm_provider,
        model=bot.llm_model,
        temperature=bot.temperature,
    )
    
    # Track usage (Response)
    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, student.tenant_id, llm_response.provider, llm_response.model, cost,
        {"type": "teacherbot_chat", "bot_id": str(bot.id)},
        teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id
    )

    # Save assistant message
    assistant_msg = TeacherbotMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role="assistant",
        content=llm_response.content,
        provider=llm_response.provider,
        model=llm_response.model,
        token_usage_json={
            "prompt_tokens": llm_response.prompt_tokens,
            "completion_tokens": llm_response.completion_tokens,
            "total_tokens": llm_response.prompt_tokens + llm_response.completion_tokens,
        },
    )
    db.add(assistant_msg)

    # Update conversation title if first exchange
    if len(history) <= 2:  
        conv.title = (content[:50] + '...') if content else f"Chat with {bot.name}"

    await db.commit()
    await db.refresh(assistant_msg)

    return assistant_msg


@router.post("/student/teacherbots/conversations/{conversation_id}/end")
async def end_teacherbot_conversation(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """End a conversation and generate report if enabled"""
    # Verify ownership
    result = await db.execute(
        select(TeacherbotConversation)
        .where(TeacherbotConversation.id == conversation_id)
        .where(TeacherbotConversation.student_id == student.id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    # Skip if report already generated
    if conv.report_json:
        return {"message": "Report already generated", "report": conv.report_json}

    # Get teacherbot
    result = await db.execute(
        select(Teacherbot).where(Teacherbot.id == conv.teacherbot_id)
    )
    bot = result.scalar_one()

    # Skip if reporting not enabled
    if not bot.enable_reporting:
        return {"message": "Reporting not enabled for this teacherbot"}
    
    # Fetch context for credits (Session -> Class -> Teacher)
    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == conv.session_id)
    )
    session_rw = session_result.first()
    if not session_rw:
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj, class_obj = session_rw

    # Check availability
    allowed = await credit_service.check_availability(
        db, student.tenant_id, 0.01, class_obj.teacher_id, class_obj.id, session_obj.id, student.id
    )
    if not allowed:
        return {"message": "Conversation ended, but report generation skipped due to insufficient credits."}

    # Get all messages
    result = await db.execute(
        select(TeacherbotMessage)
        .where(TeacherbotMessage.conversation_id == conversation_id)
        .order_by(TeacherbotMessage.created_at.asc())
    )
    messages = result.scalars().all()

    if len(messages) < 2:
        return {"message": "Not enough messages to generate report"}

    # Build transcript
    transcript = "\n".join([
        f"{'STUDENTE' if msg.role == 'user' else 'ASSISTENTE'}: {msg.content}"
        for msg in messages
    ])

    # Generate report
    report_prompt = bot.report_prompt or DEFAULT_REPORT_PROMPT

    try:
        llm_response = await llm_service.generate(
            messages=[{"role": "user", "content": f"Trascrizione della conversazione:\n\n{transcript}"}],
            system_prompt=report_prompt,
            provider=bot.llm_provider,
            model=bot.llm_model,
            temperature=0.3,  # Lower temperature for consistent report generation
        )
        
        # Track usage
        cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
        await credit_service.track_usage(
             db, student.tenant_id, llm_response.provider, llm_response.model, cost,
             {"type": "teacherbot_report", "bot_id": str(bot.id)},
             teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id
        )

        # Try to parse JSON response
        try:
            report_json = json.loads(llm_response.content)
        except json.JSONDecodeError:
            # If not valid JSON, create structured report from text
            report_json = {
                "summary": llm_response.content,
                "topics": [],
                "observations": None,
                "suggestions": None,
            }

        report_json["message_count"] = len(messages)

        conv.report_json = report_json
        conv.report_generated_at = datetime.utcnow()
        await db.commit()

        return {"message": "Report generated", "report": report_json}

    except Exception as e:
        logger.error(f"Report generation error: {e}")
        return {"message": f"Failed to generate report: {str(e)}"}
