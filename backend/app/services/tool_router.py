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
    {"value": "none", "description": "No artifact is involved: plain conversation."},
    {"value": "image", "description": "A picture, illustration, drawing, photo, logo or poster image."},
    {"value": "presentation", "description": "A slide deck / PowerPoint-style presentation."},
    {"value": "brochure", "description": "A brochure, flyer, leaflet or printable informational layout."},
    {"value": "dispensa", "description": "A structured handout / study-notes pack / course booklet (dispensa)."},
    {"value": "html_page", "description": "An interactive web page, simulation, mini-app, game or interactive visualization."},
    {"value": "quiz", "description": "A quiz or test with questions."},
    {"value": "exercise", "description": "A practice exercise or worksheet."},
    {"value": "dataset", "description": "A tabular dataset."},
]

ARTIFACT_VALUES = {a["value"] for a in ARTIFACTS}
ACTION_INSTRUCTIONS = (
    "What does the LAST user message want to do? Decide using the artifacts already present in the chat. "
    "If it refers to something that exists ('la pagina', 'l'immagine', 'modificala', 'cambia lo stile', 'più corto', 'aggiungi...') it is edit or ask_about, "
    "not create. Choose create only when it clearly asks for something new."
)
ARTIFACT_INSTRUCTIONS = (
    "Which kind of artifact does the LAST user message concern? For edit/ask_about pick the EXISTING artifact it refers to: "
    "an explicit noun wins ('la pagina' = html_page, 'l'immagine/foto' = image, 'le slide' = presentation); otherwise the MOST RECENT artifact listed. "
    "For create pick the kind to produce. Use none for plain conversation."
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
    if len(text) < MIN_TEXT_LENGTH or not settings.OPENAI_API_KEY:
        return _chat()

    artifacts = [a for a in (artifacts or []) if a.get("type") in ARTIFACT_VALUES]
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
            return _chat()
        answers = {a.get("name"): a for a in resp.json().get("answers", []) if a.get("type") == "choice"}
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Decisions API tool routing failed: %s", exc)
        return _chat()

    act, art = answers.get("action"), answers.get("artifact")
    if not act or not art:
        return _chat()
    action = act.get("choice") or "chat"
    artifact = art.get("choice") or "none"
    act_conf, art_conf = float(act.get("confidence") or 0.0), float(art.get("confidence") or 0.0)
    # Editing/asking is anchored on what already exists: if the model is sure of the action but unsure
    # which artifact, the most recent one is the natural referent ("rendila più colorata").
    anchored = action in ("edit", "ask_about") and act_conf >= MIN_CONFIDENCE and art_conf < MIN_CONFIDENCE and bool(artifacts)
    if anchored:
        artifact, art_conf = artifacts[-1]["type"], act_conf
    confidence = round(min(act_conf, art_conf), 3)
    alternatives = _probabilities(art, allowed_set)[:3]
    action_alternatives = [{"tool": a["tool"], "probability": a["probability"]} for a in _probabilities(act, {c["value"] for c in action_choices})]
    info = {"top": artifact, "alternatives": alternatives, "action_alternatives": action_alternatives, "confidence": confidence, "routed": True}

    if confidence < MIN_CONFIDENCE or action == "chat":
        return _chat(action="chat", **info)

    if action in ("edit", "ask_about"):
        if artifact not in existing:
            # The named artifact does not exist: fall back to the most recent one, else treat as a fresh request.
            if artifacts:
                artifact = artifacts[-1]["type"]
            elif action == "edit":
                action = "create"
            else:
                return _chat(action="chat", **info)
    if artifact == "none":
        return _chat(action="chat", **info)
    return {**_chat(**info), "tool": artifact, "action": action}  # type: ignore[return-value]
