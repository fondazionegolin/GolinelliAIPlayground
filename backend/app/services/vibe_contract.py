"""Vibe Lab: the contract between generated code and the in-browser Sandpack runtime.

Everything a model needs to know about *where its code will run* lives here, in ONE place, so every
generation call (architect, workers, single shot, fix turns, repair passes) sees exactly the same rules.
Weaker models fail mostly because they guess the environment (Vite? Next? Tailwind? src/ folder?), so the
contract is explicit, example-driven and ends with a checklist.

Also here: the project-brief block (spec.md + description.md pinned at the top AND restated at the
bottom of the prompt) and the model tiering that tightens limits for light models.
"""

from __future__ import annotations

import re

# --- Runtime facts shared by prompts and the validator ----------------------------------------------

# Bare imports that always resolve (provided by the platform / Sandpack template).
BUILTIN_PACKAGES = {"react", "react-dom", "react/jsx-runtime", "react-dom/client"}

# Libraries that make the Sandpack bundler download many MB or run wasm/workers: they are allowed, but
# slow to boot (the classic "Couldn't connect to server / TIME_OUT" on a cold start). The prompt tells
# models to avoid them unless the brief truly needs them, and the client gives the bundler a longer budget.
HEAVY_PACKAGES = {
    "three", "@react-three/fiber", "@react-three/drei", "phaser", "pixi.js", "p5", "tone",
    "@tensorflow/tfjs", "@tensorflow/tfjs-core", "@tensorflow/tfjs-converter",
    "@tensorflow/tfjs-backend-webgl", "@tensorflow/tfjs-backend-cpu",
    "@tensorflow-models/face-landmarks-detection", "@tensorflow-models/hand-pose-detection",
    "@tensorflow-models/pose-detection", "@tensorflow-models/coco-ssd", "@tensorflow-models/mobilenet",
    "@tensorflow-models/knn-classifier", "@vladmandic/face-api", "ml5", "onnxruntime-web",
    "@xenova/transformers", "@mediapipe/tasks-vision", "mathjs", "d3", "leaflet", "react-leaflet",
}

SANDBOX_CONTRACT = """AMBIENTE DI ESECUZIONE (CONTRATTO — leggilo come un manuale: tutto cio' che scrivi gira SOLO qui)
Il progetto viene eseguito dentro Sandpack (bundler in-browser, template "react-ts", React 18). NON e' Vite,
NON e' Next.js, NON e' Node: niente server, niente file system, niente build step tuo.
LA PIATTAFORMA POSSIEDE (non scriverli mai, vengono ignorati): index.html, index.tsx (createRoot + StrictMode +
ErrorBoundary), golinelli-bridge.ts, l'import di styles.css. Il bootstrap fa `import App from './App'`.

STRUTTURA FILE (tutti i percorsi sono relativi alla RADICE del progetto):
- OBBLIGATORI: `App.tsx` (con `export default function App()`) e `styles.css` — nella radice, MAI dentro `src/`.
  Una cartella `src/` NON esiste: `src/App.tsx` romperebbe il progetto. Usa `components/`, `hooks/`, `lib/`, `types.ts`.
- Import relativi SENZA estensione, con la maiuscola/minuscola ESATTA del nome file (`./components/Header`
  per `components/Header.tsx`). Niente alias di percorso (`@/`, `~/`): non esistono.
- Ogni import deve puntare a un file che SCRIVI TU in questa risposta (o gia' esistente) e il nome importato
  deve essere davvero esportato li' (`export default` vs `export const`: non confonderli).
- Non puoi creare ne' importare file binari (png, jpg, svg come file, mp3, font, wasm): usa SVG inline in JSX,
  emoji, gradienti CSS, data URL, oppure URL https gia' forniti dallo studente, oppure generateImage().

COSA NON ESISTE (usarlo = pagina rotta):
- Tailwind, Bootstrap o altri CSS framework: NON ci sono. Scrivi CSS vero in styles.css (variabili :root +
  classi) o stili inline. Mai `className="flex p-4 bg-blue-500"` pensando che funzioni.
- `import.meta.env`, `process.env.QUALCOSA` (esiste solo NODE_ENV), `require()`, `__dirname`, moduli Node
  (`fs`, `path`, `os`, `crypto` di Node), `next/*`, `@/...`, `.env`, `ReactDOM.render`, `createRoot` (lo fa la piattaforma).
- Sintassi TS non transpilabile: `const enum`, `namespace`, decoratori. Usa `type`/`interface`/`enum` normali.
- Backend o database tuoi: la persistenza passa SOLO da window.GolinelliAI.saveData/loadData; l'AI SOLO da window.GolinelliAI.

LIBRERIE: dichiarale in package.json ("dependencies") e usa SOLO quelle dell'elenco consentito. Importare un
pacchetto non dichiarato/non consentito = errore di compilazione. react e react-dom NON vanno elencati.
Librerie PESANTI (three, @react-three/*, phaser, pixi.js, tensorflow, mediapipe, transformers, onnxruntime, d3,
leaflet, mathjs, tone, p5): il bundler impiega decine di secondi a scaricarle e l'anteprima puo' andare in TIME_OUT.
Usale SOLO se il brief le richiede davvero; per grafica semplice usa canvas 2D, SVG o CSS; per i grafici recharts.

REGOLA D'ORO DELLA PAGINA BIANCA: l'app deve mostrare SUBITO qualcosa di utile e leggibile al primo render.
- Nessun `return null` / spinner infinito in attesa di dati: parti da dati di esempio o da uno stato vuoto ben fatto.
- MAI far lanciare eccezioni al render: niente accessi a proprieta' di undefined/null (usa `?.` e valori di default),
  `JSON.parse` e localStorage sempre in try/catch, liste `.map` solo su array (`(items ?? []).map`).
- Ogni chiamata asincrona (window.GolinelliAI.*, fetch, getUserMedia, tracker ML) sta in try/catch dentro handler o
  useEffect, con stati loading/errore visibili all'utente. Mai `await` al livello del modulo.
- La piattaforma monta l'app in React.StrictMode: gli useEffect girano DUE volte in sviluppo. Rendili idempotenti
  e con cleanup (clearInterval, stop dei tracks, unsubscribe).
- Testo e sfondo devono avere contrasto: mai testo bianco su sfondo chiaro o viceversa; `body` con colore e sfondo espliciti.
- Router: se servono piu' viste preferisci stato locale (`useState<View>`); con react-router-dom usa `HashRouter`
  (mai BrowserRouter: l'anteprima non e' servita da una radice di sito).

SCHELETRO SICURO (la forma minima che sai gia' funzionare: parti da qui e arricchisci):
=== FILE: App.tsx ===
import { useState } from 'react'
import Header from './components/Header'
type View = 'home' | 'dettaglio'
export default function App() {
  const [view, setView] = useState<View>('home')
  return (
    <div className="app">
      <Header title="Titolo" view={view} onNavigate={setView} />
      <main className="container">{view === 'home' ? <p>Contenuto iniziale visibile</p> : <p>Dettaglio</p>}</main>
    </div>
  )
}
=== FILE: components/Header.tsx ===
type Props = { title: string; view: string; onNavigate: (view: 'home' | 'dettaglio') => void }
export default function Header({ title, view, onNavigate }: Props) {
  return <header className="header"><h1>{title}</h1><button className="btn" onClick={() => onNavigate(view === 'home' ? 'dettaglio' : 'home')}>Cambia vista</button></header>
}
=== END ===

CHECKLIST FINALE (verificala mentalmente PRIMA di scrivere "=== END ==="):
1. Esiste App.tsx nella radice con export default, e styles.css? Nessun file in src/?
2. Ogni import relativo punta a un file scritto da me, con il nome esportato giusto?
3. Ogni pacchetto importato e' in package.json ed e' nell'elenco consentito? Ho evitato le librerie pesanti non necessarie?
4. Nessun Tailwind, import.meta.env, process.env, require, next/*, alias @/, file binari?
5. Il primo render mostra contenuto visibile e non puo' lanciare eccezioni (undefined, JSON.parse, array nulli)?
6. Ogni funzione elencata nel BRIEF (F1, F2, ...) e' implementata e raggiungibile dall'interfaccia?
7. Parentesi e tag JSX bilanciati, ogni file completo (nessun "..." o "resto invariato")?"""

LIGHT_MODEL_ADDENDUM = """MODALITA' ROBUSTA (il tuo modello ha un budget ridotto: precisione > ambizione):
- MASSIMO 8 file, ognuno sotto le 250 righe. Meno file = meno import che possono rompersi.
- Nessuna libreria pesante e nessun router: usa useState per le viste. Librerie ammesse solo: recharts, lucide-react, clsx, framer-motion, date-fns.
- Se una funzione del brief e' troppo complessa, implementane una versione semplice ma FUNZIONANTE, mai una versione ambiziosa che non gira.
- Scrivi codice banale e prevedibile. Niente generics complessi, niente pattern esotici."""

# Models treated as "light": cheaper/smaller, they get the robust-mode addendum and a stricter budget.
_LIGHT_MARKERS = ("haiku", "flash", "mini", "luna", "nano", "lite")


def is_light_model(model: str | None) -> bool:
    name = (model or "").lower()
    return any(marker in name for marker in _LIGHT_MARKERS)


def contract_for(model: str | None) -> str:
    """Contract text for the system prompt, tightened for light models."""
    return SANDBOX_CONTRACT + ("\n\n" + LIGHT_MODEL_ADDENDUM if is_light_model(model) else "")


# --- Project brief: pinned at the top AND restated at the bottom of every prompt --------------------

_FEATURE_LINE = re.compile(r"^\s*(?:[-*]\s*|\d+[.)]\s*)?\**\s*(F\d{1,2})\s*\**\s*[:.)\-–—]\s*(.+?)\s*$")


def extract_requirements(spec_md: str, limit: int = 40) -> list[tuple[str, str]]:
    """The F1/F2/... feature lines of spec.md, as (id, one-line text). Used for the closing reminder and
    for brief-conformance checks, so the full requirement list survives even if the spec is truncated."""
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for line in (spec_md or "").splitlines():
        match = _FEATURE_LINE.match(line)
        if match and match.group(1) not in seen:
            seen.add(match.group(1))
            found.append((match.group(1), match.group(2)[:220]))
            if len(found) >= limit:
                break
    return found


def brief_block(kb_files: list[dict], *, spec_limit: int = 30000, other_limit: int = 8000) -> str:
    """The pinned brief: spec.md first (source of truth), then description.md and other KB files."""
    def key(f: dict) -> int:
        path = str(f.get("path") or "").lower()
        return 0 if path == "spec.md" else 1 if path == "description.md" else 2 if path == "design-system.md" else 3

    parts: list[str] = []
    for f in sorted(kb_files, key=key):
        path = str(f.get("path") or "")
        limit = spec_limit if path.lower() == "spec.md" else other_limit
        parts.append(f"FILE: {path}\n{str(f.get('content') or '')[:limit]}")
    if not parts:
        return ""
    return (
        "=== BRIEF DEL PROGETTO (fonte di verita' — nato dall'intervista con l'utente; rispettalo SEMPRE, "
        "non includerlo nell'output) ===\n" + "\n\n---\n\n".join(parts) + "\n=== FINE BRIEF ==="
    )


def brief_reminder(kb_files: list[dict]) -> str:
    """Short closing restatement of the requirements (recency matters for weaker models)."""
    spec = next((str(f.get("content") or "") for f in kb_files if str(f.get("path") or "").lower() == "spec.md"), "")
    reqs = extract_requirements(spec)
    if not reqs:
        return (
            "\n\nPROMEMORIA: rileggi il BRIEF in cima. Non ridurre i requisiti, non inventare funzioni non richieste, "
            "e rispetta il CONTRATTO DELL'AMBIENTE (App.tsx nella radice, import esistenti, niente Tailwind/Node)."
        )
    listing = "\n".join(f"- {rid}: {text}" for rid, text in reqs)
    return (
        "\n\nPROMEMORIA FINALE — funzioni del brief che l'app DEVE avere alla fine (nessuna puo' mancare):\n"
        f"{listing}\n"
        "Rispetta anche il CONTRATTO DELL'AMBIENTE (App.tsx nella radice, import esistenti, niente Tailwind/Node, "
        "primo render sempre visibile)."
    )
