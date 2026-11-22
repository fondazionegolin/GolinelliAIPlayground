"""Agentic hand-off from the chatbots to the platform's own tools.

The Decisions router (``tool_router``) recognises that a chat message is really a request for one of the
platform sections ("crea una presentazione", "voglio un progetto p5.js", "un classificatore delle mie
espressioni"). Instead of improvising the artifact inside the chat, the chat calls :func:`plan_handoff`, which

1. checks the destination is allowed for this user - for students the teacher can switch modules off per session,
   so the check runs here, on the server, against ``session_modules``;
2. asks a small model for a first interpretation of the request: a short summary, a cleaned-up brief for the
   destination editor and a few destination-specific hints (project type, class names, ...);
3. (teachers) stores the resulting card in the conversation so it survives a reload.

The frontend turns the answer into an "Apri in ..." card; the destination reads the brief on arrival
(``lib/platformHandoff.ts``).
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher
from app.models.llm import TeacherConversation, TeacherConversationMessage
from app.models.session import SessionModule
from app.services import model_roles
from app.services.credit_service import credit_service
from app.services.json_extract import extract_json
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

# Modules every student always has (see StudentNavbar ALWAYS_SHOWN): they cannot be switched off.
ALWAYS_ON = {"chatbot", "documents", "files"}


@dataclass(frozen=True)
class Destination:
    id: str  # also the artifact value the router returns
    label: str
    router_hint: str  # what the Decisions router reads to recognise the intent
    teacher_route: Optional[str]  # None = students only
    student_module: Optional[str]  # SessionModule key / student dashboard module; None = teachers only
    hints: str = ""  # what the planner should extract for this destination
    variant: Optional[str] = None  # sub-kind of the destination (notebook project type, ML mode, document kind)
    needs_session: bool = False  # the teacher route requires an active session


DESTINATIONS: dict[str, Destination] = {d.id: d for d in [
    Destination("presentation", "Presentation Studio", "A slide deck / PowerPoint-style presentation.",
                "/teacher/documents", "documents", variant="presentation",
                hints='"topic": argomento e taglio della presentazione in una frase, con pubblico e durata se indicati.'),
    Destination("document", "Editor documenti", "A text document to write (relazione, lettera, verbale, scheda, programma, appunti) to open in the document editor, not a one-off chat answer.",
                "/teacher/documents", "documents", variant="document",
                hints='"topic": che documento scrivere, per chi e con quali sezioni.'),
    Destination("spreadsheet", "Editor tabelle", "A spreadsheet / Excel table / foglio di calcolo (registro, tabella voti, budget, calcoli).",
                "/teacher/documents", "documents", variant="sheet",
                hints='"topic": che tabella costruire: colonne, righe, formule attese.'),
    Destination("p5js_project", "Notebook · p5.js", "A creative-coding / p5.js sketch project: animation, generative art, visual sketch, simple 2D game made with p5.js.",
                "/teacher/notebooks", "notebook", variant="p5js",
                hints='"topic": che sketch creare (cosa si vede, interazioni, parametri); "title": titolo breve del progetto.'),
    Destination("python_notebook", "Notebook · Python", "A Python notebook project to write and run Python code (exercises, data analysis, scripts).",
                "/teacher/notebooks", "notebook", variant="python",
                hints='"topic": cosa deve fare il notebook Python; "title": titolo breve.'),
    Destination("microbit_project", "Notebook · micro:bit", "A micro:bit project (MicroPython on the board, sensors, LED matrix, buttons).",
                "/teacher/notebooks", "notebook", variant="microbit",
                hints='"topic": cosa deve fare il programma micro:bit; "title": titolo breve.'),
    Destination("vibe_lab", "Vibe Lab", "A real software project to be built with AI: a multi-section website, a web app, a landing page with several pieces of information, a tool with logic. More substantial than a single interactive page.",
                "/teacher/coding", "coding", needs_session=True,
                hints='"topic": brief del progetto software (scopo, sezioni, contenuti, stile); "title": nome breve del progetto. '
                      'Per Vibe Lab il "brief" è un METAPROMPT: esplodi la richiesta in una specifica ricca e ben strutturata, in italiano, con sezioni brevi: '
                      'Obiettivo e pubblico (età, livello); Funzionalità e interazioni richieste, una per riga, anche quelle implicite ma necessarie; '
                      'Contenuti e correttezza dei dati/dominio (valori reali, formule, vincoli scientifici o tecnici); Tecnologie (usa quelle indicate, es. three.js); '
                      'Interfaccia e controlli (cosa vede e può fare l\'utente); Stile grafico e tono; Criteri di qualità (fluidità, responsive, nessun errore). '
                      'Mantieni tutto ciò che l\'utente ha chiesto, aggiungi solo dettagli coerenti, niente codice. Lunghezza 1500-3000 caratteri.'),
    Destination("ml_lab", "Lab ML", "A machine-learning classifier trained in the browser from webcam/photos: image classifier, body-pose classifier, hand-gesture classifier, facial-expression recognition.",
                "/teacher/ml-lab", "classification", variant="image",
                hints='"mode": uno tra "image" (oggetti/immagini), "pose" (posture del corpo), "hand" (gesti delle mani), "face" (espressioni del viso); "name": nome del progetto; "classes": da 2 a 6 nomi delle classi da riconoscere.'),
    Destination("models3d", "3D Lab", "A 3D object to model by hand with solids (CAD-like): Tinkercad-style modelling, printable parts.",
                "/teacher/3d-lab", "models3d", hints='"topic": che oggetto 3D modellare.'),
    Destination("models3d_ai", "AI 3D", "A 3D model generated by AI from a text description or an image.",
                "/teacher/ai-3d", "models3d_ai", hints='"topic": descrizione dell\'oggetto 3D da generare.'),
    Destination("dataflow", "Dataflow Studio", "A data workflow: load a table, transform it, chart it, train a model by connecting nodes; agentic workflows and bots with steps.",
                "/teacher/agentic/new", "dataflow", needs_session=False,
                hints='"topic": che flusso di dati o agente costruire.'),
    Destination("smart_canvas", "Lavagne intelligenti", "A smart whiteboard / canvas to draw, sketch concept maps and think visually with an assistant.",
                "/teacher/smart-canvas", "smart_canvas", hints='"topic": cosa deve contenere la lavagna.'),
    Destination("boards", "Board", "A planning board (Kanban / Scrum backlog) to organise tasks and ideas.",
                "/teacher/boards", "boards", hints='"topic": per cosa serve la board.'),
    Destination("video_studio", "Video Studio", "A video to produce with AI (shots, scenes, clips, storyboard).",
                "/teacher/video-studio", None, hints='"topic": che video produrre.'),
    Destination("audio_lab", "Audio Lab", "Music, a jingle, a voice-over or audio to produce with AI.",
                "/teacher/audio-lab", None, hints='"kind": "voice" se serve un parlato/voce narrante da un testo, "music" se serve un brano/jingle musicale; "topic": per la musica stile, mood e strumentazione; per la voce il testo da leggere se è breve.'),
    Destination("live_interaction", "Interazione live", "A live interaction for the classroom: poll, word wall, MCQ or feedback slides shown to the students in real time.",
                "/teacher/live-interaction", None, hints='"topic": che interazione live preparare.'),
]}

# Handoffs that exist for students (module key -> destination ids that live in it).
STUDENT_DESTINATIONS = {d.id for d in DESTINATIONS.values() if d.student_module}
TEACHER_DESTINATIONS = {d.id for d in DESTINATIONS.values() if d.teacher_route}


def router_choices(audience: str) -> list[dict[str, str]]:
    """Router choices (value + description) for one audience."""
    ids = STUDENT_DESTINATIONS if audience == "student" else TEACHER_DESTINATIONS
    return [{"value": d.id, "description": d.router_hint} for d in DESTINATIONS.values() if d.id in ids and d.id != "presentation"]


async def enabled_student_modules(db: AsyncSession, session_id: uuid.UUID) -> set[str]:
    rows = await db.scalars(select(SessionModule.module_key).where(
        SessionModule.session_id == session_id, SessionModule.is_enabled == True))  # noqa: E712
    return set(rows.all()) | ALWAYS_ON


async def active_modules_text(db: AsyncSession, actor: StudentOrTeacher) -> str:
    """Prompt-ready list of the sections this user can really open (used to ground chat answers)."""
    if actor.is_teacher:
        names = [d.label for d in DESTINATIONS.values() if d.teacher_route]
        return "Sezioni della piattaforma disponibili: " + ", ".join(dict.fromkeys(names)) + "."
    enabled = await enabled_student_modules(db, actor.student.session_id)
    on = [d.label for d in DESTINATIONS.values() if d.student_module in enabled]
    off = [d.label for d in DESTINATIONS.values() if d.student_module and d.student_module not in enabled]
    return ("Sezioni attive per questo studente: " + ", ".join(dict.fromkeys(on)) + ". "
            "Sezioni DISATTIVATE dal docente (non proporle): " + (", ".join(dict.fromkeys(off)) or "nessuna") + ".")


PLANNER_SYSTEM = """Sei l'assistente agentico di una piattaforma didattica. L'utente ha chiesto qualcosa che si fa in una sezione dedicata
della piattaforma ({label}). Non devi svolgere il lavoro: prepari il passaggio alla sezione, che compilerà da sola i suoi campi con ciò che scrivi.
Rispondi SOLO con un oggetto JSON con queste chiavi:
- "summary": 2-4 frasi nella lingua dell'utente (sul modo di dire "ho capito che..."): che cosa creerai, tipo di progetto e 2-3 scelte iniziali
  sensate dedotte dalla richiesta (struttura, funzioni, stile). Niente codice, niente elenchi lunghi, niente promesse su ciò che non sai.
- "title": titolo breve del progetto (max 60 caratteri).
- "brief": la richiesta riscritta in modo completo e autosufficiente per la sezione di destinazione, nella lingua dell'utente, senza saluti.
  Deve contenere TUTTE le indicazioni concrete date dall'utente (argomento, pubblico, durata, tono, stile, numeri, vincoli, nomi) e quelle
  rilevanti emerse dalla conversazione o dai documenti. Non accorciare né generalizzare: se la richiesta è già completa, riportala quasi alla lettera.
- "source_use": quale testo già esistente la sezione deve ricevere INTEGRALMENTE come materiale di partenza (non riassunto):
  "assistant" se l'utente si riferisce al testo che l'assistente ha appena scritto in chat (sceneggiatura, bozza, copione, elenco...),
  "materials" se si riferisce ai documenti allegati, "both" per entrambi, "none" se non c'è nulla da portare oltre al brief.
- chiavi specifiche della sezione: {hints}
Non inventare dati che l'utente non ha dato. Se un'informazione manca, scegli un default ragionevole e dichiaralo nel riassunto."""

MAX_SOURCE = 20000


def _planner_context(history: list[dict], materials: list[dict]) -> str:
    """Conversation + attachments the planner reads: the last turns long enough to carry real instructions."""
    parts: list[str] = []
    turns = history[-6:]
    lines = []
    for index, m in enumerate(turns):
        limit = 6000 if index >= len(turns) - 2 else 1200
        lines.append(f"{str(m.get('role', 'user')).upper()}: {str(m.get('content') or '')[:limit]}")
    if lines:
        parts.append("CONVERSAZIONE RECENTE:\n" + "\n\n".join(lines))
    for material in materials[:5]:
        parts.append(f"DOCUMENTO ALLEGATO «{str(material.get('name') or 'documento')[:80]}»:\n{str(material.get('text') or '')[:6000]}")
    return "\n\n".join(parts) + "\n\n" if parts else ""


def _source_text(use: str, history: list[dict], materials: list[dict]) -> str:
    """The text handed over verbatim: picked by the planner but copied by code, so the model never paraphrases or truncates it."""
    chunks: list[str] = []
    if use in {"assistant", "both"}:
        last = next((str(m.get("content") or "").strip() for m in reversed(history) if m.get("role") == "assistant" and len(str(m.get("content") or "").strip()) > 200), "")
        if last:
            chunks.append(last)
    if use in {"materials", "both"}:
        for material in materials[:5]:
            text = str(material.get("text") or "").strip()
            if text:
                chunks.append(f"### {str(material.get('name') or 'Documento')[:80]}\n{text}" if len(materials) > 1 else text)
    return "\n\n".join(chunks)[:MAX_SOURCE]


async def _plan_with_llm(db: AsyncSession, actor: StudentOrTeacher, dest: Destination, prompt: str, history: list[dict], materials: list[dict]) -> dict[str, Any]:
    context = _planner_context(history, materials)
    messages = [{"role": "user", "content": f"{context}RICHIESTA:\n{prompt[:4000]}"}]
    provider, model = model_roles.provider_for("chat.fast"), model_roles.model_for("chat.fast")
    response = await llm_service.generate(
        messages=messages, system_prompt=PLANNER_SYSTEM.format(label=dest.label, hints=dest.hints or '"topic": sintesi della richiesta.'),
        provider=provider, model=model, temperature=0.2, max_tokens=4500, allow_web_search=False)
    try:
        if actor.is_student:
            student = actor.student
            await credit_service.track_usage(
                db, student.tenant_id, response.provider, response.model,
                credit_service.calculate_cost_for_model(response.provider, response.model, response.prompt_tokens or 0, response.completion_tokens or 0),
                {"type": "platform_handoff", "prompt_tokens": response.prompt_tokens, "completion_tokens": response.completion_tokens},
                session_id=student.session_id, student_id=student.id)
        else:
            teacher = actor.teacher
            await credit_service.track_usage(
                db, teacher.tenant_id, response.provider, response.model,
                credit_service.calculate_cost_for_model(response.provider, response.model, response.prompt_tokens or 0, response.completion_tokens or 0),
                {"type": "platform_handoff", "prompt_tokens": response.prompt_tokens, "completion_tokens": response.completion_tokens},
                teacher_id=teacher.id)
    except Exception:
        logger.exception("platform handoff: credit tracking failed")
    data = extract_json(response.content or "")
    return data if isinstance(data, dict) else {}


def _clean_classes(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    names = [str(v).strip()[:40] for v in value if str(v).strip()]
    return list(dict.fromkeys(names))[:6]


def _hints(dest: Destination, data: dict[str, Any]) -> dict[str, Any]:
    """Destination-specific, validated hints that travel with the brief."""
    hints: dict[str, Any] = {}
    if dest.id == "ml_lab":
        mode = str(data.get("mode") or "image").strip().lower()
        hints["mode"] = mode if mode in {"image", "pose", "hand", "face"} else "image"
        classes = _clean_classes(data.get("classes"))
        if len(classes) >= 2:
            hints["classes"] = classes
        if str(data.get("name") or "").strip():
            hints["name"] = str(data["name"]).strip()[:80]
    if dest.id == "audio_lab":
        kind = str(data.get("kind") or "").strip().lower()
        hints["kind"] = kind if kind in {"voice", "music"} else "music"
    if dest.variant:
        hints["variant"] = dest.variant
    return hints


async def plan_handoff(
    db: AsyncSession, actor: StudentOrTeacher, *, target: str, prompt: str,
    conversation_id: Optional[uuid.UUID] = None, history: Optional[list[dict]] = None,
    materials: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Build the hand-off card for ``target``; never raises for a model failure (falls back to the raw prompt)."""
    dest = DESTINATIONS.get(target)
    if dest is None:
        return {"available": False, "reason": "unknown", "content": "Non conosco questa sezione della piattaforma."}
    prompt = (prompt or "").strip()

    if actor.is_student:
        if not dest.student_module:
            return {"available": False, "reason": "not_for_students", "target": dest.id, "label": dest.label,
                    "content": f"**{dest.label}** non è disponibile per gli studenti."}
        enabled = await enabled_student_modules(db, actor.student.session_id)
        if dest.student_module not in enabled:
            return {"available": False, "reason": "module_disabled", "target": dest.id, "label": dest.label,
                    "content": f"Purtroppo la sezione **{dest.label}** è stata disattivata dal tuo docente per questa sessione, quindi non posso aprirla. "
                               "Se ti serve, chiedi al docente di attivarla: nel frattempo posso aiutarti qui in chat."}
    elif not dest.teacher_route:
        return {"available": False, "reason": "not_for_teachers", "target": dest.id, "label": dest.label,
                "content": f"**{dest.label}** non è disponibile per i docenti."}

    try:
        data = await _plan_with_llm(db, actor, dest, prompt, history or [], materials or [])
    except Exception:
        logger.exception("platform handoff: planning failed, using the raw prompt")
        data = {}
    use = str(data.get("source_use") or "").strip().lower()
    if use not in {"assistant", "materials", "both", "none"}:
        use = "materials" if materials else "none"  # planner failed: attachments still travel with the request
    summary = str(data.get("summary") or "").strip()[:900] or f"Apro **{dest.label}** con la tua richiesta."
    handoff = {
        "available": True,
        "target": dest.id,
        "label": dest.label,
        "route": dest.teacher_route if actor.is_teacher else None,
        "module": dest.student_module if actor.is_student else None,
        "needs_session": bool(dest.needs_session and actor.is_teacher),
        "title": str(data.get("title") or "").strip()[:80],
        "brief": str(data.get("brief") or data.get("topic") or prompt).strip()[:4000] or prompt,
        "source": _source_text(use, history or [], materials or []),
        "hints": _hints(dest, data),
    }
    result: dict[str, Any] = {"content": summary, "handoff": handoff}

    if actor.is_teacher and conversation_id:
        teacher = actor.teacher
        conversation = await db.scalar(select(TeacherConversation).where(
            TeacherConversation.id == conversation_id, TeacherConversation.teacher_id == teacher.id,
            TeacherConversation.tenant_id == teacher.tenant_id))
        if conversation:
            user = TeacherConversationMessage(tenant_id=teacher.tenant_id, conversation_id=conversation.id, role="user", content=prompt)
            db.add(user)
            await db.flush()
            assistant = TeacherConversationMessage(tenant_id=teacher.tenant_id, conversation_id=conversation.id, role="assistant",
                                                   content=summary, attachments_json={"handoff": handoff})
            db.add(assistant)
            conversation.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(user)
            await db.refresh(assistant)
            result["user_message"] = {"id": str(user.id), "content": user.content, "created_at": user.created_at.isoformat()}
            result["assistant_message"] = {"id": str(assistant.id), "content": summary, "created_at": assistant.created_at.isoformat(), "handoff": handoff}
    return result
