"""English versions of the Italian error messages raised as HTTPException details.

Most API errors are written in Italian in the code. When the client's UI language is English
(X-App-Language / Accept-Language, sent by the frontend on every request) the global exception
handler below swaps the detail for its English version from ``app/i18n/en_errors.json``, keyed by
the Italian text. Messages built with f-strings are stored as templates with ``{}`` holes, matched
with a regex and refilled with the same values. Unknown messages pass through unchanged.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from fastapi import Request
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.ui_language import resolve_ui_language

CATALOG_PATH = Path(__file__).resolve().parent.parent / "i18n" / "en_errors.json"


@lru_cache(maxsize=1)
def _catalog() -> tuple[dict[str, str], list[tuple[re.Pattern, str]]]:
    try:
        raw: dict[str, str] = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    exact = {k: v for k, v in raw.items() if "{}" not in k}
    templates = []
    for italian, english in raw.items():
        if "{}" not in italian:
            continue
        literal = [re.escape(part.replace("{{", "{").replace("}}", "}")) for part in italian.split("{}")]
        templates.append((re.compile("^" + "(.+?)".join(literal) + "$", re.S), english))
    # Most specific (longest literal text) first.
    templates.sort(key=lambda item: -len(item[0].pattern))
    return exact, templates


def translate_detail(detail: str, language: str) -> str:
    if language != "en" or not isinstance(detail, str):
        return detail
    exact, templates = _catalog()
    if detail in exact:
        return exact[detail]
    for pattern, english in templates:
        match = pattern.match(detail)
        if match:
            values = iter(match.groups())
            return re.sub(r"\{\}", lambda _: next(values, ""), english.replace("{{", "\x00").replace("}}", "\x01")).replace("\x00", "{").replace("\x01", "}")
    return detail


async def localized_http_exception_handler(request: Request, exc: StarletteHTTPException):
    language = resolve_ui_language(request.headers.get("x-app-language") or request.headers.get("accept-language"))
    if isinstance(exc.detail, str):
        exc.detail = translate_detail(exc.detail, language)
    return await http_exception_handler(request, exc)
