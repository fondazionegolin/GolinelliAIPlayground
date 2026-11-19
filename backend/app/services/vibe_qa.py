"""Vibe Lab quality measurement: a real browser/TypeScript run of a generated project, turned into ranked defects and a scorecard.

The `vibe-qa` service (Playwright + tsc + esbuild) returns raw facts. Everything that decides what is a defect, how
serious it is and what the score means lives here, so the thresholds can change without touching the runner.
Deterministic analysis that needs no browser (CSS classes used by components but never defined) lives here too:
it is the single most common reason a generated page looks unfinished.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Type errors that point at a real runtime fault (missing property, wrong call) rather than typing pedantry.
_RUNTIME_TS = {"TS2339", "TS2304", "TS2551", "TS2345", "TS2554", "TS2741", "TS2769", "TS2322", "TS2353", "TS2561", "TS18047", "TS18048", "TS2532", "TS2531"}

SEVERITY_WEIGHT = {"blocker": 40, "major": 12, "minor": 3}
PASS_SCORE = 85


@dataclass
class Defect:
    severity: str  # blocker | major | minor
    kind: str  # types | runtime | flow | responsive | a11y | css | visual | feature | interaction
    message: str
    file: str = ""
    line: int = 0
    fix: str = ""
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    def describe(self) -> str:
        where = f"{self.file}:{self.line}" if self.line else self.file
        return (f"{where}: " if where else "") + self.message + (f" — {self.fix}" if self.fix else "")


# --- service client -----------------------------------------------------------------------------------

def available() -> bool:
    return bool(getattr(settings, "VIBE_QA_URL", ""))


async def run(files: list[dict], tests: list[dict] | None = None, budget_ms: int = 70000) -> dict | None:
    """Run the project in the QA service. None when the service is absent or fails: callers degrade to the static gate."""
    url = getattr(settings, "VIBE_QA_URL", "")
    if not url:
        return None
    payload = {"files": [{"path": f.get("path"), "content": f.get("content")} for f in files if not str(f.get("path") or "").lower().endswith(".md")],
               "tests": tests or [], "budgetMs": budget_ms}
    try:
        async with httpx.AsyncClient(timeout=budget_ms / 1000 + 40) as client:
            response = await client.post(url.rstrip("/") + "/qa", json=payload)
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        logger.warning("vibe-qa unavailable (%s)", exc)
        return None


# --- CSS coverage: classes the components use but nobody styled -----------------------------------------

_CLASS_ATTR = re.compile(r"""className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})""")
_CLASS_TOKEN = re.compile(r"^[A-Za-z_][\w-]*$")
_CSS_CLASS = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
_CSS_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)


def css_gaps(files: list[dict]) -> dict[str, list[str]]:
    """{class name: [component files using it]} for classes no stylesheet of the project defines."""
    defined: set[str] = set()
    for f in files:
        if str(f.get("path") or "").lower().endswith(".css"):
            defined |= set(_CSS_CLASS.findall(_CSS_BLOCK_COMMENT.sub("", str(f.get("content") or ""))))
    used: dict[str, set[str]] = {}
    for f in files:
        path = str(f.get("path") or "")
        if not path.lower().endswith((".tsx", ".jsx")):
            continue
        for match in _CLASS_ATTR.finditer(str(f.get("content") or "")):
            value = next(g for g in match.groups() if g is not None)
            for token in re.sub(r"\$\{[^}]*\}", " ", value).split():
                if _CLASS_TOKEN.match(token):
                    used.setdefault(token, set()).add(path)
    return {name: sorted(paths) for name, paths in used.items() if name not in defined}


def css_coverage(files: list[dict]) -> tuple[int, int]:
    """(classes used, classes styled)."""
    gaps = css_gaps(files)
    total = 0
    seen: set[str] = set()
    for f in files:
        if str(f.get("path") or "").lower().endswith((".tsx", ".jsx")):
            for match in _CLASS_ATTR.finditer(str(f.get("content") or "")):
                value = next(g for g in match.groups() if g is not None)
                seen |= {t for t in re.sub(r"\$\{[^}]*\}", " ", value).split() if _CLASS_TOKEN.match(t)}
    total = len(seen)
    return total, total - len(gaps)


_JSX_TEXT_ESCAPE = re.compile(r">([^<>{}\n]*\\['\"][^<>{}\n]*)<")


def escaped_text(files: list[dict]) -> list[tuple[str, str]]:
    """JSX text (between tags) containing \\' or \\\": it renders the backslash. Common when a model copies string escaping into markup."""
    out: list[tuple[str, str]] = []
    for f in files:
        path = str(f.get("path") or "")
        if path.lower().endswith((".tsx", ".jsx")):
            for match in _JSX_TEXT_ESCAPE.finditer(str(f.get("content") or "")):
                out.append((path, match.group(1).strip()[:60]))
    return out


# --- acceptance tests carried inside spec.md -------------------------------------------------------------

def extract_tests(spec_md: str) -> list[dict]:
    """Acceptance tests stored by the product step as a ```json block under «Test di accettazione»."""
    import json
    match = re.search(r"##\s*Test di accettazione.*?```json\s*(\[.*?\])\s*```", spec_md or "", re.S | re.I)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
    except Exception:
        return []
    return clean_tests(data)


_ACTIONS = {"click", "fill", "select", "check", "press", "wait", "expectText", "expectNotText", "expectVisible", "expectCount"}


def clean_tests(data) -> list[dict]:
    tests: list[dict] = []
    for index, item in enumerate(data if isinstance(data, list) else []):
        if not isinstance(item, dict):
            continue
        steps = [s for s in (item.get("steps") or []) if isinstance(s, dict) and s.get("do") in _ACTIONS][:14]
        if steps:
            tests.append({"id": str(item.get("id") or f"T{index + 1}")[:12], "feature": str(item.get("feature") or "")[:12],
                          "title": str(item.get("title") or "")[:120], "steps": steps})
    return tests[:8]


# --- report -> defects -------------------------------------------------------------------------------------

def _owner_of(files: list[dict], needle: str, default: str = "App.tsx") -> str:
    needle = (needle or "").strip().lower()
    if needle:
        for f in files:
            if str(f.get("path") or "").lower().endswith((".tsx", ".jsx")) and needle in str(f.get("content") or "").lower():
                return str(f["path"])
    return default


def defects_from_report(report: dict, files: list[dict]) -> list[Defect]:
    found: list[Defect] = []
    types = report.get("typecheck") or {}
    shown = 0
    for err in types.get("errors", []):
        if err.get("code") in _RUNTIME_TS and shown < 10:
            shown += 1
            found.append(Defect("major", "types", f"TypeScript {err['code']}: {err['message']}", err.get("file", ""), err.get("line", 0),
                                "correggi il tipo o il nome: a runtime puo' dare undefined/NaN"))
    build = report.get("build") or {}
    if build.get("ok") is False and not build.get("skipped"):
        for err in build.get("errors", [])[:4]:
            found.append(Defect("blocker", "runtime", f"Build non riuscita: {err.get('message')}", err.get("file", ""), err.get("line", 0)))
    runtime = report.get("runtime") or {}
    for vp in runtime.get("viewports", []) or []:
        name = vp.get("name", "?")
        if vp.get("error"):
            found.append(Defect("major", "runtime", f"Controllo {name} non riuscito: {vp['error']}"))
            continue
        if vp.get("blank") or vp.get("crash"):
            crash = (vp.get("crash") or {}).get("message", "")
            found.append(Defect("blocker", "runtime", f"Pagina vuota o in errore su {name}" + (f": {crash}" if crash else ""), "App.tsx",
                                fix="il primo render deve mostrare contenuto e non lanciare eccezioni"))
        for message in (vp.get("pageErrors") or []) + (vp.get("consoleErrors") or []):
            found.append(Defect("blocker" if name == "desktop" else "major", "runtime", f"Errore in console ({name}): {message}"))
            break
        if vp.get("overflowX") and name in ("mobile", "tablet"):
            found.append(Defect("major", "responsive", f"Scorrimento orizzontale su {name}: elementi oltre la larghezza ({', '.join(vp.get('overflowing') or [])})",
                                "styles.css", fix="usa max-width:100%, flex-wrap/grid collassabili, niente larghezze fisse"))
        if name == "mobile" and vp.get("smallTapTargets"):
            found.append(Defect("minor", "responsive", f"Bersagli di tocco sotto 32px su mobile: {', '.join(vp['smallTapTargets'])}", "styles.css", fix="min-height 44px per bottoni e link"))
        for violation in vp.get("axe") or []:
            if violation.get("id") == "axe-failed":
                continue
            severity = "major" if violation.get("impact") in ("critical", "serious") else "minor"
            node = (violation.get("nodes") or [{}])[0]
            found.append(Defect(severity, "a11y", f"{violation.get('help')} ({violation.get('count')} elementi, {name}): {node.get('target', '')}", fix="correggi contrasto/etichette/ruoli"))
        if vp.get("brokenImages"):
            found.append(Defect("minor", "runtime", f"{vp['brokenImages']} immagini non caricano su {name}"))
    crawl = report.get("crawl") or {}
    for crash in crawl.get("crashes", []) or []:
        found.append(Defect("blocker", "interaction", f"L'app va in errore premendo «{crash.get('control')}»: {crash.get('message')}", _owner_of(files, crash.get("control", ""))))
    for item in (crawl.get("errorsAfterClick") or [])[:3]:
        found.append(Defect("major", "interaction", f"Errore in console premendo «{item.get('control')}»: {(item.get('errors') or [''])[0]}", _owner_of(files, item.get("control", ""))))
    dead = [d for d in (crawl.get("deadControls") or []) if d != "(senza testo)"]
    if len(dead) >= 3:
        found.append(Defect("minor", "interaction", f"Controlli che non fanno nulla premuti: {', '.join(dead[:6])}", _owner_of(files, dead[0]),
                            fix="ogni bottone deve produrre un effetto visibile o essere disattivato con un motivo chiaro"))
    for test in report.get("acceptance") or []:
        if not test.get("passed") and not test.get("skipped"):
            step = test.get("step") or ""
            found.append(Defect("major", "flow", f"Flusso {test.get('feature') or test.get('id')} «{test.get('title')}» non riesce al passo {test.get('failedStep')} ({step}): {test.get('error')}",
                                _owner_of(files, step.split(" ", 1)[-1] if step else ""),
                                fix="verifica che la funzione esista e sia raggiungibile dall'interfaccia (il test puo' usare un'etichetta imprecisa: allinea il testo del controllo)",
                                extra={"feature": test.get("feature")}))
    for path, snippet in escaped_text(files)[:4]:
        found.append(Defect("major", "visual", f"Testo visibile con carattere di escape letterale in {path}: «{snippet}» (si vede la barra rovesciata)", path,
                            fix="scrivi l'apostrofo normale nel testo JSX (l'escape \\' serve solo dentro stringhe tra apici)"))
    gaps = css_gaps(files)
    if gaps:
        by_file: dict[str, list[str]] = {}
        for name, paths in gaps.items():
            by_file.setdefault(paths[0], []).append(name)
        total, styled = css_coverage(files)
        for path, names in sorted(by_file.items(), key=lambda kv: -len(kv[1])):
            found.append(Defect("major", "css", f"{len(names)} classi usate in {path} non hanno nessuna regola CSS ({', '.join(names[:8])}{'…' if len(names) > 8 else ''}): la pagina appare senza layout",
                                path, fix="scrivi le regole mancanti nello stile del progetto", extra={"classes": names, "coverage": f"{styled}/{total}"}))
    order = {"blocker": 0, "major": 1, "minor": 2}
    found.sort(key=lambda d: order[d.severity])
    return found


# --- scorecard ----------------------------------------------------------------------------------------------

def scorecard(report: dict | None, files: list[dict], defects: list[Defect], visual: dict | None = None) -> dict:
    """0-100 per dimension and overall. Without a browser run only the static dimensions count."""
    by_kind: dict[str, list[Defect]] = {}
    for defect in defects:
        by_kind.setdefault(defect.kind, []).append(defect)

    def penalty(kinds: tuple[str, ...]) -> int:
        return max(0, 100 - sum(SEVERITY_WEIGHT[d.severity] for k in kinds for d in by_kind.get(k, [])))

    total, styled = css_coverage(files)
    runtime = (report or {}).get("runtime") or {}
    ran = bool(runtime.get("ran"))
    card = {
        "types": penalty(("types",)),
        "runtime": penalty(("runtime", "interaction")) if ran else None,
        "flows": penalty(("flow", "feature")) if ran else None,
        "responsive": penalty(("responsive",)) if ran else None,
        "a11y": penalty(("a11y",)) if ran else None,
        "styling": round(100 * styled / total) if total else 100,
        "visual": (visual or {}).get("score"),
    }
    weights = {"types": 1, "runtime": 3, "flows": 3, "responsive": 2, "a11y": 1, "styling": 3, "visual": 6}
    parts = [(card[k], w) for k, w in weights.items() if card.get(k) is not None]
    overall = round(sum(v * w for v, w in parts) / sum(w for _, w in parts)) if parts else 0
    if any(d.severity == "blocker" for d in defects):
        overall = min(overall, 40)
    card["overall"] = overall
    card["browser_checked"] = ran
    card["css_coverage"] = f"{styled}/{total}"
    card["defects"] = {s: sum(1 for d in defects if d.severity == s) for s in ("blocker", "major", "minor")}
    return card


VISUAL_PASS = 70


def is_good(card: dict, defects: list[Defect]) -> bool:
    visual = card.get("visual")
    return card.get("overall", 0) >= PASS_SCORE and (visual is None or visual >= VISUAL_PASS) and not any(d.severity in ("blocker", "major") for d in defects)
