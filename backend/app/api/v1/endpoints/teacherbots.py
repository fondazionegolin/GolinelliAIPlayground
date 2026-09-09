from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import Annotated, Optional, List
from datetime import datetime, timezone
from uuid import UUID
import json
import base64
import logging
import secrets

from app.core.database import get_db
from app.core.permissions import teacher_can_access_class, get_class_with_access_check
from app.core.security import generate_join_code
from app.api.deps import get_current_teacher, get_current_student
from app.models.user import User
from app.models.session import Class, Session, SessionStudent
from app.models.chat import ChatRoom, ChatMessage
from app.models.enums import ChatRoomType, SenderType
from app.models.teacherbot import (
    Teacherbot, TeacherbotStatus, TeacherbotPublication,
    TeacherbotConversation, TeacherbotMessage
)
from app.models.teacherbot_share_link import (
    TeacherbotShareLink, TeacherbotShareConversation, TeacherbotShareMessage
)
from app.schemas.teacherbot import (
    TeacherbotCreate, TeacherbotUpdate, TeacherbotResponse, TeacherbotListResponse,
    TeacherbotPublishRequest, TeacherbotPublicationResponse,
    TeacherbotConversationCreate, TeacherbotConversationResponse, TeacherbotConversationWithDetails,
    TeacherbotMessageCreate, TeacherbotMessageResponse,
    TeacherbotTestMessage, TeacherbotTestResponse,
    TeacherbotReportResponse, StudentTeacherbotResponse,
    ShareLinkCreate, ShareLinkResponse, ShareLinkVerifyRequest, ShareLinkPublicInfo,
    ShareVisitorMessageCreate, ShareConversationResponse, ShareMessageResponse,
)
from app.services.llm_service import llm_service, normalize_llm_model
from app.services.credit_service import credit_service
from app.services.education_level import get_school_grade_instruction
from app.services.environmental_impact import enrich_usage_with_environmental_impact
from app.services.rag_service import rag_service
from app.services.document_processor import document_processor
from app.services.ui_language import apply_output_language_instruction, resolve_ui_language
from app.api.v1.endpoints.stt import transcribe_with_whisper
from app.models.rag import RAGDocument
from app.models.enums import DocumentStatus, Scope
from app.realtime.gateway import sio

router = APIRouter()
logger = logging.getLogger(__name__)


def get_ui_language(request: Optional[Request]) -> str:
    if request is None:
        return "it"
    return resolve_ui_language(
        request.headers.get("x-app-language") or request.headers.get("accept-language")
    )

# Default report prompt for teacherbots with reporting enabled
DEFAULT_REPORT_PROMPT = """Genera un report sintetico di questa conversazione.
Includi:
1. SINTESI: Riassunto dell'interazione (2-3 frasi)
2. ARGOMENTI: Argomenti principali discussi
3. OSSERVAZIONI: Comprensione, difficoltà, punti di forza dello studente
4. SUGGERIMENTI: Consigli per il docente

Rispondi in formato JSON con chiavi: summary, topics (array), observations, suggestions"""


async def _build_kb_context(db: AsyncSession, bot: "Teacherbot", query: str, tenant_id: UUID) -> str:
    """Return a context block from the teacherbot's KB relevant to the query, or ''."""
    try:
        # Use a savepoint so a search failure doesn't abort the outer transaction
        async with db.begin_nested():
            chunks = await rag_service.search_teacherbot_kb(
                db, query=query, teacherbot_id=bot.id, tenant_id=tenant_id, top_k=5
            )
        if not chunks:
            return ""
        parts = ["## Documenti di riferimento\n"]
        for chunk in chunks:
            header = f"**{chunk.document_title}**"
            if chunk.page:
                header += f" (pag. {chunk.page})"
            parts.append(f"{header}\n{chunk.text}")
        return "\n\n---\n".join(parts)
    except Exception as e:
        logger.warning(f"KB search failed for bot {bot.id}: {e}")
        return ""


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
        enable_live_voice=request.enable_live_voice,
        enable_reporting=request.enable_reporting,
        report_prompt=request.report_prompt,
        llm_provider=request.llm_provider,
        llm_model=normalize_llm_model(request.llm_provider, request.llm_model),
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
    if request.enable_live_voice is not None:
        bot.enable_live_voice = request.enable_live_voice
    if request.enable_reporting is not None:
        bot.enable_reporting = request.enable_reporting
    if request.report_prompt is not None:
        bot.report_prompt = request.report_prompt
    if request.llm_provider is not None:
        bot.llm_provider = request.llm_provider
    if request.llm_model is not None:
        bot.llm_model = normalize_llm_model(request.llm_provider or bot.llm_provider, request.llm_model)
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
    http_request: Request,
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

    # Augment system prompt with KB context if available. Overrides let the teacher test
    # unsaved edits (system prompt, temperature, model) straight from the config panel.
    kb_context = await _build_kb_context(db, bot, request.content, teacher.tenant_id)
    system_prompt = request.system_prompt if request.system_prompt is not None else bot.system_prompt
    if kb_context:
        system_prompt = f"{system_prompt}\n\n{kb_context}"
    system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))

    # Call LLM
    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=request.llm_provider or bot.llm_provider,
        model=request.llm_model or bot.llm_model,
        temperature=request.temperature if request.temperature is not None else bot.temperature,
    )

    # Track usage (Context: Teacher only)
    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
        enrich_usage_with_environmental_impact(
            {
                "type": "teacherbot_test",
                "bot_id": str(bot.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
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
        token_usage_json=enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
    )


@router.post("/teacherbots/{teacherbot_id}/kb")
async def upload_teacherbot_kb_document(
    teacherbot_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """Upload a document to the teacherbot's knowledge base and ingest it."""
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=404, detail="Teacherbot not found")

    file_bytes = await file.read()
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File troppo grande (max 20 MB)")

    filename = file.filename or "document"
    mime_type = file.content_type or "application/octet-stream"

    # Extract text (no LLM summary for speed; data files skip the summary anyway)
    is_data = filename.lower().endswith((".xlsx", ".xls", ".csv"))
    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=filename,
        mime_type=mime_type,
        llm_service=None if is_data else llm_service,
        analyze_visuals=not is_data,
    )

    if not analysis.rag_segments:
        raise HTTPException(status_code=400, detail="Impossibile estrarre contenuto dal documento.")

    doc = RAGDocument(
        tenant_id=teacher.tenant_id,
        scope=Scope.USER,          # scope field is required; teacherbot_id is the real key
        owner_teacher_id=teacher.id,
        teacherbot_id=teacherbot_id,
        file_id=None,
        title=filename,
        doc_type=filename.rsplit(".", 1)[-1].lower() if "." in filename else "doc",
        status=DocumentStatus.QUEUED,
    )
    db.add(doc)
    await db.flush()

    chunk_count = await rag_service.ingest_document(
        db, doc, analysis.rag_segments or analysis.raw_text
    )
    logger.info(f"KB doc ingested for bot {teacherbot_id}: {filename} ({chunk_count} chunks)")

    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "status": doc.status,
        "chunk_count": chunk_count,
    }


@router.get("/teacherbots/{teacherbot_id}/kb")
async def list_teacherbot_kb_documents(
    teacherbot_id: UUID,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """List all knowledge base documents for a teacherbot."""
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Teacherbot not found")

    docs_result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.teacherbot_id == teacherbot_id)
        .order_by(RAGDocument.created_at.asc())
    )
    docs = docs_result.scalars().all()
    return [
        {
            "id": str(d.id),
            "title": d.title,
            "doc_type": d.doc_type,
            "status": d.status,
            "created_at": d.created_at.isoformat(),
        }
        for d in docs
    ]


@router.delete("/teacherbots/{teacherbot_id}/kb/{doc_id}", status_code=204)
async def delete_teacherbot_kb_document(
    teacherbot_id: UUID,
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """Remove a document from the teacherbot's knowledge base."""
    result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.id == doc_id)
        .where(RAGDocument.teacherbot_id == teacherbot_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()


@router.get("/teacher/sessions/{session_id}/teacherbots", response_model=list[TeacherbotListResponse])
async def list_session_teacherbots(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Return teacherbots published to the class of this session (teacher view for demo mode)"""
    from app.models.session import Session
    from app.core.permissions import teacher_can_access_session

    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Get the session's class_id
    session_result = await db.execute(
        select(Session).where(Session.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    result = await db.execute(
        select(
            Teacherbot,
            func.count(TeacherbotConversation.id.distinct()).label('conversation_count')
        )
        .join(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
        .outerjoin(TeacherbotConversation, TeacherbotConversation.teacherbot_id == Teacherbot.id)
        .where(TeacherbotPublication.class_id == session.class_id)
        .where(TeacherbotPublication.is_active == True)
        .where(Teacherbot.tenant_id == teacher.tenant_id)
        .group_by(Teacherbot.id)
        .order_by(Teacherbot.name)
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
            publication_count=1,
            conversation_count=conv_count,
        )
        for bot, conv_count in rows
    ]


@router.get("/teacher/sessions/{session_id}/teacherbot-conversations")
async def get_session_teacherbot_conversations(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Return all teacherbot conversations for a session, grouped by student (teacher view)."""
    from app.core.permissions import teacher_can_access_session
    if not await teacher_can_access_session(db, teacher, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    result = await db.execute(
        select(
            TeacherbotConversation,
            SessionStudent,
            Teacherbot,
            func.count(TeacherbotMessage.id).label("message_count"),
        )
        .join(SessionStudent, TeacherbotConversation.student_id == SessionStudent.id)
        .join(Teacherbot, TeacherbotConversation.teacherbot_id == Teacherbot.id)
        .outerjoin(TeacherbotMessage, TeacherbotMessage.conversation_id == TeacherbotConversation.id)
        .where(TeacherbotConversation.session_id == session_id)
        .where(Teacherbot.teacher_id == teacher.id)
        .group_by(TeacherbotConversation.id, SessionStudent.id, Teacherbot.id)
        .order_by(TeacherbotConversation.created_at.desc())
    )
    rows = result.all()

    return [
        {
            "id": str(conv.id),
            "student_id": str(student.id),
            "student_nickname": student.nickname,
            "teacherbot_id": str(bot.id),
            "teacherbot_name": bot.name,
            "teacherbot_color": bot.color,
            "message_count": msg_count,
            "created_at": conv.created_at.isoformat(),
            "updated_at": (conv.updated_at or conv.created_at).isoformat(),
        }
        for conv, student, bot, msg_count in rows
    ]


@router.post("/teacherbots/{teacherbot_id}/publish", response_model=TeacherbotPublicationResponse)
async def publish_teacherbot(
    teacherbot_id: UUID,
    request: TeacherbotPublishRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Publish a teacherbot to a class, or share it with a single student"""
    # Verify teacherbot ownership
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    if request.student_id is not None:
        return await _publish_teacherbot_to_student(db, teacher, bot, request.student_id)

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
            .limit(1)
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


async def _publish_teacherbot_to_student(
    db: AsyncSession, teacher: User, bot: Teacherbot, student_id: UUID,
) -> TeacherbotPublicationResponse:
    """Share a teacherbot with a single student (rather than their whole class)."""
    result = await db.execute(
        select(SessionStudent, Session, Class)
        .join(Session, SessionStudent.session_id == Session.id)
        .join(Class, Session.class_id == Class.id)
        .where(SessionStudent.id == student_id)
        .where(SessionStudent.tenant_id == teacher.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    student, session, class_ = row

    if not await teacher_can_access_class(db, teacher, class_.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    result = await db.execute(
        select(TeacherbotPublication)
        .where(TeacherbotPublication.teacherbot_id == bot.id)
        .where(TeacherbotPublication.student_id == student_id)
        .where(TeacherbotPublication.is_active == True)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already shared with this student")

    publication = TeacherbotPublication(
        tenant_id=teacher.tenant_id,
        teacherbot_id=bot.id,
        student_id=student_id,
        published_by_id=teacher.id,
        is_active=True,
    )
    db.add(publication)

    if bot.status != TeacherbotStatus.PUBLISHED:
        bot.status = TeacherbotStatus.PUBLISHED
        bot.published_at = datetime.utcnow()

    await db.commit()
    await db.refresh(publication)

    await sio.emit(
        "chat_message",
        {
            "room_type": "PUBLIC",
            "session_id": str(session.id),
            "message": {
                "id": f"share-{publication.id}",
                "sender_type": "SYSTEM",
                "text": f"Il docente ti ha condiviso un assistente: {bot.name}",
                "created_at": datetime.utcnow().isoformat(),
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
        room=f"student:{student_id}",
    )

    return TeacherbotPublicationResponse(
        id=publication.id,
        teacherbot_id=publication.teacherbot_id,
        student_id=publication.student_id,
        student_nickname=student.nickname,
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
        select(TeacherbotPublication, Class, SessionStudent)
        .outerjoin(Class, TeacherbotPublication.class_id == Class.id)
        .outerjoin(SessionStudent, TeacherbotPublication.student_id == SessionStudent.id)
        .where(TeacherbotPublication.teacherbot_id == teacherbot_id)
        .order_by(TeacherbotPublication.published_at.desc())
    )
    rows = result.all()

    return [
        TeacherbotPublicationResponse(
            id=pub.id,
            teacherbot_id=pub.teacherbot_id,
            class_id=pub.class_id,
            class_name=cls.name if cls else None,
            student_id=pub.student_id,
            student_nickname=student.nickname if student else None,
            is_active=pub.is_active,
            published_at=pub.published_at,
            published_by_id=pub.published_by_id,
        )
        for pub, cls, student in rows
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

    # Get all conversations (with or without generated reports)
    result = await db.execute(
        select(
            TeacherbotConversation, SessionStudent, Session,
            func.count(TeacherbotMessage.id).label('message_count')
        )
        .join(SessionStudent, TeacherbotConversation.student_id == SessionStudent.id)
        .join(Session, TeacherbotConversation.session_id == Session.id)
        .outerjoin(TeacherbotMessage, TeacherbotMessage.conversation_id == TeacherbotConversation.id)
        .where(TeacherbotConversation.teacherbot_id == teacherbot_id)
        .group_by(TeacherbotConversation.id, SessionStudent.id, Session.id)
        .order_by(TeacherbotConversation.created_at.desc())
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


@router.get("/teacherbots/{teacherbot_id}/conversations/{conversation_id}/messages")
async def get_teacherbot_conversation_messages_teacher(
    teacherbot_id: UUID,
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get messages for a specific teacherbot conversation (teacher view)"""
    # Verify ownership of the teacherbot
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")

    # Verify conversation belongs to this teacherbot
    result = await db.execute(
        select(TeacherbotConversation)
        .where(TeacherbotConversation.id == conversation_id)
        .where(TeacherbotConversation.teacherbot_id == teacherbot_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    result = await db.execute(
        select(TeacherbotMessage)
        .where(TeacherbotMessage.conversation_id == conversation_id)
        .order_by(TeacherbotMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]


# ==================== STUDENTBOT MANAGEMENT ====================

async def _get_owned_studentbot(db: AsyncSession, student: SessionStudent, bot_id: UUID) -> Teacherbot:
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == bot_id)
        .where(Teacherbot.creator_student_id == student.id)
        .where(Teacherbot.tenant_id == student.tenant_id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Studentbot non trovato")
    return bot


async def _student_credit_context(db: AsyncSession, student: SessionStudent):
    result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == student.session_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return row


@router.get("/student/studentbots", response_model=list[TeacherbotListResponse])
async def list_studentbots(
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(
            Teacherbot,
            func.count(TeacherbotConversation.id.distinct()).label("conversation_count"),
        )
        .outerjoin(TeacherbotConversation, TeacherbotConversation.teacherbot_id == Teacherbot.id)
        .where(Teacherbot.creator_student_id == student.id)
        .where(Teacherbot.tenant_id == student.tenant_id)
        .group_by(Teacherbot.id)
        .order_by(Teacherbot.updated_at.desc())
    )
    return [
        TeacherbotListResponse(
            id=bot.id,
            name=bot.name,
            synopsis=bot.synopsis,
            icon=bot.icon,
            color=bot.color,
            status=bot.status.value,
            is_proactive=bot.is_proactive,
            enable_reporting=False,
            created_at=bot.created_at,
            updated_at=bot.updated_at,
            publication_count=0,
            conversation_count=conversation_count,
        )
        for bot, conversation_count in result.all()
    ]


@router.post("/student/studentbots", response_model=TeacherbotResponse)
async def create_studentbot(
    request: TeacherbotCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    bot = Teacherbot(
        tenant_id=student.tenant_id,
        teacher_id=None,
        creator_student_id=student.id,
        name=request.name,
        synopsis=request.synopsis,
        description=request.description,
        icon=request.icon,
        color=request.color,
        system_prompt=request.system_prompt,
        is_proactive=request.is_proactive,
        proactive_message=request.proactive_message,
        enable_live_voice=request.enable_live_voice,
        enable_reporting=False,
        report_prompt=None,
        llm_provider=request.llm_provider,
        llm_model=normalize_llm_model(request.llm_provider, request.llm_model),
        temperature=request.temperature,
        status=TeacherbotStatus.DRAFT,
    )
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return bot


@router.get("/student/studentbots/{studentbot_id}", response_model=TeacherbotResponse)
async def get_studentbot(
    studentbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    return await _get_owned_studentbot(db, student, studentbot_id)


@router.patch("/student/studentbots/{studentbot_id}", response_model=TeacherbotResponse)
async def update_studentbot(
    studentbot_id: UUID,
    request: TeacherbotUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    bot = await _get_owned_studentbot(db, student, studentbot_id)
    for field in (
        "name", "synopsis", "description", "icon", "color", "system_prompt",
        "is_proactive", "proactive_message", "enable_live_voice", "llm_provider", "temperature",
    ):
        value = getattr(request, field)
        if value is not None:
            setattr(bot, field, value)
    if request.llm_model is not None:
        bot.llm_model = normalize_llm_model(request.llm_provider or bot.llm_provider, request.llm_model)
    if request.status in (TeacherbotStatus.DRAFT.value, TeacherbotStatus.TESTING.value, TeacherbotStatus.ARCHIVED.value):
        bot.status = TeacherbotStatus(request.status)
    bot.enable_reporting = False
    bot.report_prompt = None
    await db.commit()
    await db.refresh(bot)
    return bot


@router.delete("/student/studentbots/{studentbot_id}")
async def delete_studentbot(
    studentbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    bot = await _get_owned_studentbot(db, student, studentbot_id)
    await db.delete(bot)
    await db.commit()
    return {"message": "Studentbot eliminato"}


@router.post("/student/studentbots/{studentbot_id}/test", response_model=TeacherbotTestResponse)
async def test_studentbot(
    studentbot_id: UUID,
    request: TeacherbotTestMessage,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    bot = await _get_owned_studentbot(db, student, studentbot_id)
    session_obj, class_obj = await _student_credit_context(db, student)
    allowed = await credit_service.check_availability(
        db, student.tenant_id, 0.0001,
        teacher_id=class_obj.teacher_id,
        class_id=class_obj.id,
        session_id=session_obj.id,
        student_id=student.id,
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Credit limit exceeded")

    messages = [
        {"role": msg.get("role", "user"), "content": msg.get("content", "")}
        for msg in (request.history or [])
    ]
    messages.append({"role": "user", "content": request.content})
    kb_context = await _build_kb_context(db, bot, request.content, student.tenant_id)
    system_prompt = request.system_prompt if request.system_prompt is not None else bot.system_prompt
    if kb_context:
        system_prompt = f"{system_prompt}\n\n{kb_context}"
    system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))
    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=request.llm_provider or bot.llm_provider,
        model=request.llm_model or bot.llm_model,
        temperature=request.temperature if request.temperature is not None else bot.temperature,
    )
    cost = credit_service.calculate_cost_for_model(
        llm_response.provider, llm_response.model,
        llm_response.prompt_tokens, llm_response.completion_tokens,
    )
    await credit_service.track_usage(
        db, student.tenant_id, llm_response.provider, llm_response.model, cost,
        enrich_usage_with_environmental_impact(
            {
                "type": "studentbot_test",
                "bot_id": str(bot.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
        teacher_id=class_obj.teacher_id,
        class_id=class_obj.id,
        session_id=session_obj.id,
        student_id=student.id,
    )
    if bot.status == TeacherbotStatus.DRAFT:
        bot.status = TeacherbotStatus.TESTING
        await db.commit()
    return TeacherbotTestResponse(
        content=llm_response.content,
        provider=llm_response.provider,
        model=llm_response.model,
        token_usage_json=enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
    )


@router.post("/student/studentbots/{studentbot_id}/kb")
async def upload_studentbot_kb_document(
    studentbot_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    await _get_owned_studentbot(db, student, studentbot_id)
    file_bytes = await file.read()
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File troppo grande (max 20 MB)")
    filename = file.filename or "document"
    mime_type = file.content_type or "application/octet-stream"
    is_data = filename.lower().endswith((".xlsx", ".xls", ".csv"))
    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=filename,
        mime_type=mime_type,
        llm_service=None if is_data else llm_service,
        analyze_visuals=not is_data,
    )
    if not analysis.rag_segments:
        raise HTTPException(status_code=400, detail="Impossibile estrarre contenuto dal documento.")
    doc = RAGDocument(
        tenant_id=student.tenant_id,
        scope=Scope.USER,
        owner_student_id=student.id,
        teacherbot_id=studentbot_id,
        file_id=None,
        title=filename,
        doc_type=filename.rsplit(".", 1)[-1].lower() if "." in filename else "doc",
        status=DocumentStatus.QUEUED,
    )
    db.add(doc)
    await db.flush()
    chunk_count = await rag_service.ingest_document(db, doc, analysis.rag_segments or analysis.raw_text)
    return {"id": str(doc.id), "title": doc.title, "doc_type": doc.doc_type, "status": doc.status, "chunk_count": chunk_count}


@router.get("/student/studentbots/{studentbot_id}/kb")
async def list_studentbot_kb_documents(
    studentbot_id: UUID,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    await _get_owned_studentbot(db, student, studentbot_id)
    result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.teacherbot_id == studentbot_id)
        .where(RAGDocument.owner_student_id == student.id)
        .order_by(RAGDocument.created_at.asc())
    )
    return [
        {"id": str(doc.id), "title": doc.title, "doc_type": doc.doc_type, "status": doc.status, "created_at": doc.created_at.isoformat()}
        for doc in result.scalars().all()
    ]


@router.delete("/student/studentbots/{studentbot_id}/kb/{doc_id}", status_code=204)
async def delete_studentbot_kb_document(
    studentbot_id: UUID,
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    await _get_owned_studentbot(db, student, studentbot_id)
    result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.id == doc_id)
        .where(RAGDocument.teacherbot_id == studentbot_id)
        .where(RAGDocument.owner_student_id == student.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()


# ==================== STUDENT CONVERSATION ENDPOINTS ====================

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

    # Get active publications for this class or for this student individually.
    result = await db.execute(
        select(Teacherbot)
        .distinct()
        .join(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
        .where(or_(
            TeacherbotPublication.class_id == session.class_id,
            TeacherbotPublication.student_id == student.id,
        ))
        .where(TeacherbotPublication.is_active == True)
        .where(Teacherbot.status == TeacherbotStatus.PUBLISHED)
    )
    published_bots = result.scalars().all()
    own_result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.creator_student_id == student.id)
        .where(Teacherbot.tenant_id == student.tenant_id)
        .where(Teacherbot.status != TeacherbotStatus.ARCHIVED)
    )
    own_bots = own_result.scalars().all()
    bots = list({bot.id: bot for bot in [*published_bots, *own_bots]}.values())

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
            enable_live_voice=bot.enable_live_voice,
            is_studentbot=bot.creator_student_id == student.id,
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

    own_result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.creator_student_id == student.id)
        .where(Teacherbot.tenant_id == student.tenant_id)
        .where(Teacherbot.status != TeacherbotStatus.ARCHIVED)
    )
    bot = own_result.scalar_one_or_none()
    if not bot:
        result = await db.execute(
        select(Teacherbot)
        .distinct()
        .join(TeacherbotPublication, TeacherbotPublication.teacherbot_id == Teacherbot.id)
        .where(Teacherbot.id == teacherbot_id)
        .where(or_(
            TeacherbotPublication.class_id == session.class_id,
            TeacherbotPublication.student_id == student.id,
        ))
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
    http_request: Request,
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
    
    # Augment with KB context if the bot has a knowledge base
    kb_context = await _build_kb_context(db, bot, request.content, student.tenant_id)
    grade_instruction = get_school_grade_instruction(class_obj.school_grade)
    system_prompt = bot.system_prompt + grade_instruction
    if kb_context:
        system_prompt = f"{system_prompt}\n\n{kb_context}"
    system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))

    # history already includes user_msg because of db.add and flush
    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=bot.llm_provider,
        model=bot.llm_model,
        temperature=bot.temperature,
    )

    # Track usage
    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, student.tenant_id, llm_response.provider, llm_response.model, cost,
        enrich_usage_with_environmental_impact(
            {
                "type": "teacherbot_chat",
                "bot_id": str(bot.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
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
        token_usage_json=enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
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
    http_request: Request,
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
        elif (
            mime_type in (
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "application/vnd.ms-powerpoint",
            )
            or filename.lower().endswith((".pptx", ".ppt"))
        ):
            try:
                import io as _io
                from pptx import Presentation
                prs = Presentation(_io.BytesIO(file_data))
                slide_texts: list[str] = []
                for i, slide in enumerate(prs.slides, 1):
                    parts: list[str] = []
                    for shape in slide.shapes:
                        if not shape.has_text_frame:
                            continue
                        for para in shape.text_frame.paragraphs:
                            line = " ".join(run.text for run in para.runs if run.text.strip())
                            if line.strip():
                                parts.append(line.strip())
                    if parts:
                        slide_texts.append(f"## Slide {i}\n" + "\n".join(parts))
                extracted_text = "\n\n".join(slide_texts)
            except Exception as e:
                extracted_text = f"[Error reading PPTX: {str(e)}]"
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
            image_usage = enrich_usage_with_environmental_impact(
                {"prompt_tokens": 0, "completion_tokens": 0, "image_count": 1},
                provider="flux",
                model="flux-schnell",
            )
            img_cost = credit_service.calculate_cost_for_model("flux", "flux-schnell", 0, 0, image_count=1)
            await credit_service.track_usage(
                db, student.tenant_id, "flux", "flux-schnell", img_cost,
                {
                    **image_usage,
                    "type": "teacherbot_image_generation",
                    "bot_id": str(bot.id),
                    "image_prompt": image_prompt,
                },
                teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id,
            )
            
            # Save assistant message
            assistant_msg = TeacherbotMessage(
                tenant_id=student.tenant_id,
                conversation_id=conversation_id,
                role="assistant",
                content=assistant_content,
                provider="flux",
                model="flux-schnell",
                token_usage_json=image_usage,
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
    system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))

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
        enrich_usage_with_environmental_impact(
            {
                "type": "teacherbot_chat",
                "bot_id": str(bot.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
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
        token_usage_json=enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
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


# ==================== SHARE LINK ENDPOINTS (teacher) ====================

async def _get_owned_teacherbot(db: AsyncSession, teacherbot_id: UUID, teacher: User) -> Teacherbot:
    result = await db.execute(
        select(Teacherbot)
        .where(Teacherbot.id == teacherbot_id)
        .where(Teacherbot.teacher_id == teacher.id)
    )
    bot = result.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacherbot not found")
    return bot


@router.post("/teacherbots/{teacherbot_id}/share-links", response_model=ShareLinkResponse)
async def create_teacherbot_share_link(
    teacherbot_id: UUID,
    request: ShareLinkCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Create a public link (token + access code + expiry) for this teacherbot"""
    bot = await _get_owned_teacherbot(db, teacherbot_id, teacher)

    expires_at = request.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expires_at must be in the future")

    access_code = (request.access_code or "").strip().upper() or generate_join_code(6)

    link = TeacherbotShareLink(
        tenant_id=teacher.tenant_id,
        teacherbot_id=bot.id,
        created_by_id=teacher.id,
        token=secrets.token_urlsafe(16),
        access_code=access_code,
        label=request.label,
        expires_at=expires_at,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


@router.get("/teacherbots/{teacherbot_id}/share-links", response_model=list[ShareLinkResponse])
async def list_teacherbot_share_links(
    teacherbot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List public links created for this teacherbot"""
    await _get_owned_teacherbot(db, teacherbot_id, teacher)

    result = await db.execute(
        select(TeacherbotShareLink)
        .where(TeacherbotShareLink.teacherbot_id == teacherbot_id)
        .order_by(TeacherbotShareLink.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/teacherbots/{teacherbot_id}/share-links/{link_id}")
async def revoke_teacherbot_share_link(
    teacherbot_id: UUID,
    link_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Revoke a public link so it can no longer be opened"""
    await _get_owned_teacherbot(db, teacherbot_id, teacher)

    result = await db.execute(
        select(TeacherbotShareLink)
        .where(TeacherbotShareLink.id == link_id)
        .where(TeacherbotShareLink.teacherbot_id == teacherbot_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    link.is_active = False
    link.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Link revoked"}


@router.get("/teacherbots/{teacherbot_id}/share-links/{link_id}/conversations", response_model=list[ShareConversationResponse])
async def list_teacherbot_share_link_conversations(
    teacherbot_id: UUID,
    link_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """List visitor conversations opened through a given share link"""
    await _get_owned_teacherbot(db, teacherbot_id, teacher)

    result = await db.execute(
        select(TeacherbotShareLink)
        .where(TeacherbotShareLink.id == link_id)
        .where(TeacherbotShareLink.teacherbot_id == teacherbot_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    result = await db.execute(
        select(TeacherbotShareConversation)
        .where(TeacherbotShareConversation.share_link_id == link_id)
        .order_by(TeacherbotShareConversation.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/teacherbots/{teacherbot_id}/share-conversations/{conversation_id}/messages", response_model=list[ShareMessageResponse])
async def get_teacherbot_share_conversation_messages(
    teacherbot_id: UUID,
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get messages of a visitor conversation (teacher review view)"""
    await _get_owned_teacherbot(db, teacherbot_id, teacher)

    result = await db.execute(
        select(TeacherbotShareConversation)
        .join(TeacherbotShareLink, TeacherbotShareLink.id == TeacherbotShareConversation.share_link_id)
        .where(TeacherbotShareConversation.id == conversation_id)
        .where(TeacherbotShareLink.teacherbot_id == teacherbot_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    result = await db.execute(
        select(TeacherbotShareMessage)
        .where(TeacherbotShareMessage.conversation_id == conversation_id)
        .order_by(TeacherbotShareMessage.created_at.asc())
    )
    return result.scalars().all()


# ==================== SHARE LINK ENDPOINTS (public, no auth) ====================

# Very small in-memory throttle for wrong access-code attempts: {token: [timestamps]}.
# Not meant to survive process restarts/multiple workers — just a speed bump against brute force.
_verify_attempts: dict[str, list[datetime]] = {}
_VERIFY_MAX_ATTEMPTS = 8
_VERIFY_WINDOW_SECONDS = 600

# Same idea for anonymous voice-dictation requests: Whisper has a real per-minute API cost and
# this endpoint has no per-user credit ledger to lean on, so cap it per share link instead.
_transcribe_attempts: dict[str, list[datetime]] = {}
_TRANSCRIBE_MAX_ATTEMPTS = 30
_TRANSCRIBE_WINDOW_SECONDS = 3600


def _too_many_transcribe_attempts(token: str) -> bool:
    now = datetime.now(timezone.utc)
    attempts = [t for t in _transcribe_attempts.get(token, []) if (now - t).total_seconds() < _TRANSCRIBE_WINDOW_SECONDS]
    _transcribe_attempts[token] = attempts
    return len(attempts) >= _TRANSCRIBE_MAX_ATTEMPTS


def _record_transcribe_attempt(token: str) -> None:
    _transcribe_attempts.setdefault(token, []).append(datetime.now(timezone.utc))


def _too_many_verify_attempts(token: str) -> bool:
    now = datetime.now(timezone.utc)
    attempts = [t for t in _verify_attempts.get(token, []) if (now - t).total_seconds() < _VERIFY_WINDOW_SECONDS]
    _verify_attempts[token] = attempts
    return len(attempts) >= _VERIFY_MAX_ATTEMPTS


def _record_verify_attempt(token: str) -> None:
    _verify_attempts.setdefault(token, []).append(datetime.now(timezone.utc))


async def _get_active_share_link(db: AsyncSession, token: str) -> TeacherbotShareLink:
    result = await db.execute(
        select(TeacherbotShareLink).where(TeacherbotShareLink.token == token)
    )
    link = result.scalar_one_or_none()
    if not link or not link.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    if link.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link expired")
    return link


@router.get("/public/teacherbot-links/{token}", response_model=ShareLinkPublicInfo)
async def get_public_teacherbot_link_info(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Non-sensitive bot info shown before the access-code gate"""
    link = await _get_active_share_link(db, token)
    result = await db.execute(select(Teacherbot).where(Teacherbot.id == link.teacherbot_id))
    bot = result.scalar_one()
    return ShareLinkPublicInfo(
        name=bot.name,
        synopsis=bot.synopsis,
        icon=bot.icon,
        color=bot.color,
        is_proactive=bot.is_proactive,
        proactive_message=bot.proactive_message if bot.is_proactive else None,
    )


@router.post("/public/teacherbot-links/{token}/verify", response_model=ShareConversationResponse)
async def verify_public_teacherbot_link(
    token: str,
    request: ShareLinkVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify the access code and open a new visitor conversation"""
    link = await _get_active_share_link(db, token)

    if _too_many_verify_attempts(token):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts, try again later")

    if request.access_code.strip().upper() != link.access_code.upper():
        _record_verify_attempt(token)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access code")

    result = await db.execute(select(Teacherbot).where(Teacherbot.id == link.teacherbot_id))
    bot = result.scalar_one()

    conversation = TeacherbotShareConversation(
        tenant_id=link.tenant_id,
        share_link_id=link.id,
    )
    db.add(conversation)
    await db.flush()

    if bot.is_proactive and bot.proactive_message:
        db.add(TeacherbotShareMessage(
            tenant_id=link.tenant_id,
            conversation_id=conversation.id,
            role="assistant",
            content=bot.proactive_message,
        ))

    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.get("/public/teacherbot-links/conversations/{conversation_id}/messages", response_model=list[ShareMessageResponse])
async def get_public_teacherbot_conversation_messages(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Message history for a visitor conversation (used on page refresh)"""
    result = await db.execute(
        select(TeacherbotShareConversation).where(TeacherbotShareConversation.id == conversation_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    result = await db.execute(
        select(TeacherbotShareMessage)
        .where(TeacherbotShareMessage.conversation_id == conversation_id)
        .order_by(TeacherbotShareMessage.created_at.asc())
    )
    return result.scalars().all()


@router.post("/public/teacherbot-links/conversations/{conversation_id}/message", response_model=ShareMessageResponse)
async def send_public_teacherbot_message(
    conversation_id: UUID,
    request: ShareVisitorMessageCreate,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Send a message as an anonymous visitor and get the teacherbot's reply"""
    result = await db.execute(
        select(TeacherbotShareConversation, TeacherbotShareLink)
        .join(TeacherbotShareLink, TeacherbotShareLink.id == TeacherbotShareConversation.share_link_id)
        .where(TeacherbotShareConversation.id == conversation_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    conv, link = row
    if not link.is_active:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link revoked")
    if link.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link expired")

    result = await db.execute(select(Teacherbot).where(Teacherbot.id == link.teacherbot_id))
    bot = result.scalar_one()

    allowed = await credit_service.check_availability(
        db, bot.tenant_id, estimated_cost=0.0001, teacher_id=bot.teacher_id,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Credit limit exceeded for this teacherbot.",
        )

    user_msg = TeacherbotShareMessage(
        tenant_id=link.tenant_id,
        conversation_id=conversation_id,
        role="user",
        content=request.content,
    )
    db.add(user_msg)
    await db.flush()

    result = await db.execute(
        select(TeacherbotShareMessage)
        .where(TeacherbotShareMessage.conversation_id == conversation_id)
        .order_by(TeacherbotShareMessage.created_at.asc())
    )
    history = result.scalars().all()
    messages = [{"role": msg.role, "content": msg.content} for msg in history]

    kb_context = await _build_kb_context(db, bot, request.content, link.tenant_id)
    system_prompt = bot.system_prompt
    if kb_context:
        system_prompt = f"{system_prompt}\n\n{kb_context}"
    system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))

    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=bot.llm_provider,
        model=bot.llm_model,
        temperature=bot.temperature,
    )

    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, bot.tenant_id, llm_response.provider, llm_response.model, cost,
        enrich_usage_with_environmental_impact(
            {
                "type": "teacherbot_share_chat",
                "bot_id": str(bot.id),
                "share_link_id": str(link.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
        teacher_id=bot.teacher_id,
    )

    assistant_msg = TeacherbotShareMessage(
        tenant_id=link.tenant_id,
        conversation_id=conversation_id,
        role="assistant",
        content=llm_response.content,
        provider=llm_response.provider,
        model=llm_response.model,
        token_usage_json=enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
    )
    db.add(assistant_msg)
    conv.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(assistant_msg)
    return assistant_msg


def _extract_public_attachment_text(filename: str, mime_type: str, file_data: bytes) -> str:
    """Text extraction for public share-link attachments. Deliberately narrower than the
    authenticated student path: no vision/image analysis and no image-generation trigger, since
    anonymous visitors have no per-user credit ledger to bound that cost against."""
    if mime_type.startswith("text/") or filename.endswith((".txt", ".md", ".csv", ".py", ".js", ".ts", ".html", ".css", ".json")):
        try:
            return file_data.decode("utf-8")
        except Exception:
            return file_data.decode("latin-1", errors="ignore")
    if mime_type == "application/pdf" or filename.endswith(".pdf"):
        try:
            import fitz  # PyMuPDF
            pdf_doc = fitz.open(stream=file_data, filetype="pdf")
            text = "".join(page.get_text() for page in pdf_doc)
            pdf_doc.close()
            return text
        except Exception as e:
            return f"[Errore lettura PDF: {e}]"
    if (
        mime_type in (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-powerpoint",
        )
        or filename.lower().endswith((".pptx", ".ppt"))
    ):
        try:
            import io as _io
            from pptx import Presentation
            prs = Presentation(_io.BytesIO(file_data))
            slide_texts: list[str] = []
            for i, slide in enumerate(prs.slides, 1):
                parts: list[str] = []
                for shape in slide.shapes:
                    if not shape.has_text_frame:
                        continue
                    for para in shape.text_frame.paragraphs:
                        line = " ".join(run.text for run in para.runs if run.text.strip())
                        if line.strip():
                            parts.append(line.strip())
                if parts:
                    slide_texts.append(f"## Slide {i}\n" + "\n".join(parts))
            return "\n\n".join(slide_texts)
        except Exception as e:
            return f"[Errore lettura PPTX: {e}]"
    if mime_type.startswith("image/"):
        return f"[Immagine allegata: {filename} — non analizzata in questa chat pubblica]"
    return f"[Formato non supportato: {filename}]"


@router.post("/public/teacherbot-links/conversations/{conversation_id}/message-with-files", response_model=ShareMessageResponse)
async def send_public_teacherbot_message_with_files(
    conversation_id: UUID,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    content: str = Form(""),
    files: List[UploadFile] = File(default=[]),
):
    """Send a message with document attachments as an anonymous share-link visitor.
    No image generation and no image-vision analysis here (see _extract_public_attachment_text)."""
    result = await db.execute(
        select(TeacherbotShareConversation, TeacherbotShareLink)
        .join(TeacherbotShareLink, TeacherbotShareLink.id == TeacherbotShareConversation.share_link_id)
        .where(TeacherbotShareConversation.id == conversation_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    conv, link = row
    if not link.is_active:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link revoked")
    if link.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link expired")

    if len(files) > 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Massimo 3 allegati per messaggio")

    result = await db.execute(select(Teacherbot).where(Teacherbot.id == link.teacherbot_id))
    bot = result.scalar_one()

    allowed = await credit_service.check_availability(
        db, bot.tenant_id, estimated_cost=0.0001, teacher_id=bot.teacher_id,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Credit limit exceeded for this teacherbot.",
        )

    file_contents = []
    for file in files:
        file_data = await file.read()
        if len(file_data) > 8 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{file.filename}: massimo 8MB per allegato")
        filename = file.filename or "unknown"
        mime_type = file.content_type or "application/octet-stream"
        extracted = _extract_public_attachment_text(filename, mime_type, file_data)
        file_contents.append({"filename": filename, "mime_type": mime_type, "content": extracted[:20000]})

    full_content = content
    if file_contents:
        files_context = "\n\n--- DOCUMENTI ALLEGATI ---\n"
        for fc in file_contents:
            files_context += f"\n📄 **{fc['filename']}** ({fc['mime_type']}):\n{fc['content']}\n"
        files_context += "\n--- FINE DOCUMENTI ---\n"
        full_content = files_context + "\n" + content if content else files_context

    user_msg = TeacherbotShareMessage(
        tenant_id=link.tenant_id,
        conversation_id=conversation_id,
        role="user",
        content=content or "[Allegati caricati]",
    )
    db.add(user_msg)
    await db.flush()

    result = await db.execute(
        select(TeacherbotShareMessage)
        .where(TeacherbotShareMessage.conversation_id == conversation_id)
        .order_by(TeacherbotShareMessage.created_at.asc())
    )
    history = result.scalars().all()
    messages = [{"role": msg.role, "content": msg.content} for msg in history]
    if messages:
        messages[-1]["content"] = full_content

    kb_context = await _build_kb_context(db, bot, content, link.tenant_id)
    system_prompt = bot.system_prompt
    if kb_context:
        system_prompt = f"{system_prompt}\n\n{kb_context}"
    system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))

    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider=bot.llm_provider,
        model=bot.llm_model,
        temperature=bot.temperature,
    )

    cost = credit_service.calculate_cost_for_model(llm_response.provider, llm_response.model, llm_response.prompt_tokens, llm_response.completion_tokens)
    await credit_service.track_usage(
        db, bot.tenant_id, llm_response.provider, llm_response.model, cost,
        enrich_usage_with_environmental_impact(
            {
                "type": "teacherbot_share_chat_with_files",
                "bot_id": str(bot.id),
                "share_link_id": str(link.id),
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
        teacher_id=bot.teacher_id,
    )

    assistant_msg = TeacherbotShareMessage(
        tenant_id=link.tenant_id,
        conversation_id=conversation_id,
        role="assistant",
        content=llm_response.content,
        provider=llm_response.provider,
        model=llm_response.model,
        token_usage_json=enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=llm_response.provider,
            model=llm_response.model,
        ),
    )
    db.add(assistant_msg)
    conv.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(assistant_msg)
    return assistant_msg


@router.post("/public/teacherbot-links/{token}/transcribe")
async def transcribe_public_teacherbot_audio(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
):
    """Voice dictation for anonymous share-link visitors: transcribes audio to text so it can be
    edited and sent as a normal message. Rate-limited per link since there's no per-visitor
    credit ledger to fall back on."""
    await _get_active_share_link(db, token)  # 404/410 if invalid/expired

    if _too_many_transcribe_attempts(token):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many transcription requests, try again later")
    _record_transcribe_attempt(token)

    audio_bytes = await file.read()
    filename = file.filename or "recording.webm"
    content_type = file.content_type or "audio/webm"
    return await transcribe_with_whisper(audio_bytes, filename, content_type, language)
