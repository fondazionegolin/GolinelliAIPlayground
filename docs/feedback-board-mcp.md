# Feedback Board MCP

Server MCP per collegare Codex o Claude Code alla board sviluppo/feedback di Golinelli AI.

Il server espone i task della board come tool MCP. L'agente puo` leggere gruppi, prompt, dettagli e screenshot; puo` anche aggiornare un task tramite l'API ufficiale, ad esempio spostandolo in `Rilasciato / Chiuso` dopo il fix.

## Setup facile

Esegui questo comando dalla root del repo:

```bash
python3 scripts/setup_feedback_board_mcp.py
```

Lo script ti guida passo passo:

1. usa `https://dev.golinelli.ai/api/v1` come ambiente predefinito;
2. ti chiede login oppure un access token gia copiato;
3. testa la lettura della board;
4. testa il server MCP locale;
5. se vuoi, installa automaticamente la config in `~/.codex/config.toml`.

Il token non viene scritto nel repository. Se scegli l'installazione automatica, viene scritto solo nella tua config locale di Codex (`~/.codex/config.toml`, permessi `600`).

In pratica:

- `~/.codex/config.toml` dice a Codex che esiste il server MCP;
- `~/.golinelli-feedback-mcp/token` contiene il token privato usato dal server;
- il repository non contiene segreti.

Se in Codex fai `/mcp` e non compare nulla, quasi sempre significa che il blocco `mcp_servers.golinelli_feedback_board` non e` ancora in `~/.codex/config.toml`, oppure Codex era gia aperto e va riavviato dopo l'installazione.

Quando lo script finisce:

```text
1. Apri una nuova sessione Codex in questo repo.
2. Esegui /mcp.
3. Chiedi: Usa il MCP golinelli_feedback_board e mostrami i gruppi fix disponibili.
```

## File

- Server: `mcp/feedback_board_server.py`
- Setup guidato: `scripts/setup_feedback_board_mcp.py`
- Trasporto: stdio
- Dipendenze: solo Python standard library
- API usate: `GET /api/v1/feedback/board`, `PATCH /api/v1/feedback/board/{feedback_id}`

## Tool esposti

| Tool | Scopo |
| --- | --- |
| `list_fix_groups` | Raggruppa i task attivi per `bug`, `feature`, `ui`, `ux`, `unclassified`. |
| `get_fix_prompt` | Genera il meta-prompt agentico per un gruppo. |
| `get_task` | Restituisce il dettaglio completo di un task/feedback. |
| `get_task_screenshot` | Restituisce lo screenshot del task come contenuto immagine MCP. |
| `update_task` | Aggiorna stato, categoria, urgenza o nota interna di un task. Se chiamato solo con `task_id`, sposta il task in `released`. |

I task con `board_status` `released` o `approved` sono esclusi dai gruppi attivi.

Esempio chiusura task:

```json
{
  "task_id": "2cb83309-b697-4ea4-aa5d-8abc7fc0a3ac",
  "board_status": "released",
  "internal_note": "Fix implementato e build frontend/backend verificata."
}
```

## Variabili d'ambiente

| Variabile | Obbligatoria | Default | Note |
| --- | --- | --- | --- |
| `GOLINELLI_API_TOKEN` | No se usi `GOLINELLI_API_TOKEN_FILE` | - | Access token docente/admin/collaboratore board. |
| `GOLINELLI_API_TOKEN_FILE` | No | `~/.golinelli-feedback-mcp/token` | File locale privato da cui leggere il token. |
| `GOLINELLI_API_BASE_URL` | No | `http://localhost:8000/api/v1` | Base API. Per dev usa `https://dev.golinelli.ai/api/v1`. Accetta anche base senza `/api/v1`. |
| `GOLINELLI_MCP_TIMEOUT_SEC` | No | `20` | Timeout chiamate API. |
| `GOLINELLI_MCP_CACHE_TTL_SEC` | No | `15` | Cache breve dei task board. |

## Recuperare il token

Opzione via browser, dopo login su `https://dev.golinelli.ai` come admin/docente collaboratore:

```js
JSON.parse(localStorage.getItem('eduai-auth')).state.accessToken
```

Opzione via API:

```bash
curl -sS -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"TUO_EMAIL","password":"TUA_PASSWORD"}'
```

Usa il campo `access_token` della risposta.

Per dev:

```bash
curl -sS -X POST https://dev.golinelli.ai/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"TUO_EMAIL","password":"TUA_PASSWORD"}'
```

## Smoke test locale

Senza token puoi almeno verificare handshake e lista tool:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 mcp/feedback_board_server.py
```

Con token e backend attivo:

```bash
export GOLINELLI_API_BASE_URL=https://dev.golinelli.ai/api/v1
export GOLINELLI_API_TOKEN='INCOLLA_TOKEN'

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_fix_groups","arguments":{"refresh":true}}}' \
  | python3 mcp/feedback_board_server.py
```

## Configurazione Codex

Codex supporta MCP su CLI e IDE extension. La configurazione vive in `~/.codex/config.toml` oppure in `.codex/config.toml` per progetto trusted.

Consigliato: tieni il token fuori dal file e usa `GOLINELLI_API_TOKEN_FILE`.

```toml
[mcp_servers.golinelli_feedback_board]
command = "python3"
args = ["/home/ale/GIT/GolinelliAIPlayground/mcp/feedback_board_server.py"]
cwd = "/home/ale/GIT/GolinelliAIPlayground"
startup_timeout_sec = 10
tool_timeout_sec = 60
default_tools_approval_mode = "approve"

[mcp_servers.golinelli_feedback_board.env]
GOLINELLI_API_BASE_URL = "https://dev.golinelli.ai/api/v1"
GOLINELLI_API_TOKEN_FILE = "/home/ale/.golinelli-feedback-mcp/token"
```

Poi riavvia Codex. Il server leggera` il token dal file privato.

Nel TUI Codex usa:

```text
/mcp
```

per verificare che `golinelli_feedback_board` sia connesso.

Prompt operativo dentro Codex:

```text
Usa il MCP golinelli_feedback_board. Prima chiama list_fix_groups, poi scegli il gruppo bug piu urgente, recupera get_fix_prompt e gli screenshot disponibili, quindi implementa i fix seguendo la checklist.
```

## Configurazione Claude Code

Config locale con CLI:

```bash
export GOLINELLI_API_TOKEN='INCOLLA_TOKEN'
claude mcp add --scope local --transport stdio golinelli-feedback-board \
  --env GOLINELLI_API_TOKEN="$GOLINELLI_API_TOKEN" \
  --env GOLINELLI_API_BASE_URL="https://dev.golinelli.ai/api/v1" \
  -- python3 /home/ale/GIT/GolinelliAIPlayground/mcp/feedback_board_server.py
```

In alternativa, `.mcp.json` di progetto:

```json
{
  "mcpServers": {
    "golinelli-feedback-board": {
      "type": "stdio",
      "command": "python3",
      "args": ["/home/ale/GIT/GolinelliAIPlayground/mcp/feedback_board_server.py"],
      "env": {
        "GOLINELLI_API_BASE_URL": "https://dev.golinelli.ai/api/v1",
        "GOLINELLI_API_TOKEN_FILE": "/home/ale/.golinelli-feedback-mcp/token"
      }
    }
  }
}
```

Dopo l'avvio, usa `/mcp` in Claude Code per controllare lo stato.

## Workflow consigliato

1. Chiedi all'agente: `list_fix_groups`.
2. Scegli un gruppo: `bug`, `feature`, `ui`, `ux` o `unclassified`.
3. Chiedi `get_fix_prompt` per quel gruppo.
4. Se il prompt segnala screenshot, chiedi `get_task_screenshot` per i task indicati.
5. Lascia che l'agente lavori nel repository.
6. Alla fine usa `update_task` per spostare in `released` i task effettivamente risolti e verificati.

## Sicurezza

- Le mutazioni passano dall'API applicativa e rispettano gli stessi permessi della board.
- Il token deve appartenere a un admin o docente collaboratore della board.
- Non committare token in `.codex/config.toml`, `.mcp.json`, `.env` o screenshot.
- Per ora preferisci stdio locale: evita di esporre un server MCP HTTP pubblico finche` non ci sono auth dedicata, origin checks e rate limit.

## Riferimenti ufficiali

- MCP transport stdio: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Codex MCP: https://developers.openai.com/codex/mcp
- Claude Code MCP: https://code.claude.com/docs/en/mcp
