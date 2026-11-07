"""Vibe Lab build gate: deterministic checks a generated React project must pass BEFORE it is saved as a
"ready" version. Models are good at writing code and bad at noticing that an import is misspelled or that
the file lives in src/ — those failures used to surface only as a white preview or a bundler error.

Two layers:
1. `static_issues` — pure-Python rules about the Sandpack runtime (layout, forbidden APIs, undeclared
   packages, binary asset imports). Instant, no external tools.
2. `build_check` — runs the real esbuild bundler (when the binary is installed) on a temp copy of the
   project with packages externalised: catches syntax errors, unresolved relative imports and missing
   named exports with file:line:col, exactly the class of error Sandpack would raise later.

`normalize_layout` applies the one safe automatic fix (hoisting src/ to the project root).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import posixpath
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass

from app.services.vibe_contract import BUILTIN_PACKAGES, HEAVY_PACKAGES

logger = logging.getLogger(__name__)

CODE_EXTS = (".ts", ".tsx", ".js", ".jsx")
NODE_BUILTINS = {
    "fs", "path", "os", "crypto", "child_process", "http", "https", "net", "stream", "zlib", "util",
    "url", "events", "buffer", "process", "worker_threads", "assert", "readline",
}
BINARY_ASSET_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".mp3", ".wav", ".ogg", ".mp4", ".webm",
                     ".woff", ".woff2", ".ttf", ".otf", ".wasm", ".pdf", ".svg")

_BARE_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'".\/][^'"]*)['"]""")
_ASSET_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{0,2}/[^'"]+\.(?:%s))['"]""" % "|".join(e.lstrip(".") for e in BINARY_ASSET_EXTS), re.I)
_HAS_DEFAULT_EXPORT = re.compile(r"\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b")

# (regex, rule id, message) — each applied per code file.
_FORBIDDEN: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"\bimport\.meta\.env\b"), "no-import-meta-env", "`import.meta.env` non esiste (ambiente Sandpack, non Vite): togli la variabile d'ambiente"),
    (re.compile(r"\bprocess\.env\.(?!NODE_ENV\b)\w+"), "no-process-env", "`process.env.X` non esiste nel browser: usa costanti nel codice"),
    (re.compile(r"(?<![\w.])require\s*\(\s*['\"]"), "no-require", "`require()` non e' disponibile: usa `import`"),
    (re.compile(r"\b__dirname\b|\b__filename\b"), "no-node-globals", "`__dirname`/`__filename` sono di Node e non esistono nel browser"),
    (re.compile(r"\bReactDOM\.render\s*\(|\bcreateRoot\s*\("), "no-bootstrap", "il bootstrap (createRoot/ReactDOM.render) e' della piattaforma: esporta solo `App` da App.tsx"),
    (re.compile(r"document\.getElementById\(\s*['\"]root['\"]\s*\)"), "no-root-lookup", "non montare nulla su #root: lo fa la piattaforma, esporta solo `App`"),
    (re.compile(r"""from\s*['"](?:next|@next)/"""), "no-next", "`next/*` non esiste: il progetto e' React puro in Sandpack"),
    (re.compile(r"""from\s*['"](?:@|~)/"""), "no-path-alias", "gli alias `@/` e `~/` non esistono: usa import relativi (`./components/X`)"),
]


@dataclass
class Issue:
    file: str
    message: str
    line: int = 0
    rule: str = ""
    severity: str = "error"  # error blocks the build, warn is informational

    def to_dict(self) -> dict:
        return asdict(self)

    def describe(self) -> str:
        where = f"{self.file}:{self.line}" if self.line else self.file
        return f"{where}: {self.message}" if where else self.message


def _is_code(path: str) -> bool:
    return path.lower().endswith(CODE_EXTS)


def _package_name(spec: str) -> str:
    parts = spec.split("/")
    return "/".join(parts[:2]) if spec.startswith("@") else parts[0]


def declared_dependencies(files: list[dict]) -> set[str]:
    for f in files:
        if str(f.get("path") or "").lstrip("/") == "package.json":
            try:
                data = json.loads(str(f.get("content") or "{}"))
            except Exception:
                return set()
            return set((data.get("dependencies") or {}).keys()) | set((data.get("devDependencies") or {}).keys())
    return set()


def heavy_dependencies(files: list[dict]) -> list[str]:
    """Declared or imported packages that make the Sandpack cold start slow (client raises its timeout)."""
    used = declared_dependencies(files)
    for f in files:
        if _is_code(str(f.get("path") or "")):
            used |= {_package_name(m) for m in _BARE_IMPORT.findall(str(f.get("content") or ""))}
    return sorted(used & HEAVY_PACKAGES)


def normalize_layout(files: list[dict]) -> tuple[list[dict], list[str]]:
    """Safe automatic layout fixes. Currently: a project whose code all lives under src/ (a Vite/CRA habit)
    is hoisted to the root, because the platform entry imports './App' from the root."""
    notes: list[str] = []
    paths = [str(f.get("path") or "") for f in files]
    code = [p for p in paths if _is_code(p)]
    if code and "App.tsx" not in paths and "App.jsx" not in paths and any(p.startswith("src/") for p in code):
        if all(p.startswith("src/") or p == "package.json" for p in code):
            moved = []
            for f in files:
                p = str(f.get("path") or "")
                if p.startswith("src/"):
                    moved.append({**f, "path": p[4:]})
                else:
                    moved.append(f)
            # src/main.tsx / src/index.tsx are platform-owned; the normalizer drops them downstream.
            notes.append("Spostati i file da src/ alla radice del progetto.")
            files = moved
    # A root-level lowercase app.tsx is a common slip; the entry imports './App'.
    if "App.tsx" not in [str(f.get("path") or "") for f in files]:
        files = [({**f, "path": "App.tsx"} if str(f.get("path") or "") == "app.tsx" else f) for f in files]
        if any(str(f.get("path") or "") == "App.tsx" for f in files) and "app.tsx" in paths:
            notes.append("Rinominato app.tsx in App.tsx.")
    return files, notes


def static_issues(files: list[dict], allowed_packages: set[str] | None = None) -> list[Issue]:
    """Rules about the Sandpack runtime that need no bundler."""
    issues: list[Issue] = []
    paths = {str(f.get("path") or "") for f in files}
    declared = declared_dependencies(files)
    available = BUILTIN_PACKAGES | declared

    app = next((f for f in files if str(f.get("path") or "") in {"App.tsx", "App.jsx"}), None)
    if app is None:
        issues.append(Issue("App.tsx", "manca App.tsx nella radice del progetto (la piattaforma monta `./App`)", rule="missing-app"))
    elif not _HAS_DEFAULT_EXPORT.search(str(app.get("content") or "")):
        issues.append(Issue(str(app["path"]), "App.tsx deve avere `export default function App()` (default export)", rule="app-default-export"))
    if "styles.css" not in paths:
        issues.append(Issue("styles.css", "manca styles.css nella radice", rule="missing-styles", severity="warn"))

    for f in files:
        path = str(f.get("path") or "")
        content = str(f.get("content") or "")
        if not _is_code(path):
            continue
        if path.startswith("src/"):
            issues.append(Issue(path, "i file non vanno in src/: la cartella non esiste, il progetto parte dalla radice", rule="no-src-dir"))
        for pattern, rule, message in _FORBIDDEN:
            match = pattern.search(content)
            if match:
                issues.append(Issue(path, message, line=content.count("\n", 0, match.start()) + 1, rule=rule))
        for match in _ASSET_IMPORT.finditer(content):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), match.group(1)))
            if target not in paths:
                issues.append(Issue(path, f"importa il file binario \"{match.group(1)}\" che non puo' esistere: usa SVG inline, emoji o URL https", line=content.count("\n", 0, match.start()) + 1, rule="no-binary-asset"))
        for spec in sorted(set(_BARE_IMPORT.findall(content))):
            name = _package_name(spec)
            line = content.count("\n", 0, content.find(spec)) + 1
            bare = name.removeprefix("node:")
            if name.startswith("node:") or bare in NODE_BUILTINS:
                issues.append(Issue(path, f"`{spec}` e' un modulo Node: non esiste nel browser", line=line, rule="no-node-module"))
            elif name not in available:
                reason = "non dichiarato in package.json" if (allowed_packages is None or name in allowed_packages) else "non e' tra le librerie consentite"
                issues.append(Issue(path, f"importa il pacchetto \"{name}\" ma {reason}: aggiungilo a package.json (solo se consentito) oppure scrivi il codice a mano", line=line, rule="undeclared-package"))
    return issues


# --- esbuild ------------------------------------------------------------------------------------------

def esbuild_binary() -> str | None:
    override = os.environ.get("ESBUILD_BIN")
    if override and os.path.exists(override):
        return override
    return shutil.which("esbuild")


_ERR = re.compile(r"✘ \[ERROR\] (?P<msg>.+?)\n(?:\n\s+(?P<file>[^\s:][^\n]*?):(?P<line>\d+):(?P<col>\d+):)?", re.S)


def parse_esbuild_errors(stderr: str) -> list[Issue]:
    issues: list[Issue] = []
    seen: set[tuple] = set()
    for match in _ERR.finditer(stderr or ""):
        message = match.group("msg").strip().splitlines()[0][:300]
        file = (match.group("file") or "").strip()
        line = int(match.group("line") or 0)
        key = (file, line, message)
        if key in seen:
            continue
        seen.add(key)
        issues.append(Issue(file, _humanize(message), line=line, rule="esbuild"))
    return issues[:25]


def _humanize(message: str) -> str:
    if message.startswith("Could not resolve"):
        return message + " — il file non esiste o il percorso/maiuscole sono sbagliati"
    if message.startswith("No matching export"):
        return message + " — l'import non corrisponde a un export di quel file (default vs named?)"
    return message


async def build_check(files: list[dict], timeout: float = 25.0) -> tuple[list[Issue], bool]:
    """Bundle the project with esbuild (packages external). Returns (issues, ran). ran=False when the
    binary is unavailable or the check itself failed — the caller then relies on static rules only."""
    binary = esbuild_binary()
    if not binary:
        return [], False
    code_files = [f for f in files if not str(f.get("path") or "").lower().endswith(".md")]
    if not any(_is_code(str(f.get("path") or "")) for f in code_files):
        return [], False
    try:
        with tempfile.TemporaryDirectory(prefix="vibe-gate-") as root:
            for f in code_files:
                rel = str(f.get("path") or "").lstrip("/")
                if not rel or ".." in rel.split("/"):
                    continue
                target = os.path.join(root, rel)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "w", encoding="utf-8") as handle:
                    handle.write(str(f.get("content") or ""))
            # Mirror the platform entry so a broken App import is reported like Sandpack would.
            with open(os.path.join(root, "__entry.tsx"), "w", encoding="utf-8") as handle:
                handle.write("import './styles.css'\nimport App from './App'\nconsole.log(App)\n")
            if not os.path.exists(os.path.join(root, "styles.css")):
                open(os.path.join(root, "styles.css"), "w").close()
            proc = await asyncio.create_subprocess_exec(
                binary, "__entry.tsx", "--bundle", "--packages=external", "--jsx=automatic",
                "--outdir=__out", "--log-level=error", "--color=false", "--log-limit=0",
                cwd=root, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            try:
                _out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()
                return [], False
            if proc.returncode == 0:
                return [], True
            return parse_esbuild_errors(err.decode("utf-8", "replace")), True
    except Exception as exc:  # the gate must never break a generation
        logger.warning("vibe build check skipped (%s)", exc)
        return [], False


async def check_project(files: list[dict], allowed_packages: set[str] | None = None) -> tuple[list[Issue], bool]:
    """All gate layers. Returns (issues, bundler_ran). De-duplicates static vs bundler findings."""
    issues = static_issues(files, allowed_packages)
    built, ran = await build_check(files)
    known = {(i.file, i.line) for i in issues}
    issues.extend(i for i in built if (i.file, i.line) not in known)
    return issues, ran


def blocking(issues: list[Issue]) -> list[Issue]:
    return [i for i in issues if i.severity == "error"]
