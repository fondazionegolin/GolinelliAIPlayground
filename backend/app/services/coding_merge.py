"""Three-way merge of Vibe Lab projects (lists of {path, language, content} files).

`base` is the common ancestor, `ours` the current main branch and `theirs` the contributor's
working copy. Non-overlapping edits to the same file merge automatically (line level); a file
edited incompatibly on both sides is reported as a conflict, never written with markers (markers
would break the build). A conflicting file keeps `ours` in the merged result until somebody picks
a resolution.
"""
from __future__ import annotations

from difflib import SequenceMatcher
from typing import Optional


def _hunks(base: list[str], other: list[str]) -> list[tuple[int, int, list[str]]]:
    matcher = SequenceMatcher(a=base, b=other, autojunk=False)
    return [
        (i1, i2, other[j1:j2])
        for tag, i1, i2, j1, j2 in matcher.get_opcodes()
        if tag != "equal"
    ]


def _apply(base_slice: list[str], start: int, hunks: list[tuple[int, int, list[str]]]) -> list[str]:
    out: list[str] = []
    pos = start
    for i1, i2, replacement in hunks:
        out.extend(base_slice[pos - start:i1 - start])
        out.extend(replacement)
        pos = i2
    out.extend(base_slice[pos - start:])
    return out


def merge_text(base: str, ours: str, theirs: str) -> tuple[str, bool]:
    """Return (merged_text, has_conflict). On conflict the merged text is `ours`."""
    if ours == theirs:
        return ours, False
    if base == ours:
        return theirs, False
    if base == theirs:
        return ours, False

    b = base.splitlines(keepends=True)
    a = ours.splitlines(keepends=True)
    t = theirs.splitlines(keepends=True)
    tagged = sorted(
        [(h, "a") for h in _hunks(b, a)] + [(h, "t") for h in _hunks(b, t)],
        key=lambda item: (item[0][0], item[0][1]),
    )

    out: list[str] = []
    pos = 0
    idx = 0
    while idx < len(tagged):
        start = tagged[idx][0][0]
        end = tagged[idx][0][1]
        cluster = [tagged[idx]]
        idx += 1
        while idx < len(tagged):
            nxt = tagged[idx][0]
            if nxt[0] < end or (nxt[0] == end and (nxt[0] == start or nxt[1] == nxt[0])):
                end = max(end, nxt[1])
                cluster.append(tagged[idx])
                idx += 1
            else:
                break
        out.extend(b[pos:start])
        base_slice = b[start:end]
        a_hunks = [h for h, side in cluster if side == "a"]
        t_hunks = [h for h, side in cluster if side == "t"]
        a_text = _apply(base_slice, start, a_hunks)
        t_text = _apply(base_slice, start, t_hunks)
        if a_hunks and t_hunks:
            if a_text != t_text:
                return ours, True
            out.extend(a_text)
        else:
            out.extend(a_text if a_hunks else t_text)
        pos = end
    out.extend(b[pos:])
    return "".join(out), False


def _by_path(files: Optional[list[dict]]) -> dict[str, dict]:
    return {str(f.get("path")): f for f in (files or []) if f.get("path")}


def merge_file_sets(
    base_files: list[dict],
    ours_files: list[dict],
    theirs_files: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Merge whole projects. Returns (merged_files, conflicts).

    Each conflict is {path, kind, base, ours, theirs} with the text (or None when the file does not
    exist on that side).
    """
    base, ours, theirs = _by_path(base_files), _by_path(ours_files), _by_path(theirs_files)
    order = [p for p in ours] + [p for p in theirs if p not in ours] + [p for p in base if p not in ours and p not in theirs]
    merged: list[dict] = []
    conflicts: list[dict] = []

    def text(entry: Optional[dict]) -> Optional[str]:
        return None if entry is None else str(entry.get("content") or "")

    for path in order:
        b, o, t = base.get(path), ours.get(path), theirs.get(path)
        bt, ot, tt = text(b), text(o), text(t)
        chosen: Optional[dict]
        if ot == tt:
            chosen = o
        elif bt == ot:
            chosen = t
        elif bt == tt:
            chosen = o
        else:
            kind = "text"
            if ot is None or tt is None:
                kind = "deleted"
            elif bt is None:
                kind = "both_added"
            if kind == "text":
                result, conflict = merge_text(bt or "", ot or "", tt or "")
                if not conflict:
                    chosen = {**(o or t or {}), "path": path, "content": result}
                else:
                    conflicts.append({"path": path, "kind": "text", "base": bt, "ours": ot, "theirs": tt})
                    chosen = o
            else:
                conflicts.append({"path": path, "kind": kind, "base": bt, "ours": ot, "theirs": tt})
                chosen = o if o is not None else t
        if chosen is not None:
            merged.append({"path": path, "language": chosen.get("language"), "content": chosen.get("content") or ""})
    return merged, conflicts


def changed_files(base_files: list[dict], head_files: list[dict]) -> list[dict]:
    """What a contributor changed: [{path, status: added|modified|deleted, base, head}]."""
    base, head = _by_path(base_files), _by_path(head_files)
    changes: list[dict] = []
    for path in sorted(set(base) | set(head)):
        b, h = base.get(path), head.get(path)
        bt = None if b is None else str(b.get("content") or "")
        ht = None if h is None else str(h.get("content") or "")
        if bt == ht:
            continue
        changes.append({
            "path": path,
            "status": "added" if bt is None else "deleted" if ht is None else "modified",
            "base": bt,
            "head": ht,
        })
    return changes
