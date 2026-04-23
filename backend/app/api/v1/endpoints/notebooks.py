from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, List, Optional
from datetime import datetime
from uuid import UUID
import uuid
import json
import re

from app.core.database import get_db
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.notebook import Notebook
from app.models.session import SessionStudent
from app.services.llm_service import llm_service
import logging

router = APIRouter()
logger = logging.getLogger(__name__)
SUPPORTED_PROJECT_TYPES = {"python", "p5js"}
NOTEBOOK_CONTEXT_CELL_LIMIT = 6
NOTEBOOK_SNIPPET_CHAR_LIMIT = 1200


def _owner_id_and_tenant(actor: StudentOrTeacher) -> tuple[UUID, UUID]:
    """Return (owner_id, tenant_id) for the current actor."""
    if actor.is_teacher:
        return actor.teacher.id, actor.teacher.tenant_id
    else:
        return actor.student.id, actor.student.tenant_id


def _tokenize_for_match(*parts: str) -> set[str]:
    tokens: set[str] = set()
    for part in parts:
        for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", part or ""):
            lowered = token.lower()
            if lowered not in {"the", "and", "for", "with", "this", "that", "print", "const", "function"}:
                tokens.add(lowered)
    return tokens


def _summarize_output(outputs: list[dict] | None) -> str:
    if not outputs:
        return ""
    rendered: list[str] = []
    for output in outputs[:3]:
        if not isinstance(output, dict):
            continue
        if output.get("output_type") == "error":
            rendered.append(f"ERRORE: {output.get('ename', 'Error')}: {output.get('evalue', '')}")
        elif output.get("text"):
            rendered.append(str(output.get("text")).strip())
        elif isinstance(output.get("data"), dict):
            data = output.get("data") or {}
            text_preview = data.get("text/plain")
            if text_preview:
                rendered.append(str(text_preview).strip())
            elif data.get("image/png"):
                rendered.append("[grafico generato]")
    return "\n".join(item for item in rendered if item).strip()[:500]


def _score_notebook_cell(cell: dict, query_tokens: set[str], current_cell: str) -> int:
    source = str(cell.get("source", ""))
    outputs = _summarize_output(cell.get("outputs"))
    haystack = f"{source}\n{outputs}".lower()
    score = sum(1 for token in query_tokens if token in haystack)
    if current_cell and source.strip() == current_cell.strip():
        score += 8
    if cell.get("execution_count"):
        score += 1
    if outputs:
        score += 2
    return score


def _build_notebook_context(nb: Notebook, query: str, current_cell: str, last_output: str) -> str:
    cells = [cell for cell in (nb.cells or []) if isinstance(cell, dict) and cell.get("type") == "code"]
    if not cells:
        return ""

    query_tokens = _tokenize_for_match(query, current_cell, last_output)
    ranked_cells = sorted(
        cells,
        key=lambda cell: _score_notebook_cell(cell, query_tokens, current_cell),
        reverse=True,
    )

    selected = ranked_cells[:NOTEBOOK_CONTEXT_CELL_LIMIT]
    sections: list[str] = []
    for index, cell in enumerate(selected, start=1):
        source = str(cell.get("source", "")).strip()
        output = _summarize_output(cell.get("outputs"))
        sections.append(
            "\n".join(filter(None, [
                f"Cella rilevante #{index}",
                f"execution_count: {cell.get('execution_count') or 'n.d.'}",
                f"codice:\n{source[:NOTEBOOK_SNIPPET_CHAR_LIMIT]}",
                f"output:\n{output}" if output else "",
            ]))
        )

    return "\n\n---\n\n".join(sections)


def _sanitize_tutor_history(raw_history: object, limit: int = 60) -> list[dict[str, str]]:
    if not isinstance(raw_history, list):
        return []

    sanitized: list[dict[str, str]] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        sanitized.append({"role": role, "content": content[:4000]})

    return sanitized[-limit:]


# ── List notebooks ──────────────────────────────────────────────────────────

@router.get("/notebooks", response_model=List[dict])
async def list_notebooks(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    owner_id, tenant_id = _owner_id_and_tenant(actor)
    result = await db.execute(
        select(Notebook)
        .where(Notebook.tenant_id == tenant_id, Notebook.owner_id == owner_id)
        .order_by(Notebook.updated_at.desc())
    )
    notebooks = result.scalars().all()
    return [
        {
            "id": str(nb.id),
            "title": nb.title,
            "project_type": nb.project_type or "python",
            "cell_count": len(nb.cells) if nb.cells else 0,
            "created_at": nb.created_at.isoformat(),
            "updated_at": nb.updated_at.isoformat(),
        }
        for nb in notebooks
    ]


# ── Create notebook ──────────────────────────────────────────────────────────

@router.post("/notebooks", response_model=dict, status_code=201)
async def create_notebook(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    owner_id, tenant_id = _owner_id_and_tenant(actor)
    title = request.get("title", "Nuovo Notebook") or "Nuovo Notebook"
    project_type = _normalize_project_type(request.get("project_type"))

    nb = Notebook(
        tenant_id=tenant_id,
        owner_id=owner_id,
        title=title,
        project_type=project_type,
        cells=_starter_cells(project_type),
        editor_settings=_default_editor_settings(project_type),
    )
    db.add(nb)
    await db.commit()
    await db.refresh(nb)
    return _notebook_detail(nb)


# ── Get notebook ─────────────────────────────────────────────────────────────

@router.get("/notebooks/{notebook_id}", response_model=dict)
async def get_notebook(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    return _notebook_detail(nb)


# ── Update notebook (title + cells) ─────────────────────────────────────────

@router.put("/notebooks/{notebook_id}", response_model=dict)
async def update_notebook(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)

    if "title" in request and request["title"]:
        nb.title = request["title"]
    if "cells" in request:
        nb.cells = request["cells"]
    if "project_type" in request:
        nb.project_type = _normalize_project_type(request["project_type"])
    if "editor_settings" in request and isinstance(request["editor_settings"], dict):
        current_settings = _default_editor_settings(nb.project_type)
        current_settings.update(nb.editor_settings or {})
        current_settings.update(request["editor_settings"])
        nb.editor_settings = current_settings

    # Force updated_at
    nb.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(nb)
    return _notebook_detail(nb)


# ── Delete notebook ──────────────────────────────────────────────────────────

@router.delete("/notebooks/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    await db.delete(nb)
    await db.commit()


# ── Tutor chat ───────────────────────────────────────────────────────────────

@router.post("/notebooks/{notebook_id}/tutor", response_model=dict)
async def notebook_tutor_chat(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """
    Tutor chat with full notebook context.
    Request body: { message, history, notebook_title, current_cell_source, last_output }
    """
    nb = await _get_owned_notebook(db, notebook_id, actor)

    message = request.get("message", "")
    if not str(message or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Messaggio mancante")

    requested_history = _sanitize_tutor_history(request.get("history", []))
    server_history = _sanitize_tutor_history(nb.tutor_messages or [])
    history = server_history or requested_history
    current_cell = request.get("current_cell_source", "")
    last_output = request.get("last_output", "")
    pending_proposals = request.get("pending_proposals", [])
    project_type = nb.project_type or "python"

    # Build rich context
    all_code = "\n\n# --- next cell ---\n".join(
        cell.get("source", "") for cell in (nb.cells or []) if cell.get("type") == "code"
    )
    relevant_context = _build_notebook_context(nb, message, current_cell, last_output)

    language_label = "Python" if project_type == "python" else "p5.js / JavaScript creativo"
    code_fence = "python" if project_type == "python" else "javascript"
    proposals_context = ""
    if pending_proposals:
        proposals_context = f"""

Proposte di modifica attualmente in attesa di approvazione:
{json.dumps(pending_proposals[:5], ensure_ascii=False)}
"""

    system_prompt = f"""Sei un tutor esperto di {language_label} per studenti e docenti.
Stai aiutando con il notebook intitolato: "{nb.title}".
Tipo progetto: {project_type}

Codice completo del notebook (tutte le celle):
```{code_fence}
{all_code[:3000]}
```

Contesto notebook recuperato in base alla richiesta e alla cella attiva:
```text
{relevant_context[:4000]}
```

Cella corrente su cui sta lavorando l'utente:
```{code_fence}
{current_cell[:1000]}
```

{"Ultimo output/errore ricevuto:" if last_output else ""}
{f"```{chr(10)}{last_output[:500]}{chr(10)}```" if last_output else ""}
{proposals_context}

Il tuo obiettivo:
1. Aiuta l'utente a capire i concetti, NON scrivere il codice al suo posto
2. Se l'utente è bloccato, scomponi il problema in esercizi più semplici
3. Suggerisci approcci e funzioni utili, ma lascia che l'utente scriva il codice
4. Se l'utente chiede esplicitamente del codice di esempio, puoi mostrarne uno breve
5. Se il progetto è p5js, considera setup(), draw(), preload(), canvas, coordinate, frame rate e ciclo di rendering
6. Usa emoji per rendere le spiegazioni più chiare (es. 🐍 per Python, ⚠️ per errori)
7. Rispondi sempre in italiano a meno che l'utente scriva in un'altra lingua"""

    messages = [{"role": m["role"], "content": m["content"]} for m in history[-10:]]
    messages.append({"role": "user", "content": str(message).strip()})

    provider = "anthropic"
    model = "claude-haiku-4-5-20251001"

    try:
        response = await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=0.5,
            max_tokens=1200,
        )
        updated_history = _sanitize_tutor_history([
            *history,
            {"role": "user", "content": str(message).strip()},
            {"role": "assistant", "content": response.content},
        ])
        nb.tutor_messages = updated_history
        nb.updated_at = datetime.utcnow()
        await db.commit()
        return {"response": response.content, "history": updated_history}
    except Exception as e:
        logger.error(f"Tutor chat error: {e}")
        raise HTTPException(status_code=500, detail="Errore del tutor AI")


@router.post("/notebooks/{notebook_id}/assist", response_model=dict)
async def notebook_assist(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)

    active_source = request.get("current_cell_source", "") or ""
    last_output = request.get("last_output", "") or ""
    user_prompt = request.get("message", "") or "Analizza il codice e suggerisci correzioni mirate."
    project_type = nb.project_type or "python"
    code_fence = "python" if project_type == "python" else "javascript"

    all_code = "\n\n# --- next cell ---\n".join(
        cell.get("source", "") for cell in (nb.cells or []) if cell.get("type") == "code"
    )
    relevant_context = _build_notebook_context(nb, user_prompt, active_source, last_output)

    system_prompt = f"""Sei un assistente tutor agentico per notebook {project_type}.
Devi analizzare il codice e restituire SOLO JSON valido, senza markdown.

Formato JSON richiesto:
{{
  "summary": "breve sintesi in italiano",
  "proposals": [
    {{
      "line_start": 1,
      "line_end": 1,
      "severity": "error|warning|info",
      "message": "messaggio breve",
      "replacement": "codice sostitutivo proposto",
      "explanation": "spiegazione didattica",
      "teacher_note": "spiegazione breve da mostrare vicino al codice"
    }}
  ]
}}

Regole:
- Massimo 5 proposte
- Usa line numeri 1-based riferiti alla cella corrente
- Ogni proposta deve essere didattica e conservativa: modifica il minimo indispensabile
- replacement deve contenere il codice completo che sostituisce l'intervallo line_start..line_end
- Non inventare errori se il codice sembra corretto
- Se non serve cambiare il codice, restituisci proposals: []
- Se il progetto è p5js, considera anche errori tipici di setup/draw, canvas, preload, scope e API p5
- Rispondi in italiano"""

    messages = [
        {
            "role": "user",
            "content": (
                f"Notebook: {nb.title}\n"
                f"Tipo progetto: {project_type}\n\n"
                f"Codice completo:\n```{code_fence}\n{all_code[:5000]}\n```\n\n"
                f"Contesto recuperato del notebook:\n```text\n{relevant_context[:4000]}\n```\n\n"
                f"Cella corrente:\n```{code_fence}\n{active_source[:2500]}\n```\n\n"
                f"Ultimo output o errore:\n{last_output[:1200] or '(nessuno)'}\n\n"
                f"Richiesta utente: {user_prompt}"
            ),
        }
    ]

    provider = "anthropic"
    model = "claude-haiku-4-5-20251001"

    try:
        response = await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=0.2,
            max_tokens=900,
        )
        parsed = _extract_json_object(response.content)
        proposals = parsed.get("proposals", [])
        normalized = []
        for idx, proposal in enumerate(proposals[:5]):
            if not isinstance(proposal, dict):
                continue
            line_start = max(1, int(proposal.get("line_start", 1) or 1))
            line_end = max(line_start, int(proposal.get("line_end", line_start) or line_start))
            normalized.append({
                "id": f"p-{idx}",
                "line_start": line_start,
                "line_end": line_end,
                "severity": proposal.get("severity", "info") if proposal.get("severity") in {"error", "warning", "info"} else "info",
                "message": str(proposal.get("message", "")).strip()[:200],
                "replacement": str(proposal.get("replacement", "")).rstrip()[:4000],
                "explanation": str(proposal.get("explanation", "")).strip()[:700],
                "teacher_note": str(proposal.get("teacher_note", "")).strip()[:300],
            })

        return {
            "summary": str(parsed.get("summary", "Analisi completata.")).strip()[:500],
            "proposals": normalized,
        }
    except Exception as e:
        logger.error(f"Notebook assist error: {e}")
        raise HTTPException(status_code=500, detail="Errore dell'assistente AI")


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_owned_notebook(db: AsyncSession, notebook_id: UUID, actor: StudentOrTeacher) -> Notebook:
    owner_id, tenant_id = _owner_id_and_tenant(actor)
    result = await db.execute(
        select(Notebook).where(
            Notebook.id == notebook_id,
            Notebook.owner_id == owner_id,
            Notebook.tenant_id == tenant_id,
        )
    )
    nb = result.scalar_one_or_none()
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook non trovato")
    return nb


def _notebook_detail(nb: Notebook) -> dict:
    return {
        "id": str(nb.id),
        "title": nb.title,
        "project_type": nb.project_type or "python",
        "cells": nb.cells or [],
        "editor_settings": _default_editor_settings(nb.project_type or "python") | (nb.editor_settings or {}),
        "tutor_messages": _sanitize_tutor_history(nb.tutor_messages or []),
        "created_at": nb.created_at.isoformat(),
        "updated_at": nb.updated_at.isoformat(),
    }


def _normalize_project_type(value: Optional[str]) -> str:
    project_type = (value or "python").strip().lower()
    if project_type not in SUPPORTED_PROJECT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo progetto non supportato")
    return project_type


def _default_editor_settings(project_type: str) -> dict:
    return {
        "theme": "dracula" if project_type == "p5js" else "dark",
        "font_size": 14,
        "font_family": "jetbrains",
        "live_preview": project_type == "p5js",
    }


def _starter_cells(project_type: str) -> list[dict]:
    if project_type == "p5js":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "source": (
                "function setup() {\n"
                "  createCanvas(640, 360)\n"
                "  noStroke()\n"
                "}\n\n"
                "function draw() {\n"
                "  background(248, 250, 252)\n"
                "  fill(59, 130, 246)\n"
                "  circle(mouseX, mouseY, 48)\n"
                "}\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    return [{
        "id": str(uuid.uuid4()),
        "type": "code",
        "source": "# Benvenuto nel tuo notebook Python!\nprint('Hello, world!')\n",
        "outputs": [],
        "execution_count": None,
    }]


def _extract_json_object(raw_text: str) -> dict:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))
