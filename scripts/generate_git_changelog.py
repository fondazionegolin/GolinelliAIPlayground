#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "docs" / "changelog-git-state.json"
DRAFT_PATH = ROOT / "frontend" / "public" / "changelog" / "git-draft.json"


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    return json.loads(STATE_PATH.read_text())


def save_state(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def normalize_commit(subject: str) -> dict:
    lower = subject.lower().strip()
    category = "improved"
    if lower.startswith(("feat:", "feature:", "add:", "new:")):
        category = "new"
    elif lower.startswith(("fix:", "bugfix:", "hotfix:")):
        category = "fixed"

    cleaned = subject
    for prefix in ("feat:", "feature:", "add:", "new:", "fix:", "bugfix:", "hotfix:", "chore:", "refactor:"):
        if lower.startswith(prefix):
            cleaned = subject[len(prefix):].strip()
            break

    title = cleaned[:1].upper() + cleaned[1:] if cleaned else "Aggiornamento piattaforma"
    return {
        "category": category,
        "title": title,
        "description": title,
    }


def main() -> None:
    head = run_git("rev-parse", "HEAD")
    short_head = run_git("rev-parse", "--short", "HEAD")
    branch = run_git("rev-parse", "--abbrev-ref", "HEAD")

    state = load_state()
    last_ref = state.get("last_processed_ref")

    if last_ref:
      commit_lines = run_git("log", "--format=%H%x1f%s", f"{last_ref}..HEAD")
    else:
      commit_lines = run_git("log", "--format=%H%x1f%s", "-n", "12")

    commits = []
    if commit_lines:
        for line in commit_lines.splitlines():
            sha, subject = line.split("\x1f", 1)
            if sha == last_ref:
                continue
            commits.append({"sha": sha, "subject": subject})

    if not commits:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "version_label": f"git-{short_head}",
            "title": "Nessuna novità da pubblicare",
            "summary": "Nessun commit nuovo rispetto all'ultimo draft generato.",
            "git_ref": head,
            "items": [],
        }
    else:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "version_label": f"{datetime.now().strftime('%Y.%m.%d')}-{short_head}",
            "title": f"Aggiornamenti branch {branch}",
            "summary": f"Bozza generata automaticamente da {len(commits)} commit nuovi.",
            "git_ref": head,
            "items": [normalize_commit(commit["subject"]) for commit in reversed(commits)],
        }

    DRAFT_PATH.parent.mkdir(parents=True, exist_ok=True)
    DRAFT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    save_state({"last_processed_ref": head, "generated_at": payload["generated_at"]})


if __name__ == "__main__":
    main()
