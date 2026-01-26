from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, Optional, List
from datetime import datetime
from uuid import UUID
import logging
import base64
import io

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.llm import LLMProfile, Conversation, ConversationMessage, AuditEvent
from app.models.enums import MessageRole
from app.schemas.llm import (
    LLMProfileResponse, ConversationCreate, ConversationResponse,
    MessageCreate, ConversationMessageResponse, ExplainRequest, ExplainResponse,
)
from app.services.llm_service import llm_service
from app.services.chatbot_profiles import get_profile, get_all_profiles, CHATBOT_PROFILES

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/chatbot-profiles")
async def list_chatbot_profiles():
    """Get all available chatbot profiles with their configurations"""
    return get_all_profiles()


@router.get("/available-models")
async def list_available_models():
    """Get list of available LLM models"""
    from app.core.config import settings
    import httpx
    
    models = []
    
    # OpenAI models
    if settings.OPENAI_API_KEY:
        models.extend([
            {"provider": "openai", "model": "gpt-5-mini", "name": "GPT-5 Mini", "description": "Veloce e intelligente", "icon": "openai"},
            {"provider": "openai", "model": "gpt-5-nano", "name": "GPT-5 Nano", "description": "Ultra veloce ed economico", "icon": "openai"},
        ])
    
    # Anthropic models
    if settings.ANTHROPIC_API_KEY:
        models.extend([
            {"provider": "anthropic", "model": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5", "description": "Veloce e leggero", "icon": "anthropic"},
        ])
    
    # Ollama models - fetch dynamically from Ollama API
    if settings.OLLAMA_BASE_URL:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags", timeout=5.0)
                if response.status_code == 200:
                    ollama_data = response.json()
                    available_ollama = {m["name"].split(":")[0]: m["name"] for m in ollama_data.get("models", [])}
                    
                    # Add configured Ollama models if available
                    if "mistral-nemo" in available_ollama or "mistral-nemo:latest" in [m["name"] for m in ollama_data.get("models", [])]:
                        models.append({"provider": "ollama", "model": "mistral-nemo", "name": "Mistral Nemo", "description": "12B locale, veloce", "icon": "mistral"})
                    if "deepseek-r1" in available_ollama:
                        models.append({"provider": "ollama", "model": "deepseek-r1:8b", "name": "DeepSeek R1 8B", "description": "Ragionamento avanzato", "icon": "deepseek"})
                    if "mistral" in available_ollama:
                        models.append({"provider": "ollama", "model": "mistral", "name": "Mistral 7B", "description": "Modello locale efficiente", "icon": "mistral"})
        except Exception:
            pass  # Ollama not available, skip
    
    return {"models": models, "default_provider": "openai", "default_model": "gpt-5-mini"}


@router.get("/profiles", response_model=list[LLMProfileResponse])
async def list_profiles(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    tenant_id = auth.teacher.tenant_id if auth.is_teacher else auth.student.tenant_id
    
    result = await db.execute(
        select(LLMProfile).where(
            (LLMProfile.tenant_id == tenant_id) | (LLMProfile.tenant_id.is_(None))
        )
    )
    return result.scalars().all()


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    request: ConversationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    if student.session_id != request.session_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Check if profile exists, create default if not
    result = await db.execute(
        select(LLMProfile).where(LLMProfile.key == request.profile_key)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        # Create default profile
        profile = LLMProfile(
            key=request.profile_key,
            system_prompt_template="Sei un tutor AI educativo. Aiuta lo studente a comprendere gli argomenti in modo chiaro e paziente.",
            ui_schema_json={},
            allowed_tools_json=[],
            default_model_pref={"provider": "openai", "model": "gpt-3.5-turbo"},
        )
        db.add(profile)
        await db.flush()
    
    conversation = Conversation(
        tenant_id=student.tenant_id,
        session_id=request.session_id,
        student_id=student.id,
        profile_key=request.profile_key,
        title=request.title or f"Conversation {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        llm_provider=request.provider,
        llm_model=request.model,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    session_id: Optional[UUID] = None,
    student_id: Optional[UUID] = None,
):
    if auth.is_student:
        # Students can only see their own conversations
        query = select(Conversation).where(Conversation.student_id == auth.student.id)
    else:
        # Teachers can filter by session and student
        query = select(Conversation)
        if session_id:
            # Verify teacher owns session
            result = await db.execute(
                select(Session)
                .join(Class)
                .where(Session.id == session_id)
                .where(Class.teacher_id == auth.teacher.id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
            query = query.where(Conversation.session_id == session_id)
        if student_id:
            query = query.where(Conversation.student_id == student_id)
    
    query = query.order_by(Conversation.updated_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Delete a single conversation and all its messages"""
    # Find conversation
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Verify ownership
    if auth.role == "student" and conversation.student_id != auth.user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Delete messages first
    await db.execute(
        ConversationMessage.__table__.delete().where(
            ConversationMessage.conversation_id == conversation_id
        )
    )
    
    # Delete conversation
    await db.delete(conversation)
    await db.commit()
    
    return {"status": "deleted", "conversation_id": str(conversation_id)}


@router.delete("/sessions/{session_id}/conversations")
async def delete_all_session_conversations(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Delete all conversations for a session (for current user)"""
    # Build query based on user role
    query = select(Conversation).where(Conversation.session_id == session_id)
    
    if auth.role == "student":
        query = query.where(Conversation.student_id == auth.user.id)
    
    result = await db.execute(query)
    conversations = result.scalars().all()
    
    deleted_count = 0
    for conv in conversations:
        # Delete messages
        await db.execute(
            ConversationMessage.__table__.delete().where(
                ConversationMessage.conversation_id == conv.id
            )
        )
        await db.delete(conv)
        deleted_count += 1
    
    await db.commit()
    
    return {"status": "deleted", "count": deleted_count}


@router.get("/sessions/{session_id}/conversations")
async def get_session_conversations_detailed(
    session_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Get all conversations for a session with student details (teacher only)"""
    from sqlalchemy import func as sqlfunc
    from app.models.session import SessionStudent
    
    # Verify teacher owns session
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    
    # Get conversations with student info and message count
    result = await db.execute(
        select(Conversation, SessionStudent)
        .join(SessionStudent, Conversation.student_id == SessionStudent.id)
        .where(Conversation.session_id == session_id)
        .order_by(Conversation.updated_at.desc())
    )
    rows = result.all()
    
    # Get message counts for each conversation
    conversations_data = []
    for conv, student in rows:
        msg_count_result = await db.execute(
            select(sqlfunc.count(ConversationMessage.id))
            .where(ConversationMessage.conversation_id == conv.id)
        )
        message_count = msg_count_result.scalar() or 0
        
        conversations_data.append({
            "id": str(conv.id),
            "student_id": str(student.id),
            "student_nickname": student.nickname,
            "profile_key": conv.profile_key,
            "title": conv.title,
            "llm_provider": conv.llm_provider,
            "llm_model": conv.llm_model,
            "message_count": message_count,
            "created_at": conv.created_at.isoformat(),
            "updated_at": conv.updated_at.isoformat(),
        })
    
    return conversations_data


@router.get("/conversations/{conversation_id}/messages", response_model=list[ConversationMessageResponse])
async def get_conversation_messages(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    # Verify access
    if auth.is_student:
        if conversation.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        result = await db.execute(
            select(Session)
            .join(Class)
            .where(Session.id == conversation.session_id)
            .where(Class.teacher_id == auth.teacher.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at.asc())
    )
    return result.scalars().all()


@router.post("/conversations/{conversation_id}/message", response_model=ConversationMessageResponse)
async def send_message(
    conversation_id: UUID,
    request: MessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    if conversation.student_id != student.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Save user message
    user_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=request.content,
        content_json=request.content_json,
    )
    db.add(user_message)
    
    # Log audit event
    audit = AuditEvent(
        tenant_id=student.tenant_id,
        session_id=conversation.session_id,
        actor_type="STUDENT",
        actor_student_id=student.id,
        event_type="PROMPT_SUBMITTED",
        payload_json={
            "conversation_id": str(conversation_id),
            "content_preview": request.content[:200] if request.content else "",
        },
    )
    db.add(audit)
    
    await db.flush()
    
    # Get conversation history for context
    result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at.asc())
    )
    history = result.scalars().all()
    
    # Build messages for LLM
    messages = []
    for msg in history:
        messages.append({
            "role": msg.role.value,
            "content": msg.content or "",
        })
    # Add current user message
    messages.append({"role": "user", "content": request.content})
    
    # Check if user is requesting image generation
    import re
    image_request_patterns = [
        r"genera(?:mi)?\s+(?:una?\s+)?immagine",
        r"crea(?:mi)?\s+(?:una?\s+)?immagine",
        r"disegna(?:mi)?",
        r"generate\s+(?:an?\s+)?image",
        r"create\s+(?:an?\s+)?image",
        r"draw\s+(?:me\s+)?",
    ]
    is_image_request = any(re.search(p, request.content.lower()) for p in image_request_patterns)
    
    if is_image_request:
        # Extract the image description from the request
        try:
            # Use LLM to extract a good DALL-E prompt
            prompt_extraction = await llm_service.generate(
                messages=[{"role": "user", "content": f"Estrai una descrizione dettagliata per generare un'immagine da questa richiesta. Rispondi SOLO con la descrizione in inglese, senza altro testo: {request.content}"}],
                system_prompt="You are a helpful assistant that extracts image descriptions. Respond only with the image description in English.",
                temperature=0.3,
                max_tokens=200,
            )
            image_prompt = prompt_extraction.content.strip()
            
            # Generate the image using selected provider and size
            image_provider = request.image_provider or "flux-schnell"
            image_size = request.image_size or "1024x1024"
            image_url = await llm_service.generate_image(image_prompt, size=image_size, provider=image_provider)
            provider_label = "DALL-E 3" if image_provider == "dall-e" else "Flux Schnell"
            assistant_content = f"🎨 Ecco l'immagine che hai richiesto:\n\n![Immagine generata]({image_url})\n\n*Generata con {provider_label} - Prompt: {image_prompt}*"
            provider = "openai" if image_provider == "dall-e" else "flux"
            model = "dall-e-3" if image_provider == "dall-e" else "flux-schnell"
            token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
        except Exception as e:
            logger.error(f"Image generation error: {e}")
            assistant_content = f"Mi dispiace, non sono riuscito a generare l'immagine. Errore: {str(e)}"
            provider = "fallback"
            model = "none"
            token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    else:
        # Get chatbot profile for system prompt
        profile = get_profile(conversation.profile_key)
        system_prompt = profile["system_prompt"]
        
        # Add verbose mode instruction
        if request.verbose_mode:
            system_prompt += "\n\nIMPORTANTE: L'utente ha richiesto risposte ESAUSTIVE e DETTAGLIATE. Fornisci spiegazioni approfondite, esempi, e tutti i dettagli rilevanti."
        else:
            system_prompt += "\n\nIMPORTANTE: L'utente preferisce risposte SINTETICHE e CONCISE. Sii breve e vai dritto al punto, evitando spiegazioni superflue."
        
        temperature = profile.get("temperature", 0.7)
        
        # Check if this is the math_coach profile - use agentic system with tools
        if conversation.profile_key == "math_coach":
            try:
                from app.services.math_agent import run_math_agent
                
                # Use math agent with tool calling for accurate calculations
                assistant_content = await run_math_agent(
                    messages=messages,
                    provider=conversation.llm_provider or "openai",
                    model=conversation.llm_model or "gpt-4o-mini",
                    max_iterations=5,
                )
                provider = conversation.llm_provider or "openai"
                model = conversation.llm_model or "gpt-4o-mini"
                token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
            except Exception as e:
                logger.error(f"Math agent error: {e}")
                # Fallback to regular LLM
                llm_response = await llm_service.generate(
                    messages=messages,
                    system_prompt=system_prompt,
                    provider=conversation.llm_provider,
                    model=conversation.llm_model,
                    temperature=temperature,
                    max_tokens=2048,
                )
                assistant_content = llm_response.content
                provider = llm_response.provider
                model = llm_response.model
                token_usage = {
                    "prompt_tokens": llm_response.prompt_tokens,
                    "completion_tokens": llm_response.completion_tokens,
                }
        else:
            # Call LLM service with conversation's preferred provider/model
            try:
                llm_response = await llm_service.generate(
                    messages=messages,
                    system_prompt=system_prompt,
                    provider=conversation.llm_provider,
                    model=conversation.llm_model,
                    temperature=temperature,
                    max_tokens=2048,
                )
                
                assistant_content = llm_response.content
                provider = llm_response.provider
                model = llm_response.model
                token_usage = {
                    "prompt_tokens": llm_response.prompt_tokens,
                    "completion_tokens": llm_response.completion_tokens,
                }
            except Exception as e:
                logger.error(f"LLM service error: {e}")
                # Fallback response if LLM fails
                assistant_content = "Mi dispiace, si è verificato un errore nel generare la risposta. Per favore riprova tra qualche istante."
                provider = "fallback"
                model = "none"
                token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    
    # Save assistant message
    assistant_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=assistant_content,
        provider=provider,
        model=model,
        token_usage_json=token_usage,
    )
    db.add(assistant_message)
    
    conversation.updated_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(assistant_message)
    
    return assistant_message


@router.post("/generate-image")
async def generate_image(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Generate an image using DALL-E 3 or Flux"""
    prompt = request.get("prompt", "")
    provider = request.get("provider", "dall-e")  # "dall-e" or "flux-schnell"
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")
    
    try:
        image_url = await llm_service.generate_image(prompt, provider=provider)
        return {"image_url": image_url, "prompt": prompt, "provider": provider}
    except Exception as e:
        logger.error(f"Image generation error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/conversations/{conversation_id}/message-with-files")
async def send_message_with_files(
    conversation_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
    content: str = Form(""),
    files: List[UploadFile] = File(default=[]),
):
    """Send a message with file attachments to a conversation"""
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    
    if conversation.student_id != student.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Process attached files
    file_contents = []
    for file in files:
        file_data = await file.read()
        filename = file.filename or "unknown"
        mime_type = file.content_type or "application/octet-stream"
        
        # Extract text content based on file type
        extracted_text = ""
        if mime_type.startswith("text/") or filename.endswith((".txt", ".md")):
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
                vision_response = await llm_service.generate(
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Descrivi dettagliatamente questa immagine in italiano."},
                            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}}
                        ]
                    }],
                    provider="openai",
                    model="gpt-4o",
                    temperature=0.3,
                    max_tokens=1000,
                )
                extracted_text = f"[Immagine: {filename}]\n{vision_response.content}"
            except Exception as e:
                extracted_text = f"[Immagine: {filename} - impossibile analizzare: {str(e)}]"
        
        file_contents.append({
            "filename": filename,
            "mime_type": mime_type,
            "content": extracted_text[:10000]  # Limit content size
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
    user_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=content or "[Allegati caricati]",
        content_json={"files": [{"filename": fc["filename"], "mime_type": fc["mime_type"]} for fc in file_contents]},
    )
    db.add(user_message)
    await db.flush()
    
    # Get conversation history
    result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at.asc())
    )
    history = result.scalars().all()
    
    # Build messages for LLM
    messages = []
    for msg in history[:-1]:  # Exclude the message we just added
        messages.append({
            "role": msg.role.value,
            "content": msg.content or "",
        })
    # Add current message with file context
    messages.append({"role": "user", "content": full_content})
    
    # Get chatbot profile
    profile = get_profile(conversation.profile_key)
    system_prompt = profile["system_prompt"] + "\n\nQuando l'utente allega documenti, analizzali attentamente e rispondi in base al loro contenuto."
    temperature = profile.get("temperature", 0.7)
    
    # Call LLM
    try:
        llm_response = await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=conversation.llm_provider,
            model=conversation.llm_model,
            temperature=temperature,
            max_tokens=2048,
        )
        assistant_content = llm_response.content
        provider = llm_response.provider
        model = llm_response.model
        token_usage = {
            "prompt_tokens": llm_response.prompt_tokens,
            "completion_tokens": llm_response.completion_tokens,
        }
    except Exception as e:
        logger.error(f"LLM service error: {e}")
        assistant_content = "Mi dispiace, si è verificato un errore. Per favore riprova."
        provider = "fallback"
        model = "none"
        token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    
    # Save assistant message
    assistant_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.ASSISTANT,
        content=assistant_content,
        provider=provider,
        model=model,
        token_usage_json=token_usage,
    )
    db.add(assistant_message)
    
    conversation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(assistant_message)
    
    return assistant_message


async def load_teacher_context(db: AsyncSession, teacher: User) -> str:
    """
    Load teacher's database context for analytics mode.
    Returns formatted context string with all teacher's classes, sessions, students, tasks, etc.
    """
    from app.models.task import Task, TaskSubmission
    from app.models.chat import ChatMessage

    # Load all teacher's data from database for context
    context_parts = []
    
    # 1. Get all classes
    classes_result = await db.execute(
        select(Class).where(Class.teacher_id == teacher.id)
    )
    classes = classes_result.scalars().all()
    
    if classes:
        context_parts.append("## LE TUE CLASSI:")
        for cls in classes:
            context_parts.append(f"- **{cls.name}** (ID: {cls.id})")
            
            # Get sessions for this class
            sessions_result = await db.execute(
                select(Session).where(Session.class_id == cls.id)
            )
            sessions = sessions_result.scalars().all()
            
            for session in sessions:
                context_parts.append(f"  - Sessione: **{session.title}** (codice: {session.join_code}, stato: {session.status.value})")
                
                # Get students in this session
                students_result = await db.execute(
                    select(SessionStudent).where(SessionStudent.session_id == session.id)
                )
                students = students_result.scalars().all()
                
                if students:
                    student_names = [s.nickname for s in students]
                    context_parts.append(f"    - Studenti ({len(students)}): {', '.join(student_names)}")
                
                # Get tasks for this session
                tasks_result = await db.execute(
                    select(Task).where(Task.session_id == session.id)
                )
                tasks = tasks_result.scalars().all()
                
                for task in tasks:
                    context_parts.append(f"    - Compito: **{task.title}** (tipo: {task.task_type.value}, stato: {task.status.value}, punti: {task.points or 'N/A'})")
                    
                    # Get submissions for this task
                    submissions_result = await db.execute(
                        select(TaskSubmission, SessionStudent)
                        .join(SessionStudent, TaskSubmission.student_id == SessionStudent.id)
                        .where(TaskSubmission.task_id == task.id)
                    )
                    submissions = submissions_result.all()
                    
                    if submissions:
                        context_parts.append(f"      Consegne ({len(submissions)}/{len(students)}):")
                        for sub, student in submissions:
                            score_info = f"voto: {sub.score}" if sub.score else "non valutato"
                            context_parts.append(f"        - {student.nickname}: {score_info}")
                            if sub.feedback:
                                context_parts.append(f"          Feedback: {sub.feedback[:100]}...")
                    else:
                        context_parts.append(f"      Nessuna consegna ancora")
                
                # Get chat messages with sender info
                try:
                    chat_result = await db.execute(
                        select(ChatMessage, SessionStudent)
                        .outerjoin(SessionStudent, ChatMessage.sender_student_id == SessionStudent.id)
                        .where(ChatMessage.session_id == session.id)
                        .order_by(ChatMessage.created_at.desc())
                        .limit(100)
                    )
                    chat_rows = chat_result.all()
                    
                    if chat_rows:
                        context_parts.append(f"\n    ### STORICO CHAT SESSIONE ({len(chat_rows)} messaggi):")
                        for msg, student in reversed(chat_rows):
                            sender = student.nickname if student else ("Docente" if msg.sender_type.value == "TEACHER" else "Sistema")
                            timestamp = msg.created_at.strftime("%d/%m %H:%M") if msg.created_at else ""
                            text = msg.message_text[:150] if msg.message_text else ""
                            context_parts.append(f"      [{timestamp}] **{sender}**: {text}")
                except Exception as e:
                    logger.debug(f"Could not load chat messages: {e}")
    
    # Build and return the full context
    teacher_context = "\n".join(context_parts) if context_parts else "Nessun dato disponibile. Crea prima delle classi e sessioni."
    return teacher_context


@router.post("/teacher/chat")
async def teacher_chat(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Direct chat endpoint for teachers - includes real data from database"""
    content = request.get("content", "")
    history = request.get("history", [])
    profile_key = request.get("profile_key", "teacher_support")
    provider = request.get("provider")
    model = request.get("model")

    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content required")

    # Get chatbot profile
    profile = get_profile(profile_key)
    uses_agent = profile.get("uses_agent", False)

    # Build messages from history
    messages = []
    for msg in history:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })
    messages.append({"role": "user", "content": content})

    try:
        if uses_agent:
            # NEW: Route to teacher agent for intelligent content generation
            from app.services.teacher_agent import run_teacher_agent

            # Load database context (used by analytics mode)
            context = await load_teacher_context(db, teacher)

            llm_response_content = await run_teacher_agent(
                messages=messages,
                context=context,
                provider=provider or "openai",
                model=model or "gpt-5-mini",
            )

            return {
                "response": llm_response_content,
                "provider": provider or "openai",
                "model": model or "gpt-5-mini",
                "prompt_tokens": 0,  # TODO: track token usage accurately
                "completion_tokens": 0,
            }
        else:
            # EXISTING: Use context-rich analytics approach for backward compatibility
            context = await load_teacher_context(db, teacher)
            base_system_prompt = profile["system_prompt"]

            # Enhance system prompt with real data
            system_prompt = f"""{base_system_prompt}

---
## DATI REALI DEL DOCENTE (dal database):

{context}

---
## ISTRUZIONI PER LA FORMATTAZIONE:
1. Quando presenti dati sugli studenti, USA SEMPRE TABELLE MARKDOWN ben formattate
2. Includi statistiche riassuntive (es. "3 su 5 studenti hanno consegnato")
3. Usa emoji per rendere il testo più leggibile (✅ consegnato, ❌ non consegnato, ⏳ in attesa)
4. Per le valutazioni, mostra sempre:
   - Tabella con: Studente | Compiti Assegnati | Consegnati | Valutazione Media
   - Percentuale di completamento
   - Note su chi non ha consegnato
5. Quando parli di chat/interazioni, riassumi i temi principali discussi
6. Rispondi SEMPRE con dati specifici presi dal contesto sopra, MAI in modo generico

IMPORTANTE: Usa questi dati reali per rispondere alle domande del docente. Quando ti chiede informazioni su classi, studenti, compiti o valutazioni, fai riferimento ai dati sopra. Se non hai dati sufficienti, spiega cosa manca."""

            temperature = profile.get("temperature", 0.7)

            llm_response = await llm_service.generate(
                messages=messages,
                system_prompt=system_prompt,
                provider=provider,
                model=model,
                temperature=temperature,
                max_tokens=4096,
            )

            return {
                "response": llm_response.content,
                "provider": llm_response.provider,
                "model": llm_response.model,
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            }
    except Exception as e:
        logger.error(f"Teacher chat error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/teacher/chat-with-files")
async def teacher_chat_with_files(
    content: str = Form(...),
    history: str = Form("[]"),
    profile_key: str = Form("teacher_support"),
    provider: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    files: list[UploadFile] = File([]),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """Teacher chat endpoint with file upload support"""
    import json
    import base64
    
    # Parse history from JSON string
    try:
        parsed_history = json.loads(history)
    except:
        parsed_history = []
    
    # Process uploaded files
    file_contents = []
    for file in files:
        file_data = await file.read()
        file_name = file.filename or "document"
        file_type = file.content_type or "application/octet-stream"
        
        # For text files, extract content directly
        if file_type.startswith("text/") or file_name.endswith((".txt", ".md", ".csv", ".json")):
            try:
                text_content = file_data.decode("utf-8")
                file_contents.append(f"\n--- Contenuto di {file_name} ---\n{text_content}\n--- Fine {file_name} ---\n")
            except:
                file_contents.append(f"\n[File {file_name} non leggibile come testo]\n")
        elif file_type == "application/pdf" or file_name.endswith(".pdf"):
            # Try to extract PDF text
            try:
                from PyPDF2 import PdfReader
                from io import BytesIO
                reader = PdfReader(BytesIO(file_data))
                pdf_text = ""
                for page in reader.pages:
                    pdf_text += page.extract_text() or ""
                file_contents.append(f"\n--- Contenuto di {file_name} (PDF) ---\n{pdf_text}\n--- Fine {file_name} ---\n")
            except Exception as e:
                file_contents.append(f"\n[Errore lettura PDF {file_name}: {str(e)}]\n")
        elif file_type.startswith("image/"):
            # For images, encode as base64 for vision models
            b64_image = base64.b64encode(file_data).decode("utf-8")
            file_contents.append(f"\n[Immagine allegata: {file_name}]\n")
        else:
            file_contents.append(f"\n[File allegato: {file_name} ({file_type})]\n")
    
    # Combine content with file contents
    full_content = content
    if file_contents:
        full_content += "\n\nDocumenti allegati:" + "".join(file_contents)
    
    # Get chatbot profile
    profile = get_profile(profile_key)
    base_system_prompt = profile["system_prompt"]
    
    # Build messages
    messages = []
    for msg in parsed_history:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })
    messages.append({"role": "user", "content": full_content})
    
    temperature = profile.get("temperature", 0.7)
    
    try:
        llm_response = await llm_service.generate(
            messages=messages,
            system_prompt=base_system_prompt,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=4096,
        )
        
        return {
            "response": llm_response.content,
            "provider": llm_response.provider,
            "model": llm_response.model,
            "prompt_tokens": llm_response.prompt_tokens,
            "completion_tokens": llm_response.completion_tokens,
        }
    except Exception as e:
        logger.error(f"Teacher chat with files error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/explain", response_model=ExplainResponse)
async def explain_message(
    request: ExplainRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(
        select(ConversationMessage).where(ConversationMessage.id == request.message_id)
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    
    # Verify access via conversation
    result = await db.execute(
        select(Conversation).where(Conversation.id == message.conversation_id)
    )
    conversation = result.scalar_one_or_none()
    
    if auth.is_student:
        if conversation.student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # TODO: Generate explanation using LLM
    explanation = f"[Explanation placeholder for message: {message.content[:100] if message.content else 'N/A'}...]"
    
    return ExplainResponse(
        message_id=request.message_id,
        explanation=explanation,
        level="GENERIC",
        created_at=datetime.utcnow(),
    )
