"""Named persistent tables for Dataflow Studio (``db.*`` nodes).

A table belongs to a workflow and is stored in ``agentic_workflow_tables``, so what one node inserts is still there
for the next run, the next chat turn or a later node ("insert rows, then pick at random from the table").
Rows are plain JSON dicts: inserts/updates/deletes work on Python lists so integers stay integers; pandas is only used
to evaluate ``where`` expressions (same dialect as «Filtra righe»).
"""
from __future__ import annotations

import json
import random
import re
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agentic import AgenticWorkflowTable
from app.services.dataflow_nodes import interpolate_variables, json_value

DB_NODES = {"db.create_table", "db.insert", "db.read", "db.query", "db.random_pick", "db.update", "db.delete_rows", "db.count"}
MAX_ROWS = 5000


def _csv(value: Any) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _table(columns: list[str], rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"columns": list(columns), "rows": rows, "rowCount": len(rows)}


def _coerce(raw: Any) -> Any:
    """«12» → 12, «3,5»/«3.5» → 3.5, everything else untouched."""
    if not isinstance(raw, str):
        return raw
    text = raw.strip()
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+[.,]\d+", text):
        return float(text.replace(",", "."))
    return text


def parse_assignments(raw: Any, variables: dict[str, Any]) -> dict[str, Any]:
    """«col=val; col2=val» (or a JSON object) → dict. ``$variabile`` is replaced before parsing."""
    text = interpolate_variables(raw, variables).strip() if raw not in (None, "") else ""
    if not text:
        return {}
    if text.startswith("{"):
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return {str(key): value for key, value in data.items()}
        except ValueError:
            pass
    pieces: list[str] = []
    for chunk in re.split(r"[;\n]", text):
        pieces += chunk.split(",") if chunk.count("=") > 1 else [chunk]
    result: dict[str, Any] = {}
    for piece in pieces:
        if "=" not in piece:
            if piece.strip():
                raise ValueError(f"Valore non valido «{piece.strip()}»: usa il formato colonna=valore; colonna2=valore")
            continue
        key, value = piece.split("=", 1)
        if key.strip():
            result[key.strip()] = _coerce(value)
    return result


def _name(config: dict[str, Any], variables: dict[str, Any]) -> str:
    name = interpolate_variables(config.get("table_name") or "", variables).strip()
    if not name:
        raise ValueError("Scrivi il nome della tabella (es. «domande»)")
    return name[:80]


async def _load(db: AsyncSession, workflow_id: Any, name: str, *, lock: bool = False) -> AgenticWorkflowTable | None:
    query = select(AgenticWorkflowTable).where(AgenticWorkflowTable.workflow_id == workflow_id, AgenticWorkflowTable.name == name)
    result = await db.execute(query.with_for_update() if lock else query)
    return result.scalar_one_or_none()


async def _require(db: AsyncSession, workflow_id: Any, name: str, *, lock: bool = False) -> AgenticWorkflowTable:
    record = await _load(db, workflow_id, name, lock=lock)
    if record is None:
        raise ValueError(f"La tabella «{name}» non esiste ancora: creala con «Crea tabella» o inserisci una riga")
    return record


async def _save(db: AsyncSession, record: AgenticWorkflowTable, columns: list[str], rows: list[dict[str, Any]]) -> None:
    if len(rows) > MAX_ROWS:
        raise ValueError(f"La tabella «{record.name}» supererebbe il limite di {MAX_ROWS} righe")
    record.columns, record.rows = list(columns), list(rows)
    await db.commit()


def _rows_of(value: Any) -> list[dict[str, Any]]:
    """Rows carried by an input: a table, a single row (dict) or nothing."""
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        return [dict(row) for row in value["rows"] if isinstance(row, dict)]
    if isinstance(value, dict):
        return [dict(value)]
    if isinstance(value, list):
        return [dict(row) for row in value if isinstance(row, dict)]
    return []


def _match(columns: list[str], rows: list[dict[str, Any]], where: str) -> list[int]:
    """Positions of the rows satisfying ``where`` (empty expression = every row)."""
    if not where.strip():
        return list(range(len(rows)))
    if not rows:
        return []
    frame = pd.DataFrame(rows, columns=columns)
    try:
        return [int(index) for index in frame.query(where.strip()).index]
    except Exception as exc:
        raise ValueError(f"Condizione non valida ({exc}). Colonne disponibili: {', '.join(columns) or 'nessuna'}") from exc


def _merge_columns(columns: list[str], rows: list[dict[str, Any]]) -> list[str]:
    return list(dict.fromkeys([*columns, *(str(key) for row in rows for key in row)]))


async def run_db_node(node_type: str, inputs: dict[str, Any], config: dict[str, Any], state: dict[str, Any], db: AsyncSession | None) -> dict[str, Any]:
    workflow_id = state.get("workflow_id")
    if db is None or not workflow_id:
        raise ValueError("Le tabelle con nome si usano salvando il workflow: salvalo e riprova")
    variables = state.get("variables") or {}
    name = _name(config, variables)
    where = interpolate_variables(config.get("where") or "", variables)

    if node_type == "db.create_table":
        record = await _load(db, workflow_id, name, lock=True)
        columns = _csv(interpolate_variables(config.get("columns") or "", variables))
        seed_rows = _rows_of(inputs.get("table"))
        columns = _merge_columns(columns, seed_rows)
        replace = config.get("if_exists", "keep") == "replace"
        if record is None:
            record = AgenticWorkflowTable(workflow_id=workflow_id, name=name, columns=[], rows=[])
            db.add(record)
        elif not replace:
            return {"table": _table(record.columns or [], record.rows or [])}
        await _save(db, record, columns, seed_rows)
        return {"table": _table(columns, seed_rows)}

    if node_type == "db.insert":
        incoming = _rows_of(inputs.get("table")) + _rows_of(inputs.get("row"))
        typed = parse_assignments(config.get("values"), variables)
        if typed:
            # Typed fields complete a connected row; with several connected rows they apply to each one.
            incoming = [{**row, **typed} for row in incoming] if incoming else [typed]
        if not incoming:
            raise ValueError("Niente da inserire: compila «Valori» (colonna=valore) o collega una riga/tabella")
        record = await _load(db, workflow_id, name, lock=True)
        if record is None:
            record = AgenticWorkflowTable(workflow_id=workflow_id, name=name, columns=[], rows=[])
            db.add(record)
        rows = [dict(row) for row in (record.rows or [])] + [{str(key): json_value(value) for key, value in row.items()} for row in incoming]
        columns = _merge_columns(record.columns or [], incoming)
        await _save(db, record, columns, rows)
        return {"table": _table(columns, rows), "count": len(incoming)}

    record = await _require(db, workflow_id, name, lock=node_type in {"db.update", "db.delete_rows", "db.random_pick"})
    columns, rows = list(record.columns or []), [dict(row) for row in (record.rows or [])]

    if node_type == "db.read":
        return {"table": _table(columns, rows)}

    if node_type == "db.count":
        return {"count": len(_match(columns, rows, where))}

    if node_type == "db.query":
        picked = [rows[i] for i in _match(columns, rows, where)]
        order_by = str(config.get("order_by") or "").strip()
        if order_by:
            if order_by not in columns:
                raise ValueError(f"Colonna di ordinamento «{order_by}» inesistente. Colonne: {', '.join(columns)}")
            descending = config.get("order") == "descending"
            filled = [row for row in picked if row.get(order_by) is not None]
            missing = [row for row in picked if row.get(order_by) is None]
            try:
                filled.sort(key=lambda row: row[order_by], reverse=descending)
            except TypeError:
                filled.sort(key=lambda row: str(row[order_by]), reverse=descending)
            picked = filled + missing
        chosen = [c for c in _csv(config.get("columns")) if c in columns]
        out_columns = chosen or columns
        picked = [{c: row.get(c) for c in out_columns} for row in picked]
        limit = int(config.get("limit") or 0)
        return {"table": _table(out_columns, picked[:limit] if limit > 0 else picked)}

    if node_type == "db.random_pick":
        candidates = _match(columns, rows, where)
        count = max(1, int(config.get("count") or 1))
        if not candidates:
            if config.get("on_empty") == "ignora":
                return {"table": _table(columns, []), "row": None}
            raise ValueError(f"Nessuna riga da estrarre nella tabella «{name}»" + (" con la condizione data" if where.strip() else " (è vuota)"))
        seed = int(config.get("seed") or 0)
        chooser = random.Random(seed) if seed else random
        positions = chooser.sample(candidates, min(count, len(candidates)))
        picked = [rows[i] for i in positions]
        if config.get("remove"):
            remaining = [row for i, row in enumerate(rows) if i not in set(positions)]
            await _save(db, record, columns, remaining)
        return {"table": _table(columns, [dict(row) for row in picked]), "row": dict(picked[0])}

    if node_type == "db.update":
        changes = parse_assignments(config.get("set"), variables)
        if not changes:
            raise ValueError("Scrivi cosa cambiare in «Imposta» (colonna=valore)")
        positions = _match(columns, rows, where)
        for i in positions:
            rows[i].update(changes)
        columns = _merge_columns(columns, [changes])
        await _save(db, record, columns, rows)
        return {"table": _table(columns, rows), "count": len(positions)}

    if node_type == "db.delete_rows":
        if not where.strip() and not config.get("delete_all"):
            raise ValueError("Scrivi la condizione delle righe da eliminare (oppure attiva «Elimina tutte le righe»)")
        doomed = set(_match(columns, rows, where))
        rows = [row for i, row in enumerate(rows) if i not in doomed]
        await _save(db, record, columns, rows)
        return {"table": _table(columns, rows), "count": len(doomed)}

    raise ValueError(f"Nodo tabella non supportato: {node_type}")
