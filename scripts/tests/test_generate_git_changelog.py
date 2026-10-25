import importlib.util
import json
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "generate_git_changelog.py"
SPEC = importlib.util.spec_from_file_location("generate_git_changelog", SCRIPT)
changelog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(changelog)


def configure(monkeypatch, tmp_path, log, paths):
    state = tmp_path / "state.json"
    draft = tmp_path / "draft.json"
    state.write_text(json.dumps({"last_processed_ref": "previous"}))
    draft.write_text(json.dumps({"title": "Reviewed release", "items": [{"title": "Full books"}]}))
    monkeypatch.setattr(changelog, "STATE_PATH", state)
    monkeypatch.setattr(changelog, "DRAFT_PATH", draft)

    def run_git(*args):
        if args[0] == "log":
            return log
        if args[0] == "diff-tree":
            return paths[args[-1]]
        if "--abbrev-ref" in args:
            return "staging"
        return "current"

    monkeypatch.setattr(changelog, "run_git", run_git)
    return state, draft


def test_repeated_push_preserves_reviewed_release(monkeypatch, tmp_path):
    state, draft = configure(monkeypatch, tmp_path, "", {})
    before = state.read_bytes(), draft.read_bytes()
    changelog.main()
    assert (state.read_bytes(), draft.read_bytes()) == before


def test_metadata_commit_does_not_replace_reviewed_release(monkeypatch, tmp_path):
    state, draft = configure(monkeypatch, tmp_path, "metadata\x1fchore: publish changelog", {
        "metadata": "docs/changelog-git-state.json\nfrontend/public/changelog/git-draft.json",
    })
    before = state.read_bytes(), draft.read_bytes()
    changelog.main()
    assert (state.read_bytes(), draft.read_bytes()) == before


def test_new_code_still_generates_a_release(monkeypatch, tmp_path):
    state, draft = configure(monkeypatch, tmp_path, "metadata\x1fchore: publish changelog\ncode\x1ffeat: import complete books", {
        "metadata": "frontend/public/changelog/git-draft.json",
        "code": "backend/app/services/toy_lm_library.py",
    })
    changelog.main()
    payload = json.loads(draft.read_text())
    assert len(payload["items"]) == 1
    assert payload["items"][0]["category"] == "new"
    assert "complete books" in payload["items"][0]["title"]
    assert json.loads(state.read_text())["last_processed_ref"] == "current"
