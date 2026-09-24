"""Search/replace patches for Vibe Lab edits.

The coding agent edits existing files with SEARCH/REPLACE blocks instead of re-emitting whole
files: cheaper, faster and it cannot silently drop code it was not asked to touch. Models are not
byte-exact, so matching degrades gracefully: exact -> trailing-whitespace-insensitive ->
indentation-insensitive (the replacement is re-indented to the matched location).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_SEARCH = re.compile(r"^\s*<{5,9}\s*SEARCH\s*$")
_DIVIDER = re.compile(r"^\s*={5,9}\s*$")
_REPLACE = re.compile(r"^\s*>{5,9}\s*REPLACE\s*$")


@dataclass
class PatchBlock:
    search: str
    replace: str


@dataclass
class PatchFailure:
    block: PatchBlock
    reason: str


def parse_search_replace(text: str) -> list[PatchBlock]:
    """Parse every SEARCH/REPLACE block in `text`; unterminated trailing blocks are ignored."""
    blocks: list[PatchBlock] = []
    state = "idle"
    search: list[str] = []
    replace: list[str] = []
    for line in text.split("\n"):
        if state == "idle":
            if _SEARCH.match(line):
                state, search, replace = "search", [], []
        elif state == "search":
            if _DIVIDER.match(line):
                state = "replace"
            else:
                search.append(line)
        elif state == "replace":
            if _REPLACE.match(line):
                blocks.append(PatchBlock("\n".join(search), "\n".join(replace)))
                state = "idle"
            else:
                replace.append(line)
    return blocks


def _indent_of(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def _find_line_window(lines: list[str], needle: list[str], normalize) -> int:
    """Index of the unique window of `lines` matching `needle` under `normalize`, else -1."""
    wanted = [normalize(item) for item in needle]
    size = len(wanted)
    hits = [
        start for start in range(0, len(lines) - size + 1)
        if [normalize(item) for item in lines[start:start + size]] == wanted
    ]
    return hits[0] if len(hits) == 1 else -1


def apply_block(content: str, block: PatchBlock) -> tuple[str, str | None]:
    """Apply one block. Returns (new_content, failure_reason_or_None)."""
    search = block.search.strip("\n")
    replace = block.replace.strip("\n")
    if not search.strip():
        # Empty SEARCH = append (used to add code at the end of a file).
        joined = content.rstrip("\n")
        return (f"{joined}\n{replace}\n" if joined else f"{replace}\n"), None

    occurrences = content.count(search)
    if occurrences == 1:
        return content.replace(search, replace, 1), None
    if occurrences > 1:
        return content, "il blocco SEARCH compare più volte: serve più contesto per identificarlo"

    lines = content.split("\n")
    needle = search.split("\n")
    start = _find_line_window(lines, needle, lambda item: item.rstrip())
    reindent = False
    if start < 0:
        start = _find_line_window(lines, [item for item in needle], lambda item: item.strip())
        reindent = start >= 0
    if start < 0:
        return content, "il blocco SEARCH non corrisponde al contenuto attuale del file"

    replacement = replace.split("\n") if replace else []
    if reindent and replacement:
        # Shift the replacement by the indentation delta between the file and the model's SEARCH.
        file_indent = _indent_of(lines[start])
        model_indent = _indent_of(needle[0])
        shifted = []
        for item in replacement:
            if item.startswith(model_indent):
                shifted.append(file_indent + item[len(model_indent):])
            else:
                shifted.append(file_indent + item.lstrip() if item.strip() else item)
        replacement = shifted
    new_lines = lines[:start] + replacement + lines[start + len(needle):]
    return "\n".join(new_lines), None


def apply_search_replace(content: str, patch_text: str) -> tuple[str, list[PatchFailure], int]:
    """Apply every block in `patch_text` in order. Returns (content, failures, applied_count)."""
    failures: list[PatchFailure] = []
    applied = 0
    for block in parse_search_replace(patch_text):
        content, reason = apply_block(content, block)
        if reason:
            failures.append(PatchFailure(block, reason))
        else:
            applied += 1
    return content, failures, applied
