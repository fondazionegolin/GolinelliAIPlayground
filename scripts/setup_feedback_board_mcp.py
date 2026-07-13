#!/usr/bin/env python3
"""Interactive setup for the Golinelli feedback-board MCP server.

This script:
1. Gets an access token for https://dev.golinelli.ai.
2. Tests the feedback board API.
3. Tests the local stdio MCP server.
4. Optionally installs Codex user config in ~/.codex/config.toml.

No token is written inside this repository.
"""

from __future__ import annotations

import getpass
import json
import os
import pathlib
import shutil
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
MCP_SERVER = REPO_ROOT / "mcp" / "feedback_board_server.py"
DEFAULT_API_BASE = "https://dev.golinelli.ai/api/v1"
TOKEN_DIR = pathlib.Path.home() / ".golinelli-feedback-mcp"
TOKEN_FILE = TOKEN_DIR / "token"
CONFIG_BEGIN = "# BEGIN Golinelli feedback board MCP"
CONFIG_END = "# END Golinelli feedback board MCP"


def ask(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or (default or "")


def yes_no(prompt: str, default: bool = True) -> bool:
    marker = "Y/n" if default else "y/N"
    value = input(f"{prompt} [{marker}]: ").strip().lower()
    if not value:
        return default
    return value in {"y", "yes", "s", "si", "si'", "true", "1"}


def request_json(url: str, *, token: str | None = None, method: str = "GET", payload: dict | None = None):
    data = None
    headers = {"Accept": "application/json", "User-Agent": "golinelli-feedback-mcp-setup/0.1"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = body
        return exc.code, parsed


def login_for_token(api_base: str) -> str:
    print("\nLogin dev.golinelli.ai")
    email = ask("Email")
    password = getpass.getpass("Password: ")
    if not email or not password:
        raise SystemExit("Email e password sono obbligatorie per il login.")
    status, data = request_json(
        f"{api_base.rstrip('/')}/auth/login",
        method="POST",
        payload={"email": email, "password": password},
    )
    if status != 200 or not isinstance(data, dict) or not data.get("access_token"):
        raise SystemExit(f"Login fallito ({status}): {data}")
    return str(data["access_token"])


def get_token(api_base: str) -> str:
    env_token = os.getenv("GOLINELLI_API_TOKEN", "").strip()
    if env_token and yes_no("Uso il token gia presente in GOLINELLI_API_TOKEN?", True):
        return env_token

    print("\nCome vuoi autenticarti?")
    print("1. Login normale con email/password di https://dev.golinelli.ai (consigliato)")
    print("2. Ho gia un access_token copiato dal browser e voglio incollarlo")
    print("\nSe non sai cosa sia un access_token, scegli 1: ti basta usare le stesse credenziali con cui entri su dev.golinelli.ai.")
    choice = ask("Scelta", "1")
    if choice == "2":
        token = getpass.getpass("Access token (non viene mostrato): ").strip()
        if not token:
            raise SystemExit("Token vuoto.")
        return token
    return login_for_token(api_base)


def test_board_api(api_base: str, token: str) -> list[dict]:
    print("\nTest API board...")
    status, data = request_json(f"{api_base.rstrip('/')}/feedback/board", token=token)
    if status != 200 or not isinstance(data, list):
        raise SystemExit(f"Test API fallito ({status}): {data}")
    print(f"OK: letti {len(data)} task dalla board.")
    return data


def parse_json_lines(output: str) -> list[dict]:
    messages = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        messages.append(json.loads(line))
    return messages


def test_mcp_server(api_base: str, token: str) -> None:
    print("\nTest server MCP locale...")
    env = os.environ.copy()
    env["GOLINELLI_API_BASE_URL"] = api_base
    env["GOLINELLI_API_TOKEN"] = token
    payload = "\n".join(
        [
            '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
            '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
            '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_fix_groups","arguments":{"refresh":true}}}',
            "",
        ]
    )
    proc = subprocess.run(
        [sys.executable, str(MCP_SERVER)],
        input=payload,
        text=True,
        capture_output=True,
        env=env,
        cwd=str(REPO_ROOT),
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(f"Server MCP uscito con codice {proc.returncode}:\n{proc.stderr}")
    messages = parse_json_lines(proc.stdout)
    errors = [msg for msg in messages if msg.get("error")]
    if errors:
        raise SystemExit(f"Test MCP fallito:\n{json.dumps(errors, ensure_ascii=False, indent=2)}")
    group_msg = next((msg for msg in messages if msg.get("id") == 3), None)
    groups_text = ((group_msg or {}).get("result") or {}).get("content", [{}])[0].get("text", "[]")
    groups = json.loads(groups_text)
    print(f"OK: MCP attivo, {len(groups)} gruppi fix disponibili.")


def save_token(token: str) -> pathlib.Path:
    TOKEN_DIR.mkdir(mode=0o700, exist_ok=True)
    TOKEN_FILE.write_text(token.strip() + "\n", encoding="utf-8")
    os.chmod(TOKEN_FILE, 0o600)
    return TOKEN_FILE


def codex_block(api_base: str) -> str:
    return textwrap.dedent(
        f"""\
        {CONFIG_BEGIN}
        [mcp_servers.golinelli_feedback_board]
        command = "{sys.executable}"
        args = ["{MCP_SERVER}"]
        cwd = "{REPO_ROOT}"
        startup_timeout_sec = 10
        tool_timeout_sec = 60
        default_tools_approval_mode = "approve"

        [mcp_servers.golinelli_feedback_board.env]
        GOLINELLI_API_BASE_URL = "{api_base}"
        GOLINELLI_API_TOKEN_FILE = "{TOKEN_FILE}"
        {CONFIG_END}
        """
    ).strip()


def install_codex_config(api_base: str) -> pathlib.Path:
    config_dir = pathlib.Path.home() / ".codex"
    config_dir.mkdir(mode=0o700, exist_ok=True)
    config_path = config_dir / "config.toml"
    existing = config_path.read_text(encoding="utf-8") if config_path.exists() else ""

    block = codex_block(api_base)
    if CONFIG_BEGIN in existing and CONFIG_END in existing:
        before = existing.split(CONFIG_BEGIN, 1)[0].rstrip()
        after = existing.split(CONFIG_END, 1)[1].lstrip()
        new_text = "\n\n".join(part for part in [before, block, after] if part)
    else:
        new_text = "\n\n".join(part for part in [existing.rstrip(), block] if part)

    if config_path.exists():
        backup = config_path.with_suffix(f".toml.backup-{int(time.time())}")
        shutil.copy2(config_path, backup)
        print(f"Backup config esistente: {backup}")

    config_path.write_text(new_text.rstrip() + "\n", encoding="utf-8")
    os.chmod(config_path, 0o600)
    return config_path


def main() -> int:
    if "--install-codex-only" in sys.argv:
        api_base = DEFAULT_API_BASE
        for arg in sys.argv:
            if arg.startswith("--api-base="):
                api_base = arg.split("=", 1)[1].rstrip("/")
        path = install_codex_config(api_base)
        print(f"OK: configurazione Codex scritta in {path}")
        print(f"Token atteso in: {TOKEN_FILE}")
        print("Ora riavvia Codex e controlla /mcp.")
        return 0

    print("Setup MCP Feedback Board Golinelli")
    print(f"Repo: {REPO_ROOT}")
    if not MCP_SERVER.exists():
        raise SystemExit(f"Server MCP non trovato: {MCP_SERVER}")

    api_base = ask("API base", DEFAULT_API_BASE).rstrip("/")
    token = get_token(api_base)
    cards = test_board_api(api_base, token)
    test_mcp_server(api_base, token)
    token_path = save_token(token)
    print(f"OK: token salvato in file locale privato: {token_path}")

    if yes_no("\nVuoi installare la configurazione in ~/.codex/config.toml?", True):
        path = install_codex_config(api_base)
        print(f"OK: configurazione Codex scritta in {path}")
    else:
        print("\nConfig Codex da copiare manualmente:")
        print(codex_block(api_base))

    print("\nProssimi passi:")
    print("1. Apri una nuova sessione Codex in questo repo.")
    print("2. Esegui /mcp e verifica che golinelli_feedback_board sia connesso.")
    print("3. Scrivi: Usa il MCP golinelli_feedback_board e mostrami i gruppi fix disponibili.")
    print(f"\nTask letti durante il setup: {len(cards)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
