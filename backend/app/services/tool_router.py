"""Intent routing for chat messages, powered by the OpenAI Decisions API.

One `POST /v1/decisions` call asks two typed questions over the same evidence
(what artifacts already exist in the chat + the last turns + the new message):

  * action   — chat | create | edit | ask_about
  * artifact — which artifact kind the message concerns (image, html_page, ...)

Splitting *what to do* from *on what* is what lets "modificami la pagina con un altro
stile" mean EDIT the existing html_page instead of creating a new one or editing the
last image. Any failure degrades to plain chat.
"""
import logging
import re
from typing import Optional, TypedDict

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

DECISIONS_URL = "https://api.openai.com/v1/decisions"
MIN_CONFIDENCE = 0.6
MIN_TEXT_LENGTH = 8
REQUEST_TIMEOUT_S = 4.0
CLIP = 320

ACTIONS = [
    {"value": "chat", "description": "Normal conversation: a question, explanation, advice, brainstorming, summary or discussion that neither asks to produce nor to change an artifact."},
    {"value": "create", "description": "The user wants a NEW artifact produced from scratch (or an explicitly separate/different one), even if similar artifacts already exist in the chat."},
    {"value": "edit", "description": "The user wants to CHANGE an artifact that already exists in this chat: restyle, recolor, shorten, extend, fix, translate, add/remove parts, 'make it ...', 'change the ...', 'now with ...'. Short follow-ups that only make sense relative to an existing artifact are edits."},
    {"value": "ask_about", "description": "The user asks a question about, or wants an explanation/review/feedback of, an artifact that already exists, without changing it ('what does this page do?', 'is the slide deck too long?')."},
]

ARTIFACTS = [
    {"value": "teaching_protocol", "description": "Execute a teaching/activity protocol or produce a coordinated set of teaching materials with multiple specialized agents (quiz, teacherbot, documents, slides, sheet, image, interactive page). Requests to discuss, design or explain agentic systems are plain conversation."},
    {"value": "deep_research", "description": "An in-depth investigation / deep research / ricerca approfondita: search and read multiple online sources, compare evidence and produce a cited research report. Explicit requests for deep research always concern this artifact, not plain chat."},
    {"value": "podcast", "description": "An audio summary, narrated explanation, educational podcast or spoken version of attached documents."},
    {"value": "calendar", "description": "The teacher's calendar: add, schedule, plan, move, reschedule, cancel or delete events, lessons, tests, meetings or deadlines on dates; recurring events (every week / every month); finding a free slot when a class or session is available; putting the dates found in an attached document into the calendar. Asking to put something 'in calendario/in agenda' always concerns this artifact."},
    {"value": "none", "description": "No artifact is involved: plain conversation."},
    {"value": "image", "description": "A picture, illustration, drawing, photo, logo or poster image."},
    {"value": "presentation", "description": "A slide deck / PowerPoint-style presentation."},
    {"value": "brochure", "description": "A brochure, flyer, leaflet or printable informational layout."},
    {"value": "dispensa", "description": "A structured handout / study-notes pack / course booklet (dispensa)."},
    {"value": "html_page", "description": "An interactive web page, simulation, mini-app, game or interactive visualization."},
    {"value": "quiz", "description": "A quiz or test with questions."},
    {"value": "dataset", "description": "A tabular dataset."},
]

ARTIFACT_VALUES = {a["value"] for a in ARTIFACTS}
ACTION_INSTRUCTIONS = (
    "What does the LAST user message want to do? Decide using the artifacts already present in the chat. "
    "If it refers to something that exists ('la pagina', 'l'immagine', 'modificala', 'cambia lo stile', 'più corto', 'aggiungi...') it is edit or ask_about, "
    "not create. Choose create only when it clearly asks for something new. Any change to the calendar (adding, moving, repeating or deleting events, scheduling into a free slot) is edit: the calendar always exists."
)
ARTIFACT_INSTRUCTIONS = (
    "Which kind of artifact does the LAST user message concern? For edit/ask_about pick the EXISTING artifact it refers to: "
    "an explicit noun wins ('la pagina' = html_page, 'l'immagine/foto' = image, 'le slide' = presentation); otherwise the MOST RECENT artifact listed. "
    "For create pick the kind to produce. Choose teaching_protocol when the user asks to execute a teaching/activity protocol, "
    "create a teacherbot, or produce multiple coordinated kinds of materials (such as quiz AND slides AND teacherbot). "
    "Writing a protocol document or discussing agentic behavior without asking to execute it is plain conversation. "
    "Choose calendar whenever the user wants events added, moved, repeated or removed in the calendar, a free slot found, "
    "or the dates of an attached document put in the calendar. Use none for plain conversation."
)


class ToolDecision(TypedDict):
    tool: str  # artifact to route to ("chat" when plain chat, below threshold or on failure)
    action: str  # chat | create | edit | ask_about
    confidence: float  # min(action confidence, artifact confidence); 0.0 when the router did not run
    top: str  # best artifact guess even when not confident enough to route
    alternatives: list[dict]  # artifact probabilities [{"tool","probability"}], best first, up to 3
    action_alternatives: list[dict]  # action probabilities, best first
    routed: bool  # False = router did not run / failed


def _chat(**overrides) -> ToolDecision:
    base: ToolDecision = {"tool": "chat", "action": "chat", "confidence": 0.0, "top": "chat", "alternatives": [], "action_alternatives": [], "routed": False}
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def fallback_tool_decision(text: str, allowed: Optional[list[str]], artifacts: list[dict]) -> ToolDecision:
    """Keep explicit artifact requests usable without an external routing model."""
    if re.search(r"\b(?:come\s+(?:posso|si|faccio\s+a)|come\s+(?:creare|generare|modificare)|spiegami|how\s+(?:to|can|do)|what\s+is)\b", text, re.I):
        return _chat()
    if re.search(r"\b(?:non|senza|don't|do not)\s+(?:\w+\s+){0,2}(?:crea\w*|genera\w*|modifica\w*|create|generate|edit)\b", text, re.I):
        return _chat()
    if re.search(r"\b(?:solo\s+(?:il\s+)?codice|soltanto\s+(?:il\s+)?codice|code\s+only|only\s+(?:the\s+)?code)\b", text, re.I):
        return _chat()
    create = re.search(r"\b(?:crea|creami|creare|genera|generami|generare|prepara|preparami|realizza|realizzami|costruisci|fammi|fai|create|build|generate|make)\b", text, re.I)
    edit = re.search(r"\b(?:modifica\w*|cambia\w*|aggiung\w*|rimuov\w*|togli\w*|rendi\w*|rendila|rendilo|corregg\w*|sostituisc\w*|edit|change|add|remove|fix|update)\b", text, re.I)
    if not create and not edit:
        return _chat()
    patterns = {
        "html_page": r"\b(?:pagin[ae](?:\s+(?:web|html|interattiv[ae]))?|simulazion[ei]|mini[ -]?app|interactive\s+(?:page|visualization)|web\s*page|html|gioco\s+interattivo)\b",
        "brochure": r"\b(?:brochure|volantino|flyer)\b",
        "dispensa": r"\b(?:dispens[ae]|handout)\b",
        "presentation": r"\b(?:presentazion[ei]|slides?|diapositive|deck)\b",
        "image": r"\b(?:immagin[ei]|illustrazion[ei]|foto|image|picture)\b",
        "quiz": r"\b(?:quiz|verifica|questionario)\b",
        "dataset": r"\b(?:dataset|csv)\b",
    }
    available = set(allowed) if allowed is not None else ARTIFACT_VALUES
    named = [kind for kind, pattern in patterns.items() if re.search(pattern, text, re.I)]
    # Multiple materials and disallowed tools require the semantic router; don't guess.
    if len(named) > 1 or named and named[0] not in available:
        return _chat()
    referents = [a["type"] for a in artifacts if a.get("type") in available and a.get("type") != "calendar"]
    artifact = named[0] if named else referents[-1] if edit and referents else None
    if not artifact:
        return _chat()
    action = "edit" if edit and artifact in referents and not create else "create"
    return {**_chat(), "tool": artifact, "action": action, "top": artifact,
            "confidence": 1.0, "routed": True, "alternatives": [{"tool": artifact, "probability": 1.0}]}


def build_evidence(text: str, artifacts: list[dict], recent: list[dict]) -> str:
    """Shared input: existing artifacts (oldest→newest), the last turns, then the message to classify."""
    lines = ["ARTIFACTS ALREADY IN THIS CHAT (oldest first; the last one is the most recent):"]
    if artifacts:
        for a in artifacts[-8:]:
            detail = f" — {str(a.get('detail'))[:120]}" if a.get("detail") else ""
            lines.append(f"- {a.get('type')}{detail}")
    else:
        lines.append("- (none)")
    lines.append("\nRECENT TURNS:")
    for m in recent[-4:]:
        content = (m.get("content") or "").replace("\n", " ").strip()
        lines.append(f"{str(m.get('role', 'user')).upper()}: {content[:CLIP]}")
    lines.append(f"\nLAST USER MESSAGE: {text.strip()[:1500]}")
    return "\n".join(lines)


def _probabilities(answer: dict, allowed: set[str]) -> list[dict]:
    return sorted(
        (
            {"tool": p.get("value"), "probability": round(float(p.get("probability") or 0.0), 3)}
            for p in answer.get("probabilities") or []
            if p.get("value") in allowed
        ),
        key=lambda a: a["probability"],
        reverse=True,
    )


async def decide_tool(
    text: str,
    allowed: Optional[list[str]] = None,
    artifacts: Optional[list[dict]] = None,
    recent: Optional[list[dict]] = None,
) -> ToolDecision:
    text = (text or "").strip()
    if re.search(r"\b(?:solo\s+(?:il\s+)?codice|soltanto\s+(?:il\s+)?codice|code\s+only|only\s+(?:the\s+)?code)\b", text, re.I):
        return _chat()
    # An explicit mode request must work even when the Decisions API is unavailable.
    if (not allowed or "deep_research" in allowed) and is_deep_research_request(text):
        return {**_chat(), "tool": "deep_research", "action": "create", "top": "deep_research",
                "confidence": 1.0, "routed": True,
                "alternatives": [{"tool": "deep_research", "probability": 1.0}]}
    fallback = fallback_tool_decision(text, allowed, artifacts or [])
    if len(text) < MIN_TEXT_LENGTH or not settings.OPENAI_API_KEY:
        return fallback

    artifacts = [a for a in (artifacts or []) if a.get("type") in ARTIFACT_VALUES]
    if allowed and "calendar" in allowed and not any(a["type"] == "calendar" for a in artifacts):
        # The calendar is always there to be edited, even in a brand-new chat.
        artifacts = [{"type": "calendar", "detail": "calendario del docente (sempre disponibile)"}, *artifacts]
    existing = {a["type"] for a in artifacts}
    allowed_set = (set(allowed) if allowed else set(ARTIFACT_VALUES)) | {"none"}
    allowed_set.discard("chat")
    artifact_choices = [a for a in ARTIFACTS if a["value"] in allowed_set]
    # Without any existing artifact there is nothing to edit or ask about.
    action_choices = [a for a in ACTIONS if artifacts or a["value"] in ("chat", "create")]

    payload = {
        "model": settings.OPENAI_DECISIONS_MODEL,
        "input": build_evidence(text, artifacts, recent or []),
        "questions": [
            {"type": "choice", "name": "action", "instructions": ACTION_INSTRUCTIONS, "choices": action_choices},
            {"type": "choice", "name": "artifact", "instructions": ARTIFACT_INSTRUCTIONS, "choices": artifact_choices},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
            resp = await client.post(
                DECISIONS_URL,
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json=payload,
            )
        if resp.status_code >= 400:
            logger.warning("Decisions API error %s: %s", resp.status_code, resp.text[:300])
            return fallback
        answers = {a.get("name"): a for a in resp.json().get("answers", []) if a.get("type") == "choice"}
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Decisions API tool routing failed: %s", exc)
        return fallback

    act, art = answers.get("action"), answers.get("artifact")
    if not act or not art:
        return fallback
    action = act.get("choice") or "chat"
    artifact = art.get("choice") or "none"
    act_conf, art_conf = float(act.get("confidence") or 0.0), float(art.get("confidence") or 0.0)
    # Editing/asking is anchored on what already exists: if the model is sure of the action but unsure
    # which artifact, the most recent one is the natural referent ("rendila più colorata").
    # The always-present calendar is never an implicit referent: only an explicit calendar request targets it.
    referents = [a for a in artifacts if a["type"] != "calendar"]
    anchored = action in ("edit", "ask_about") and act_conf >= MIN_CONFIDENCE and art_conf < MIN_CONFIDENCE and bool(referents)
    if anchored:
        artifact, art_conf = referents[-1]["type"], act_conf
    confidence = round(min(act_conf, art_conf), 3)
    alternatives = _probabilities(art, allowed_set)[:3]
    action_alternatives = [{"tool": a["tool"], "probability": a["probability"]} for a in _probabilities(act, {c["value"] for c in action_choices})]
    info = {"top": artifact, "alternatives": alternatives, "action_alternatives": action_alternatives, "confidence": confidence, "routed": True}

    if confidence < MIN_CONFIDENCE or action == "chat":
        if fallback["routed"]:
            return fallback
        return _chat(action="chat", **info)

    if action in ("edit", "ask_about"):
        if artifact not in existing:
            # The named artifact does not exist: fall back to the most recent one, else treat as a fresh request.
            if referents:
                artifact = referents[-1]["type"]
            elif action == "edit":
                action = "create"
            else:
                return _chat(action="chat", **info)
    if artifact == "calendar" and action == "create":
        action = "edit"  # adding events is an edit of the (always existing) calendar
    if artifact == "none":
        return _chat(action="chat", **info)
    return {**_chat(**info), "tool": artifact, "action": action}  # type: ignore[return-value]


def is_deep_research_request(text: str) -> bool:
    if re.search(r"\b(?:non|senza|no|without|don't|do not)\s+(?:(?:voglio|vorrei|fare|una|la|a|the|want|use|need)\s+){0,3}(?:deep[\s-]*research|ricerca\s+approfondita)", text, re.I):
        return False
    if re.search(r"(?:cos[’']?è|cosa (?:significa|vuol dire)|what is|come (?:funziona|si usa))\s+(?:(?:la|una|the|a)\s+)?(?:deep[\s-]*research|ricerca\s+approfondita)", text, re.I):
        return False
    artifact = re.search(r"\b(?:deep[\s-]*research|ricerca\s+approfondita)\b", text, re.I)
    action = re.search(r"\b(?:voglio|vorrei|fai|fammi|esegui|avvia|crea|creami|prepara|conduci|svolgi|effettua|puoi|potresti|want|need|run|start|do|conduct)\b", text, re.I)
    command = re.match(r"^\s*(?:(?:una|la|a|the|modalità)\s+)?(?:deep[\s-]*research|ricerca\s+approfondita)\b", text, re.I)
    return bool(artifact and (action or command))
