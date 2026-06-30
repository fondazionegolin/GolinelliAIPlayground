from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, List, Optional
from datetime import datetime
from uuid import UUID
import uuid
import json
import re

import httpx

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.notebook import Notebook
from app.models.notebook_version import NotebookVersion
from app.models.session import SessionStudent
from app.services.llm_service import llm_service
import logging

router = APIRouter()
logger = logging.getLogger(__name__)
SUPPORTED_PROJECT_TYPES = {"python", "p5js", "strudel", "game2d", "microbit", "circuitplayground"}
NOTEBOOK_CONTEXT_CELL_LIMIT = 6
NOTEBOOK_SNIPPET_CHAR_LIMIT = 1200

# Riferimento API vincolante per il target pxt-adafruit (Circuit Playground Express).
# Il microservizio PXT compila SOLO questo dialetto MakeCode TypeScript: ogni API
# inventata o presa dal micro:bit fa fallire la build (error TS2339 / TS2304).
CIRCUITPLAYGROUND_API_REFERENCE = """Target di compilazione: pxt-adafruit (Circuit Playground Express). Linguaggio: MakeCode TypeScript.
Usa SOLO queste API reali (qualsiasi altra fa fallire la compilazione UF2):
- Loop/tempo: forever(() => { ... }), pause(ms), control.runInParallel(() => {...})
- Eventi: input.onGesture(Gesture.Shake, () => {...}), input.buttonA.onEvent(ButtonEvent.Click, () => {...})
- Sensori: input.temperature(TemperatureUnit.Celsius), input.lightLevel(), input.soundLevel(),
  input.acceleration(Dimension.X|Y|Z), input.buttonA.isPressed(), input.buttonB.isPressed()
- NeoPixel: light.setAll(0xRRGGBB), light.setPixelColor(i, 0xRRGGBB), light.clear(), light.showRing(...)
  I NeoPixel si aggiornano DA SOLI dopo setPixelColor/setAll: NON esiste light.show().
  Colori predefiniti: Colors.Red, Colors.Green, Colors.Blue, Colors.White (oppure esadecimale 0x00ff00)
- Matematica utile: Math.map(x, fromLow, fromHigh, toLow, toHigh), Math.constrain(x, min, max), Math.abs(x)
- Audio: music.playTone(Note.C, music.beat(BeatFraction.Whole)), music.playSound(...)
- Seriale verso il browser: serial.writeLine("temp=" + temp + " luce=" + luce)
  La seriale è GIÀ su USB: scrivi direttamente con serial.writeLine, righe key=value su una sola riga.
VIETATO: basic.* (è del micro:bit, non esiste qui), led.*, light.show(), serial.redirectToUSB(),
serial.redirect(...), CircuitPython (import, def, while True:, cp.*), print(), console.log(),
e qualunque funzione non elencata sopra.
Esempio MINIMO che COMPILA e che puoi usare come base:
let temp = 0
let luce = 0
forever(function () {
    // Leggo i sensori onboard della scheda
    temp = input.temperature(TemperatureUnit.Celsius)
    luce = input.lightLevel()
    // Invio i dati al cruscotto del browser come riga key=value
    serial.writeLine("temp=" + temp + " luce=" + luce)
    // Feedback visivo sui NeoPixel
    if (temp > 28) {
        light.setAll(0xff0040)
    } else {
        light.setAll(0x0066ff)
    }
    pause(500)
})"""


# Riferimento API vincolante per la micro:bit. Il notebook compila il codice
# come main.py dentro il firmware MicroPython e lo flasha sulla scheda via WebUSB.
# Riferimento ufficiale: https://microbit-micropython.readthedocs.io/en/v2-docs/
# NB: la MicroPython della micro:bit NON è il CPython del PC: alcune sintassi
# moderne (in primis le f-string) danno SyntaxError sulla scheda.
MICROBIT_MICROPYTHON_REFERENCE = """Linguaggio: MicroPython per BBC micro:bit V2 (riferimento: microbit-micropython.readthedocs.io/en/v2-docs).
Il codice è il main.py che viene caricato sulla scheda: deve essere MicroPython VALIDO per micro:bit, NON Python da PC e NON JavaScript/MakeCode.

REGOLA CRITICA SULLE STRINGHE — le f-string NON sono supportate dalla micro:bit e danno SyntaxError.
- VIETATO:  print(f"heading={angolo}")          # f-string -> SyntaxError sulla scheda
- CORRETTO: print("heading={}".format(angolo))   # usa sempre .format()
- CORRETTO: print("heading=" + str(angolo))      # oppure concatenazione con str()
Non usare MAI il prefisso f"..." o f'...'. Converti SEMPRE i numeri con str() o con "{}".format(...).

Moduli disponibili (import all'inizio del file):
- from microbit import *   (sempre, dà display, pulsanti, sensori, pin, Image, sleep, running_time, temperature)
- import music | import radio | import neopixel | import speech | import audio | import log | import math | import random

API reali da usare (qualsiasi altra cosa è inventata):
- Tempo: sleep(ms), running_time(), temperature()
- Display LED 5x5: display.show(Image.HAPPY), display.scroll("ciao"), display.set_pixel(x, y, 0-9),
  display.get_pixel(x, y), display.clear(), display.read_light_level()
- Pulsanti: button_a.is_pressed(), button_a.was_pressed(), button_a.get_presses() (e button_b)
- Accelerometro: accelerometer.get_x()/get_y()/get_z(), accelerometer.get_values(),
  accelerometer.current_gesture(), accelerometer.is_gesture("shake")
- Bussola: compass.heading(), compass.is_calibrated(), compass.calibrate(), compass.get_field_strength()
- Microfono (V2): microphone.sound_level()  (0-255)
- Pin: pin0.read_analog(), pin0.write_digital(0/1), pin0.is_touched() ...
- Immagini: Image.HEART, Image.HAPPY, Image.YES, Image.NO, Image.ARROW_N, ecc.
- Musica: music.play(music.NYAN), music.pitch(440, 500)
- Radio: radio.on(), radio.config(group=1), radio.send("ciao"), radio.receive()

Comunicazione con il browser: usa print() con UNA riga key=value per ciclo, così il cruscotto del browser
la legge dal monitor seriale e aggiorna i sensori in tempo reale. Le chiavi note al cruscotto sono:
temp, light, compass, accx, accy, accz, sound, a, b.
Ogni blocco di codice proposto deve avere commenti in italiano che spieghino cosa fa e a cosa serve.

Esempio MINIMO che FUNZIONA sulla micro:bit (usalo come base, niente f-string):
from microbit import *

while True:
    # Leggo i sensori di bordo
    angolo = compass.heading()
    luce = display.read_light_level()
    # Invio una riga key=value al cruscotto del browser (con .format, non f-string)
    print("compass={} light={}".format(angolo, luce))
    sleep(200)"""


def _strip_code_fences(code: str) -> str:
    """Rimuove i recinti markdown (```lang ... ```) che l'LLM lascia talvolta nel
    replacement: quei backtick finirebbero nella cella e farebbero fallire la build
    MakeCode con TS1128."""
    lines = [line for line in code.splitlines() if not line.lstrip().startswith("```")]
    return "\n".join(lines).strip()


def _apply_line_range(source: str, line_start: int, line_end: int, replacement: str) -> str:
    """Replica lato server lo splice che il frontend usa per applicare una proposta,
    così possiamo compilare il risultato esatto che vedrà lo studente."""
    lines = source.split("\n")
    repl = replacement.replace("\r\n", "\n").split("\n")
    start = max(0, line_start - 1)
    count = max(1, line_end - line_start + 1)
    lines[start:start + count] = repl
    return "\n".join(lines)


async def _compile_circuitplayground(code: str) -> tuple[bool, str]:
    """Compila il codice col microservizio PXT. Ritorna (ok, errori).
    Fail-open: se il compilatore non risponde non blocchiamo la proposta."""
    compiler_url = settings.PXT_COMPILER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=settings.PXT_COMPILER_TIMEOUT_SECONDS) as client:
            resp = await client.post(f"{compiler_url}/compile/circuitplayground", json={"code": code})
    except httpx.HTTPError as exc:
        logger.warning("PXT compiler non raggiungibile durante la validazione: %s", exc)
        return True, ""
    if resp.status_code < 400:
        return True, ""
    try:
        data = resp.json()
        logs = data.get("logs") or data.get("error") or ""
    except ValueError:
        logs = resp.text
    error_lines = [ln for ln in (logs or "").splitlines() if "error" in ln.lower() or "main.ts" in ln.lower()]
    return False, ("\n".join(error_lines) or logs or "Compilazione fallita.")[:1500]


async def _autofix_makecode(code: str, error_logs: str) -> str:
    """Chiede al modello di correggere il codice usando l'errore reale del compilatore."""
    system_prompt = (
        "Sei un correttore di codice MakeCode TypeScript per Circuit Playground Express.\n"
        "Ricevi un programma che NON compila e l'errore esatto del compilatore PXT.\n"
        "Restituisci SOLO il programma completo corretto che compila: niente markdown, "
        "niente spiegazioni, niente backtick. Mantieni l'intento originale e i commenti in italiano.\n\n"
        + CIRCUITPLAYGROUND_API_REFERENCE
    )
    user_msg = (
        f"Errore del compilatore PXT:\n{error_logs}\n\n"
        f"Codice da correggere:\n{code}\n\n"
        "Riscrivi il programma completo corretto."
    )
    response = await llm_service.generate(
        messages=[{"role": "user", "content": user_msg}],
        system_prompt=system_prompt,
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        temperature=0.0,
        max_tokens=1200,
    )
    return _strip_code_fences(response.content or "")


async def _validate_and_autofix_circuitplayground(
    proposals: list[dict], active_source: str, active_line_count: int
) -> tuple[list[dict], bool]:
    """Per ogni proposta compila il risultato applicato alla cella; se non compila,
    tenta fino a 2 autocorrezioni guidate dall'errore del compilatore. Le proposte
    corrette diventano riscritture di tutta la cella (line 1..fine)."""
    all_ok = True
    for prop in proposals:
        replacement = prop.get("replacement") or ""
        if not replacement.strip():
            continue
        candidate = _apply_line_range(active_source, prop["line_start"], prop["line_end"], replacement)
        ok, logs = await _compile_circuitplayground(candidate)
        if ok:
            continue

        fixed_code = None
        attempt_code, attempt_logs = candidate, logs
        for _ in range(2):
            corrected = await _autofix_makecode(attempt_code, attempt_logs)
            if not corrected.strip():
                break
            ok2, logs2 = await _compile_circuitplayground(corrected)
            if ok2:
                fixed_code = corrected
                break
            attempt_code, attempt_logs = corrected, logs2

        if fixed_code is not None:
            prop["line_start"] = 1
            prop["line_end"] = active_line_count
            prop["replacement"] = fixed_code[:4000]
            prop["message"] = (prop.get("message") or "Proposta").strip()[:160] + " — verificata: compila"
        else:
            all_ok = False
            prop["severity"] = "warning"
            prop["message"] = (prop.get("message") or "Proposta").strip()[:140] + " — non compila ancora, controlla il codice"
    return proposals, all_ok


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


# ── Version history / rollback ──────────────────────────────────────────────

# Quante versioni teniamo per notebook: oltre questa soglia le più vecchie
# vengono potate per non far crescere la tabella all'infinito.
MAX_VERSIONS_PER_NOTEBOOK = 50
VALID_VERSION_SOURCES = {"manual", "ai", "auto", "rollback"}


def _version_summary(v: NotebookVersion) -> dict:
    """Versione 'leggera' per l'elenco: niente celle, solo i metadati."""
    cells = v.cells or []
    return {
        "id": str(v.id),
        "label": v.label,
        "source": v.source,
        "title": v.title,
        "project_type": v.project_type,
        "cell_count": len(cells) if isinstance(cells, list) else 0,
        "created_at": v.created_at.isoformat(),
    }


def _version_detail(v: NotebookVersion) -> dict:
    return {
        **_version_summary(v),
        "cells": v.cells or [],
        "editor_settings": v.editor_settings or {},
    }


async def _snapshot_notebook(
    db: AsyncSession,
    nb: Notebook,
    label: str,
    source: str,
) -> NotebookVersion:
    """Crea una versione con lo stato CORRENTE del notebook e pota le più vecchie.
    Non fa commit: lo fa il chiamante."""
    version = NotebookVersion(
        notebook_id=nb.id,
        tenant_id=nb.tenant_id,
        label=(label or "Snapshot")[:160],
        source=source if source in VALID_VERSION_SOURCES else "manual",
        title=nb.title,
        project_type=nb.project_type or "python",
        cells=nb.cells or [],
        editor_settings=nb.editor_settings or {},
    )
    db.add(version)
    await db.flush()

    # Potatura: tieni solo le ultime MAX_VERSIONS_PER_NOTEBOOK.
    stale = await db.execute(
        select(NotebookVersion.id)
        .where(NotebookVersion.notebook_id == nb.id)
        .order_by(NotebookVersion.created_at.desc())
        .offset(MAX_VERSIONS_PER_NOTEBOOK)
    )
    stale_ids = [row[0] for row in stale.all()]
    for sid in stale_ids:
        old = await db.get(NotebookVersion, sid)
        if old is not None:
            await db.delete(old)
    return version


@router.get("/notebooks/{notebook_id}/versions", response_model=List[dict])
async def list_notebook_versions(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    result = await db.execute(
        select(NotebookVersion)
        .where(NotebookVersion.notebook_id == nb.id)
        .order_by(NotebookVersion.created_at.desc())
    )
    return [_version_summary(v) for v in result.scalars().all()]


@router.post("/notebooks/{notebook_id}/versions", response_model=dict, status_code=201)
async def create_notebook_version(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    label = (request.get("label") or "Salvataggio manuale").strip()
    source = request.get("source") or "manual"
    version = await _snapshot_notebook(db, nb, label, source)
    await db.commit()
    await db.refresh(version)
    return _version_summary(version)


@router.get("/notebooks/{notebook_id}/versions/{version_id}", response_model=dict)
async def get_notebook_version(
    notebook_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    version = await db.get(NotebookVersion, version_id)
    if version is None or version.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Versione non trovata")
    return _version_detail(version)


@router.post("/notebooks/{notebook_id}/versions/{version_id}/restore", response_model=dict)
async def restore_notebook_version(
    notebook_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    version = await db.get(NotebookVersion, version_id)
    if version is None or version.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Versione non trovata")

    # Prima di sovrascrivere, salviamo lo stato attuale come checkpoint, così
    # anche il ripristino è reversibile.
    await _snapshot_notebook(db, nb, "Prima del ripristino", "auto")

    nb.title = version.title or nb.title
    nb.project_type = _normalize_project_type(version.project_type)
    nb.cells = version.cells or []
    if isinstance(version.editor_settings, dict):
        nb.editor_settings = version.editor_settings
    nb.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(nb)
    return _notebook_detail(nb)


@router.delete("/notebooks/{notebook_id}/versions/{version_id}", status_code=204)
async def delete_notebook_version(
    notebook_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    version = await db.get(NotebookVersion, version_id)
    if version is None or version.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Versione non trovata")
    await db.delete(version)
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

    if project_type == "python":
        language_label = "Python"
        code_fence = "python"
    elif project_type == "microbit":
        language_label = "micro:bit con MicroPython (codice caricato sulla scheda via WebUSB e monitor seriale)"
        code_fence = "python"
    elif project_type == "circuitplayground":
        language_label = "Circuit Playground Express con MakeCode TypeScript, compilazione UF2 e comunicazione seriale Web Serial"
        code_fence = "typescript"
    elif project_type == "game2d":
        language_label = "Game 2D schema JSON con runner Phaser"
        code_fence = "json"
    elif project_type == "strudel":
        language_label = "Strudel (live coding musicale con mini notation)"
        code_fence = "javascript"
    else:
        language_label = "p5.js / JavaScript creativo"
        code_fence = "javascript"
    proposals_context = ""
    if pending_proposals:
        proposals_context = f"""

Proposte di modifica attualmente in attesa di approvazione:
{json.dumps(pending_proposals[:5], ensure_ascii=False)}
"""

    strudel_extra = ""
    if project_type == "strudel":
        strudel_extra = """
Strudel è un sistema di live coding musicale basato su JavaScript. Concetti chiave:
- Mini notation: pattern ritmici tra virgolette, es. "bd sd" o "c3 e3 g3"
- Funzioni principali: note(), s(), sound(), n(), freq()
- Parametri audio: gain(), pan(), room(), delay(), cutoff(), speed()
- Inviluppo: attack(), decay(), sustain(), release()
- Trasformazioni pattern: .slow(n), .fast(n), .rev(), .palindrome(), .every(n, fn)
- Combinatori: stack(...), seq(...), cat(...)
- Il codice viene eseguito in tempo reale e produce audio nel browser via WebAudio
- Shift+Enter o il pulsante Play eseguono il codice; l'audio parte solo dopo il primo clic "Attiva audio"
"""
    game2d_extra = ""
    if project_type == "game2d":
        game2d_extra = """
Game 2D usa un runner Phaser fisso e una cella JSON come configurazione.
Concetti chiave:
- Lo schema descrive metadata, world, player, entities, collectibles, goal e ui
- Non serve scrivere codice JavaScript per il prototipo: cambia i dati JSON
- player.speed controlla la velocità, world.gravity controlla il movimento verticale
- entities include platform, hazard, enemy; collectibles include oggetti raccoglibili
- behaviors come patrol definiscono movimenti pre-scritti dal runner
- Il JSON deve restare valido e serializzabile
"""
    microbit_extra = ""
    if project_type == "microbit":
        microbit_extra = """
micro:bit usa una singola pagina di codice MicroPython che viene caricata sulla scheda via WebUSB.
Il tutor deve trasformare intenzioni creative in passi realizzabili e codice MicroPython che gira DAVVERO
sulla scheda, facendo una domanda socratica quando l'intenzione è ambigua.

""" + MICROBIT_MICROPYTHON_REFERENCE + "\n"
    circuitplayground_extra = ""
    if project_type == "circuitplayground":
        circuitplayground_extra = """
Circuit Playground Express usa una singola pagina di codice MakeCode TypeScript per programmare la scheda.
Concetti chiave:
- MakeCode TypeScript: forever, pause, light.setAll, input.temperature(TemperatureUnit.Celsius), input.lightLevel(), serial.writeLine
- Il codice viene compilato dal microservizio PXT in un firmware UF2 per Circuit Playground Express
- Per parlare con il browser usa output seriale semplice, es. temp=22 luce=120 movimento=3, oppure JSON serializzabile
- Il browser legge la seriale con Web Serial: Chrome/Edge, HTTPS o localhost
- La scheda in bootloader UF2/CPLAYBOOT e pronta per ricevere il firmware compilato; in runtime esegue il codice e invia dati seriali
- Ogni blocco di codice proposto deve avere commenti in italiano che spieghino cosa fa e a cosa serve
- Il tutor deve collegare sempre intenzione creativa, sensori onboard, NeoPixel/audio e dati seriali verso il browser

""" + CIRCUITPLAYGROUND_API_REFERENCE + "\n"

    system_prompt = f"""Sei un tutor esperto di {language_label} per studenti e docenti.
Stai aiutando con il notebook intitolato: "{nb.title}".
Tipo progetto: {project_type}
{strudel_extra}
{game2d_extra}
{microbit_extra}
{circuitplayground_extra}
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
6. Se il progetto è strudel, guida con domande sulla mini notation, i ritmi, i parametri sonori e la struttura del pattern
7. Se il progetto è game2d, ragiona sullo schema JSON e non proporre codice libero se non richiesto esplicitamente
8. Se il progetto è microbit, collega sempre intenzione creativa, sensori/attuatori e dati seriali verso il browser
9. Per microbit, ogni blocco di codice deve includere commenti in italiano che spieghino cosa fa e a cosa serve
10. Se il progetto è circuitplayground, collega sempre intenzione creativa, sensori onboard, NeoPixel/audio e dati seriali verso il browser
11. Per circuitplayground, ogni blocco di codice deve includere commenti in italiano che spieghino cosa fa e a cosa serve
12. Non usare emoji, emoticon o toni giocosi
13. Rispondi in modo compatto, chiaro e operativo: paragrafi brevi, pochi punti, niente preamboli inutili
14. Mantieni uno stile socratico: fai al massimo una domanda guida per volta quando serve
15. Rispondi sempre in italiano a meno che l'utente scriva in un'altra lingua"""

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
            max_tokens=850,
            allow_web_search=False,
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
    code_fence = "typescript" if project_type == "circuitplayground" else "python" if project_type in {"python", "microbit"} else "json" if project_type == "game2d" else "javascript"

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
- Se il progetto è game2d, correggi solo JSON/schema: niente codice JavaScript libero
- Se il progetto è microbit, puoi sostituire anche tutta la cella quando serve per trasformare l intenzione creativa in un programma completo
- Se il progetto è microbit, ogni replacement deve contenere commenti in italiano nei blocchi principali spiegando cosa fanno e a cosa servono
- Se il progetto è microbit, preferisci output seriale leggibile dal cruscotto browser: key=value o JSON su una riga
- Se il progetto è circuitplayground, puoi sostituire anche tutta la cella quando serve per trasformare l intenzione creativa in un programma completo
- Se il progetto è circuitplayground, ogni replacement deve contenere commenti in italiano nei blocchi principali spiegando cosa fanno e a cosa servono
- Se il progetto è circuitplayground, preferisci output seriale leggibile dal cruscotto browser: key=value o JSON su una riga
- Se il progetto è circuitplayground, genera solo MakeCode TypeScript compilabile da PXT; non generare CircuitPython
- Se riscrivi un programma hardware (microbit/circuitplayground) per intero, usa line_start=1 e line_end pari all'ultima riga della cella corrente, e fai in modo che replacement sia il programma COMPLETO e bilanciato (ogni parentesi/graffa aperta è chiusa una sola volta, nessuna riga duplicata in coda)
- Rispondi in italiano""" + (
        "\n\n" + CIRCUITPLAYGROUND_API_REFERENCE if project_type == "circuitplayground" else ""
    )

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
        # Per i notebook hardware il tutor può riscrivere tutta la cella. Se la proposta
        # parte da riga 1 ma indica un line_end troppo corto, lo splice lascerebbe la
        # vecchia coda (es. un "})" orfano) e la build MakeCode fallirebbe con TS1128.
        # Estendiamo line_end a tutta la cella quando la riscrittura parte dall'inizio.
        active_line_count = len(active_source.splitlines()) or 1
        is_device_notebook = project_type in {"microbit", "circuitplayground"}
        for idx, proposal in enumerate(proposals[:5]):
            if not isinstance(proposal, dict):
                continue
            line_start = max(1, int(proposal.get("line_start", 1) or 1))
            line_end = max(line_start, int(proposal.get("line_end", line_start) or line_start))
            if is_device_notebook and line_start <= 1:
                line_end = max(line_end, active_line_count)
            normalized.append({
                "id": f"p-{idx}",
                "line_start": line_start,
                "line_end": line_end,
                "severity": proposal.get("severity", "info") if proposal.get("severity") in {"error", "warning", "info"} else "info",
                "message": str(proposal.get("message", "")).strip()[:200],
                "replacement": _strip_code_fences(str(proposal.get("replacement", "")))[:4000],
                "explanation": str(proposal.get("explanation", "")).strip()[:700],
                "teacher_note": str(proposal.get("teacher_note", "")).strip()[:300],
            })

        summary_text = str(parsed.get("summary", "Analisi completata.")).strip()[:500]

        # Auto-fix loop: per Circuit Playground compiliamo davvero ogni proposta col
        # microservizio PXT e correggiamo finché non compila, così lo studente non
        # riceve mai codice rotto (API inventate, code orfane, ecc.).
        if project_type == "circuitplayground" and normalized:
            normalized, all_ok = await _validate_and_autofix_circuitplayground(
                normalized, active_source, active_line_count
            )
            if not all_ok:
                summary_text = (summary_text + " Nota: una proposta non compila ancora, l'ho segnalata.").strip()[:500]

        response_payload = {
            "summary": summary_text,
            "proposals": normalized,
        }
        if project_type in {"microbit", "circuitplayground"}:
            updated_history = _sanitize_tutor_history([
                *(nb.tutor_messages or []),
                {"role": "user", "content": str(user_prompt).strip()},
                {"role": "assistant", "content": response_payload["summary"]},
            ])
            nb.tutor_messages = updated_history
            nb.updated_at = datetime.utcnow()
            await db.commit()
            response_payload["history"] = updated_history

        return response_payload
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
        "theme": "dracula" if project_type in ("p5js", "strudel", "game2d", "microbit", "circuitplayground") else "dark",
        "font_size": 14,
        "font_family": "jetbrains",
        "live_preview": project_type in ("p5js", "game2d"),
        "microbit_language": "python" if project_type == "microbit" else None,
        "device_language": "typescript" if project_type == "circuitplayground" else "python" if project_type == "microbit" else None,
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
    if project_type == "strudel":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "source": (
                "// Benvenuto nel live coding musicale con Strudel!\n"
                "// Scrivi un pattern e premi Play (o Shift+Enter)\n\n"
                'note("c3 e3 g3 b3")\n'
                '  .sound("triangle")\n'
                "  .slow(2)\n"
                "  .gain(0.6)\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "game2d":
        starter_spec = {
            "version": 1,
            "metadata": {
                "title": "Primo prototipo 2D",
                "description": "Un runner Phaser legge questo JSON e costruisce il livello.",
            },
            "world": {
                "width": 960,
                "height": 540,
                "background": "#0f172a",
                "gravity": 900,
            },
            "player": {
                "x": 80,
                "y": 420,
                "width": 32,
                "height": 42,
                "color": "#38bdf8",
                "speed": 260,
                "jump": 470,
            },
            "goal": {
                "x": 880,
                "y": 382,
                "width": 36,
                "height": 72,
                "color": "#facc15",
                "label": "Portale",
            },
            "entities": [
                {"id": "ground", "type": "platform", "x": 480, "y": 520, "width": 960, "height": 40, "color": "#334155"},
                {"id": "step-1", "type": "platform", "x": 250, "y": 420, "width": 180, "height": 24, "color": "#475569"},
                {"id": "step-2", "type": "platform", "x": 515, "y": 335, "width": 190, "height": 24, "color": "#475569"},
                {"id": "enemy-1", "type": "enemy", "x": 570, "y": 480, "width": 34, "height": 34, "color": "#fb7185", "behavior": {"kind": "patrol", "axis": "x", "distance": 120, "speed": 90}},
                {"id": "spikes", "type": "hazard", "x": 735, "y": 502, "width": 120, "height": 24, "color": "#ef4444"},
            ],
            "collectibles": [
                {"id": "star-1", "x": 250, "y": 370, "radius": 11, "color": "#fde047"},
                {"id": "star-2", "x": 515, "y": 285, "radius": 11, "color": "#fde047"},
                {"id": "star-3", "x": 820, "y": 455, "radius": 11, "color": "#fde047"},
            ],
            "ui": {
                "objective": "Raccogli le stelle e raggiungi il portale.",
            },
        }
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "name": "game.json",
            "source": json.dumps(starter_spec, ensure_ascii=False, indent=2),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "microbit":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "name": "main.py",
            "source": (
                "from microbit import *\n\n"
                "# Questo programma legge temperatura, luce e inclinazione della micro:bit.\n"
                "# Serve per far arrivare dati reali al cruscotto seriale del browser.\n"
                "while True:\n"
                "    temp = temperature()\n"
                "    luce = display.read_light_level()\n"
                "    x = accelerometer.get_x()\n\n"
                "    # Scriviamo una riga key=value: il browser la trasforma in valori nel cruscotto.\n"
                "    print('temp=' + str(temp) + ' luce=' + str(luce) + ' x=' + str(x))\n\n"
                "    # Un feedback semplice sulla matrice LED mostra se la scheda e inclinata.\n"
                "    if x > 300:\n"
                "        display.show(Image.ARROW_E)\n"
                "    elif x < -300:\n"
                "        display.show(Image.ARROW_W)\n"
                "    else:\n"
                "        display.show(Image.HAPPY)\n\n"
                "    sleep(500)\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "circuitplayground":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "name": "main.ts",
            "source": (
                "// Questo programma legge sensori onboard della Circuit Playground Express.\n"
                "// Serve per inviare dati reali al cruscotto seriale del browser.\n"
                "let temp = 0\n"
                "let luce = 0\n\n"
                "forever(function () {\n"
                "  // Leggiamo temperatura e luce: sono valori fisici rilevati dalla scheda.\n"
                "  temp = input.temperature(TemperatureUnit.Celsius)\n"
                "  luce = input.lightLevel()\n\n"
                "  // Scriviamo una riga key=value: il browser la trasforma in valori nel cruscotto.\n"
                "  serial.writeLine(\"temp=\" + temp + \" luce=\" + luce)\n\n"
                "  // I NeoPixel danno un feedback visivo: blu se fa fresco, rosso se fa caldo.\n"
                "  if (temp > 28) {\n"
                "    light.setAll(0xff0040)\n"
                "  } else {\n"
                "    light.setAll(0x0066ff)\n"
                "  }\n\n"
                "  pause(500)\n"
                "})\n"
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
