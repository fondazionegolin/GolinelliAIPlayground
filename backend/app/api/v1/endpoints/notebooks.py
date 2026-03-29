from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, List, Optional
from datetime import datetime
from uuid import UUID
import uuid

from app.core.database import get_db
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.notebook import Notebook
from app.models.session import SessionStudent
from app.services.llm_service import llm_service
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def _owner_id_and_tenant(actor: StudentOrTeacher) -> tuple[UUID, UUID]:
    """Return (owner_id, tenant_id) for the current actor."""
    if actor.is_teacher:
        return actor.teacher.id, actor.teacher.tenant_id
    else:
        return actor.student.id, actor.student.tenant_id


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

    # Starter cell
    starter_cell = {
        "id": str(uuid.uuid4()),
        "type": "code",
        "source": "# Benvenuto nel tuo notebook Python!\nprint('Hello, world!')\n",
        "outputs": [],
        "execution_count": None,
    }

    nb = Notebook(
        tenant_id=tenant_id,
        owner_id=owner_id,
        title=title,
        cells=[starter_cell],
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
    history = request.get("history", [])
    current_cell = request.get("current_cell_source", "")
    last_output = request.get("last_output", "")

    # Build rich context
    all_code = "\n\n# --- next cell ---\n".join(
        cell.get("source", "") for cell in (nb.cells or []) if cell.get("type") == "code"
    )

    system_prompt = f"""Sei un tutor esperto di Python per studenti e docenti.
Stai aiutando con il notebook intitolato: "{nb.title}".

Codice completo del notebook (tutte le celle):
```python
{all_code[:3000]}
```

Cella corrente su cui sta lavorando l'utente:
```python
{current_cell[:1000]}
```

{"Ultimo output/errore ricevuto:" if last_output else ""}
{f"```{chr(10)}{last_output[:500]}{chr(10)}```" if last_output else ""}

Il tuo obiettivo:
1. Aiuta l'utente a capire i concetti, NON scrivere il codice al suo posto
2. Se l'utente è bloccato, scomponi il problema in esercizi più semplici
3. Suggerisci approcci e funzioni utili, ma lascia che l'utente scriva il codice
4. Se l'utente chiede esplicitamente del codice di esempio, puoi mostrarne uno breve
5. Usa emoji per rendere le spiegazioni più chiare (es. 🐍 per Python, ⚠️ per errori)
6. Rispondi sempre in italiano a meno che l'utente scriva in un'altra lingua"""

    messages = [{"role": m["role"], "content": m["content"]} for m in history[-10:]]
    messages.append({"role": "user", "content": message})

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
        return {"response": response.content}
    except Exception as e:
        logger.error(f"Tutor chat error: {e}")
        raise HTTPException(status_code=500, detail="Errore del tutor AI")


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
        "cells": nb.cells or [],
        "created_at": nb.created_at.isoformat(),
        "updated_at": nb.updated_at.isoformat(),
    }
