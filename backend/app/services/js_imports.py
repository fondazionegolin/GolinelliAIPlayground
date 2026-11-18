"""Small lexical scanner for JS/TS module references; never reads imports out of prose literals.

It does not execute code. esbuild remains the syntax/bundle authority. Keeping token positions lets
static checks report the real import line, even for multiline imports and re-exports.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


_WORD = re.compile(r"[A-Za-z_$][\w$]*")


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    start: int
    end: int


def tokens(source: str) -> list[Token]:
    result: list[Token] = []
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        if ch.isspace():
            i += 1
            continue
        if source.startswith('//', i):
            end = source.find('\n', i + 2)
            i = n if end < 0 else end
            continue
        if source.startswith('/*', i):
            end = source.find('*/', i + 2)
            i = n if end < 0 else end + 2
            continue
        if ch in "\"'`":
            start, quote = i, ch
            i += 1
            value = []
            interpolated = False
            terminated = False
            while i < n:
                if quote != '`' and source[i] in '\r\n':
                    break  # '...' and "..." cannot span lines: this quote was an apostrophe in text
                if source[i] == '\\' and i + 1 < n:
                    escaped = re.match(r"\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))", source[i:])
                    if escaped:
                        number = int(next(v for v in escaped.groups() if v is not None), 16)
                        value.append(chr(number) if number <= 0x10ffff else '')
                        i += len(escaped.group())
                    else:
                        value.append({'n': '\n', 'r': '\r', 't': '\t'}.get(source[i + 1], source[i + 1])); i += 2
                elif source[i] == quote:
                    i += 1
                    terminated = True
                    break
                else:
                    interpolated |= quote == '`' and source.startswith('${', i)
                    value.append(source[i]); i += 1
            if quote != '`' and not terminated and i < n:
                result.append(Token('punct', quote, start, start + 1))  # lone apostrophe: keep scanning after it
                i = start + 1
                continue
            result.append(Token('template' if interpolated else 'string', ''.join(value), start, i))
            continue
        # Regex literals are opaque, just like strings. A slash after an operand is division.
        previous = result[-1].value if result else ''
        if ch == '/' and (not result or previous in {'=', '(', '[', '{', ',', ':', ';', '!', '?', 'return', '=>', '&&', '||'}):
            start = i; i += 1; in_class = False
            while i < n and source[i] not in '\r\n':
                if source[i] == '\\': i += 2; continue
                if source[i] == '[': in_class = True
                elif source[i] == ']': in_class = False
                elif source[i] == '/' and not in_class:
                    i += 1
                    while i < n and source[i].isalpha(): i += 1
                    break
                i += 1
            result.append(Token('literal', '', start, i))
            continue
        match = _WORD.match(source, i) if ch.isalpha() or ch in '_$' else None
        if match:
            end = i + len(match.group())
            result.append(Token('word', match.group(), i, end)); i = end
        else:
            # Combined operators matter only for detecting the start of a regex literal.
            op = next((v for v in ('=>', '&&', '||', '?.') if source.startswith(v, i)), ch)
            result.append(Token('punct', op, i, i + len(op))); i += len(op)
    return result


def code_mask(source: str) -> str:
    """Preserve executable tokens and line positions, blanking comments and literal bodies."""
    masked = ['\n' if ch == '\n' else ' ' for ch in source]
    for token in tokens(source):
        if token.kind not in {'string', 'template', 'literal'}:
            masked[token.start:token.end] = source[token.start:token.end]
    return ''.join(masked)


def module_imports(source: str) -> list[tuple[str, int]]:
    items = tokens(source)
    found: list[tuple[str, int]] = []
    for index, token in enumerate(items):
        if token.kind != 'word' or token.value not in {'import', 'export', 'require'}:
            continue
        if index and items[index - 1].value in {'.', '?.'}:
            continue
        rest = items[index + 1: index + 129]
        target = None
        if token.value in {'import', 'require'} and rest:
            if rest[0].kind == 'string' and token.value == 'import': target = rest[0]
            elif len(rest) >= 2 and rest[0].value == '(' and rest[1].kind == 'string': target = rest[1]
        if target is None and token.value in {'import', 'export'} and rest:
            if rest[0].value not in {'*', '{', 'type'} and not (token.value == 'import' and rest[0].kind == 'word'):
                continue
            for pos, item in enumerate(rest[:-1]):
                if item.value in {';', '=', '(', ')', 'const', 'let', 'var', 'function', 'class', 'default', 'interface', 'return'}: break
                if item.kind == 'word' and item.value == 'from' and rest[pos + 1].kind == 'string':
                    target = rest[pos + 1]; break
        if target is not None and target.value:
            found.append((target.value, token.start))
    return found
