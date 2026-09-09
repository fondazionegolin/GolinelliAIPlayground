#!/usr/bin/env python3
"""MCP server for the Golinelli feedback development board.

Transport: stdio, newline-delimited JSON-RPC as defined by MCP 2025-06-18.
Authentication: forwards GOLINELLI_API_TOKEN as Bearer token to the app API.
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import sys
import textwrap
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "golinelli-feedback-board"
SERVER_VERSION = "0.2.0"
DEFAULT_TOKEN_FILE = "~/.golinelli-feedback-mcp/token"

BOARD_STATUSES = {
    "inbox",
    "triage",
    "ready",
    "in_progress",
    "qa",
    "approved",
    "released",
}
CATEGORIES = {"bug", "feature", "ui", "ux"}
URGENCIES = {"alta", "media", "bassa"}

CATEGORY_LABELS = {
    "bug": "Bug",
    "feature": "Feature",
    "ui": "UI",
    "ux": "UX",
    "unclassified": "Non classificati",
}

URGENCY_LABELS = {
    "alta": "Alta",
    "media": "Media",
    "bassa": "Bassa",
}

URGENCY_ORDER = {
    "alta": 0,
    "media": 1,
    "bassa": 2,
}


class McpError(Exception):
    def __init__(self, message: str, code: int = -32000):
        super().__init__(message)
        self.code = code


@dataclass
class ApiConfig:
    base_url: str
    token: str
    token_file: pathlib.Path | None
    timeout_sec: float
    cache_ttl_sec: float


class FeedbackBoardClient:
    def __init__(self, config: ApiConfig):
        self.config = config
        self._cards_cache: tuple[float, list[dict[str, Any]]] | None = None

    def _url(self, path: str) -> str:
        base = self.config.base_url.rstrip("/")
        if base.endswith("/api/v1"):
            return f"{base}{path}"
        return f"{base}/api/v1{path}"

    def _request_json(self, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
        token = self.config.token
        if self.config.token_file and self.config.token_file.exists():
            token = self.config.token_file.read_text(encoding="utf-8").strip()
        if not token:
            raise McpError(
                "GOLINELLI_API_TOKEN non configurato. Esporta un access token docente/admin prima di avviare il server MCP.",
                code=-32001,
            )
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": f"{SERVER_NAME}/{SERVER_VERSION}",
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self._url(path),
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout_sec) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise McpError(f"API board HTTP {exc.code}: {detail}", code=-32002) from exc
        except urllib.error.URLError as exc:
            raise McpError(f"API board non raggiungibile: {exc.reason}", code=-32003) from exc

    def list_cards(self, *, refresh: bool = False) -> list[dict[str, Any]]:
        now = time.time()
        if (
            not refresh
            and self._cards_cache is not None
            and now - self._cards_cache[0] < self.config.cache_ttl_sec
        ):
            return self._cards_cache[1]
        cards = self._request_json("/feedback/board")
        if not isinstance(cards, list):
            raise McpError("Risposta API inattesa: /feedback/board non ha restituito una lista.", code=-32004)
        self._cards_cache = (now, cards)
        return cards

    def get_card(self, task_id: str) -> dict[str, Any]:
        for card in self.list_cards(refresh=False):
            if str(card.get("id")) == task_id:
                return card
        for card in self.list_cards(refresh=True):
            if str(card.get("id")) == task_id:
                return card
        raise McpError(f"Task non trovato: {task_id}", code=-32005)

    def update_card(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        updated = self._request_json(
            f"/feedback/board/{urllib.parse.quote(task_id, safe='')}",
            method="PATCH",
            body=payload,
        )
        self._cards_cache = None
        if not isinstance(updated, dict):
            raise McpError("Risposta API inattesa: update task non ha restituito un oggetto.", code=-32008)
        return updated


def configured_client() -> FeedbackBoardClient:
    base_url = os.getenv("GOLINELLI_API_BASE_URL", "http://localhost:8000/api/v1")
    token = os.getenv("GOLINELLI_API_TOKEN", "").strip()
    token_file: pathlib.Path | None = None
    if not token:
        token_file = pathlib.Path(os.getenv("GOLINELLI_API_TOKEN_FILE", DEFAULT_TOKEN_FILE)).expanduser()
        if token_file.exists():
            token = token_file.read_text(encoding="utf-8").strip()
    timeout_sec = float(os.getenv("GOLINELLI_MCP_TIMEOUT_SEC", "20"))
    cache_ttl_sec = float(os.getenv("GOLINELLI_MCP_CACHE_TTL_SEC", "15"))
    return FeedbackBoardClient(ApiConfig(base_url=base_url, token=token, token_file=token_file, timeout_sec=timeout_sec, cache_ttl_sec=cache_ttl_sec))


CLIENT = configured_client()


def page_label(page_url: str | None) -> str:
    if not page_url:
        return "Pagina non indicata"
    try:
        parsed = urllib.parse.urlparse(page_url)
        if parsed.path:
            return parsed.path
    except Exception:
        pass
    return page_url


def describe_environment(card: dict[str, Any]) -> str:
    info = card.get("browser_info") or {}
    parts = []
    if info.get("viewport_width") and info.get("viewport_height"):
        parts.append(f"viewport {info['viewport_width']}x{info['viewport_height']}")
    if info.get("screen_width") and info.get("screen_height"):
        parts.append(f"schermo {info['screen_width']}x{info['screen_height']}")
    if info.get("platform"):
        parts.append(str(info["platform"]))
    if info.get("language"):
        parts.append(str(info["language"]))
    return ", ".join(parts) or "non disponibile"


def max_urgency(cards: list[dict[str, Any]]) -> str | None:
    values = [str(card.get("urgency") or "bassa") for card in cards]
    if not values:
        return None
    return sorted(values, key=lambda value: URGENCY_ORDER.get(value, 3))[0]


def active_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [card for card in cards if str(card.get("board_status") or "") not in {"released", "approved"}]


def sort_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        cards,
        key=lambda card: (
            URGENCY_ORDER.get(str(card.get("urgency") or "bassa"), 3),
            str(card.get("created_at") or ""),
        ),
    )


def group_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for card in active_cards(cards):
        key = str(card.get("category") or "unclassified")
        grouped.setdefault(key, []).append(card)

    out = []
    for key, group in grouped.items():
        sorted_group = sort_cards(group)
        screenshot_count = sum(1 for card in sorted_group if (card.get("browser_info") or {}).get("screenshot_base64"))
        urgency = max_urgency(sorted_group)
        out.append(
            {
                "id": key,
                "title": CATEGORY_LABELS.get(key, key),
                "category": key,
                "task_count": len(sorted_group),
                "screenshot_count": screenshot_count,
                "max_urgency": urgency,
                "max_urgency_label": URGENCY_LABELS.get(urgency or "", urgency),
                "task_ids": [str(card.get("id")) for card in sorted_group],
                "pages": sorted({page_label(card.get("page_url")) for card in sorted_group}),
            }
        )

    return sorted(
        out,
        key=lambda group: (
            URGENCY_ORDER.get(str(group.get("max_urgency") or "bassa"), 3),
            -int(group.get("task_count") or 0),
        ),
    )


def task_prompt_block(card: dict[str, Any], index: int) -> str:
    info = card.get("browser_info") or {}
    errors = (card.get("console_errors") or [])[:8]
    error_block = "\n".join(f"    {idx + 1}. {err}" for idx, err in enumerate(errors)) if errors else "    Nessun errore console registrato."
    screenshot = (
        f"presente: richiedi/usa get_task_screenshot per task {index}"
        if info.get("screenshot_base64")
        else "non presente"
    )
    note = str(card.get("internal_note") or "").strip()
    return "\n".join(
        line
        for line in [
            f"### Task {index} - {CATEGORY_LABELS.get(str(card.get('category') or 'unclassified'), 'Non classificato')} / {URGENCY_LABELS.get(str(card.get('urgency') or ''), 'Urgenza N/D')}",
            f"- ID feedback: {card.get('id')}",
            f"- Stato board: {card.get('board_status')}",
            f"- Fonte: {'task manuale' if card.get('source') == 'manual' else 'feedback utente'}",
            f"- Segnalato da: {card.get('user_display_name') or 'Anonimo'} ({card.get('user_type')})",
            f"- Pagina: {page_label(card.get('page_url'))}",
            f"- Ambiente: {describe_environment(card)}",
            f"- Screenshot: {screenshot}",
            f"- Messaggio: {card.get('message')}",
            f"- Nota interna: {note}" if note else "",
            "- Errori console:",
            error_block,
        ]
        if line
    )


def build_fix_prompt(group_id: str, cards: list[dict[str, Any]]) -> str:
    group = next((item for item in group_cards(cards) if item["id"] == group_id), None)
    if not group:
        raise McpError(f"Gruppo non trovato o senza task attivi: {group_id}", code=-32006)

    group_tasks = [card for card in active_cards(cards) if str(card.get("category") or "unclassified") == group_id]
    group_tasks = sort_cards(group_tasks)
    task_blocks = "\n\n".join(task_prompt_block(card, idx + 1) for idx, card in enumerate(group_tasks))
    screenshot_refs = [
        f"- Task {idx + 1} ({card.get('id')}): screenshot disponibile via get_task_screenshot."
        for idx, card in enumerate(group_tasks)
        if (card.get("browser_info") or {}).get("screenshot_base64")
    ]
    if not screenshot_refs:
        screenshot_refs = ["- Nessuno screenshot disponibile."]

    return textwrap.dedent(
        f"""\
        Sei Codex/Claude Code in una codebase esistente. Implementa un ciclo completo di fix per questo gruppo della board feedback Golinelli.

        Obiettivo:
        Risolvere insieme i task raggruppati sotto "{group['title']}", mantenendo l'intervento coerente, piccolo e verificabile.

        Contesto gruppo:
        - Tipologia: {group['title']}
        - Priorita massima: {group.get('max_urgency_label') or 'N/D'}
        - Task inclusi: {group['task_count']}
        - Pagine/aree coinvolte: {", ".join(group['pages'])}

        Regole operative:
        - Prima leggi il codice e individua i punti responsabili del comportamento segnalato.
        - Usa i tool MCP della board per recuperare dettagli e screenshot quando servono.
        - Non fare refactor non richiesti e non revertire modifiche non tue.
        - Se i task sembrano avere cause diverse, separa le ipotesi ma consegna una soluzione coerente.
        - Dopo le modifiche esegui i test o almeno il controllo piu vicino disponibile; se non puoi, spiega il motivo.

        Task da lavorare:

        {task_blocks}

        Screenshot disponibili:
        {chr(10).join(screenshot_refs)}

        Checklist:
        - [ ] Riprodurre o dedurre il comportamento attuale da codice, pagina, console error e screenshot.
        - [ ] Identificare la causa probabile per ogni task.
        - [ ] Implementare il fix mantenendo compatibilita con i flussi esistenti.
        - [ ] Verificare UI responsive e stati vuoti/loading/error quando pertinenti.
        - [ ] Aggiornare eventuali copy, tipi o API client solo se necessari.
        - [ ] Eseguire lint/test/build mirati o documentare cosa non e stato possibile verificare.
        - [ ] Chiudere con riepilogo: file modificati, task coperti, test eseguiti, rischi residui.

        Criteri di accettazione:
        - Tutti i task elencati sono risolti o esplicitamente classificati come non riproducibili/bloccati con motivo.
        - La soluzione non introduce regressioni evidenti nelle altre colonne della board o nelle pagine correlate.
        - Il riepilogo finale permette di aggiornare rapidamente la board feedback.
        """
    ).strip()


def data_uri_to_image(data_uri: str) -> tuple[str, str]:
    if "," not in data_uri:
        return "image/png", data_uri
    header, encoded = data_uri.split(",", 1)
    mime = "image/png"
    if header.startswith("data:"):
        mime = header[5:].split(";", 1)[0] or mime
    return mime, encoded


TOOLS = [
    {
        "name": "list_fix_groups",
        "description": "Lista i gruppi attivi della board feedback raggruppati per tipologia.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "refresh": {
                    "type": "boolean",
                    "description": "Forza il refresh dalla API invece di usare la cache breve.",
                    "default": False,
                }
            },
        },
    },
    {
        "name": "get_fix_prompt",
        "description": "Genera il meta-prompt agentico per un gruppo della board feedback.",
        "inputSchema": {
            "type": "object",
            "required": ["group_id"],
            "properties": {
                "group_id": {
                    "type": "string",
                    "description": "ID gruppo restituito da list_fix_groups, es. bug, feature, ui, ux, unclassified.",
                }
            },
        },
    },
    {
        "name": "get_task",
        "description": "Restituisce il dettaglio completo di un task/feedback.",
        "inputSchema": {
            "type": "object",
            "required": ["task_id"],
            "properties": {
                "task_id": {"type": "string", "description": "ID feedback/task."}
            },
        },
    },
    {
        "name": "get_task_screenshot",
        "description": "Restituisce lo screenshot allegato al task come contenuto immagine MCP.",
        "inputSchema": {
            "type": "object",
            "required": ["task_id"],
            "properties": {
                "task_id": {"type": "string", "description": "ID feedback/task."}
            },
        },
    },
    {
        "name": "update_task",
        "description": "Aggiorna un task della board feedback. Usa board_status='released' per spostarlo in Rilasciato / Chiuso.",
        "inputSchema": {
            "type": "object",
            "required": ["task_id"],
            "properties": {
                "task_id": {"type": "string", "description": "ID feedback/task."},
                "board_status": {
                    "type": "string",
                    "description": "Nuovo stato board.",
                    "enum": sorted(BOARD_STATUSES),
                    "default": "released",
                },
                "category": {
                    "type": "string",
                    "description": "Categoria task.",
                    "enum": sorted(CATEGORIES),
                },
                "urgency": {
                    "type": "string",
                    "description": "Urgenza task.",
                    "enum": sorted(URGENCIES),
                },
                "internal_note": {
                    "type": "string",
                    "description": "Nota interna da salvare sul task.",
                },
            },
        },
    },
]


def tool_result_text(payload: Any) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, indent=2),
            }
        ]
    }


def call_tool(name: str, args: dict[str, Any] | None) -> dict[str, Any]:
    args = args or {}
    if name == "list_fix_groups":
        cards = CLIENT.list_cards(refresh=bool(args.get("refresh")))
        return tool_result_text(group_cards(cards))
    if name == "get_fix_prompt":
        group_id = str(args.get("group_id") or "").strip()
        if not group_id:
            raise McpError("group_id obbligatorio", code=-32602)
        return tool_result_text(build_fix_prompt(group_id, CLIENT.list_cards(refresh=False)))
    if name == "get_task":
        task_id = str(args.get("task_id") or "").strip()
        if not task_id:
            raise McpError("task_id obbligatorio", code=-32602)
        return tool_result_text(CLIENT.get_card(task_id))
    if name == "get_task_screenshot":
        task_id = str(args.get("task_id") or "").strip()
        if not task_id:
            raise McpError("task_id obbligatorio", code=-32602)
        card = CLIENT.get_card(task_id)
        data_uri = (card.get("browser_info") or {}).get("screenshot_base64")
        if not data_uri:
            raise McpError(f"Nessuno screenshot disponibile per task {task_id}", code=-32007)
        mime, data = data_uri_to_image(str(data_uri))
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Screenshot task {task_id} ({page_label(card.get('page_url'))}).",
                },
                {
                    "type": "image",
                    "mimeType": mime,
                    "data": data,
                },
            ]
        }
    if name == "update_task":
        task_id = str(args.get("task_id") or "").strip()
        if not task_id:
            raise McpError("task_id obbligatorio", code=-32602)
        payload: dict[str, Any] = {}
        if "board_status" in args:
            board_status = str(args.get("board_status") or "").strip()
            if board_status not in BOARD_STATUSES:
                raise McpError(f"board_status non valido: {board_status}", code=-32602)
            payload["board_status"] = board_status
        if "category" in args:
            category = str(args.get("category") or "").strip()
            if category not in CATEGORIES:
                raise McpError(f"category non valida: {category}", code=-32602)
            payload["category"] = category
        if "urgency" in args:
            urgency = str(args.get("urgency") or "").strip()
            if urgency not in URGENCIES:
                raise McpError(f"urgency non valida: {urgency}", code=-32602)
            payload["urgency"] = urgency
        if "internal_note" in args:
            payload["internal_note"] = str(args.get("internal_note") or "")
        if not payload:
            payload["board_status"] = "released"
        return tool_result_text(CLIENT.update_card(task_id, payload))
    raise McpError(f"Tool sconosciuto: {name}", code=-32601)


def handle_request(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") or {}

    if request_id is None:
        return None

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {"listChanged": False},
                },
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION,
                },
                "instructions": (
                    "Access to the Golinelli feedback development board. "
                    "Use list_fix_groups before get_fix_prompt. Use get_task_screenshot when a prompt references screenshots. "
                    "Use update_task with board_status='released' only after a task has been fixed and verified."
                ),
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") or {}
        return {"jsonrpc": "2.0", "id": request_id, "result": call_tool(name, arguments)}

    raise McpError(f"Metodo non supportato: {method}", code=-32601)


def write_message(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            response = handle_request(message)
            if response is not None:
                write_message(response)
        except McpError as exc:
            request_id = None
            try:
                request_id = json.loads(line).get("id")
            except Exception:
                pass
            write_message({"jsonrpc": "2.0", "id": request_id, "error": {"code": exc.code, "message": str(exc)}})
        except Exception as exc:  # noqa: BLE001
            print(traceback.format_exc(), file=sys.stderr)
            request_id = None
            try:
                request_id = json.loads(line).get("id")
            except Exception:
                pass
            write_message({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": str(exc)}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
