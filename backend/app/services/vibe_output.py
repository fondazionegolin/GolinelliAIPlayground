"""Bounded, model-independent recovery of complete file payloads. No execution or network calls."""
import json
import re
import posixpath

from app.services.js_imports import tokens

MAX_OUTPUT = 1_000_000
MAX_FILE = 200_000
_CODE = {'.tsx', '.ts', '.jsx', '.js', '.css', '.json'}


def safe_file(path, content):
    if not isinstance(path, str) or not isinstance(content, str) or not content.strip() or len(content) > MAX_FILE:
        return None
    path = path.strip().strip('`').removeprefix('./')
    if path.startswith(('/', '\\')) or '\\' in path or ':' in path or '..' in path.split('/') or any(ord(c) < 32 for c in path):
        return None
    path = posixpath.normpath(path)
    if posixpath.splitext(path)[1].lower() not in _CODE:
        return None
    if path.lower() in {'index.tsx', 'index.ts', 'index.jsx', 'index.js', 'main.tsx', 'main.ts', 'main.jsx', 'main.js', 'golinelli-bridge.ts'}:
        return None
    content = content.strip()
    fenced = re.fullmatch(r'```[^\n]*\n(.*?)\n```', content, re.S)
    if fenced: content = fenced.group(1)
    return {'path': path, 'content': content, 'language': posixpath.splitext(path)[1][1:]}


def looks_complete(content: str) -> bool:
    text = content.strip()
    items = tokens(text)
    if not items: return False
    stack = []
    pairs = {')': '(', ']': '[', '}': '{'}
    for item in items:
        if item.kind in {'string', 'template'} and text[item.start:item.end][-1:] not in {"'", '"', '`'}: return False
        if item.kind != 'punct': continue
        if item.value in {'(', '[', '{'}: stack.append(item.value)
        elif item.value in pairs:
            if not stack or stack.pop() != pairs[item.value]: return False
    return not stack and items[-1].value not in {'=', '+', '-', '*', '/', '.', ',', '=>', ':', '?', 'return', 'export', 'import', 'from', 'const', 'let', 'function'}


def recover_files(raw: str) -> list[dict]:
    """Accept canonical markers without @@FILES@@, JSON and explicitly named fenced code blocks.

    Files still go through the real build gate. Anonymous prose/code fences are never guessed into
    a project: that could silently replace an existing app with an unrelated or incomplete snippet.
    """
    raw = (raw or '')[:MAX_OUTPUT]
    candidates = []
    # JSON formats: {files:[...]}, [{path,content}], or a map of path -> content.
    bodies = [raw.strip()]
    bodies += re.findall(r'```(?:json)?\s*\n(.*?)\n```', raw, re.S)
    for body in bodies:
        try: payload = json.loads(body)
        except (ValueError, TypeError): continue
        if isinstance(payload, dict) and 'files' in payload: payload = payload['files']
        if isinstance(payload, dict): payload = [{'path': k, 'content': v} for k, v in payload.items()]
        if isinstance(payload, list):
            candidates.extend((v.get('path') or v.get('filename'), v.get('content') or v.get('code')) for v in payload[:64] if isinstance(v, dict))
    markers = list(re.finditer(r'^\s*===\s*FILE:\s*(.+?)\s*===\s*$', raw, re.M))
    for index, marker in enumerate(markers[:64]):
        body = raw[marker.end():markers[index + 1].start() if index + 1 < len(markers) else len(raw)]
        end = re.search(r'^\s*===\s*END\s*===\s*$', body, re.M)
        # Marker output must be terminated; don't resurrect a known truncated final file.
        if end is not None or index + 1 < len(markers) or looks_complete(body): candidates.append((marker.group(1), body[:end.start()] if end else body))
    fence = re.compile(r'(?:^|\n)(?:#{1,4}\s+|\*\*)?`?([\w./-]+\.(?:tsx?|jsx?|css|json))`?(?:\*\*)?\s*:?\s*\n```[^\n]*\n(.*?)\n```', re.S)
    candidates.extend((m.group(1), m.group(2)) for m in fence.finditer(raw))
    labelled = re.compile(r'```(?:tsx?|jsx?|css|json)?\s+(?:filename=)?([\w./-]+\.(?:tsx?|jsx?|css|json))\s*\n(.*?)\n```', re.S)
    candidates.extend((m.group(1), m.group(2)) for m in labelled.finditer(raw))
    files = {}
    for path, content in candidates:
        value = safe_file(path, content)
        if value: files[value['path']] = value
    return list(files.values())[:64]


def requires_unsupported_stack(text: str) -> bool:
    # Explicit implementation requests, not a web app that merely teaches or edits Python.
    return bool(re.search(r"(?im)^\s*(?:scrivi|sviluppa|write)\s+(?:un\s+programma\s+)?in\s+python\b|^\s*(?:usa|usando|use)\s+(?:streamlit|django|flask)\b", text or ''))
