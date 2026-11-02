#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "docs" / "changelog-git-state.json"
DRAFT_PATH = ROOT / "frontend" / "public" / "changelog" / "git-draft.json"
RELEASE_METADATA_PATHS = {"docs/changelog-git-state.json", "frontend/public/changelog/git-draft.json"}


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
    match = re.match(r"^(\w+)(?:\(([^)]*)\))?!?:\s*(.*)$", subject.strip())
    kind, scope, rest = (match.group(1).lower(), match.group(2), match.group(3)) if match else ("", None, subject.strip())
    category = "improved"
    if kind in ("feat", "feature", "add", "new"):
        category = "new"
    elif kind in ("fix", "bugfix", "hotfix"):
        category = "fixed"

    cleaned = f"{scope}: {rest}" if scope and rest else rest
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
    # The draft is cumulative: it lists every commit since the last *published* release, so a push that is not
    # followed by a publish never drops earlier commits from the next draft.
    last_ref = state.get("published_ref") or state.get("last_processed_ref")

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
            paths = set(run_git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines())
            if paths and paths.issubset(RELEASE_METADATA_PATHS):
                continue
            commits.append({"sha": sha, "subject": subject})

    if not commits:
        # A repeated push or a commit publishing the draft must preserve the
        # reviewed release instead of replacing it with an empty/metadata draft.
        return
    else:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "version_label": f"{datetime.now().strftime('%Y.%m.%d')}-{short_head}",
            "title": f"Aggiornamenti branch {branch}",
            "summary": f"Bozza generata automaticamente da {len(commits)} commit dall'ultima release pubblicata.",
            "git_ref": head,
            "items": [normalize_commit(commit["subject"]) for commit in reversed(commits)],
        }

    DRAFT_PATH.parent.mkdir(parents=True, exist_ok=True)
    DRAFT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    save_state({**state, "last_processed_ref": head, "generated_at": payload["generated_at"]})


def mark_published() -> None:
    """Call after the current draft has been published in Admin > Backend: the next draft starts after it."""
    state = load_state()
    draft = json.loads(DRAFT_PATH.read_text()) if DRAFT_PATH.exists() else {}
    ref = draft.get("git_ref") or run_git("rev-parse", "HEAD")
    save_state({**state, "published_ref": ref})


if __name__ == "__main__":
    if "--mark-published" in sys.argv:
        mark_published()
    else:
        main()
