from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form, Request
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, Optional, List
from datetime import datetime
from uuid import UUID
import logging
import base64
import hashlib
import io
import json
import asyncio
import aiofiles
import httpx
import uuid
import re
from pathlib import Path

from app.core.config import settings
from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.llm import LLMProfile, Conversation, ConversationMessage, AuditEvent
from app.models.credits import CreditTransaction
from app.models.enums import MessageRole, CreditTransactionType
from app.schemas.llm import (
    LLMProfileResponse, ConversationCreate, ConversationResponse,
    MessageCreate, ConversationMessageResponse, ExplainRequest, ExplainResponse,
)
from app.services.llm_service import DEFAULT_OPENAI_CHAT_MODEL, llm_service, normalize_llm_model
from app.services.credit_service import credit_service
from app.services.chatbot_profiles import get_profile, get_all_profiles, CHATBOT_PROFILES
from app.services.education_level import get_school_grade_instruction
from app.services.document_processor import document_processor
from app.services.moderation_service import moderation_service
from app.services.environmental_impact import (
    build_estimated_token_usage,
    enrich_usage_with_environmental_impact,
)
from app.services.ui_language import apply_output_language_instruction, resolve_ui_language
from app.models.alert import ContentAlert
from app.realtime.gateway import notify_teacher_content_alert, sio

logger = logging.getLogger(__name__)

router = APIRouter()


def _extract_json_object(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").strip()
        if text.endswith("```"):
            text = text[:-3].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def _bounded_number(value, default: float, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _parse_submission_score(value) -> tuple[Optional[float], bool]:
    """Return a numeric score and whether it represents a fraction/percentage.

    Quiz submissions store results such as ``5/8`` while manually assigned
    grades are plain numbers.  Teacher context generation must support both
    formats without allowing one malformed historical value to abort a chat.
    """
    if value is None:
        return None, False

    text = str(value).strip().replace(",", ".")
    if not text:
        return None, False

    try:
        if text.endswith("%"):
            return float(text[:-1].strip()), True
        if "/" in text:
            numerator_text, denominator_text = (part.strip() for part in text.split("/", 1))
            numerator = float(numerator_text)
            denominator = float(denominator_text)
            if denominator == 0:
                return None, True
            return numerator / denominator * 100, True
        return float(text), False
    except (TypeError, ValueError):
        return None, False


def _sanitize_slide_agent_payload(payload: dict, dims: dict) -> dict:
    width = float(dims.get("width") or 960)
    height = float(dims.get("height") or 540)
    allowed_types = {"text", "image", "rectangle", "ellipse", "line"}
    allowed_align = {"left", "center", "right", "justify"}

    title = str(payload.get("title") or "Presentazione").strip()[:120]
    slides = payload.get("slides") if isinstance(payload.get("slides"), list) else []
    clean_slides = []

    for slide_index, slide in enumerate(slides[:18]):
        if not isinstance(slide, dict):
            continue
        blocks = slide.get("blocks") if isinstance(slide.get("blocks"), list) else []
        clean_blocks = []

        for layer, block in enumerate(blocks[:28]):
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type") or "").strip()
            if block_type not in allowed_types:
                continue

            block_width = _bounded_number(block.get("width"), 220, 1 if block_type == "line" else 24, width)
            block_height = _bounded_number(block.get("height"), 80, 0 if block_type == "line" else 24, height)
            x = _bounded_number(block.get("x"), 80, -width * 0.2, width - min(block_width, width * 0.05))
            y = _bounded_number(block.get("y"), 80, -height * 0.2, height - min(block_height, height * 0.05))
            style = block.get("style") if isinstance(block.get("style"), dict) else {}
            clean_style = {}

            if block_type == "text":
                text = str(block.get("content") or "").strip()
                if not text:
                    continue
                align = style.get("textAlign")
                if not isinstance(align, str) or align not in allowed_align:
                    align = "left"
                clean_style = {
                    "fontFamily": str(style.get("fontFamily") or "Inter, Arial, sans-serif")[:80],
                    "fontSize": int(_bounded_number(style.get("fontSize"), 22, 10, 72)),
                    "color": str(style.get("color") or "#111827")[:32],
                    "backgroundColor": str(style.get("backgroundColor") or "transparent")[:32],
                    "fontWeight": str(style.get("fontWeight") or "normal")[:24],
                    "textAlign": str(align),
                    "lineHeight": _bounded_number(style.get("lineHeight"), 1.25, 0.9, 2.0),
                    "padding": int(_bounded_number(style.get("padding"), 0, 0, 40)),
                    "borderRadius": int(_bounded_number(style.get("borderRadius"), 0, 0, 48)),
                }
                content = text[:900]
            elif block_type == "image":
                content = str(block.get("content") or "").strip()
                if not (content.startswith("http://") or content.startswith("https://") or content.startswith("/") or content.startswith("data:image/")):
                    content = "https://placehold.co/640x360?text=Visual"
                clean_style = {
                    "borderRadius": int(_bounded_number(style.get("borderRadius"), 12, 0, 48)),
                    "padding": int(_bounded_number(style.get("padding"), 0, 0, 40)),
                    "backgroundColor": str(style.get("backgroundColor") or "transparent")[:32],
                }
            else:
                content = ""
                clean_style = {
                    "fill": str(style.get("fill") or ("transparent" if block_type == "line" else "#f8fafc"))[:32],
                    "stroke": str(style.get("stroke") or "#0f172a")[:32],
                    "strokeWidth": int(_bounded_number(style.get("strokeWidth"), 1, 0, 16)),
                }
                if block_type == "rectangle":
                    clean_style["cornerRadius"] = int(_bounded_number(style.get("cornerRadius"), 12, 0, 64))

            clean_blocks.append({
                "id": str(uuid.uuid4()),
                "type": block_type,
                "content": content,
                "x": x,
                "y": y,
                "width": block_width,
                "height": block_height,
                "rotation": _bounded_number(block.get("rotation"), 0, -360, 360),
                "zIndex": int(block.get("zIndex") if isinstance(block.get("zIndex"), int) else layer),
                "style": clean_style,
            })

        if clean_blocks:
            clean_slides.append({
                "id": str(uuid.uuid4()),
                "title": str(slide.get("title") or f"Slide {slide_index + 1}").strip()[:120],
                "blocks": clean_blocks,
                "speakerNotes": str(slide.get("speakerNotes") or slide.get("notes") or "").strip()[:1200],
            })

    if not clean_slides:
        raise ValueError("Presentation agent returned no renderable slides")

    return {
        "title": title,
        "format": str(payload.get("format") or "16:9"),
        "slides": clean_slides,
        "agent_steps": payload.get("agent_steps") if isinstance(payload.get("agent_steps"), list) else [],
    }


def _fallback_presentation_strategy(prompt: str) -> dict:
    cleaned_title = re.sub(
        r"^(crea|creami|genera|generami|prepara|preparami|realizza|fammi)\s+(una\s+)?(presentazione|slide)\s+(sulla|sulle|sugli|sullo|sul|su|riguardo|about)?\s*",
        "",
        prompt.strip(),
        flags=re.IGNORECASE,
    ).strip(" .:;-")
    title = (cleaned_title or prompt.strip() or "Presentazione")[:100]
    return {
        "title": title,
        "audience": "Studenti",
        "core_message": f"Comprendere i concetti essenziali di {title}",
        "narrative_arc": "Contesto, concetti chiave, approfondimento, applicazioni e sintesi.",
        "slides": [
            {"title": title, "role": "cover", "purpose": "Introdurre il tema", "key_points": [title], "visual_idea": "Copertina essenziale", "speaker_notes": "Presentare obiettivi e percorso."},
            {"title": "Contesto", "role": "concept", "purpose": "Inquadrare l'argomento", "key_points": [f"Che cos'è {title}", "Perché è importante", "Concetti di partenza"], "visual_idea": "Schema introduttivo", "speaker_notes": "Collegare il tema alle conoscenze pregresse."},
            {"title": "Concetti chiave", "role": "evidence", "purpose": "Evidenziare gli elementi fondamentali", "key_points": ["Idea fondamentale", "Elementi principali", "Relazioni da ricordare"], "visual_idea": "Tre card concettuali", "speaker_notes": "Approfondire con esempi pertinenti al tema."},
            {"title": "Esempi e applicazioni", "role": "process", "purpose": "Rendere concreto il contenuto", "key_points": ["Esempio guidato", "Applicazione pratica", "Domanda per la classe"], "visual_idea": "Percorso in tre passaggi", "speaker_notes": "Coinvolgere gli studenti con una breve attività."},
            {"title": "In sintesi", "role": "summary", "purpose": "Consolidare l'apprendimento", "key_points": ["Concetto centrale", "Collegamento principale", "Spunto di approfondimento"], "visual_idea": "Mappa riepilogativa", "speaker_notes": "Riprendere gli obiettivi iniziali."},
        ],
    }


def _fallback_presentation_style() -> dict:
    return {
        "palette": {"background": "#F8FAFC", "surface": "#FFFFFF", "primary": "#4F46E5", "accent": "#06B6D4", "text": "#0F172A"},
        "typography": {"heading": "Inter", "body": "Inter", "title_size": 34, "body_size": 20},
        "layout": "Titolo forte, griglia ariosa, massimo tre nuclei informativi per slide",
        "components": ["accent_bar", "content_cards", "summary_panel"],
    }


def _fallback_presentation_payload(strategy: dict, fmt: str, width: int, height: int) -> dict:
    title = str(strategy.get("title") or "Presentazione")[:100]
    source_slides = strategy.get("slides") if isinstance(strategy.get("slides"), list) else []
    palette = {
        "ink": "#111827",
        "muted": "#475569",
        "paper": "#F4F7FB",
        "white": "#FFFFFF",
        "indigo": "#4F46E5",
        "violet": "#8B5CF6",
        "cyan": "#06B6D4",
        "emerald": "#10B981",
        "amber": "#F59E0B",
        "coral": "#F97316",
        "line": "#DCE4F0",
    }

    def rectangle(x, y, block_width, block_height, fill, radius=0, stroke=None, stroke_width=0):
        return {
            "type": "rectangle", "content": "", "x": x, "y": y, "width": block_width, "height": block_height,
            "style": {"fill": fill, "stroke": stroke or fill, "strokeWidth": stroke_width, "cornerRadius": radius},
        }

    def ellipse(x, y, block_width, block_height, fill):
        return {
            "type": "ellipse", "content": "", "x": x, "y": y, "width": block_width, "height": block_height,
            "style": {"fill": fill, "stroke": fill, "strokeWidth": 0},
        }

    def text_block(content, x, y, block_width, block_height, size=20, color=None, weight="400", align="left", background="transparent", radius=0, padding=0, line_height=1.22):
        return {
            "type": "text", "content": str(content)[:900], "x": x, "y": y, "width": block_width, "height": block_height,
            "style": {
                "fontFamily": "Inter", "fontSize": size, "color": color or palette["ink"], "fontWeight": weight,
                "textAlign": align, "backgroundColor": background, "borderRadius": radius, "padding": padding,
                "lineHeight": line_height,
            },
        }

    slides = []
    for index, source in enumerate(source_slides[:12]):
        source = source if isinstance(source, dict) else {}
        slide_title = str(source.get("title") or f"Slide {index + 1}")[:100]
        points = source.get("key_points") if isinstance(source.get("key_points"), list) else []
        points = [str(point)[:150] for point in points[:4] if str(point).strip()]
        if not points:
            points = [str(source.get("purpose") or "Concetto essenziale")[:150]]
        role = str(source.get("role") or "concept")
        is_cover = index == 0 or role == "cover"

        if is_cover:
            topic_labels = [
                str(item.get("title") or "")[:35]
                for item in source_slides[1:4]
                if isinstance(item, dict) and item.get("title")
            ] or ["Contesto", "Concetti chiave", "Sintesi"]
            blocks = [
                rectangle(0, 0, width, height, palette["ink"]),
                ellipse(width - 210, -80, 300, 300, "#312E81"),
                ellipse(width - 110, height - 105, 180, 180, "#164E63"),
                rectangle(62, 58, 150, 34, palette["cyan"], 17),
                text_block("PERCORSO DIDATTICO", 74, 65, 130, 22, 12, palette["ink"], "700", "center"),
                text_block(slide_title, 62, 126, width - 180, 150, 46, palette["white"], "800", line_height=1.05),
                text_block(strategy.get("core_message") or source.get("purpose") or "Una presentazione chiara, visuale e pronta da personalizzare.", 66, 300, width - 260, 82, 21, "#CBD5E1", "400", line_height=1.3),
            ]
            label_width = min(210, (width - 156) / max(1, len(topic_labels)))
            for label_index, label in enumerate(topic_labels[:3]):
                label_x = 62 + label_index * (label_width + 16)
                blocks.extend([
                    rectangle(label_x, height - 104, label_width, 48, "#1E293B", 14, "#334155", 1),
                    text_block(f"0{label_index + 1}  {label}", label_x + 14, height - 91, label_width - 28, 24, 13, palette["white"], "600"),
                ])
        elif role in {"process", "timeline"}:
            blocks = [
                rectangle(0, 0, width, height, palette["paper"]),
                text_block("PROCESSO", 62, 40, 150, 24, 12, palette["indigo"], "800"),
                text_block(slide_title, 62, 72, width - 124, 76, 32, palette["ink"], "800"),
                rectangle(105, 270, width - 210, 5, palette["line"], 3),
            ]
            step_colors = [palette["indigo"], palette["cyan"], palette["coral"], palette["emerald"]]
            step_width = (width - 140) / max(1, len(points))
            for point_index, point in enumerate(points):
                center_x = 70 + step_width * point_index + step_width / 2
                blocks.extend([
                    ellipse(center_x - 24, 248, 48, 48, step_colors[point_index % len(step_colors)]),
                    text_block(str(point_index + 1), center_x - 12, 258, 24, 24, 15, palette["white"], "800", "center"),
                    text_block(point, 70 + step_width * point_index, 320, step_width - 18, 105, 17, palette["ink"], "600", "center", palette["white"], 16, 14, 1.25),
                ])
        elif role == "summary" or index == len(source_slides[:12]) - 1:
            blocks = [
                rectangle(0, 0, width, height, "#0F172A"),
                rectangle(0, 0, width, 12, palette["cyan"]),
                text_block("DA RICORDARE", 62, 48, 180, 24, 12, palette["cyan"], "800"),
                text_block(slide_title, 62, 82, width - 124, 72, 34, palette["white"], "800"),
            ]
            card_width = (width - 156) / min(3, max(1, len(points)))
            summary_colors = ["#312E81", "#164E63", "#7C2D12"]
            for point_index, point in enumerate(points[:3]):
                card_x = 62 + point_index * (card_width + 16)
                blocks.extend([
                    rectangle(card_x, 190, card_width, 245, summary_colors[point_index % len(summary_colors)], 20),
                    text_block(f"0{point_index + 1}", card_x + 20, 215, 54, 34, 15, palette["cyan"], "800"),
                    text_block(point, card_x + 20, 275, card_width - 40, 125, 19, palette["white"], "600", line_height=1.3),
                ])
        else:
            accent_colors = [palette["indigo"], palette["cyan"], palette["coral"], palette["emerald"]]
            tint_colors = ["#EEF2FF", "#ECFEFF", "#FFF7ED", "#ECFDF5"]
            blocks = [
                rectangle(0, 0, width, height, palette["paper"]),
                rectangle(0, 0, 235, height, palette["ink"]),
                text_block(f"{index + 1:02d}", 46, 42, 80, 52, 28, palette["cyan"], "800"),
                text_block(slide_title, 42, 125, 155, 170, 28, palette["white"], "800", line_height=1.12),
                text_block(source.get("purpose") or "Esploriamo i punti fondamentali", 44, 350, 150, 92, 15, "#94A3B8", "400", line_height=1.3),
            ]
            card_x = 270
            card_width = width - card_x - 52
            card_height = min(88, (height - 112) / max(1, len(points)) - 12)
            for point_index, point in enumerate(points):
                card_y = 52 + point_index * (card_height + 14)
                blocks.extend([
                    rectangle(card_x, card_y, card_width, card_height, tint_colors[point_index % len(tint_colors)], 18),
                    rectangle(card_x, card_y, 8, card_height, accent_colors[point_index % len(accent_colors)], 4),
                    text_block(f"0{point_index + 1}", card_x + 26, card_y + 18, 42, 26, 13, accent_colors[point_index % len(accent_colors)], "800"),
                    text_block(point, card_x + 82, card_y + 15, card_width - 108, card_height - 24, 18, palette["ink"], "600", line_height=1.22),
                ])
        slides.append({"title": slide_title, "speakerNotes": str(source.get("speaker_notes") or "")[:1000], "blocks": blocks})
    return {"title": title, "format": fmt, "slides": slides}


def get_ui_language(request: Optional[Request]) -> str:
    if request is None:
        return "it"
    return resolve_ui_language(
        request.headers.get("x-app-language") or request.headers.get("accept-language")
    )


async def _build_teacher_url_context(content: str) -> str:
    """Extract readable page text from URLs pasted into teacher chat messages."""
    try:
        from app.services.web_search_service import web_search_service
        return await web_search_service.build_url_context(content or "")
    except Exception as e:
        logger.warning("Teacher URL context build failed: %s", e)
        return ""


async def _augment_teacher_messages_with_url_context(messages: list[dict]) -> list[dict]:
    """Append URL context from recent teacher messages, preserving stored history."""
    if not messages:
        return messages

    last_user_index = None
    recent_user_texts: list[str] = []
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") != "user":
            continue
        content = messages[index].get("content") or ""
        if isinstance(content, str):
            recent_user_texts.append(content)
        if last_user_index is None:
            last_user_index = index
        if len(recent_user_texts) >= 8:
            break
    if last_user_index is None:
        return messages

    source_text = "\n\n".join(reversed(recent_user_texts))
    url_context = await _build_teacher_url_context(source_text)
    if not url_context:
        return messages

    augmented = [dict(message) for message in messages]
    content = augmented[last_user_index].get("content") or ""
    augmented[last_user_index]["content"] = (
        f"{content}\n\n--- CONTESTO ESTRATTO DAI LINK INCOLLATI ---\n"
        f"{url_context}\n"
        f"--- FINE CONTESTO LINK ---"
    )
    return augmented


async def safe_track_usage(
    db: AsyncSession,
    tenant_id,
    provider,
    model,
    cost,
    metadata,
    teacher_id=None,
    class_id=None,
    session_id=None,
    student_id=None,
    context: str = "",
):
    try:
        await credit_service.track_usage(
            db, tenant_id, provider, model, cost,
            metadata,
            teacher_id, class_id, session_id, student_id
        )
    except Exception:
        logger.exception(
            "Credit tracking failed%s tenant=%s provider=%s model=%s session=%s student=%s",
            f" ({context})" if context else "",
            tenant_id,
            provider,
            model,
            session_id,
            student_id,
        )


@router.get("/chatbot-profiles")
async def list_chatbot_profiles():
    """Get all available chatbot profiles with their configurations"""
    return get_all_profiles()


# Voices supported by gpt-realtime; marin/cedar are the most natural/expressive.
REALTIME_VOICES = {"alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"}


class RealtimeInterrogationRequest(BaseModel):
    topic: Optional[str] = None
    language: str = "it"
    voice: Optional[str] = None
    style: str = "warm"   # warm | natural | strict
    pace: str = "normal"  # slow | normal | fast


def _build_delivery_directive(style: str, pace: str, is_english: bool) -> str:
    """A strong instruction block steering the voice's warmth, expressivity and tempo."""
    if is_english:
        style_map = {
            "warm": (
                "Perform as a real, human teacher who is genuinely fond of the student and excited about the subject. "
                "Your voice is warm, bright and smiling. Be vocally expressive like a real person: change pitch a lot, "
                "speed up when you get excited, slow down to emphasise, add natural micro-pauses, and let small reactions "
                "slip out ('Ah, nice!', 'Mmh, let's see…', 'Exactly!', 'Good one.'). Sound like someone who truly cares, "
                "never like a synthesiser reading text."
            ),
            "natural": "Speak in a natural, conversational and friendly tone, with normal human expressiveness and the odd small reaction.",
            "strict": "Speak with a composed, authoritative and serious tone, like a demanding but fair examiner — still human, never robotic.",
        }
        pace_map = {
            "slow": "Keep a calm, well-articulated pace.",
            "normal": "Keep a natural, conversational pace.",
            "fast": "Keep a brisk, dynamic and energetic pace.",
        }
        anti_flat = "ABSOLUTELY never sound flat, cold, monotone, bored or robotic. If in doubt, add more warmth and intonation."
    else:
        style_map = {
            "warm": (
                "Interpreta un professore vero, umano, a cui lo studente sta davvero a cuore e appassionato della materia. "
                "La tua voce è calda, luminosa e sorridente. Sii espressivo come una persona reale: cambia molto l'intonazione, "
                "accelera quando ti emozioni, rallenta per enfatizzare, usa micro-pause naturali e lascia uscire piccole reazioni "
                "('Ah, bene!', 'Mmh, vediamo…', 'Esatto!', 'Bella questa.'). Suona come qualcuno a cui importa davvero, "
                "mai come un sintetizzatore che legge un testo."
            ),
            "natural": "Parla con un tono naturale, colloquiale e cordiale, con la normale espressività umana e qualche piccola reazione spontanea.",
            "strict": "Parla con un tono fermo, autorevole e serio, come un esaminatore esigente ma giusto — sempre umano, mai robotico.",
        }
        pace_map = {
            "slow": "Mantieni un ritmo calmo e ben scandito.",
            "normal": "Mantieni un ritmo naturale e colloquiale.",
            "fast": "Mantieni un ritmo sostenuto, dinamico ed energico.",
        }
        anti_flat = "Non risultare ASSOLUTAMENTE MAI piatto, freddo, monotono, annoiato o robotico. Nel dubbio, aggiungi più calore e intonazione."

    header = "\n\nVOICE DELIVERY:\n" if is_english else "\n\nRESA VOCALE:\n"
    return (
        f"{header}- {style_map.get(style, style_map['warm'])}\n"
        f"- {pace_map.get(pace, pace_map['normal'])}\n"
        f"- {anti_flat}"
    )


def _voice_mode_wrapper(
    base_prompt: str,
    language: str,
    style: str = "warm",
    pace: str = "normal",
    topic: Optional[str] = None,
    exam_mode: bool = True,
) -> str:
    """Wrap a base system prompt with spoken-conversation guidance + voice delivery directives.

    Shared by the oral-exam ("interrogazione") session and teacherbot live-voice sessions.
    When ``exam_mode`` is True the wrapper adds the structured oral-exam follow-up routine and
    the topic-driven opening; otherwise it keeps the bot's own persona and opens with a greeting.
    """
    is_english = (language or "it").lower().startswith("en")
    topic = (topic or "").strip()

    if is_english:
        voice_guidance = (
            "\n\nVOICE MODE (spoken conversation):\n"
            "- You are speaking out loud with the student in real time. Keep a natural, conversational tone.\n"
            "- Do NOT use markdown, headings, asterisks, emoji or any formatting symbols: everything you say is read aloud.\n"
            "- Keep your turns short (1–3 sentences) so the conversation stays lively.\n"
            "- Speak in English.\n"
        )
        if exam_mode:
            voice_guidance += (
                "- Ask one question at a time and wait for the student's spoken answer before continuing.\n"
                "\nAFTER EVERY STUDENT ANSWER, stay concise and terse (no preambles, short sentences) and always:\n"
                "1. React briefly to the answer (correct / partial / to review).\n"
                "2. Add ONE concrete cue to go deeper into the topic (a fact, link or example to explore).\n"
                "3. Name ONE specific skill or competence the student should strengthen.\n"
                "4. Encourage them with one short sentence to do better.\n"
                "5. Then ask the next, slightly more demanding question.\n"
                "Keep all of this within 2–3 short sentences total: warmth in the voice, dryness in the words."
            )
            topic_line = (
                f"\n\nThe student has chosen this exam topic: \"{topic}\". Open with a short greeting and your first question on it."
                if topic
                else "\n\nStart by warmly greeting the student and asking which topic they want to be examined on."
            )
        else:
            topic_line = "\n\nStart by warmly greeting the student out loud and inviting them to ask their first question or say what they need help with."
    else:
        voice_guidance = (
            "\n\nMODALITÀ VOCALE (conversazione parlata):\n"
            "- Stai parlando a voce con lo studente in tempo reale. Usa un tono naturale e colloquiale.\n"
            "- NON usare markdown, titoli, asterischi, emoji o simboli di formattazione: tutto ciò che dici viene letto ad alta voce.\n"
            "- Mantieni interventi brevi (1–3 frasi) per una conversazione viva e dinamica.\n"
            "- Parla in italiano.\n"
        )
        if exam_mode:
            voice_guidance += (
                "- Fai una domanda alla volta e aspetta la risposta parlata dello studente prima di proseguire.\n"
                "\nDOPO OGNI RISPOSTA DELLO STUDENTE, resta asciutto e conciso (niente preamboli, frasi brevi) e sempre:\n"
                "1. Reagisci brevemente alla risposta (corretto / parziale / da rivedere).\n"
                "2. Aggiungi UNO spunto concreto per approfondire l'argomento (un fatto, un collegamento o un esempio da esplorare).\n"
                "3. Indica UNA competenza o abilità specifica che lo studente deve sviluppare meglio.\n"
                "4. Incoraggialo con una frase breve a fare meglio.\n"
                "5. Poi poni la domanda successiva, un po' più impegnativa.\n"
                "Tieni tutto entro 2–3 frasi brevi in totale: calore nella voce, asciuttezza nelle parole."
            )
            topic_line = (
                f"\n\nLo studente ha scelto questo argomento d'esame: \"{topic}\". Inizia con un breve saluto e la prima domanda su questo argomento."
                if topic
                else "\n\nInizia salutando con cortesia lo studente e chiedendogli su quale argomento desidera essere interrogato."
            )
        else:
            topic_line = "\n\nInizia salutando a voce lo studente e invitandolo a fare la prima domanda o a dirti di cosa ha bisogno."

    delivery = _build_delivery_directive(style, pace, is_english)
    return f"{base_prompt}{voice_guidance}{delivery}{topic_line}"


def _build_interrogation_instructions(topic: Optional[str], language: str, style: str = "warm", pace: str = "normal") -> str:
    """Compose the oral-exam ("interrogazione") system prompt for the realtime voice session."""
    base = get_profile("oral_exam").get("system_prompt", "")
    return _voice_mode_wrapper(base, language, style, pace, topic=topic, exam_mode=True)


@router.post("/realtime/interrogation-session")
async def create_realtime_interrogation_session(
    request: RealtimeInterrogationRequest,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """
    Mint a short-lived ephemeral client secret for an OpenAI Realtime voice
    interrogation ("interrogazione"). The browser uses this secret to open a
    WebRTC connection directly to OpenAI; the real API key never leaves the server.
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="L'interrogazione vocale non è configurata",
        )

    instructions = _build_interrogation_instructions(
        request.topic, request.language, request.style, request.pace
    )
    actor_id = str(auth.teacher.id if auth.is_teacher else auth.student.id)
    return await _mint_realtime_voice_secret(instructions, request.voice, actor_id)


async def _mint_realtime_voice_secret(instructions: str, voice_pref: Optional[str], actor_id: str) -> dict:
    """POST to OpenAI for a short-lived realtime client secret. Shared by all voice sessions."""
    voice = voice_pref if voice_pref in REALTIME_VOICES else settings.OPENAI_REALTIME_VOICE
    safety_identifier = hashlib.sha256(actor_id.encode("utf-8")).hexdigest()

    payload = {
        "session": {
            "type": "realtime",
            "model": settings.OPENAI_REALTIME_MODEL,
            "instructions": instructions,
            "audio": {
                "input": {
                    "transcription": {"model": settings.OPENAI_REALTIME_TRANSCRIBE_MODEL},
                    # Push-to-talk: the client controls turns explicitly (commit on
                    # mic release), so automatic server-side VAD is disabled.
                    "turn_detection": None,
                },
                "output": {"voice": voice},
            },
        }
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                    "OpenAI-Safety-Identifier": safety_identifier,
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.error("Realtime client_secrets request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Impossibile avviare l'interazione vocale",
        )

    if resp.status_code >= 400:
        logger.error("Realtime client_secrets error %s: %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Impossibile avviare l'interazione vocale",
        )

    data = resp.json()
    # The GA response shape is { "value": "ek_...", "expires_at": ..., "session": {...} }
    value = data.get("value") or (data.get("client_secret") or {}).get("value")
    if not value:
        logger.error("Realtime client_secrets returned no token: %s", data)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Impossibile avviare l'interazione vocale",
        )

    return {
        "value": value,
        "model": settings.OPENAI_REALTIME_MODEL,
        "expires_at": data.get("expires_at"),
    }


class RealtimeTeacherbotSessionRequest(BaseModel):
    teacherbot_id: UUID
    language: str = "it"
    voice: Optional[str] = None
    style: str = "warm"
    pace: str = "normal"


async def _load_voice_teacherbot(db: AsyncSession, auth: StudentOrTeacher, teacherbot_id: UUID):
    """Load a teacherbot the actor may talk to, enforcing ownership (teacher) or publication (student)."""
    from app.models.teacherbot import Teacherbot, TeacherbotPublication, TeacherbotStatus

    if auth.is_teacher:
        result = await db.execute(
            select(Teacherbot)
            .where(Teacherbot.id == teacherbot_id)
            .where(Teacherbot.teacher_id == auth.teacher.id)
        )
        bot = result.scalar_one_or_none()
        if not bot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistente non trovato")
        return bot

    student = auth.student
    session_result = await db.execute(select(Session).where(Session.id == student.session_id))
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessione non trovata")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistente non disponibile")
    return bot


@router.post("/realtime/teacherbot-session")
async def create_realtime_teacherbot_session(
    request: RealtimeTeacherbotSessionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """
    Mint a short-lived ephemeral client secret for a live voice chat with a teacherbot.
    The voice persona is driven by the bot's own system prompt (no RAG during the call).
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="L'interazione vocale non è configurata",
        )

    bot = await _load_voice_teacherbot(db, auth, request.teacherbot_id)
    if not bot.enable_live_voice:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La voce live non è abilitata per questo assistente",
        )

    instructions = _voice_mode_wrapper(
        bot.system_prompt or "", request.language, request.style, request.pace, exam_mode=False
    )
    actor_id = str(auth.teacher.id if auth.is_teacher else auth.student.id)
    return await _mint_realtime_voice_secret(instructions, request.voice, actor_id)


@router.get("/environmental-footprint")
async def get_environmental_footprint(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    query = select(CreditTransaction).where(CreditTransaction.transaction_type == CreditTransactionType.API_CALL)
    actor_type = "teacher" if auth.is_teacher else "student"
    if auth.is_teacher:
        query = query.where(CreditTransaction.teacher_id == auth.teacher.id)
    else:
        query = query.where(CreditTransaction.student_id == auth.student.id)

    result = await db.execute(query.order_by(CreditTransaction.timestamp.asc()))
    transactions = result.scalars().all()

    totals = {
        "energy_wh": 0.0,
        "co2_grams": 0.0,
        "water_ml": 0.0,
        "water_drops": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "image_count": 0,
        "interaction_count": len(transactions),
        "estimated_entry_count": 0,
    }

    for tx in transactions:
        usage = dict(tx.usage_details or {})
        enriched = enrich_usage_with_environmental_impact(usage, provider=tx.provider, model=tx.model)
        impact = enriched.get("environmental_impact") or {}
        totals["energy_wh"] += float(impact.get("energy_wh") or 0)
        totals["co2_grams"] += float(impact.get("co2_grams") or 0)
        totals["water_ml"] += float(impact.get("water_ml") or 0)
        totals["water_drops"] += int(impact.get("water_drops") or 0)
        totals["prompt_tokens"] += int(enriched.get("prompt_tokens") or 0)
        totals["completion_tokens"] += int(enriched.get("completion_tokens") or 0)
        totals["total_tokens"] += int(enriched.get("total_tokens") or 0)
        totals["image_count"] += int(enriched.get("image_count") or 0)
        if enriched.get("estimated_tokens"):
            totals["estimated_entry_count"] += 1

    return {
        "actor_type": actor_type,
        "totals": {
            **totals,
            "energy_wh": round(totals["energy_wh"], 4),
            "co2_grams": round(totals["co2_grams"], 4),
            "water_ml": round(totals["water_ml"], 4),
        },
    }


@router.post("/files/preview")
async def preview_file(
    file: UploadFile = File(...),
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)] = None,
):
    """
    Quick file preview — no LLM calls, just metadata extraction.
    Used by the frontend to show rich attachment cards before sending.
    Returns: { filename, type, sheets, rows, columns, column_types, stats, sample, suggested_prompts }
    """
    try:
        file_bytes = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot read file")

    filename = file.filename or "file"
    mime_type = file.content_type or "application/octet-stream"
    fn_lower = filename.lower()

    base = {"filename": filename, "mime_type": mime_type, "size_bytes": len(file_bytes)}

    # ── Data file: XLSX / XLS ────────────────────────────────────────────────
    if fn_lower.endswith((".xlsx", ".xls")) or "spreadsheet" in mime_type or "excel" in mime_type:
        try:
            import pandas as pd
            import io as _io
            xl = pd.ExcelFile(_io.BytesIO(file_bytes))
            sheets_info = []
            for sheet_name in xl.sheet_names[:6]:
                df = xl.parse(sheet_name)
                rows, cols = df.shape
                col_names = [str(c) for c in df.columns.tolist()]
                col_types = {}
                for c in df.columns:
                    dtype = df[c].dtype
                    if str(dtype).startswith("int") or str(dtype).startswith("float"):
                        col_types[str(c)] = "number"
                    elif "datetime" in str(dtype):
                        col_types[str(c)] = "date"
                    else:
                        col_types[str(c)] = "text"
                stats = {}
                for c in df.select_dtypes(include="number").columns[:8]:
                    s = df[c].dropna()
                    if len(s):
                        stats[str(c)] = {
                            "min": float(s.min()), "max": float(s.max()),
                            "mean": round(float(s.mean()), 3),
                            "nulls": int(df[c].isna().sum()),
                        }
                sample = df.head(5).fillna("").astype(str).values.tolist()
                sheets_info.append({
                    "name": sheet_name, "rows": rows, "columns": col_names,
                    "column_types": col_types, "stats": stats, "sample": sample
                })
            suggested = [
                "Analizza questi dati e fornisci un riassunto",
                "Identifica eventuali valori anomali o outlier",
                "Calcola le statistiche principali per ogni colonna numerica",
                "Quali sono le tendenze principali in questo dataset?",
            ]
            return {**base, "type": "xlsx", "sheets": sheets_info,
                    "active_sheet": sheets_info[0] if sheets_info else None,
                    "suggested_prompts": suggested}
        except Exception as e:
            logger.warning(f"XLSX preview failed: {e}")
            return {**base, "type": "xlsx", "error": str(e)}

    # ── Data file: CSV ───────────────────────────────────────────────────────
    if fn_lower.endswith(".csv") or "csv" in mime_type:
        try:
            import pandas as pd
            import io as _io
            for enc in ("utf-8", "latin-1", "cp1252"):
                try:
                    df = pd.read_csv(_io.BytesIO(file_bytes), encoding=enc, nrows=500)
                    break
                except Exception:
                    continue
            else:
                return {**base, "type": "csv"}
            rows = len(df)
            col_names = [str(c) for c in df.columns.tolist()]
            col_types = {}
            for c in df.columns:
                dtype = df[c].dtype
                col_types[str(c)] = "number" if str(dtype).startswith(("int", "float")) else "text"
            stats = {}
            for c in df.select_dtypes(include="number").columns[:8]:
                s = df[c].dropna()
                if len(s):
                    stats[str(c)] = {"min": float(s.min()), "max": float(s.max()), "mean": round(float(s.mean()), 3)}
            sample = df.head(5).fillna("").astype(str).values.tolist()
            suggested = [
                "Analizza questo CSV e fornisci un riassunto dei dati",
                "Identifica correlazioni tra le colonne",
                "Trova i valori più frequenti per ogni categoria",
            ]
            return {**base, "type": "csv", "rows": rows, "columns": col_names,
                    "column_types": col_types, "stats": stats, "sample": sample,
                    "suggested_prompts": suggested}
        except Exception as e:
            return {**base, "type": "csv", "error": str(e)}

    # ── JSON ─────────────────────────────────────────────────────────────────
    if fn_lower.endswith(".json") or "json" in mime_type:
        try:
            import json as _json
            data = _json.loads(file_bytes.decode("utf-8", errors="ignore"))
            if isinstance(data, list):
                return {**base, "type": "json", "records": len(data),
                        "keys": list(data[0].keys())[:15] if data and isinstance(data[0], dict) else [],
                        "suggested_prompts": ["Analizza questi dati JSON", "Riassumi la struttura"]}
            elif isinstance(data, dict):
                return {**base, "type": "json", "keys": list(data.keys())[:15],
                        "suggested_prompts": ["Analizza questo JSON", "Spiega la struttura"]}
        except Exception:
            pass
        return {**base, "type": "json"}

    # ── Other document types ──────────────────────────────────────────────────
    suggested_by_type = {
        "pdf": ["Riassumi questo documento", "Quali sono i punti chiave?", "Estrai le informazioni principali"],
        "docx": ["Analizza questo documento", "Riassumi il contenuto", "Trova i punti principali"],
        "pptx": ["Analizza questa presentazione", "Riassumi le slide", "Quali sono i messaggi chiave?"],
    }
    for ext, prompts in suggested_by_type.items():
        if fn_lower.endswith(f".{ext}"):
            return {**base, "type": ext, "suggested_prompts": prompts}

    return {**base, "type": "document",
            "suggested_prompts": ["Analizza questo file", "Riassumi il contenuto"]}


@router.get("/available-models")
async def list_available_models():
    """Get list of available LLM models"""
    from app.core.config import settings
    import httpx
    
    models = []
    
    # OpenAI models
    if settings.OPENAI_API_KEY:
        models.extend([
            {"provider": "openai", "model": DEFAULT_OPENAI_CHAT_MODEL, "name": "GPT-5.6 Luna", "description": "Veloce ed economico", "icon": "openai"},
        ])
    
    # Anthropic models
    if settings.ANTHROPIC_API_KEY:
        models.extend([
            {"provider": "anthropic", "model": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5", "description": "Veloce e leggero", "icon": "anthropic"},
        ])

    # Gemini models
    if settings.GEMINI_API_KEY:
        models.extend([
            {"provider": "gemini", "model": "gemini-3.8-flash", "name": "Gemini 3.8 Flash", "description": "Veloce e intelligente - Google", "icon": "google"},
        ])

    # DeepSeek models — hidden from UI (provider available but not shown to users)
    # if settings.DEEPSEEK_API_KEY:
    #     models.extend([
    #         {"provider": "deepseek", "model": "deepseek-chat", ...},
    #         {"provider": "deepseek", "model": "deepseek-reasoner", ...},
    #     ])
    
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
                        models.append({"provider": "ollama", "model": available_ollama.get("mistral-nemo", "mistral-nemo"), "name": "Mistral Nemo", "description": "12B locale, veloce", "icon": "mistral"})
                    # DeepSeek R1 via Ollama — hidden from UI
                    # if "deepseek-r1" in available_ollama:
                    #     models.append({"provider": "ollama", "model": ..., "name": "DeepSeek R1 8B", ...})
                    if "mistral" in available_ollama:
                        models.append({"provider": "ollama", "model": available_ollama.get("mistral", "mistral"), "name": "Mistral 7B", "description": "Modello locale efficiente", "icon": "mistral"})
        except Exception:
            pass  # Ollama not available, skip
    
    return {"models": models, "default_provider": "openai", "default_model": DEFAULT_OPENAI_CHAT_MODEL}


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


class ConversationTitleUpdate(BaseModel):
    title: str


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
        llm_model=normalize_llm_model(request.provider, request.model),
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    # Notify teacher's session room that a new conversation started
    await sio.emit("conversation_created", {
        "id": str(conversation.id),
        "student_id": str(student.id),
        "student_nickname": student.nickname or "Studente",
        "profile_key": conversation.profile_key,
        "title": conversation.title,
        "llm_provider": conversation.llm_provider,
        "llm_model": conversation.llm_model,
        "message_count": 0,
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
    }, room=f"session:{request.session_id}")
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


@router.patch("/conversations/{conversation_id}", response_model=ConversationResponse)
async def rename_conversation(
    conversation_id: UUID,
    request: ConversationTitleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Rename one of the current student's tutor conversations."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .where(Conversation.student_id == student.id)
        .where(Conversation.session_id == student.session_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    title = request.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Title cannot be empty")
    conversation.title = title[:255]
    await db.commit()
    await db.refresh(conversation)
    return conversation


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
    if auth.is_student and conversation.student_id != auth.student.id:
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
    
    if auth.is_student:
        query = query.where(Conversation.student_id == auth.student.id)
    
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
    
    # Fetch context for credits (Session -> Class -> Teacher)
    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == conversation.session_id)
    )
    session_rw = session_result.first()
    if not session_rw:
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj, class_obj = session_rw

    # Check credit availability
    is_allowed = await credit_service.check_availability(
        db, 
        student.tenant_id, 
        estimated_cost=0.0001, # Minimal check
        teacher_id=class_obj.teacher_id,
        class_id=class_obj.id,
        session_id=session_obj.id,
        student_id=student.id
    )
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Credit limit exceeded for this session/class."
        )

    # === Content Moderation ===
    moderation_result = await moderation_service.check(request.content or "")
    effective_content = moderation_result.masked_text or request.content

    if not moderation_result.is_safe and moderation_result.flagged:
        # Flagged: block message, create alert, notify teacher, return blocked reply
        alert = ContentAlert(
            tenant_id=student.tenant_id,
            session_id=conversation.session_id,
            student_id=student.id,
            conversation_id=conversation_id,
            alert_type=moderation_result.alert_type or "offensive",
            status="pending",
            original_message=request.content or "",
            masked_message=moderation_result.masked_text,
            risk_score=moderation_result.risk_score,
            details={
                "flagged_categories": moderation_result.flagged_categories,
                "pii_found": moderation_result.pii_found,
            },
        )
        db.add(alert)
        blocked_user_msg = ConversationMessage(
            tenant_id=student.tenant_id,
            conversation_id=conversation_id,
            role=MessageRole.USER,
            content=f"[BLOCCATO] {effective_content}",
        )
        db.add(blocked_user_msg)
        blocked_reply = ConversationMessage(
            tenant_id=student.tenant_id,
            conversation_id=conversation_id,
            role=MessageRole.ASSISTANT,
            content="🚫 Il tuo messaggio è stato bloccato perché contiene contenuto non appropriato. Questo evento è stato segnalato al tuo docente.",
            provider="system",
            model="moderation",
            token_usage_json={"prompt_tokens": 0, "completion_tokens": 0},
        )
        db.add(blocked_reply)
        conversation.updated_at = datetime.utcnow()
        await db.flush()
        try:
            await notify_teacher_content_alert(
                session_id=str(conversation.session_id),
                alert_id=str(alert.id),
                student_id=str(student.id),
                nickname=student.nickname or "Studente",
                alert_type=moderation_result.alert_type or "offensive",
                risk_score=moderation_result.risk_score,
                preview=(request.content or "")[:100],
            )
        except Exception as ge:
            logger.warning(f"[Moderation] notify_teacher_content_alert failed: {ge}")
        await db.commit()
        await db.refresh(blocked_reply)
        return blocked_reply

    elif moderation_result.pii_found:
        # PII only: mask + continue, create alert, notify teacher
        alert = ContentAlert(
            tenant_id=student.tenant_id,
            session_id=conversation.session_id,
            student_id=student.id,
            conversation_id=conversation_id,
            alert_type="pii_detected",
            status="pending",
            original_message=request.content or "",
            masked_message=effective_content,
            risk_score=0.3,
            details={"pii_found": moderation_result.pii_found},
        )
        db.add(alert)
        await db.flush()
        try:
            await notify_teacher_content_alert(
                session_id=str(conversation.session_id),
                alert_id=str(alert.id),
                student_id=str(student.id),
                nickname=student.nickname or "Studente",
                alert_type="pii_detected",
                risk_score=0.3,
                preview=(request.content or "")[:100],
            )
        except Exception as ge:
            logger.warning(f"[Moderation] notify_teacher_content_alert (pii) failed: {ge}")

    # Save user message (use masked content if PII was found)
    user_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=effective_content,
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
    
    # history already includes user_message because of db.add and flush
    # So we don't need to append request.content again if it's already in history
    
    # Check if user is requesting image generation
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
    is_image_request = any(re.search(p, request.content.lower()) for p in image_request_patterns)
    
    provider = "none"
    model = "none"
    token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    
    if is_image_request:
        # Extract the image description from the request, using history for context
        try:
            # Check for existing images in attachments or history for img2img
            image_base64 = None
            if request.attachments:
                # Look for images in current request attachments
                for att in request.attachments:
                    # In this platform, attachments are usually URLs like /uploads/chat/...
                    # We need to read the file from the local path
                    file_url = att.get('url') if isinstance(att, dict) else None
                    if file_url and file_url.startswith('/uploads/chat/'):
                        try:
                            # Map URL to local path
                            relative_path = file_url.lstrip('/')
                            local_path = Path(relative_path)
                            if local_path.exists():
                                async with aiofiles.open(local_path, 'rb') as f:
                                    img_data = await f.read()
                                    image_base64 = base64.b64encode(img_data).decode("utf-8")
                                    logger.info(f"Img2Img: Loaded image from {local_path}")
                                    break
                        except Exception as ex:
                            logger.error(f"Failed to load image for img2img: {ex}")

            # Prepare a prompt for the LLM to extract/refine the image description
            extraction_messages = messages[:-1] # All history except current message
            extraction_messages.append({
                "role": "user", 
                "content": f"Basandoti sulla conversazione precedente e su questa nuova richiesta, estrai una descrizione dettagliata in inglese per generare un'immagine. Se l'utente chiede modifiche a un'immagine precedente, incorpora le modifiche nella nuova descrizione. Rispondi SOLO con la descrizione in inglese, senza altro testo. Richiesta: {request.content}"
            })

            prompt_extraction = await llm_service.generate(
                messages=extraction_messages,
                system_prompt="You are a helpful assistant that extracts and refines image generation prompts. Respond only with the detailed image description in English.",
                temperature=0.3,
                max_tokens=300,
            )
            image_prompt = prompt_extraction.content.strip()
            
            # Generate the image using selected provider and size
            image_provider = request.image_provider or settings.OPENAI_IMAGE_MODEL
            image_size = request.image_size or "1024x1024"

            # Call generation
            image_url = await llm_service.generate_image(
                image_prompt,
                size=image_size,
                provider=image_provider,
                image_base64=image_base64
            )
            openai_providers = {"dall-e", "gpt-image-1", "gpt-image-1.5", "gpt-image-2", settings.OPENAI_IMAGE_MODEL}
            provider_labels = {"dall-e": "DALL-E 3", "gpt-image-1": "GPT Image 1", "gpt-image-1.5": "GPT Image 1.5", "gpt-image-2": "GPT Image 2", settings.OPENAI_IMAGE_MODEL: "GPT Image 2"}
            provider_label = provider_labels.get(image_provider, image_provider)
            assistant_content = f"🎨 Ecco l'immagine che hai richiesto:\n\n![Immagine generata]({image_url})\n\n*Generata con {provider_label} - Prompt: {image_prompt}*"
            provider = "openai" if image_provider in openai_providers else "flux"
            model_map = {"dall-e": "dall-e-3", "gpt-image-1": "gpt-image-1", "gpt-image-1.5": "gpt-image-1.5", "gpt-image-2": "gpt-image-2", settings.OPENAI_IMAGE_MODEL: settings.OPENAI_IMAGE_MODEL}
            model = model_map.get(image_provider, image_provider)
            token_usage = enrich_usage_with_environmental_impact(
                {"prompt_tokens": 0, "completion_tokens": 0, "image_count": 1},
                provider=provider,
                model=model,
            )
            
            # TRACK IMAGE COST
            img_cost = credit_service.calculate_cost_for_model(provider, model, 0, 0, image_count=1)
            await safe_track_usage(
                db, student.tenant_id, provider, model, img_cost,
                {
                    "image_prompt": image_prompt,
                    "size": image_size,
                    "image_count": 1,
                    **token_usage,
                },
                teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id,
                context="image_generation"
            )
        except Exception as e:
            logger.error(f"Image generation error: {e}")
            assistant_content = f"Mi dispiace, non sono riuscito a generare l'immagine. Errore: {str(e)}"
            provider = "fallback"
            model = "none"
            token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    else:
        # Get chatbot profile for system prompt
        profile = get_profile(conversation.profile_key)
        
        # Call teacher agent for intelligent routing even for students
        try:
            from app.services.teacher_agent import run_teacher_agent
            provider = conversation.llm_provider or "openai"
            model = normalize_llm_model(provider, conversation.llm_model) or DEFAULT_OPENAI_CHAT_MODEL
            
            assistant_content = await run_teacher_agent(
                messages=messages,
                context="", # Minimal context for student
                structured_context={},
                provider=provider,
                model=model,
                actor_type="STUDENT",
                profile_key=conversation.profile_key,
                school_grade=class_obj.school_grade,
            )
            token_usage = enrich_usage_with_environmental_impact(
                build_estimated_token_usage(messages, assistant_content),
                provider=provider,
                model=model,
            )
            estimated_cost = credit_service.calculate_cost_for_model(
                provider,
                model,
                token_usage["prompt_tokens"],
                token_usage["completion_tokens"],
            )
            await safe_track_usage(
                db, student.tenant_id, provider, model, estimated_cost,
                {
                    **token_usage,
                    "type": "student_chat_estimated",
                    "profile_key": conversation.profile_key,
                },
                class_obj.teacher_id, class_obj.id, session_obj.id, student.id,
                context="student_chat_estimated",
            )

        except Exception as e:
            logger.error(f"Teacher agent error for student: {e}")
            assistant_content = "Mi dispiace, si è verificato un errore nel generare la risposta."
            provider = "fallback"
            model = "none"
            token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    
    # Prepend PII notice to assistant response if PII was masked
    if moderation_result.pii_found:
        pii_label = moderation_service.pii_label_list(moderation_result.pii_found)
        pii_notice = f"⚠️ *Nota: il tuo messaggio conteneva dati sensibili ({pii_label}) che sono stati automaticamente rimossi per la tua sicurezza.*\n\n"
        assistant_content = pii_notice + assistant_content

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

    # Notify teacher that this conversation has new messages
    from sqlalchemy import func as sql_func
    count_result = await db.execute(
        select(sql_func.count()).select_from(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
    )
    msg_count = count_result.scalar_one() or 0
    await sio.emit("conversation_updated", {
        "conversation_id": str(conversation_id),
        "session_id": str(conversation.session_id),
        "message_count": msg_count,
        "updated_at": conversation.updated_at.isoformat(),
    }, room=f"session:{conversation.session_id}")

    return assistant_message


@router.post("/conversations/{conversation_id}/message-stream")
async def send_message_stream(
    conversation_id: UUID,
    request: MessageCreate,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """
    Streaming SSE version of send_message.
    Performs the same credit/moderation checks and DB persistence,
    but streams the LLM response as Server-Sent Events with typewriter effect.
    """
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    if conversation.student_id != student.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == conversation.session_id)
    )
    session_rw = session_result.first()
    if not session_rw:
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj, class_obj = session_rw

    is_allowed = await credit_service.check_availability(
        db,
        student.tenant_id,
        estimated_cost=0.0001,
        teacher_id=class_obj.teacher_id,
        class_id=class_obj.id,
        session_id=session_obj.id,
        student_id=student.id,
    )
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Credit limit exceeded for this session/class.",
        )

    # Content moderation
    moderation_result = await moderation_service.check(request.content or "")
    effective_content = moderation_result.masked_text or request.content

    if not moderation_result.is_safe and moderation_result.flagged:
        # Flagged: block and return immediately (no streaming needed)
        db.add(ContentAlert(
            tenant_id=student.tenant_id,
            session_id=conversation.session_id,
            student_id=student.id,
            conversation_id=conversation_id,
            alert_type=moderation_result.alert_type or "offensive",
            status="pending",
            original_message=request.content or "",
            masked_message=moderation_result.masked_text,
            risk_score=moderation_result.risk_score,
            details={
                "flagged_categories": moderation_result.flagged_categories,
                "pii_found": moderation_result.pii_found,
            },
        ))
        blocked_user_msg = ConversationMessage(
            tenant_id=student.tenant_id,
            conversation_id=conversation_id,
            role=MessageRole.USER,
            content=f"[BLOCCATO] {effective_content}",
        )
        blocked_reply = ConversationMessage(
            tenant_id=student.tenant_id,
            conversation_id=conversation_id,
            role=MessageRole.ASSISTANT,
            content="🚫 Il tuo messaggio è stato bloccato perché contiene contenuto non appropriato. Questo evento è stato segnalato al tuo docente.",
            provider="system",
            model="moderation",
            token_usage_json={"prompt_tokens": 0, "completion_tokens": 0},
        )
        db.add(blocked_user_msg)
        db.add(blocked_reply)
        conversation.updated_at = datetime.utcnow()
        await db.commit()
        try:
            await notify_teacher_content_alert(
                session_id=str(conversation.session_id),
                alert_id=str(blocked_user_msg.id),
                student_id=str(student.id),
                nickname=student.nickname or "Studente",
                alert_type=moderation_result.alert_type or "offensive",
                risk_score=moderation_result.risk_score,
                preview=(request.content or "")[:100],
            )
        except Exception:
            pass

        async def blocked_stream():
            yield f"data: {json.dumps({'type': 'done', 'content': blocked_reply.content, 'message_id': str(blocked_reply.id), 'provider': blocked_reply.provider, 'model': blocked_reply.model, 'token_usage': blocked_reply.token_usage_json})}\n\n"

        return StreamingResponse(blocked_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    elif moderation_result.pii_found:
        db.add(ContentAlert(
            tenant_id=student.tenant_id,
            session_id=conversation.session_id,
            student_id=student.id,
            conversation_id=conversation_id,
            alert_type="pii_detected",
            status="pending",
            original_message=request.content or "",
            masked_message=effective_content,
            risk_score=0.3,
            details={"pii_found": moderation_result.pii_found},
        ))
        await db.flush()

    # Save user message
    user_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=effective_content,
        content_json=request.content_json,
    )
    db.add(user_message)
    db.add(AuditEvent(
        tenant_id=student.tenant_id,
        session_id=conversation.session_id,
        actor_type="STUDENT",
        actor_student_id=student.id,
        event_type="PROMPT_SUBMITTED",
        payload_json={
            "conversation_id": str(conversation_id),
            "content_preview": request.content[:200] if request.content else "",
        },
    ))
    # Commit user message immediately so it's visible to teacher even before
    # the assistant response is generated (the generator commits separately).
    await db.commit()

    # Build message history for LLM
    hist_result = await db.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at.asc())
    )
    messages = [{"role": m.role.value, "content": m.content or ""} for m in hist_result.scalars().all()]

    pii_prefix = ""
    if moderation_result.pii_found:
        pii_label = moderation_service.pii_label_list(moderation_result.pii_found)
        pii_prefix = f"⚠️ *Nota: il tuo messaggio conteneva dati sensibili ({pii_label}) che sono stati automaticamente rimossi per la tua sicurezza.*\n\n"

    provider = conversation.llm_provider or "openai"
    model = normalize_llm_model(provider, conversation.llm_model) or DEFAULT_OPENAI_CHAT_MODEL
    profile_key = conversation.profile_key or "tutor"

    # chat_mode overrides the profile so the right system prompt is used
    if request.chat_mode == "quiz":
        profile_key = "quiz"
    elif request.chat_mode == "dataset":
        profile_key = "dataset_generator"

    # Load any teacher-defined custom prompt for this profile+session
    from app.models.session import SessionProfileOverride
    override_result = await db.execute(
        select(SessionProfileOverride)
        .where(SessionProfileOverride.session_id == conversation.session_id)
        .where(SessionProfileOverride.profile_key == profile_key)
    )
    profile_override = override_result.scalar_one_or_none()
    custom_profile_prompt = profile_override.custom_system_prompt if profile_override else None
    ui_language = get_ui_language(http_request)

    async def generate_stream():
        from app.services.teacher_agent import generate_generic_response_stream
        from app.services.llm_service import _needs_web_search

        try:
            if _needs_web_search(messages):
                yield f"data: {json.dumps({'type': 'status', 'message': '🔍 Ricerca sul web in corso...'})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'status', 'message': '💬 Elaborazione risposta...'})}\n\n"

            full_content = pii_prefix
            async for chunk in generate_generic_response_stream(
                messages, provider, model, profile_key,
                custom_system_prompt=custom_profile_prompt,
                ui_language=ui_language,
            ):
                full_content += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

            # Persist assistant message
            estimated_usage = enrich_usage_with_environmental_impact(
                build_estimated_token_usage(messages, full_content),
                provider=provider,
                model=model,
            )

            assistant_message = ConversationMessage(
                tenant_id=student.tenant_id,
                conversation_id=conversation_id,
                role=MessageRole.ASSISTANT,
                content=full_content,
                provider=provider,
                model=model,
                token_usage_json=estimated_usage,
            )
            db.add(assistant_message)
            conversation.updated_at = datetime.utcnow()
            await db.commit()
            await db.refresh(assistant_message)

            estimated_cost = credit_service.calculate_cost_for_model(
                provider,
                model,
                int(estimated_usage.get("prompt_tokens") or 0),
                int(estimated_usage.get("completion_tokens") or 0),
            )
            await safe_track_usage(
                db, student.tenant_id, provider, model, estimated_cost,
                {
                    **estimated_usage,
                    "type": "student_chat_stream",
                    "profile_key": profile_key,
                },
                class_obj.teacher_id, class_obj.id, session_obj.id, student.id,
                context="student_chat_stream",
            )

            yield f"data: {json.dumps({'type': 'done', 'content': full_content, 'message_id': str(assistant_message.id), 'provider': provider, 'model': model, 'token_usage': estimated_usage})}\n\n"

            # Notify teacher of updated conversation
            try:
                from sqlalchemy import func as sql_func
                count_result = await db.execute(
                    select(sql_func.count()).select_from(ConversationMessage)
                    .where(ConversationMessage.conversation_id == conversation_id)
                )
                msg_count = count_result.scalar_one() or 0
                await sio.emit("conversation_updated", {
                    "conversation_id": str(conversation_id),
                    "session_id": str(conversation.session_id),
                    "message_count": msg_count,
                    "updated_at": conversation.updated_at.isoformat(),
                }, room=f"session:{conversation.session_id}")
            except Exception as e:
                logger.warning(f"Socket notify failed: {e}")

        except Exception as e:
            logger.error(f"Student stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/student/chat")
async def student_chat(
    request: dict,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    student: Annotated[SessionStudent, Depends(get_current_student)],
):
    """Direct chat endpoint for students (e.g. for document assistant)"""
    content = request.get("content", "")
    history = request.get("history", [])
    profile_key = request.get("profile_key", "tutor")
    provider = request.get("provider")
    model = request.get("model")
    model = normalize_llm_model(provider, model)

    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content required")

    # Fetch context for credits (Session -> Class -> Teacher)
    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == student.session_id)
    )
    session_rw = session_result.first()
    if not session_rw:
        raise HTTPException(status_code=404, detail="Session not found")
    session_obj, class_obj = session_rw

    # Check credit availability
    allowed = await credit_service.check_availability(
        db, student.tenant_id, 0.0001, class_obj.teacher_id, class_obj.id, session_obj.id, student.id
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Credit limit exceeded")

    # Get chatbot profile
    profile = get_profile(profile_key)
    
    # Build messages
    messages = []
    for msg in history:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })
    messages.append({"role": "user", "content": content})

    try:
        # Use teacher agent logic even for students for consistent widgets/intent handling
        from app.services.teacher_agent import run_teacher_agent
        
        # Build a minimal context for student if needed, but for now we focus on the agent routing
        # Students don't see the teacher's full analytics context
        
        response_content = await run_teacher_agent(
            messages=messages,
            context="", # No full teacher context for students
            structured_context={},
            provider=provider,
            model=model,
            actor_type="STUDENT",
            profile_key=profile_key,
            ui_language=get_ui_language(http_request),
            school_grade=class_obj.school_grade,
        )

        return {
            "response": response_content,
            "provider": provider,
            "model": model,
            "prompt_tokens": 0,
            "completion_tokens": 0,
        }
    except Exception as e:
        logger.error(f"Student chat error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/presentations/agent")
async def presentation_agent(
    request: dict,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Agentic presentation generator: strategy -> visual direction -> editable slide JSON."""
    prompt = str(request.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")

    provider = request.get("provider")
    model = normalize_llm_model(provider, request.get("model"))
    language = get_ui_language(http_request)
    fmt = str(request.get("format") or "16:9")
    dims = request.get("dims") if isinstance(request.get("dims"), dict) else {"width": 960, "height": 540}
    current_presentation = request.get("current_presentation") if isinstance(request.get("current_presentation"), dict) else {}
    mode = str(request.get("mode") or "create")

    tenant_id = None
    teacher_id = None
    class_id = None
    session_id = None
    student_id = None
    school_grade = None

    if auth.is_student:
        tenant_id = auth.student.tenant_id
        student_id = auth.student.id
        session_id = auth.student.session_id
        session_result = await db.execute(
            select(Session, Class)
            .join(Class, Session.class_id == Class.id)
            .where(Session.id == auth.student.session_id)
        )
        session_row = session_result.first()
        if session_row:
            session_obj, class_obj = session_row
            teacher_id = class_obj.teacher_id
            class_id = class_obj.id
            school_grade = class_obj.school_grade
            session_id = session_obj.id
    else:
        tenant_id = auth.teacher.tenant_id
        teacher_id = auth.teacher.id

    allowed = await credit_service.check_availability(
        db, tenant_id, 0.002, teacher_id, class_id, session_id, student_id
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Credit limit exceeded")

    school_grade_instruction = get_school_grade_instruction(school_grade) if school_grade else ""
    canvas_width = int(_bounded_number(dims.get("width"), 960, 320, 1600))
    canvas_height = int(_bounded_number(dims.get("height"), 540, 240, 1400))
    current_summary = json.dumps(current_presentation, ensure_ascii=False)[:7000]

    strategy_system = (
        "Sei un presentation strategist per una piattaforma didattica. "
        "Trasforma input anche grezzi in una tesi chiara, un arco narrativo e una scaletta didattica. "
        "Non copiare il testo dell'utente nelle slide: estrai, organizza, sintetizza, decidi cosa merita spazio. "
        "Rispondi solo con JSON valido."
    )
    strategy_user = (
        f"Lingua output: {language}\n"
        f"Formato: {fmt}, canvas {canvas_width}x{canvas_height}\n"
        f"Modalita: {mode}\n"
        f"{school_grade_instruction}\n\n"
        f"Richiesta utente:\n{prompt}\n\n"
        f"Presentazione corrente, se da modificare:\n{current_summary}\n\n"
        "Produci JSON con questa forma:\n"
        "{\"title\":\"...\",\"audience\":\"...\",\"core_message\":\"...\",\"narrative_arc\":\"...\","
        "\"slides\":[{\"title\":\"...\",\"role\":\"cover|concept|evidence|comparison|process|summary\","
        "\"purpose\":\"...\",\"key_points\":[\"...\"],\"visual_idea\":\"...\",\"speaker_notes\":\"...\"}]}"
    )

    style_system = (
        "Sei un art director per presentazioni in stile Gamma/Keynote: sistemi visuali puliti, coerenti, moderni. "
        "Definisci palette, gerarchie tipografiche, ritmo, pattern layout e componenti. "
        "Evita palette monotone e slide piene di testo. Rispondi solo con JSON valido, compatto e senza spiegazioni."
    )

    compose_system = (
        "Sei un presentation composer. Devi restituire una presentazione completa come JSON renderizzabile "
        "nell'editor Golinelli. Usi SOLO blocchi editabili: text, rectangle, ellipse, line, image. "
        "Tutto il contenuto verbale visibile deve stare in blocchi text separati e modificabili. "
        "Non usare markdown né elenchi multipli dentro un unico blocco testo. Ogni slide deve avere gerarchia visuale, respiro, "
        "contrasto WCAG, almeno due superfici colore e forme o diagrammi quando utili. Alterna layout: cover, split, card, timeline, bento, summary. "
        "Evita la gabbia ripetitiva titolo+riquadro bianco+lista. Non incollare paragrafi lunghi: massimo 16 parole per blocco testo, "
        "salvo note relatore. Titoli 30-48px, corpo 17-22px, lineHeight 1.15-1.4. Rispondi solo con JSON valido."
    )

    try:
        strategy_resp = None
        style_resp = None
        compose_resp = None
        try:
            strategy_resp = await llm_service.generate(
                messages=[{"role": "user", "content": strategy_user}],
                system_prompt=strategy_system,
                provider=provider,
                model=model,
                temperature=0.45,
                max_tokens=2600,
                allow_web_search=False,
            )
            strategy = _extract_json_object(strategy_resp.content)
            if not isinstance(strategy.get("slides"), list) or not strategy["slides"]:
                raise ValueError("Strategist returned no slide outline")
        except Exception as strategy_error:
            logger.warning("Presentation strategist fallback: %s", strategy_error)
            strategy = _fallback_presentation_strategy(prompt)

        style_user = (
            f"Strategia:\n{json.dumps(strategy, ensure_ascii=False)[:7000]}\n\n"
            "Restituisci ESATTAMENTE un JSON compatto con questo schema e nessun altro campo:\n"
            "{\"palette\":{\"background\":\"#...\",\"surface\":\"#...\",\"primary\":\"#...\",\"accent\":\"#...\",\"text\":\"#...\"},"
            "\"typography\":{\"heading\":\"Inter\",\"body\":\"Inter\",\"title_size\":34,\"body_size\":20},"
            "\"layout\":\"una frase breve\",\"components\":[\"massimo\",\"quattro\",\"elementi\"]}. "
            "Massimo 900 caratteri complessivi."
        )
        try:
            style_resp = await llm_service.generate(
                messages=[{"role": "user", "content": style_user}],
                system_prompt=style_system,
                provider=provider,
                model=model,
                temperature=0.4,
                max_tokens=900,
                allow_web_search=False,
            )
            style = _extract_json_object(style_resp.content)
        except Exception as style_error:
            logger.warning("Presentation art director fallback: %s", style_error)
            style = _fallback_presentation_style()

        compose_user = (
            f"Canvas: {canvas_width}x{canvas_height}. Formato: {fmt}. Lingua: {language}.\n"
            "Schema blocchi:\n"
            "text: {type:'text', content, x,y,width,height, style:{fontFamily,fontSize,color,backgroundColor,fontWeight,textAlign,lineHeight,padding,borderRadius}}\n"
            "rectangle/ellipse: {type, content:'', x,y,width,height, style:{fill,stroke,strokeWidth,cornerRadius}}\n"
            "line: {type:'line', content:'', x,y,width,height, style:{stroke,strokeWidth}}\n"
            "image: usa solo placeholder https://placehold.co/... descrittivi se serve una visuale.\n\n"
            "STRATEGIA:\n"
            f"{json.dumps(strategy, ensure_ascii=False)}\n\n"
            "DIREZIONE VISIVA:\n"
            f"{json.dumps(style, ensure_ascii=False)}\n\n"
            "VINCOLI DI COMPOSIZIONE:\n"
            "- Ogni informazione o punto deve essere un blocco text autonomo e quindi modificabile.\n"
            "- Metti forme di sfondo prima dei testi nell'array blocks, così i livelli restano corretti.\n"
            "- Inserisci un blocco titolo nativo nella slide; non creare due blocchi titolo sovrapposti.\n"
            "- Usa contrasti netti, blocchi colore, numeri/etichette e spaziatura coerente.\n"
            "- Varia davvero il layout tra slide consecutive.\n\n"
            "Restituisci JSON finale:\n"
            "{\"title\":\"...\",\"format\":\"" + fmt + "\",\"slides\":[{\"title\":\"...\",\"speakerNotes\":\"...\",\"blocks\":[...]}]}"
        )
        try:
            compose_resp = await llm_service.generate(
                messages=[{"role": "user", "content": compose_user}],
                system_prompt=compose_system,
                provider=provider,
                model=model,
                temperature=0.5,
                max_tokens=7000,
                allow_web_search=False,
            )
            payload = _extract_json_object(compose_resp.content)
        except Exception as compose_error:
            logger.warning("Presentation composer fallback: %s", compose_error)
            payload = _fallback_presentation_payload(strategy, fmt, canvas_width, canvas_height)
        payload["format"] = fmt
        payload["agent_steps"] = [
            {"agent": "Strategist", "summary": str(strategy.get("core_message") or strategy.get("narrative_arc") or "")[:500]},
            {"agent": "Art director", "summary": json.dumps(style, ensure_ascii=False)[:500]},
            {"agent": "Composer", "summary": "Ha prodotto slide editabili con layout, gerarchie e blocchi nativi." if compose_resp else "Ha applicato il layout editabile di fallback."},
        ]
        try:
            result = _sanitize_slide_agent_payload(payload, {"width": canvas_width, "height": canvas_height})
        except (TypeError, ValueError, KeyError) as sanitize_error:
            logger.warning("Presentation payload sanitizer fallback: %s", sanitize_error)
            payload = _fallback_presentation_payload(strategy, fmt, canvas_width, canvas_height)
            payload["agent_steps"] = [
                {"agent": "Strategist", "summary": str(strategy.get("core_message") or strategy.get("narrative_arc") or "")[:500]},
                {"agent": "Composer", "summary": "Ha applicato il layout editabile di fallback."},
            ]
            result = _sanitize_slide_agent_payload(payload, {"width": canvas_width, "height": canvas_height})

        responses = [response for response in (strategy_resp, style_resp, compose_resp) if response is not None]
        total_prompt = sum(response.prompt_tokens for response in responses)
        total_completion = sum(response.completion_tokens for response in responses)
        last_response = responses[-1] if responses else None
        real_provider = (last_response.provider if last_response else None) or provider or settings.DEFAULT_LLM_PROVIDER
        real_model = (last_response.model if last_response else None) or model or settings.DEFAULT_LLM_MODEL
        cost = credit_service.calculate_cost_for_model(real_provider, real_model, total_prompt, total_completion)
        await safe_track_usage(
            db,
            tenant_id,
            real_provider,
            real_model,
            cost,
            enrich_usage_with_environmental_impact(
                {
                    "type": "presentation_agent",
                    "prompt": prompt[:1000],
                    "agent_steps": ["strategy", "style", "compose"],
                    "slides": len(result["slides"]),
                    "prompt_tokens": total_prompt,
                    "completion_tokens": total_completion,
                    "total_tokens": total_prompt + total_completion,
                },
                provider=real_provider,
                model=real_model,
            ),
            teacher_id,
            class_id,
            session_id,
            student_id,
            context="presentation_agent",
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Presentation agent failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Presentation agent failed: {e}")


@router.post("/documents/assist")
async def document_context_assist(
    request: dict,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Return a contextual, reviewable proposal for a document selection or slide target."""
    prompt = str(request.get("prompt") or "").strip()
    target = request.get("target") if isinstance(request.get("target"), dict) else {}
    target_kind = str(target.get("kind") or "").strip()
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")
    if target_kind not in {"selected_text", "slide_block", "slide", "presentation"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select text, a slide object, a slide, or the presentation first")

    provider = request.get("provider")
    model = normalize_llm_model(provider, request.get("model"))
    language = get_ui_language(http_request)
    dims = request.get("dims") if isinstance(request.get("dims"), dict) else {"width": 960, "height": 540}
    canvas_width = int(_bounded_number(dims.get("width"), 960, 320, 1600))
    canvas_height = int(_bounded_number(dims.get("height"), 540, 240, 1400))

    tenant_id = auth.student.tenant_id if auth.is_student else auth.teacher.tenant_id
    student_id = auth.student.id if auth.is_student else None
    teacher_id = None if auth.is_student else auth.teacher.id
    class_id = None
    session_id = auth.student.session_id if auth.is_student else None
    if auth.is_student:
        session_result = await db.execute(
            select(Session, Class)
            .join(Class, Session.class_id == Class.id)
            .where(Session.id == auth.student.session_id)
        )
        session_row = session_result.first()
        if session_row:
            session_obj, class_obj = session_row
            teacher_id = class_obj.teacher_id
            class_id = class_obj.id
            session_id = session_obj.id

    allowed = await credit_service.check_availability(
        db, tenant_id, 0.0005, teacher_id, class_id, session_id, student_id
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Credit limit exceeded")

    target_payload = json.dumps(target, ensure_ascii=False)[:60000 if target_kind == "presentation" else 10000]
    document_context = json.dumps(request.get("document_context") or {}, ensure_ascii=False)[:5000]
    if target_kind == "selected_text":
        response_schema = '{"summary":"breve descrizione della modifica","replacement_text":"testo sostitutivo, senza commenti"}'
        target_rules = (
            "Modifica soltanto il testo selezionato. Mantieni lingua, significato e tono del documento, salvo richiesta esplicita. "
            "replacement_text deve contenere esclusivamente il testo pronto da inserire."
        )
    elif target_kind == "slide_block":
        response_schema = '{"summary":"breve descrizione della modifica","replacement_block":{"type":"text|image|rectangle|ellipse|line","content":"...","x":0,"y":0,"width":100,"height":100,"style":{}}}'
        target_rules = (
            "Modifica soltanto l'oggetto selezionato. Conserva posizione, dimensioni e tipo quando la richiesta non li riguarda. "
            "Per immagini non inventare URL esterni: conserva content se non viene chiesta una sostituzione."
        )
    elif target_kind == "slide":
        response_schema = '{"summary":"breve descrizione della modifica","replacement_slide":{"title":"...","blocks":[...]}}'
        target_rules = (
            "Modifica soltanto la slide corrente. Restituisci tutti i suoi blocchi, inclusi quelli invariati. "
            "Usa solo blocchi text, image, rectangle, ellipse e line."
        )
    else:
        response_schema = '{"summary":"breve descrizione della modifica","replacement_presentation":{"title":"...","format":"16:9|4:3","slides":[{"title":"...","blocks":[...],"speakerNotes":"..."}]}}'
        selected_slide_ids = target.get("selected_slide_ids")
        if isinstance(selected_slide_ids, list) and len(selected_slide_ids) > 1:
            target_rules = (
                "Modifica soltanto le slide selezionate ricevute nel bersaglio. "
                "Restituisci tutte e sole le slide selezionate, nello stesso ordine e nello stesso numero, incluse quelle rimaste invariate. "
                "Non modificare il titolo o il formato della presentazione e usa solo blocchi text, image, rectangle, ellipse e line."
            )
        else:
            target_rules = (
                "Puoi modificare l'intera presentazione: titolo, ordine, numero e contenuto delle slide. "
                "Restituisci sempre la presentazione completa, incluse le slide rimaste invariate. "
                "Mantieni il formato corrente salvo richiesta esplicita e usa solo blocchi text, image, rectangle, ellipse e line."
            )

    system_prompt = (
        "Sei Document Builder, un assistente agentico per un editor didattico. "
        "Ricevi un bersaglio preciso già selezionato dall'utente e produci una proposta reversibile. "
        "Non modificare parti fuori dal bersaglio. Non applicare la modifica: il client chiederà conferma. "
        "Rispondi esclusivamente con JSON valido, compatto e senza Markdown. "
        "Evita ripetizioni e mantieni la risposta entro i limiti strettamente necessari."
    )
    user_prompt = (
        f"Lingua interfaccia: {language}\nCanvas slide: {canvas_width}x{canvas_height}\n"
        f"Istruzione utente:\n{prompt}\n\nBersaglio selezionato:\n{target_payload}\n\n"
        f"Contesto documento:\n{document_context}\n\nRegole:\n{target_rules}\n\nSchema risposta obbligatorio:\n{response_schema}"
    )

    try:
        response = await llm_service.generate(
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=0.25,
            max_tokens=16000 if target_kind == "presentation" else 3200,
            allow_web_search=False,
        )
        usage_responses = [response]
        try:
            payload = _extract_json_object(response.content)
        except (json.JSONDecodeError, ValueError):
            # Some providers can stop a long structured answer before the final quote/braces.
            # Give the model one bounded repair pass and account for both calls in one usage event.
            logger.warning(
                "Repairing truncated document assist response (target_kind=%s, chars=%s)",
                target_kind,
                len(response.content or ""),
            )
            repair_response = await llm_service.generate(
                messages=[{
                    "role": "user",
                    "content": (
                        "Ripara e completa il seguente output interrotto. Restituisci un solo oggetto JSON "
                        "valido e compatto, conforme allo schema indicato. Non aggiungere Markdown o spiegazioni. "
                        "Mantieni il contenuto già prodotto e chiudi correttamente stringhe, array e oggetti.\n\n"
                        f"Schema:\n{response_schema}\n\nOutput da riparare:\n{(response.content or '')[:45000]}"
                    ),
                }],
                system_prompt="Sei un riparatore di JSON. Produci esclusivamente JSON valido e compatto.",
                provider=provider,
                model=model,
                temperature=0,
                max_tokens=16000 if target_kind == "presentation" else 5000,
                allow_web_search=False,
            )
            usage_responses.append(repair_response)
            response = repair_response
            try:
                payload = _extract_json_object(response.content)
            except (json.JSONDecodeError, ValueError) as repair_error:
                logger.warning(
                    "Document assist repair pass still unparsable (target_kind=%s, chars=%s)",
                    target_kind,
                    len(response.content or ""),
                )
                raise ValueError("La proposta generata era troppo lunga o incompleta: riprova con una richiesta più mirata (es. poche slide alla volta)") from repair_error
        summary = str(payload.get("summary") or "Ho preparato una modifica contestuale.").strip()[:500]

        if target_kind == "selected_text":
            replacement_text = str(payload.get("replacement_text") or "").strip()
            if not replacement_text:
                raise ValueError("No replacement text returned")
            proposal = {"kind": target_kind, "replacement_text": replacement_text[:12000]}
        elif target_kind == "slide_block":
            replacement_block = payload.get("replacement_block")
            if not isinstance(replacement_block, dict):
                raise ValueError("No replacement block returned")
            sanitized = _sanitize_slide_agent_payload(
                {"title": "Proposal", "slides": [{"title": "Target", "blocks": [replacement_block]}]},
                {"width": canvas_width, "height": canvas_height},
            )
            blocks = sanitized.get("slides", [{}])[0].get("blocks", [])
            if not blocks:
                raise ValueError("Replacement block is not renderable")
            proposal = {"kind": target_kind, "replacement_block": blocks[0]}
        elif target_kind == "slide":
            replacement_slide = payload.get("replacement_slide")
            if not isinstance(replacement_slide, dict):
                raise ValueError("No replacement slide returned")
            sanitized = _sanitize_slide_agent_payload(
                {"title": "Proposal", "slides": [replacement_slide]},
                {"width": canvas_width, "height": canvas_height},
            )
            slides = sanitized.get("slides", [])
            if not slides:
                raise ValueError("Replacement slide is not renderable")
            proposal = {"kind": target_kind, "replacement_slide": slides[0]}
        else:
            replacement_presentation = payload.get("replacement_presentation")
            if not isinstance(replacement_presentation, dict):
                raise ValueError("No replacement presentation returned")
            sanitized = _sanitize_slide_agent_payload(
                replacement_presentation,
                {"width": canvas_width, "height": canvas_height},
            )
            proposal = {"kind": target_kind, "replacement_presentation": sanitized}

        real_provider = response.provider or provider or settings.DEFAULT_LLM_PROVIDER
        real_model = response.model or model or settings.DEFAULT_LLM_MODEL
        prompt_tokens = sum(item.prompt_tokens for item in usage_responses)
        completion_tokens = sum(item.completion_tokens for item in usage_responses)
        cost = credit_service.calculate_cost_for_model(real_provider, real_model, prompt_tokens, completion_tokens)
        await safe_track_usage(
            db, tenant_id, real_provider, real_model, cost,
            enrich_usage_with_environmental_impact({
                "type": "document_context_assist",
                "target_kind": target_kind,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
                "repair_attempted": len(usage_responses) > 1,
            }, provider=real_provider, model=real_model),
            teacher_id, class_id, session_id, student_id,
            context="document_context_assist",
        )
        return {
            "summary": summary,
            "proposal": proposal,
            "agent_steps": [
                {"agent": "Context Analyst", "summary": "Ha isolato il contenuto selezionato."},
                {"agent": "Document Builder", "summary": summary},
                {"agent": "Reviewer", "summary": "La proposta è pronta per la conferma."},
            ],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Document context assist failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Document assist failed: {exc}")


@router.post("/generate-image")
async def generate_image(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Generate an image using DALL-E 3 or Flux"""
    prompt = request.get("prompt", "")
    provider = request.get("provider", settings.OPENAI_IMAGE_MODEL)
    if not prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")
    
    # Determine context
    teacher_id = None
    class_id = None
    session_id = None
    student_id = None
    tenant_id = None
    
    if auth.is_student:
        tenant_id = auth.student.tenant_id
        student_id = auth.student.id
        session_id = auth.student.session_id
        # Need to fetch class/teacher
        session_result = await db.execute(
            select(Session, Class)
            .join(Class, Session.class_id == Class.id)
            .where(Session.id == session_id)
        )
        res = session_result.first()
        if res:
            sess, cls = res
            class_id = cls.id
            teacher_id = cls.teacher_id
    else:
        tenant_id = auth.teacher.tenant_id
        teacher_id = auth.teacher.id
    
    # Check credits
    allowed = await credit_service.check_availability(
        db, tenant_id, 0.001, teacher_id, class_id, session_id, student_id
    )
    if not allowed:
        raise HTTPException(status_code=402, detail="Credit limit exceeded")
    
    try:
        image_url = await llm_service.generate_image(prompt, provider=provider)
    except Exception as e:
        logger.error(f"Image generation error (provider={provider}): {e}")
        # Flux/BFL/Golinelli image backends may be unavailable (missing key or unreachable
        # host). Fall back to the OpenAI image model so the feature keeps working.
        if provider != settings.OPENAI_IMAGE_MODEL:
            try:
                image_url = await llm_service.generate_image(prompt, provider=settings.OPENAI_IMAGE_MODEL)
                provider = settings.OPENAI_IMAGE_MODEL
            except Exception as e2:
                logger.error("Image generation fallback (%s) failed: %s", settings.OPENAI_IMAGE_MODEL, e2)
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e2))
        else:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    # Track Usage (non-blocking)
    openai_providers = {"dall-e", "gpt-image-1", "gpt-image-1.5", "gpt-image-2", settings.OPENAI_IMAGE_MODEL}
    real_provider = "openai" if provider in openai_providers else "flux"
    model_map = {"dall-e": "dall-e-3", "gpt-image-1": "gpt-image-1", "gpt-image-1.5": "gpt-image-1.5", "gpt-image-2": "gpt-image-2", settings.OPENAI_IMAGE_MODEL: settings.OPENAI_IMAGE_MODEL}
    real_model = model_map.get(provider, "flux-schnell")
    cost = credit_service.calculate_cost_for_model(real_provider, real_model, 0, 0, image_count=1)
    await safe_track_usage(
        db, tenant_id, real_provider, real_model, cost,
        enrich_usage_with_environmental_impact(
            {"prompt": prompt, "type": "direct_generation", "image_count": 1},
            provider=real_provider,
            model=real_model,
        ),
        teacher_id, class_id, session_id, student_id,
        context="generate_image"
    )

    return {"image_url": image_url, "prompt": prompt, "provider": provider}


@router.post("/conversations/{conversation_id}/message-with-files")
async def send_message_with_files(
    conversation_id: UUID,
    http_request: Request,
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
    
    # Fetch context for credits (Session -> Class -> Teacher)
    session_result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == conversation.session_id)
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
        raise HTTPException(status_code=402, detail="Credit limit exceeded for this session/class.")
    
    # Process attached files with advanced multi-step processor
    file_extracts: list[str] = []
    file_infos: list[dict] = []
    MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

    for file in files:
        file_data = await file.read()
        filename = file.filename or "unknown"
        mime_type = file.content_type or "application/octet-stream"
        file_infos.append({"filename": filename, "mime_type": mime_type})

        if len(file_data) > MAX_FILE_BYTES:
            file_extracts.append(f"\n[File troppo grande: {filename}]\n")
            continue

        # For images, do a quick credit check before vision analysis
        if mime_type.startswith("image/"):
            credits_ok = await credit_service.check_availability(
                db, student.tenant_id, 0.005,
                class_obj.teacher_id, class_obj.id, session_obj.id, student.id,
            )
            analyze_visuals = credits_ok
        else:
            analyze_visuals = True

        try:
            analysis = await document_processor.process(
                file_bytes=file_data,
                filename=filename,
                mime_type=mime_type,
                llm_service=llm_service,
                analyze_visuals=analyze_visuals,
            )
            file_extracts.append(analysis.structured_extract)

            # Track vision cost if image was analyzed
            if mime_type.startswith("image/") and analyze_visuals and analysis.visual_descriptions:
                v_cost = 0.005
                await safe_track_usage(
                    db, student.tenant_id, "openai", "gpt-4o", v_cost,
                    {"type": "vision_analysis", "filename": filename},
                    class_obj.teacher_id, class_obj.id, session_obj.id, student.id,
                    context="vision_analysis",
                )
        except Exception as e:
            logger.error(f"Document processing error for {filename}: {e}")
            file_extracts.append(f"\n[Errore elaborazione {filename}: {e}]\n")

    # Build the full message with processed file extracts
    full_content = content
    if file_extracts:
        files_context = (
            "\n\n--- DOCUMENTI ELABORATI ---\n"
            + "\n\n".join(file_extracts)
            + "\n--- FINE DOCUMENTI ---\n"
        )
        full_content = files_context + "\n" + content if content else files_context
    
    # Save user message
    user_message = ConversationMessage(
        tenant_id=student.tenant_id,
        conversation_id=conversation_id,
        role=MessageRole.USER,
        content=content or "[Allegati caricati]",
        content_json={"files": file_infos},
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
    for msg in history:
        messages.append({
            "role": msg.role.value,
            "content": msg.content or "",
        })
    
    # history already includes user_message because of db.add and flush
    # and we already processed the full_content with file extraction
    # We need to replace the last message in history with the one containing full_content
    if messages:
        messages[-1]["content"] = full_content
    
    # Check for image generation request in content
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
    
    provider = "none"
    model = "none"
    token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    
    if is_image_request:
        try:
            # Look for image in attached files
            image_base64 = None
            # Find the first image in file_contents (we already have it in memory)
            # But file_contents has extracted_text, not raw base64. 
            # We need to get it again or pass it. 
            # Let's assume we use the first image file if available.
            for file in files:
                if file.content_type and file.content_type.startswith("image/"):
                    # Rewind file to read from start again if needed
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
            
            # Use default flux-schnell if not specified (request dict is not available in Form method directly as object)
            # We'd need to add these as Form fields if we want them here.
            image_provider = "flux-schnell" 
            image_size = "1024x1024"
            
            image_url = await llm_service.generate_image(
                image_prompt, 
                size=image_size, 
                provider=image_provider,
                image_base64=image_base64
            )
            
            provider_label = "FLUX"
            assistant_content = f"🎨 Ecco l'immagine che hai richiesto:\n\n![Immagine generata]({image_url})\n\n*Generata con {provider_label} - Prompt: {image_prompt}*"
            provider = "flux"
            model = image_provider
            token_usage = enrich_usage_with_environmental_impact(
                {"prompt_tokens": 0, "completion_tokens": 0, "image_count": 1},
                provider=provider,
                model=model,
            )
            
            # Track Usage
            img_cost = credit_service.calculate_cost_for_model(provider, model, 0, 0, image_count=1)
            await safe_track_usage(
                db, student.tenant_id, provider, model, img_cost,
                enrich_usage_with_environmental_impact(
                    {
                        "image_prompt": image_prompt,
                        "type": "img2img" if image_base64 else "txt2img",
                        "image_count": 1,
                    },
                    provider=provider,
                    model=model,
                ),
                teacher_id=class_obj.teacher_id, class_id=class_obj.id, session_id=session_obj.id, student_id=student.id,
                context="image_generation_files"
            )
        except Exception as e:
            logger.error(f"Image generation with files error: {e}")
            assistant_content = f"Errore generazione immagine: {str(e)}"
            provider = "fallback"
    else:
        # Get chatbot profile
        profile = get_profile(conversation.profile_key)
        grade_instruction = get_school_grade_instruction(class_obj.school_grade)
        system_prompt = (
            profile["system_prompt"]
            + grade_instruction
            + "\n\nQuando l'utente allega documenti, analizzali attentamente e rispondi in base al loro contenuto."
        )
        system_prompt = apply_output_language_instruction(system_prompt, get_ui_language(http_request))
        temperature = profile.get("temperature", 0.7)
        
        provider = "none"
        model = "none"
        token_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    
    # Call LLM
    try:
        llm_response = await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=conversation.llm_provider,
            model=conversation.llm_model,
            temperature=temperature,
            max_tokens=1200,
        )
        assistant_content = llm_response.content
        provider = llm_response.provider
        model = llm_response.model
        token_usage = enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": llm_response.prompt_tokens,
                "completion_tokens": llm_response.completion_tokens,
            },
            provider=provider,
            model=model,
        )

        # Track Usage
        cost = credit_service.calculate_cost_for_model(provider, model, token_usage["prompt_tokens"], token_usage["completion_tokens"])
        await safe_track_usage(
            db, student.tenant_id, provider, model, cost,
            token_usage,
            class_obj.teacher_id, class_obj.id, session_obj.id, student.id,
            context="message_with_files"
        )

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


async def load_session_context(db: AsyncSession, session_id_str: str, teacher: User) -> str:
    """Build a rich, session-focused context block injected into the teacher AI chat."""
    from uuid import UUID as _UUID
    from sqlalchemy import func as _func
    from app.models.session import Session, SessionStudent
    from app.models.llm import Conversation
    from app.models.teacherbot import TeacherbotConversation, Teacherbot
    from app.models.task import Task, TaskSubmission
    from app.models.session import Class
    from app.models.chat import ChatMessage

    try:
        sess_uuid = _UUID(session_id_str)
    except ValueError:
        return ""

    row = (await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == sess_uuid, Session.tenant_id == teacher.tenant_id)
    )).first()
    if not row:
        return ""
    session, cls = row

    parts = [
        f"## SESSIONE ATTIVA: {session.title}",
        f"Classe: {cls.name}  |  Stato: {session.status.value}  |  Codice: {session.join_code}",
    ]

    # Students
    students = (await db.execute(
        select(SessionStudent).where(SessionStudent.session_id == sess_uuid)
    )).scalars().all()
    parts.append(f"Studenti iscritti: {len(students)}" + (
        " — " + ", ".join(s.nickname for s in students) if students else ""
    ))
    student_map = {str(s.id): s.nickname for s in students}

    # Chatbot conversation stats by profile
    conv_rows = (await db.execute(
        select(Conversation.profile_key, _func.count(Conversation.id).label("cnt"))
        .join(SessionStudent, Conversation.student_id == SessionStudent.id)
        .where(SessionStudent.session_id == sess_uuid)
        .group_by(Conversation.profile_key)
        .order_by(_func.count(Conversation.id).desc())
    )).all()
    if conv_rows:
        total = sum(r.cnt for r in conv_rows)
        profile_str = ", ".join(f"{r.profile_key}×{r.cnt}" for r in conv_rows[:6])
        parts.append(f"Conversazioni chatbot: {total} totali — profili: {profile_str}")

        # Most active students by message count
        top_students = (await db.execute(
            select(
                SessionStudent.nickname,
                _func.count(Conversation.id).label("cnt"),
            )
            .join(Conversation, Conversation.student_id == SessionStudent.id)
            .where(SessionStudent.session_id == sess_uuid)
            .group_by(SessionStudent.id, SessionStudent.nickname)
            .order_by(_func.count(Conversation.id).desc())
            .limit(5)
        )).all()
        if top_students:
            parts.append("Studenti più attivi (chatbot): " + ", ".join(
                f"{r.nickname} ({r.cnt})" for r in top_students
            ))

        conv_student_rows = (await db.execute(
            select(
                SessionStudent.nickname,
                Conversation.profile_key,
                _func.count(Conversation.id).label("cnt"),
            )
            .join(Conversation, Conversation.student_id == SessionStudent.id)
            .where(SessionStudent.session_id == sess_uuid)
            .group_by(SessionStudent.nickname, Conversation.profile_key)
            .order_by(SessionStudent.nickname.asc(), _func.count(Conversation.id).desc())
        )).all()
        if conv_student_rows:
            parts.append("Dettaglio conversazioni chatbot per studente:")
            for row in conv_student_rows:
                parts.append(f"- {row.nickname}: {row.profile_key}×{row.cnt}")

    # Teacherbot conversations
    tb_rows = (await db.execute(
        select(Teacherbot.name, _func.count(TeacherbotConversation.id).label("cnt"))
        .join(Teacherbot, TeacherbotConversation.teacherbot_id == Teacherbot.id)
        .where(TeacherbotConversation.session_id == sess_uuid)
        .group_by(Teacherbot.name)
        .order_by(_func.count(TeacherbotConversation.id).desc())
    )).all()
    if tb_rows:
        parts.append("Conversazioni teacherbot: " + ", ".join(
            f"{r.name}×{r.cnt}" for r in tb_rows
        ))

    # Tasks and submissions
    tasks = (await db.execute(
        select(Task).where(Task.session_id == sess_uuid)
    )).scalars().all()
    if tasks:
        parts.append("Compiti e consegne:")
    for task in tasks:
        submissions = (await db.execute(
            select(TaskSubmission).where(TaskSubmission.task_id == task.id)
        )).scalars().all()
        sub_cnt = len(submissions)
        parts.append(
            f"Compito '{task.title}': {sub_cnt}/{len(students)} consegne, stato: {task.status.value}"
        )
        if submissions:
            scored = [sub for sub in submissions if sub.score is not None]
            if scored:
                parsed_scores = [_parse_submission_score(sub.score) for sub in scored]
                numeric_scores = [score for score, is_ratio in parsed_scores if score is not None and not is_ratio]
                ratio_scores = [score for score, is_ratio in parsed_scores if score is not None and is_ratio]
                if numeric_scores:
                    avg_score = sum(numeric_scores) / len(numeric_scores)
                    parts.append(
                        f"  - media voti: {avg_score:.2f} su {len(numeric_scores)} consegne valutate"
                    )
                if ratio_scores:
                    avg_percentage = sum(ratio_scores) / len(ratio_scores)
                    parts.append(
                        f"  - media risposte corrette: {avg_percentage:.1f}% su {len(ratio_scores)} consegne"
                    )
            for sub in submissions[:20]:
                nickname = student_map.get(str(sub.student_id), "Studente")
                score_info = f"voto {sub.score}" if sub.score is not None else "non valutato"
                feedback_info = f" | feedback: {sub.feedback[:120]}" if sub.feedback else ""
                parts.append(f"  - {nickname}: {score_info}{feedback_info}")

    chat_rows = (await db.execute(
        select(ChatMessage, SessionStudent)
        .outerjoin(SessionStudent, ChatMessage.sender_student_id == SessionStudent.id)
        .where(ChatMessage.session_id == sess_uuid)
        .order_by(ChatMessage.created_at.desc())
        .limit(80)
    )).all()
    if chat_rows:
        parts.append(f"Messaggi recenti della chat di sessione ({len(chat_rows)}):")
        for msg, student in reversed(chat_rows):
            sender = student.nickname if student else ("Docente" if msg.sender_type.value == "TEACHER" else "Sistema")
            timestamp = msg.created_at.strftime("%d/%m %H:%M") if msg.created_at else ""
            text = (msg.message_text or "").strip().replace("\n", " ")
            if text:
                parts.append(f"- [{timestamp}] {sender}: {text[:220]}")

    # Live interactions (sondaggi, MCQ, word wall, opinion, feedback)
    from app.models.live_interaction import LiveInteraction, LiveInteractionResponse
    li_rows = (await db.execute(
        select(LiveInteraction)
        .where(LiveInteraction.session_id == sess_uuid)
        .order_by(LiveInteraction.created_at.asc())
    )).scalars().all()
    if li_rows:
        parts.append(f"\nInterazioni live ({len(li_rows)}):")
        for li in li_rows:
            slides = li.slides_json or []
            parts.append(f"\n### Attività live: '{li.title}' | stato: {li.status} | slide: {len(slides)}")
            li_responses = (await db.execute(
                select(LiveInteractionResponse, SessionStudent.nickname)
                .join(SessionStudent, LiveInteractionResponse.student_id == SessionStudent.id)
                .where(LiveInteractionResponse.live_interaction_id == li.id)
                .order_by(LiveInteractionResponse.slide_index, LiveInteractionResponse.created_at)
            )).all()
            # Group by slide
            by_slide: dict[int, list] = {}
            for resp, nickname in li_responses:
                by_slide.setdefault(resp.slide_index, []).append((nickname, resp.response_json))
            for slide_idx in sorted(by_slide.keys()):
                slide_cfg = slides[slide_idx] if slide_idx < len(slides) else {}
                slide_type = slide_cfg.get("type", "unknown")
                slide_title = slide_cfg.get("question") or slide_cfg.get("prompt") or slide_cfg.get("title") or f"Slide {slide_idx + 1}"
                slide_responses = by_slide[slide_idx]
                parts.append(f"  Slide {slide_idx + 1} [{slide_type}] — {slide_title!r} ({len(slide_responses)} risposte):")
                for nickname, resp_json in slide_responses:
                    if isinstance(resp_json, dict):
                        answer = resp_json.get("answer") or resp_json.get("word") or resp_json.get("choice") or str(resp_json)
                    else:
                        answer = str(resp_json)
                    parts.append(f"    - {nickname}: {str(answer)[:200]}")

    return "\n".join(parts)


async def load_teacher_context(db: AsyncSession, teacher: User) -> tuple[str, dict]:
    """
    Load teacher's database context for analytics mode.
    Returns (formatted context string, structured context dict).
    """
    from app.models.task import Task, TaskSubmission
    from app.models.chat import ChatMessage

    # Load all teacher's data from database for context
    context_parts = []
    structured_context = {
        "classes": [],
        "active_sessions": [],
        "students": []
    }
    
    # 1. Get all classes
    classes_result = await db.execute(
        select(Class).where(Class.teacher_id == teacher.id)
    )
    classes = classes_result.scalars().all()
    
    if classes:
        context_parts.append("## LE TUE CLASSI:")
        for cls in classes:
            grade_label = f", grado: {cls.school_grade}" if getattr(cls, "school_grade", None) else ""
            context_parts.append(f"- **{cls.name}** (ID: {cls.id}{grade_label})")
            
            # Get sessions for this class
            sessions_result = await db.execute(
                select(Session).where(Session.class_id == cls.id)
            )
            sessions = sessions_result.scalars().all()
            
            for session in sessions:
                context_parts.append(f"  - Sessione: **{session.title}** (codice: {session.join_code}, stato: {session.status.value})")
                
                # Add to structured context
                structured_context["active_sessions"].append({
                    "id": str(session.id),
                    "title": session.title,
                    "class_name": cls.name,
                    "status": session.status.value
                })
                
                # Get students in this session
                students_result = await db.execute(
                    select(SessionStudent).where(SessionStudent.session_id == session.id)
                )
                students = students_result.scalars().all()
                
                if students:
                    student_names = [s.nickname for s in students]
                    context_parts.append(f"    - Studenti ({len(students)}): {', '.join(student_names)}")
                    
                    for s in students:
                        structured_context["students"].append({
                            "id": str(s.id),
                            "nickname": s.nickname,
                            "session_id": str(session.id),
                            "session_title": session.title
                        })
                
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
    return teacher_context, structured_context


@router.post("/teacher/chat")
async def teacher_chat(
    request: dict,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """Direct chat endpoint for teachers - includes real data from database"""
    content = request.get("content", "")
    history = request.get("history", [])
    profile_key = request.get("profile_key", "teacher_support")
    provider = request.get("provider")
    model = request.get("model")
    model = normalize_llm_model(provider, model)

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
    llm_messages = await _augment_teacher_messages_with_url_context(messages)

    try:
        # Load database context (used by analytics mode)
        context, structured_context = await load_teacher_context(db, teacher)
        ui_language = get_ui_language(http_request)

        if uses_agent:
            # NEW: Route to teacher agent for intelligent content generation
            from app.services.teacher_agent import run_teacher_agent

            llm_response_content = await run_teacher_agent(
                messages=llm_messages,
                context=context,
                structured_context=structured_context,
                provider=provider or "openai",
                model=model or DEFAULT_OPENAI_CHAT_MODEL,
                ui_language=ui_language,
            )

            return {
                "response": llm_response_content,
                "provider": provider or "openai",
                "model": model or DEFAULT_OPENAI_CHAT_MODEL,
                "prompt_tokens": 0,  # TODO: track token usage accurately
                "completion_tokens": 0,
            }
        else:
            # EXISTING: Use context-rich analytics approach for backward compatibility
            base_system_prompt = apply_output_language_instruction(profile["system_prompt"], ui_language)

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
                messages=llm_messages,
                system_prompt=system_prompt,
                provider=provider,
                model=model,
                temperature=temperature,
                max_tokens=1500,
            )

            cost = credit_service.calculate_cost_for_model(
                llm_response.provider, llm_response.model,
                llm_response.prompt_tokens, llm_response.completion_tokens,
            )
            await safe_track_usage(
                db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
                enrich_usage_with_environmental_impact(
                    {
                        "type": "teacher_chat",
                        "profile": profile_key,
                        "prompt_tokens": llm_response.prompt_tokens,
                        "completion_tokens": llm_response.completion_tokens,
                    },
                    provider=llm_response.provider,
                    model=llm_response.model,
                ),
                teacher_id=teacher.id,
                context="teacher_chat",
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


@router.post("/teacher/chat-stream")
async def teacher_chat_stream(
    request: dict,
    http_request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """
    Streaming teacher chat endpoint with real-time web search feedback.
    Returns Server-Sent Events (SSE) for progress updates.
    """
    content = request.get("content", "")
    history = request.get("history", [])
    provider = request.get("provider", "openai")
    model = request.get("model", DEFAULT_OPENAI_CHAT_MODEL)
    model = normalize_llm_model(provider, model) or DEFAULT_OPENAI_CHAT_MODEL
    agent_mode = request.get("agent_mode", "default")
    max_tokens = min(int(request.get("max_tokens", 4096)), 16000)
    ui_language = get_ui_language(http_request)

    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content required")

    # Build messages from history
    messages = []
    for msg in history:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })
    messages.append({"role": "user", "content": content})

    async def generate_stream():
        """Generator for SSE events"""
        from app.services.teacher_agent import (
            classify_intent,
            generate_with_web_search_streaming,
            generate_quiz_with_tools,
            generate_exercise_with_tools,
            generate_dataset,
            generate_with_analytics,
            TeacherIntent,
        )
        from app.services.web_search_service import web_search_service

        recent_user_text = "\n\n".join(
            str(msg.get("content") or "")
            for msg in messages[-16:]
            if msg.get("role") == "user"
        )
        if web_search_service.extract_urls(recent_user_text):
            yield f"data: {json.dumps({'type': 'status', 'message': '🔗 Lettura dei link in corso...'})}\n\n"
        llm_messages = await _augment_teacher_messages_with_url_context(messages)

        async def build_done_event(result_content: str, stream_type: str) -> str:
            if not result_content or not result_content.strip():
                raise RuntimeError("Il modello non ha restituito alcun contenuto")
            estimated_usage = enrich_usage_with_environmental_impact(
                build_estimated_token_usage(llm_messages, result_content),
                provider=provider,
                model=model,
            )
            estimated_cost = credit_service.calculate_cost_for_model(
                provider,
                model,
                int(estimated_usage.get("prompt_tokens") or 0),
                int(estimated_usage.get("completion_tokens") or 0),
            )
            await safe_track_usage(
                db, teacher.tenant_id, provider, model, estimated_cost,
                {
                    **estimated_usage,
                    "type": stream_type,
                    "agent_mode": agent_mode,
                },
                teacher_id=teacher.id,
                context=stream_type,
            )
            return json.dumps({
                "type": "done",
                "content": result_content,
                "provider": provider,
                "model": model,
                "token_usage": estimated_usage,
            })

        try:
            # If mode is "default" (chat), skip intent recognition — stream text directly
            if agent_mode == "default":
                import re as _re
                from datetime import date as _date, time as _time
                from app.services.llm_service import _needs_web_search
                from app.services.teacher_agent import generate_with_analytics_stream
                from app.models.calendar import SessionCalendarEvent as _CalEvent

                session_id_str = request.get("session_id")

                # Yield status immediately so NGINX/client know the connection is alive
                if _needs_web_search(llm_messages):
                    yield f"data: {json.dumps({'type': 'status', 'message': '🔍 Ricerca sul web in corso...'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'status', 'message': '💬 Elaborazione risposta...'})}\n\n"

                context, _ = await load_teacher_context(db, teacher)

                # If a session is active, prepend live session metrics to context
                if session_id_str:
                    session_ctx = await load_session_context(db, session_id_str, teacher)
                    if session_ctx:
                        context = session_ctx + "\n\n---\n\n" + context

                # Build datetime-aware calendar addendum
                now = datetime.now()
                _days_it = ["lunedì","martedì","mercoledì","giovedì","venerdì","sabato","domenica"]
                _months_it = ["gennaio","febbraio","marzo","aprile","maggio","giugno",
                              "luglio","agosto","settembre","ottobre","novembre","dicembre"]
                now_str = f"{_days_it[now.weekday()]} {now.day} {_months_it[now.month-1]} {now.year}, ore {now.strftime('%H:%M')}"
                cal_addendum = f"\n\n---\nData e ora attuali (server): {now_str}.\n"
                if session_id_str:
                    cal_addendum += (
                        "Se il docente chiede di creare un evento in calendario, "
                        "al termine della risposta includi questo blocco e nient'altro:\n"
                        "<CALENDAR_EVENT>{\"title\": \"Titolo\", \"event_date\": \"YYYY-MM-DD\", "
                        "\"event_time\": \"HH:MM\", \"color\": \"#6366f1\"}</CALENDAR_EVENT>\n"
                        "Calcola le date relative (es. 'domani', 'lunedì prossimo') dalla data attuale.\n"
                        "Includi il tag SOLO se ti viene chiesto esplicitamente di creare un evento."
                    )

                full_content = ''
                async for chunk in generate_with_analytics_stream(
                    llm_messages, context + cal_addendum, provider, model,
                    custom_system_prompt=teacher.support_chat_system_prompt or None,
                    ui_language=ui_language,
                    max_tokens=max_tokens,
                ):
                    full_content += chunk
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

                # Extract and execute CALENDAR_EVENT actions
                _cal_pat = _re.compile(r'<CALENDAR_EVENT>(.*?)</CALENDAR_EVENT>', _re.DOTALL)
                _matches = _cal_pat.findall(full_content)
                clean_content = _cal_pat.sub('', full_content).strip()

                for _m in _matches:
                    try:
                        evt = json.loads(_m.strip())
                        if not evt.get('event_date') or not session_id_str:
                            continue
                        _sess = (await db.execute(
                            select(Session).where(Session.id == UUID(session_id_str))
                        )).scalar_one_or_none()
                        if not _sess or _sess.tenant_id != teacher.tenant_id:
                            continue
                        _ev_time = _time.fromisoformat(evt['event_time']) if evt.get('event_time') else None
                        _new_ev = _CalEvent(
                            session_id=UUID(session_id_str),
                            tenant_id=teacher.tenant_id,
                            created_by_teacher_id=teacher.id,
                            title=str(evt.get('title', 'Evento'))[:200],
                            description=evt.get('description'),
                            event_date=_date.fromisoformat(evt['event_date']),
                            event_time=_ev_time,
                            color=str(evt.get('color', '#6366f1')),
                        )
                        db.add(_new_ev)
                        await db.flush()
                        await db.commit()
                        yield f"data: {json.dumps({'type': 'calendar_event_created', 'event': {'id': str(_new_ev.id), 'title': _new_ev.title, 'event_date': str(_new_ev.event_date), 'event_time': str(_new_ev.event_time) if _new_ev.event_time else None, 'color': _new_ev.color}})}\n\n"
                    except Exception as _exc:
                        logging.warning(f"Failed to create calendar event from chat: {_exc}")

                if not clean_content and _matches:
                    clean_content = "Ho elaborato la richiesta relativa al calendario."

                yield f"data: {await build_done_event(clean_content, 'teacher_chat_stream_default')}\n\n"
                return

            # Step 1: Classify intent (only for non-default modes)
            yield f"data: {json.dumps({'type': 'status', 'message': '🧠 Analisi della richiesta...'})}\n\n"
            forced_mode_intents = {
                "web_search": TeacherIntent.WEB_SEARCH,
                "quiz": TeacherIntent.QUIZ_GENERATION,
                "exercise": TeacherIntent.EXERCISE_GENERATION,
                "dataset": TeacherIntent.DATASET_GENERATION,
                "report": TeacherIntent.REPORT_GENERATION,
            }

            if agent_mode in forced_mode_intents:
                intent_result = type("ForcedIntentResult", (), {
                    "intent": forced_mode_intents[agent_mode],
                    "confidence": 1.0,
                })()
            else:
                intent_result = await classify_intent(content, history)

            yield f"data: {json.dumps({'type': 'intent', 'intent': intent_result.intent.value, 'confidence': intent_result.confidence})}\n\n"

            # Step 2: Route based on intent
            if intent_result.intent == TeacherIntent.WEB_SEARCH:
                # Web search removed — fall through to analytics/generic response
                context, _ = await load_teacher_context(db, teacher)
                from app.services.teacher_agent import generate_with_analytics
                result = await generate_with_analytics(llm_messages, context, provider, model, ui_language=ui_language)
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_web_fallback')}\n\n"

            elif intent_result.intent == TeacherIntent.QUIZ_GENERATION:
                yield f"data: {json.dumps({'type': 'status', 'message': '❓ Modalità: Generazione Quiz'})}\n\n"
                yield f"data: {json.dumps({'type': 'status', 'message': '⏳ Creazione domande...'})}\n\n"

                result = await generate_quiz_with_tools(llm_messages, provider, model)
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_quiz')}\n\n"

            elif intent_result.intent == TeacherIntent.EXERCISE_GENERATION:
                yield f"data: {json.dumps({'type': 'status', 'message': '💪 Modalità: Generazione Esercizio'})}\n\n"
                yield f"data: {json.dumps({'type': 'status', 'message': '⏳ Creazione esercizio...'})}\n\n"

                result = await generate_exercise_with_tools(llm_messages, provider, model)
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_exercise')}\n\n"

            elif intent_result.intent == TeacherIntent.DATASET_GENERATION:
                yield f"data: {json.dumps({'type': 'status', 'message': '📊 Modalità: Generazione Dataset'})}\n\n"
                yield f"data: {json.dumps({'type': 'status', 'message': '⏳ Creazione dataset CSV...'})}\n\n"

                result = await generate_dataset(llm_messages, provider, model)
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_dataset')}\n\n"

            elif intent_result.intent == TeacherIntent.REPORT_GENERATION:
                yield f"data: {json.dumps({'type': 'status', 'message': '📊 Modalità: Generazione Report'})}\n\n"

                from app.services.teacher_agent import generate_report_widgets
                import re as _re
                full_ctx, structured_context = await load_teacher_context(db, teacher)
                report_context = full_ctx
                session_uuid_match = _re.search(r"\(([0-9a-f]{8}-[0-9a-f-]{27})\)", content, _re.IGNORECASE)
                if session_uuid_match:
                    selected_session_ctx = await load_session_context(db, session_uuid_match.group(1), teacher)
                    if selected_session_ctx:
                        report_context = selected_session_ctx
                result = await generate_report_widgets(
                    content, structured_context,
                    full_context=report_context, messages=llm_messages,
                    provider=provider, model=model,
                )
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_report')}\n\n"

            elif intent_result.intent == TeacherIntent.ACTION_MENU:
                yield f"data: {json.dumps({'type': 'status', 'message': '📋 Apertura Menu Azioni'})}\n\n"
                
                from app.services.teacher_agent import generate_action_menu_widget
                result = await generate_action_menu_widget()
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_action_menu')}\n\n"

            else:
                yield f"data: {json.dumps({'type': 'status', 'message': '📊 Modalità: Analytics'})}\n\n"
                yield f"data: {json.dumps({'type': 'status', 'message': '⏳ Elaborazione risposta...'})}\n\n"

                context, _ = await load_teacher_context(db, teacher)
                result = await generate_with_analytics(llm_messages, context, provider, model, ui_language=ui_language)
                yield f"data: {await build_done_event(result, 'teacher_chat_stream_analytics')}\n\n"

        except Exception as e:
            logger.error(f"Streaming error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/teacher/chat-with-files")
async def teacher_chat_with_files(
    content: str = Form(...),
    history: str = Form("[]"),
    profile_key: str = Form("teacher_support"),
    provider: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    files: list[UploadFile] = File([]),
    http_request: Request = None,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """Teacher chat endpoint with file upload support (advanced multi-step processing)."""
    MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per file

    # Parse history from JSON string
    try:
        parsed_history = json.loads(history)
    except Exception:
        parsed_history = []

    # Process uploaded files with the advanced document processor
    file_extracts: list[str] = []
    for file in files:
        file_data = await file.read()
        file_name = file.filename or "document"
        file_type = file.content_type or "application/octet-stream"

        if len(file_data) > MAX_FILE_BYTES:
            file_extracts.append(f"\n[File troppo grande: {file_name}]\n")
            continue

        try:
            fn_lower = file_name.lower()
            is_spreadsheet = (
                fn_lower.endswith((".xlsx", ".xls", ".csv"))
                or "spreadsheet" in file_type
                or "excel" in file_type
                or file_type in ("text/csv", "application/csv")
            )
            analysis = await document_processor.process(
                file_bytes=file_data,
                filename=file_name,
                mime_type=file_type,
                # Skip LLM-based summarisation for spreadsheets — the raw
                # structured extract is already informative and the extra LLM
                # call makes the request too slow / too large.
                llm_service=None if is_spreadsheet else llm_service,
                analyze_visuals=not is_spreadsheet,
            )
            file_extracts.append(analysis.structured_extract)
            logger.info(
                "Teacher doc processed: %s | steps: %s",
                file_name,
                analysis.processing_steps,
            )
        except Exception as e:
            logger.error(f"Document processing error for {file_name}: {e}")
            file_extracts.append(f"\n[Errore elaborazione {file_name}: {e}]\n")

    # Combine user message with processed file extracts
    full_content = content
    if file_extracts:
        full_content += (
            "\n\n--- DOCUMENTI ELABORATI ---\n"
            + "\n\n".join(file_extracts)
            + "\n--- FINE DOCUMENTI ---\n"
        )

    # Get chatbot profile
    profile = get_profile(profile_key)
    base_system_prompt = apply_output_language_instruction(
        profile["system_prompt"],
        get_ui_language(http_request),
    )

    # Build messages
    messages = []
    for msg in parsed_history:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })
    messages.append({"role": "user", "content": full_content})
    llm_messages = await _augment_teacher_messages_with_url_context(messages)

    temperature = profile.get("temperature", 0.7)

    try:
        llm_response = await llm_service.generate(
            messages=llm_messages,
            system_prompt=base_system_prompt,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=1500,
        )

        cost = credit_service.calculate_cost_for_model(
            llm_response.provider,
            llm_response.model,
            llm_response.prompt_tokens,
            llm_response.completion_tokens,
        )
        await safe_track_usage(
            db, teacher.tenant_id, llm_response.provider, llm_response.model, cost,
            enrich_usage_with_environmental_impact(
                {
                    "type": "teacher_chat_with_files",
                    "profile": profile_key,
                    "file_count": len(files),
                    "prompt_tokens": llm_response.prompt_tokens,
                    "completion_tokens": llm_response.completion_tokens,
                },
                provider=llm_response.provider,
                model=llm_response.model,
            ),
            teacher_id=teacher.id,
            context="teacher_chat_with_files",
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


@router.post("/documents/analyze")
async def analyze_document(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    ingest_to_rag: bool = Form(False),
):
    """
    Multi-step document analysis endpoint.

    Extracts text, detects visual content (charts/graphs), runs vision analysis,
    and returns a structured extract ready to inject into chat context.

    Optionally ingests the document to the RAG pipeline for semantic search
    (requires a valid session_id and an existing RAGDocument record).
    """
    from app.services.rag_service import rag_service as _rag_service
    from app.models.rag import RAGDocument
    from app.models.enums import DocumentStatus

    file_bytes = await file.read()
    filename = file.filename or "document"
    mime_type = file.content_type or "application/octet-stream"

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    MAX_BYTES = 20 * 1024 * 1024
    if len(file_bytes) > MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_BYTES // 1024 // 1024} MB)")

    try:
        analysis = await document_processor.process(
            file_bytes=file_bytes,
            filename=filename,
            mime_type=mime_type,
            llm_service=llm_service,
            analyze_visuals=True,
        )
    except Exception as e:
        logger.error(f"Document analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Document processing failed: {e}")

    result = {
        "filename": analysis.filename,
        "mime_type": analysis.mime_type,
        "page_count": analysis.page_count,
        "summary": analysis.summary,
        "key_concepts": analysis.key_concepts,
        "entities": analysis.entities,
        "has_visual_content": analysis.has_visual_content,
        "visual_descriptions": analysis.visual_descriptions,
        "structured_extract": analysis.structured_extract,
        "processing_steps": analysis.processing_steps,
        "rag_ingested": False,
        "rag_chunk_count": 0,
    }

    # Optional RAG ingestion
    if ingest_to_rag and session_id:
        try:
            session_uuid = UUID(session_id)
            tenant_id = auth.teacher.tenant_id if auth.is_teacher else auth.student.tenant_id

            # Find an existing QUEUED RAGDocument for this session + filename
            rag_doc_result = await db.execute(
                select(RAGDocument)
                .where(RAGDocument.session_id == session_uuid)
                .where(RAGDocument.title == filename)
                .where(RAGDocument.status == DocumentStatus.QUEUED)
                .order_by(RAGDocument.created_at.desc())
                .limit(1)
            )
            rag_doc = rag_doc_result.scalar_one_or_none()

            if rag_doc:
                content_for_rag = analysis.rag_segments or analysis.structured_extract or analysis.raw_text
                chunk_count = await _rag_service.ingest_document(db, rag_doc, content_for_rag)
                result["rag_ingested"] = True
                result["rag_chunk_count"] = chunk_count
        except Exception as e:
            logger.warning(f"RAG ingestion skipped: {e}")

    return result


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


class YoutubeTranscriptRequest(BaseModel):
    url: str


@router.post("/youtube/transcript")
async def get_youtube_transcript(
    request: YoutubeTranscriptRequest,
    current_user: User = Depends(get_current_teacher),
):
    """Fetch transcript and metadata for a YouTube video."""
    import re
    import httpx

    url = request.url.strip()
    match = re.search(
        r'(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})',
        url
    )
    if not match:
        raise HTTPException(status_code=400, detail="URL YouTube non valido")

    video_id = match.group(1)

    # Fetch title via oembed (no API key required)
    title: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            )
            if resp.status_code == 200:
                title = resp.json().get("title")
    except Exception:
        pass

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import (
            NoTranscriptFound, TranscriptsDisabled, VideoUnavailable
        )

        def _fetch():
            api = YouTubeTranscriptApi()
            try:
                fetched = api.fetch(video_id, languages=['it', 'en', 'en-US', 'en-GB'])
            except NoTranscriptFound:
                # Fallback: find any available transcript
                transcript_list = api.list(video_id)
                fetched = transcript_list.find_a_transcript(['it', 'en']).fetch()
            return fetched

        fetched = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        snippets = list(fetched)
        full_text = ' '.join(s.text for s in snippets)
        last = snippets[-1] if snippets else None
        duration = int(last.start + last.duration) if last else 0

        return {
            "video_id": video_id,
            "title": title,
            "transcript": full_text,
            "duration_seconds": duration,
        }
    except TranscriptsDisabled:
        raise HTTPException(status_code=422, detail="I trascritti sono disabilitati per questo video")
    except VideoUnavailable:
        raise HTTPException(status_code=422, detail="Video non disponibile o privato")
    except NoTranscriptFound:
        raise HTTPException(status_code=422, detail="Nessun trascritto disponibile per questo video")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Impossibile ottenere il trascritto: {str(exc)}")


class CompileLatexRequest(BaseModel):
    content: str
    filename: str = "dispensa"


@router.post("/compile-latex")
async def compile_latex(
    request: CompileLatexRequest,
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Compile a LaTeX document to PDF using pdflatex."""
    import subprocess
    import tempfile
    import shutil
    import os

    # Check pdflatex is available
    pdflatex_path = shutil.which("pdflatex")
    if not pdflatex_path:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pdflatex non disponibile sul server. Contatta l'amministratore per installare TeXLive."
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        tex_file = os.path.join(tmpdir, "document.tex")
        pdf_file = os.path.join(tmpdir, "document.pdf")

        # Write LaTeX content
        with open(tex_file, "w", encoding="utf-8") as f:
            f.write(request.content)

        # Run pdflatex twice (for TOC/refs)
        for _ in range(2):
            result = subprocess.run(
                [pdflatex_path, "-interaction=nonstopmode", "-output-directory", tmpdir, tex_file],
                capture_output=True,
                timeout=60,
            )

        if not os.path.exists(pdf_file):
            stdout = (result.stdout or b"").decode("latin-1", errors="replace")
            stderr = (result.stderr or b"").decode("latin-1", errors="replace")
            log_output = (stdout + "\n" + stderr)[-4000:] if (stdout or stderr) else "nessun output"
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Compilazione LaTeX fallita. Log:\n{log_output}"
            )

        with open(pdf_file, "rb") as f:
            pdf_bytes = f.read()

    safe_name = "".join(c for c in request.filename if c.isalnum() or c in "_-") or "dispensa"
    from fastapi.responses import Response
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )


class HtmlPageEditRequest(BaseModel):
    html: str
    modification: str


@router.post("/html-page/edit")
async def edit_html_page(
    request: HtmlPageEditRequest,
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """
    Edit an interactive HTML page using tool-calling (no free-text parsing).
    Claude is forced to call the edit_page tool with typed CSS/HTML/JS parameters,
    which are then applied deterministically with regex — no LLM output parsing.
    """
    import re

    client = llm_service.anthropic_client
    if not client:
        raise HTTPException(status_code=500, detail="Anthropic client non configurato")

    tools = [{
        "name": "edit_page",
        "description": (
            "Modifica la pagina HTML interattiva. Specifica solo le sezioni che devono cambiare. "
            "Ogni campo deve contenere il contenuto COMPLETO della sezione aggiornata."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "css": {
                    "type": "string",
                    "description": "Contenuto completo aggiornato del blocco <style> (senza il tag <style>/</ style>)"
                },
                "html_body": {
                    "type": "string",
                    "description": "Contenuto completo aggiornato del <body> esclusi gli script (senza il tag <body>/</ body>)"
                },
                "js": {
                    "type": "string",
                    "description": "Contenuto completo aggiornato del blocco <script> principale (senza il tag <script>/</ script>)"
                }
            }
        }
    }]

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8096,
        tools=tools,
        tool_choice={"type": "tool", "name": "edit_page"},
        system=(
            "Sei un editor HTML esperto. Modifica la pagina applicando solo i cambiamenti necessari. "
            "Usa il tool edit_page specificando solo le sezioni che cambiano. "
            "Ogni sezione deve essere il contenuto COMPLETO aggiornato di quel blocco."
        ),
        messages=[{
            "role": "user",
            "content": (
                f"Pagina HTML corrente:\n\n{request.html}\n\n"
                f"Modifica richiesta: {request.modification}"
            )
        }]
    )

    tool_block = next(
        (b for b in response.content if getattr(b, "type", None) == "tool_use" and b.name == "edit_page"),
        None
    )
    if not tool_block:
        raise HTTPException(status_code=422, detail="Nessuna modifica generata dal modello")

    params = tool_block.input
    result_html = request.html

    css = params.get("css")
    if css:
        if re.search(r"<style[^>]*>", result_html, re.IGNORECASE):
            result_html = re.sub(
                r"<style[^>]*>[\s\S]*?</style>",
                f"<style>\n{css}\n</style>",
                result_html,
                flags=re.IGNORECASE,
            )
        else:
            result_html = result_html.replace("</head>", f"<style>\n{css}\n</style>\n</head>")

    js = params.get("js")
    if js:
        script_matches = list(re.finditer(r"<script(?:\s[^>]*)?>[\s\S]*?</script>", result_html, re.IGNORECASE))
        if script_matches:
            last = script_matches[-1]
            result_html = result_html[:last.start()] + f"<script>\n{js}\n</script>" + result_html[last.end():]
        else:
            result_html = result_html.replace("</body>", f"<script>\n{js}\n</script>\n</body>")

    html_body = params.get("html_body")
    if html_body:
        def _replace_body(m: re.Match) -> str:
            return f"{m.group(1)}\n{html_body}\n{m.group(3)}"
        result_html = re.sub(
            r"(<body[^>]*>)([\s\S]*?)(<script|\s*</body>)",
            _replace_body,
            result_html,
            flags=re.IGNORECASE,
        )

    return {"html": result_html}


class BrochureEditRequest(BaseModel):
    payload: dict  # BrochurePayload as dict
    modification: str


@router.post("/brochure/edit")
async def edit_brochure(
    request: BrochureEditRequest,
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    """
    Edit a brochure payload using tool-calling.
    Claude returns only the fields that need to change; they are merged with the original.
    """
    client = llm_service.anthropic_client
    if not client:
        raise HTTPException(status_code=500, detail="Anthropic client non configurato")

    tools = [{
        "name": "edit_brochure",
        "description": (
            "Modifica la brochure. Specifica SOLO i campi che devono cambiare rispetto all'originale. "
            "I campi non specificati restano invariati. "
            "Per array (keyPoints, features, benefits, steps, stats, faq) fornisci l'intero array aggiornato."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "subtitle": {"type": "string"},
                "palette": {"type": "array", "items": {"type": "string"}, "description": "Fino a 5 colori hex"},
                "heroBadge": {"type": "string"},
                "heroAccent": {"type": "string"},
                "heroDescription": {"type": "string"},
                "ctaPrimary": {"type": "string"},
                "ctaSecondary": {"type": "string"},
                "overviewTitle": {"type": "string"},
                "overviewLead": {"type": "string"},
                "keyPoints": {"type": "array", "items": {"type": "string"}},
                "features": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "icon": {"type": "string"},
                            "title": {"type": "string"},
                            "description": {"type": "string"}
                        }
                    }
                },
                "benefits": {"type": "array", "items": {"type": "string"}},
                "steps": {"type": "array", "items": {"type": "string"}},
                "stats": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "label": {"type": "string"},
                            "description": {"type": "string"}
                        }
                    }
                },
                "faq": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string"},
                            "answer": {"type": "string"}
                        }
                    }
                },
                "closingTitle": {"type": "string"},
                "closingText": {"type": "string"},
                "closingQuote": {"type": "string"},
                "closingAuthor": {"type": "string"},
            }
        }
    }]

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        tools=tools,
        tool_choice={"type": "tool", "name": "edit_brochure"},
        system=(
            "Sei un editor di contenuti per brochure. "
            "Applica la modifica richiesta specificando SOLO i campi che cambiano. "
            "Non toccare i campi che non richiedono modifiche."
        ),
        messages=[{
            "role": "user",
            "content": (
                f"Brochure attuale (JSON):\n\n{request.payload}\n\n"
                f"Modifica richiesta: {request.modification}"
            )
        }]
    )

    tool_block = next(
        (b for b in response.content if getattr(b, "type", None) == "tool_use" and b.name == "edit_brochure"),
        None
    )
    if not tool_block:
        raise HTTPException(status_code=422, detail="Nessuna modifica generata dal modello")

    # Merge: original payload + only the changed fields from the tool call
    merged = {**request.payload, **tool_block.input}
    return {"payload": merged}
