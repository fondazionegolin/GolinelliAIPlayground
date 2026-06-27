import re
import json
import logging
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.api.v1.endpoints.chat import get_or_create_public_room
from app.core.config import settings
from app.core.database import get_db
from app.models.chat import ChatMessage
from app.models.coding import CodingBrief, CodingDesignSystem, CodingMessage, CodingProject, CodingPublication, CodingVersion
from app.models.enums import SenderType
from app.models.session import Class, Session
from app.schemas.coding import (
    CodingMessageCreate,
    CodingMessageResponse,
    CodingBriefCreate,
    CodingBriefResponse,
    CodingGenerateRequest,
    CodingGenerateResponse,
    CodingGeneratedFile,
    CodingProjectCreate,
    CodingProjectDetail,
    CodingProjectResponse,
    CodingVersionCreate,
    CodingVersionResponse,
    DesignSystemCompileRequest,
    DesignSystemCompileResponse,
    DesignSystemContrastCheck,
    DesignSystemCreate,
    DesignSystemResponse,
    DesignSystemSuggestRequest,
    DesignSystemSuggestResponse,
    DesignSystemUpdate,
)
from app.services.credit_service import credit_service
from app.services.environmental_impact import (
    build_estimated_token_usage,
    enrich_usage_with_environmental_impact,
)
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

router = APIRouter()
public_router = APIRouter()

SUPPORTED_TEMPLATES = {"html-css-js", "vite-react"}
CODEGEN_SYSTEM_PROMPT = """Sei un senior front-end engineer e UI/UX designer dentro Golinelli.ai.
Generi codice reale, funzionante e graficamente curato per una mini app web interattiva.

Pianifica MENTALMENTE prima di scrivere (obiettivo e pubblico studenti, sezioni in ordine, palette
con coppie testo/sfondo a contrasto AA, tipografia, spaziatura, stati vuoto/caricamento/errore,
responsive), poi implementa e rileggi mentalmente il render correggendo i difetti. NON scrivere il
piano nell'output: rispondi direttamente con i file finali, senza preamboli.

DESIGN SYSTEM OBBLIGATORIO (rispetta sempre):
- Contrasto: ogni testo deve avere contrasto AA con il suo sfondo. MAI testo chiaro su sfondo chiaro
  o testo scuro su sfondo scuro. Se il fondo e` scuro il testo e` chiaro, e viceversa. Definisci
  esplicitamente le variabili colore in :root e usale ovunque (niente colori "a caso" inline).
- Leggibilita`: dimensione base >=16px, line-height >=1.5, larghezza testo leggibile, gerarchia chiara.
- Layout: usa fl/grid, spaziatura coerente (scala 4/8px), niente elementi sovrapposti o testo tagliato,
  niente overflow orizzontale. Padding generosi, componenti allineati.
- Estetica: moderna e pulita (card con border-radius, ombre morbide, stati hover/focus visibili),
  coerente in tutta la pagina. Mobile-first e pienamente responsive.
- Accessibilita`: focus visibile, alt sulle immagini, label sugli input, contrasto sui bottoni.
- DESIGN SYSTEM DEL PROGETTO (priorita` massima): se esiste un file design-system.md nella knowledge
  base, le sue variabili :root e regole sono VINCOLANTI e prevalgono sulle tue scelte. Incolla quel
  blocco :root in styles.css e usa SOLO quelle variabili (--ds-*); non inventare altri colori/font/raggi.

Rispondi SOLO con JSON valido, senza markdown, senza backtick, senza testo fuori dal JSON.
Per restare compatto: niente commenti superflui nel codice e nessun campo extra oltre a quelli richiesti.
Formato obbligatorio:
{
  "summary": "breve descrizione in italiano",
  "agent_notes": ["spiegazione breve e concreta di una scelta di design fatta"],
  "files": [
    {"path": "index.html", "language": "html", "content": "..."},
    {"path": "styles.css", "language": "css", "content": "..."},
    {"path": "script.js", "language": "javascript", "content": "..."}
  ]
}

Vincoli tecnici:
- Non usare script remoti, iframe, tracking, cookie o localStorage.
- Non usare fetch verso internet o API esterne.
- Se la richiesta include chatbot, modello LLM, assistente AI o generazione immagini, usa il runtime interno gia` disponibile nella preview:
  - await window.GolinelliAI.chat({ content, history, profileKey, provider, model })
  - await window.GolinelliAI.generateImage({ prompt })
- window.GolinelliAI.chat restituisce un oggetto con "response"; window.GolinelliAI.generateImage restituisce un oggetto con "image_url".
- Non inventare chiavi API, token o URL esterni. Le chiamate AI devono passare solo da window.GolinelliAI.
- Gestisci sempre loading, errori e risposta vuota in modo comprensibile per uno studente.
- Il progetto deve funzionare come pagina statica in iframe sandboxato.
- Usa HTML, CSS e JavaScript vanilla. Puoi creare piu` file, ma index.html, styles.css e script.js devono esistere.
- index.html deve linkare styles.css e script.js. Tutti i colori e stili vivono in styles.css con variabili in :root.
- Se generi un chatbot o una chat, stile coerente con i chatbot della piattaforma:
  area conversazione a fumetti, messaggi utente a destra con accento, assistente a sinistra su fondo chiaro,
  composer in basso con input arrotondato e pulsante icona, stati "sta scrivendo"/errore/vuoto chiari.
- Contenuto adatto a studenti.
"""


INTERVIEW_SYSTEM_PROMPT = """Sei un product designer che intervista uno studente per capire bene
quale mini app web vuole, prima di generarla. Fai poche domande mirate (3-4 al massimo), semplici,
in italiano, adatte a studenti, che riducano davvero l'ambiguita` (scopo, contenuti, stile/colori,
funzioni chiave, pubblico). Per ogni domanda proponi 2-4 risposte rapide come suggerimenti.
Rispondi SOLO con JSON valido:
{
  "questions": [
    {"question": "domanda breve e chiara", "suggestions": ["opzione 1", "opzione 2", "opzione 3"]}
  ]
}
Massimo 4 domande. Niente testo fuori dal JSON."""


UI_REVIEW_SYSTEM_PROMPT = """Sei un revisore UI/QA front-end. Ricevi i file di una mini app web e li
controlli come se vedessi il render. Trova e CORREGGI i difetti UI tipici:
- testo poco leggibile o invisibile (chiaro su chiaro, scuro su scuro, contrasto insufficiente);
- elementi o testi sovrapposti, tagliati, fuori dal contenitore, overflow orizzontale;
- spaziature incoerenti, allineamenti sballati, componenti rotti su mobile;
- font troppo piccoli, gerarchia assente, stati hover/focus mancanti;
- colori inline incoerenti: consolidali in variabili :root.

ADERENZA AL DESIGN SYSTEM (priorita` massima quando viene fornito un design-system.md): verifica e
CORREGGI lo scostamento dal contratto visivo. In particolare:
- il blocco :root in styles.css DEVE contenere ESATTAMENTE le variabili --ds-* del design system
  (copiale dal design-system.md se mancano o differiscono);
- colori, font, raggi, ombre, spaziature DEVONO usare le variabili --ds-* (niente hex/px "a caso"
  che bypassano il design system: sostituiscili con la variabile corretta);
- i bottoni primari DEVONO seguire la ricetta del design system (background var(--ds-btn-bg),
  color var(--ds-btn-color), border var(--ds-btn-border), border-radius var(--ds-btn-radius),
  backdrop-filter var(--ds-btn-backdrop)); le card la ricetta var(--ds-card-bg)/var(--ds-card-border)/
  var(--ds-card-backdrop);
- se lo stile e` vetro/translucido, assicurati che ci sia uno sfondo pagina ricco (gradiente/forme)
  e che sia applicato backdrop-filter con prefisso -webkit-.
Elenca in "issues_found" anche gli scostamenti dal design system che hai corretto.

Mantieni intatti contenuti e funzionalita` (incluse le chiamate a window.GolinelliAI). Non cambiare
l'obiettivo della app: migliora solo qualita` visiva, contrasto, leggibilita`, layout e aderenza al
design system.
Rispondi SOLO con JSON valido nello stesso formato dell'input:
{
  "summary": "cosa hai corretto, in breve",
  "issues_found": ["difetto corretto", "..."],
  "files": [{"path": "...", "language": "...", "content": "..."}]
}
Includi TUTTI i file (anche quelli non modificati). Niente testo fuori dal JSON."""


# Agentic design-system enforcement pass for React projects. Runs after generation when a
# design-system.md contract exists, and rewrites styling so the app actually obeys the framework.
DESIGN_REVIEW_SYSTEM_PROMPT = """Sei un design system enforcer per progetti React + TypeScript dentro Golinelli.ai.
Ricevi i file di un'app React e il CONTRATTO DESIGN SYSTEM (design-system.md). Il tuo compito: rendere
l'app PERFETTAMENTE conforme al contratto, senza cambiare funzionalita`, struttura dei componenti o testi.

Cosa fare:
- styles.css DEVE iniziare con l'INTERO blocco :root del design system (variabili --ds-*), identico.
- Sostituisci OGNI colore/font/raggio/ombra/spaziatura hardcoded (hex, rgb, px arbitrari, nomi colore)
  con la variabile --ds-* corretta, sia in styles.css sia negli stili inline JSX dei componenti.
- Bottoni primari: applica la ricetta del contratto (background var(--ds-btn-bg), color var(--ds-btn-color),
  border var(--ds-btn-border), border-radius var(--ds-btn-radius), box-shadow var(--ds-shadow),
  backdrop-filter var(--ds-btn-backdrop)). Card/pannelli: ricetta var(--ds-card-bg)/var(--ds-card-border)/
  var(--ds-radius)/var(--ds-card-backdrop). Tipografia e spaziature dalle variabili.
- Se lo stile e` vetro/translucido, assicurati di uno sfondo pagina ricco e di backdrop-filter (con -webkit-).
- Mantieni contrasto AA, focus visibile, responsive. NON toccare logica, import, nomi, props, contenuti.

FORMATO DI OUTPUT — restituisci SOLO i file che modifichi (di norma styles.css + i componenti con stili
inline non conformi), nel formato delimitato, senza backtick e senza testo fuori:
=== FILE: styles.css ===
<contenuto completo del file aggiornato>
=== FILE: components/Header.tsx ===
<contenuto completo del file aggiornato>
=== END ===
Non ristampare i file gia` conformi. Dopo l'ultimo file scrivi ESATTAMENTE: === END ==="""


# --- Multi-phase streaming generation prompts (plan -> per-file) ---
PLAN_SYSTEM_PROMPT = """Sei un senior software architect e UI/UX lead dentro Golinelli.ai.
Progetti applicazioni web COMPLETE e ambiziose: non semplici paginette, ma vere mini-piattaforme
(dashboard, liste con dettaglio, form, filtri, grafici disegnati a mano in canvas/SVG, animazioni,
stato applicativo in memoria durante la sessione, e se utile chatbot o generazione immagini via
window.GolinelliAI).

REGOLA FONDAMENTALE — SINGLE PAGE APP: l'app è SEMPRE una sola pagina, un unico index.html. NON creare
altre pagine .html e NON usare link che navigano verso altre pagine. Le diverse viste/sezioni
(home, dettaglio, impostazioni, ecc.) si caricano DINAMICAMENTE via JavaScript (dynamic content
loading): cambiare vista significa aggiornare il contenuto di un contenitore (es. #app) con JS, non
navigare a un altro file. Per il routing usa al massimo l'hash (#vista) gestito in JavaScript.

Pensa IN GRANDE ma resta realizzabile come pagina statica in un iframe sandboxato:
- solo HTML, CSS e JavaScript vanilla; NESSUNO script remoto, NESSUN fetch esterno, niente localStorage;
- UN SOLO file HTML: index.html. Oltre a styles.css e script.js puoi aggiungere SOLO moduli .js/.css
  aggiuntivi (mai altre pagine .html). Massimo 8 file totali;
- design system curato: contrasto AA, tipografia con scala, spaziatura coerente, responsive mobile-first,
  estetica moderna (card, ombre morbide, stati hover/focus), componenti riutilizzabili.

Prima RAGIONA in modo ESPLICITO e in italiano, in modo che uno studente capisca il tuo piano:
obiettivo e pubblico, architettura (viste e come vengono caricate dinamicamente), modello dati lato
client, flussi utente, palette e tipografia, funzioni interattive ricche, stati vuoto/caricamento/errore,
responsive. Scrivi questo ragionamento come testo leggibile (puoi usare elenchi puntati), non come JSON.

Quando hai finito il ragionamento, scrivi una riga contenente ESATTAMENTE:
@@FILES@@
e SUBITO DOPO solo un array JSON dei file da creare, in ordine sensato di generazione
(prima index.html, poi styles.css, poi script.js, poi eventuali moduli .js/.css):
[{"path": "index.html", "language": "html", "purpose": "cosa contiene e come si collega agli altri file"}]
Dopo l'array non scrivere altro."""


FILE_SYSTEM_PROMPT = """Sei un senior front-end engineer dentro Golinelli.ai. Scrivi il contenuto
COMPLETO di UN SOLO file dell'app, perfettamente coerente con il piano e con gli altri file.

Output: restituisci SOLO il contenuto grezzo del file richiesto. Niente spiegazioni, niente commenti
introduttivi, niente backtick, niente markdown, nessun testo fuori dal file.

Design system OBBLIGATORIO: contrasto AA (mai chiaro su chiaro o scuro su scuro), dimensione base
>=16px, line-height >=1.5, layout flex/grid, spaziatura coerente (scala 4/8px), niente overflow o testi
tagliati, estetica moderna e pulita, stati hover/focus visibili, mobile-first e pienamente responsive,
accessibilità (focus visibile, alt, label).

SINGLE PAGE APP — nessuna navigazione tra pagine: esiste solo index.html. Per cambiare vista/sezione
NON usare MAI link a un altro file (vietato <a href="pagina.html">). Usa JavaScript per il dynamic
content loading: funzioni che riscrivono il contenuto di un contenitore (es. #app) o mostrano/nascondono
sezioni. I controlli di navigazione sono <button> o al massimo <a href="#vista"> gestiti via JS con
addEventListener / window.onhashchange. Tutto deve restare dentro questa unica pagina.

Tecnica:
- solo HTML/CSS/JS vanilla; nessuno script remoto, nessun fetch esterno, niente localStorage;
- index.html linka styles.css e script.js (e i moduli .js/.css del piano) con percorsi relativi;
- TUTTI i colori e gli stili vivono in styles.css con variabili in :root, riusate ovunque;
- per AI usa il runtime interno: await window.GolinelliAI.chat({content, history, profileKey}) che
  restituisce {response}, e await window.GolinelliAI.generateImage({prompt}) che restituisce {image_url};
- gestisci sempre stati di caricamento, errore e vuoto in modo comprensibile per studenti;
- contenuto adatto a studenti."""


# Single coherent streaming generation (the production path). One LLM call writes the whole
# app so all files stay mutually consistent (shared IDs/classes/functions); files are emitted in
# a lightweight delimiter format (NOT JSON) which is token-cheap and never breaks on escaping.
CODEGEN_STREAM_SYSTEM_PROMPT = """Sei un senior front-end engineer e UI/UX designer dentro Golinelli.ai.
In UN UNICO passaggio costruisci una vera app React + TypeScript COMPLETA, coerente e FUNZIONANTE: non
una paginetta, ma una mini-piattaforma (dashboard, liste con dettaglio, form, filtri, grafici, animazioni,
stato applicativo, routing tra viste, e se utile chatbot/immagini via window.GolinelliAI).

AMBIENTE DI ESECUZIONE: il progetto gira in un bundler React reale in-browser (stile Vite/CodeSandbox).
- Scrivi React 18 con TypeScript in file .tsx/.ts. Hai hooks (useState, useEffect, ...), JSX, moduli ES.
- DEVE esistere un file App.tsx con `export default function App()` (oppure `export default App`): è il
  componente radice montato dalla piattaforma. NON scrivere tu index.html né il file di entry/bootstrap
  (createRoot): li fornisce la piattaforma. NON importare './styles.css' nei componenti: lo fa la piattaforma.
- Organizza il codice in più file: App.tsx + componenti in components/ (es. components/Header.tsx), hook
  in hooks/, utilità in lib/, tipi in types.ts. Import relativi tra i tuoi file (es. './components/Header').
- styles.css contiene gli stili globali (incluse le variabili :root); è applicato automaticamente. Puoi
  anche usare CSS Modules (Foo.module.css) o stili inline, ma tieni la palette nelle variabili :root.

LIBRERIE npm: puoi usarle davvero. Dichiarale in package.json (campo "dependencies") con una versione
(es. "recharts": "^2.12.0") e importale normalmente. Librerie utili: react-router-dom (routing reale tra
viste/URL), recharts (grafici), framer-motion (animazioni), clsx, date-fns, zustand. react e react-dom
sono già forniti: NON elencarli. Usa solo ciò che ti serve davvero e versioni esistenti e stabili.

ROUTING: per più viste usa react-router-dom (createBrowserRouter/Routes) oppure stato locale. Niente più
vincolo single-page artificiale: puoi avere route vere come /, /dettaglio/:id, ecc.

COERENZA CRITICA: poiché scrivi TUTTI i file insieme, devono combaciare PERFETTAMENTE — ogni import punta
a un file che crei davvero con quell'export; i nomi di componenti/funzioni/tipi combaciano; nessun import
mancante o inutilizzato. Rileggi mentalmente e verifica i riferimenti incrociati. Codice TypeScript che
compila: tipizza props e stato, niente `any` gratuiti, niente riferimenti a cose non definite.

DESIGN: contrasto AA (mai chiaro su chiaro o scuro su scuro), base >=16px, line-height >=1.5, layout
flex/grid, spaziatura 4/8px, niente overflow, estetica moderna (card, ombre morbide, hover/focus), mobile-first
responsive, accessibilità (focus visibile, alt, label). Definisci le variabili colore in :root in styles.css.

DESIGN SYSTEM DEL PROGETTO (PRIORITÀ MASSIMA): se nella knowledge base esiste un file design-system.md, le
sue variabili :root e le sue regole sono VINCOLANTI e PREVALGONO su ogni tua scelta estetica. Obbligatorio:
- incolla l'INTERO blocco :root del design-system.md, identico, all'inizio di styles.css;
- TUTTO il colore/font/raggio/ombra/spaziatura nei componenti DEVE usare quelle variabili
  (es. `background: var(--ds-btn-bg)`, `color: var(--ds-text)`, `border-radius: var(--ds-radius)`),
  sia in styles.css sia negli stili inline JSX; NON inventare hex/px che bypassano il design system;
- segui le ricette di bottoni/card/superfici del design-system.md. Coerenza visiva totale col contratto.

PERSISTENZA DATI: se l'app gestisce dati creati dall'utente (liste, bot, note, documenti, punteggi...),
PERSISTILI in localStorage così sopravvivono al refresh. Usa una chiave con prefisso del progetto
(es. `golinelli:<nome-app>:<entità>`), carica all'avvio (lazy initializer di useState) e salva a ogni
modifica (useEffect). Gestisci JSON corrotto/assente senza crashare. localStorage è permesso e consigliato.

RISORSE ESTERNE: l'ambiente HA rete, quindi font (Google Fonts), immagini da URL e CDN funzionano. Preferisci
comunque SVG inline/gradienti per la grafica decorativa. Per immagini generate usa
await window.GolinelliAI.generateImage({prompt}) -> {image_url}. Per l'AI testuale usa
await window.GolinelliAI.chat({content, history, profileKey}) -> {response}. NON inventare chiavi API o
endpoint backend: le chiamate AI passano SOLO da window.GolinelliAI.

FORMATO DI OUTPUT — rispettalo ALLA LETTERA:
1) Prima un breve RAGIONAMENTO in italiano (markdown, elenchi ok): piano, viste, componenti, scelte di design.
2) Poi una riga con ESATTAMENTE: @@FILES@@
3) Poi OGNI file, senza backtick e senza commenti fuori dal codice, in questo formato:
=== FILE: package.json ===
<contenuto completo del file>
=== FILE: App.tsx ===
<contenuto completo del file>
=== FILE: components/Header.tsx ===
<contenuto completo del file>
=== FILE: styles.css ===
<contenuto completo del file>
4) Dopo l'ultimo file, una riga con ESATTAMENTE: === END ===

App.tsx e styles.css devono SEMPRE esistere. Includi package.json solo se usi librerie oltre a react/react-dom.
Non scrivere index.html né il file di entry/bootstrap. Non scrivere nulla al di fuori di questo formato dopo @@FILES@@."""


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug or "progetto")[:120]


def _extract_json_object(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def _extract_json_array(raw: str) -> list:
    """Like _extract_json_object but for the plan's file list ([...])."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            parsed = json.loads(text[start:end + 1])
        else:
            raise
    return parsed if isinstance(parsed, list) else []


def _lang_for_path(path: str) -> str:
    lower = path.lower()
    if lower.endswith((".js", ".mjs")):
        return "javascript"
    if lower.endswith(".css"):
        return "css"
    if lower.endswith((".html", ".htm")):
        return "html"
    if lower.endswith(".json"):
        return "json"
    if lower.endswith(".md"):
        return "markdown"
    return "text"


def _strip_code_fences(text: str) -> str:
    """Models sometimes wrap a single-file answer in ```lang ... ``` despite instructions."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z0-9]*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    return t


# The preview iframe is a network-less sandbox: any external URL the model slips in (font CDNs,
# placeholder image services, external scripts) fails and spams the console / breaks the page.
# We strip them defensively so generations stay self-contained even if the model disobeys.
_PLACEHOLDER_IMG = (
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='300'%3E"
    "%3Crect%20width='400'%20height='300'%20fill='%23e2e8f0'/%3E%3Ctext%20x='200'%20y='155'%20"
    "font-family='sans-serif'%20font-size='20'%20fill='%2394a3b8'%20text-anchor='middle'%3EImmagine%3C/text%3E%3C/svg%3E"
)
_EXT_STYLESHEET_RE = re.compile(r'<link\b[^>]*href=["\']https?://[^"\']+["\'][^>]*>', re.IGNORECASE)
_EXT_SCRIPT_RE = re.compile(r'<script\b[^>]*\bsrc=["\']https?://[^"\']+["\'][^>]*>\s*</script>', re.IGNORECASE)
_EXT_IMG_RE = re.compile(r'(<img\b[^>]*?\bsrc=)["\']https?://[^"\']*["\']', re.IGNORECASE)
_CSS_IMPORT_RE = re.compile(r'@import[^;]*https?://[^;]*;', re.IGNORECASE)
_CSS_URL_RE = re.compile(r'url\(\s*["\']?https?://[^)]*\)', re.IGNORECASE)


def _sanitize_external_refs(files: list[dict]) -> list[dict]:
    cleaned: list[dict] = []
    for f in files:
        path = str(f.get("path") or "")
        content = str(f.get("content") or "")
        low = path.lower()
        if low.endswith((".html", ".htm")):
            content = _EXT_STYLESHEET_RE.sub("", content)
            content = _EXT_SCRIPT_RE.sub("", content)
            content = _EXT_IMG_RE.sub(lambda m: f'{m.group(1)}"{_PLACEHOLDER_IMG}"', content)
        elif low.endswith(".css"):
            content = _CSS_IMPORT_RE.sub("", content)
            content = _CSS_URL_RE.sub("none", content)
        cleaned.append({**f, "content": content})
    return cleaned


def _normalize_plan_files(raw_files: list) -> list[dict]:
    """Sanitise the planned file list: valid relative paths, dedup, required files present,
    sensible generation order (index.html, styles.css, script.js, then the rest), capped."""
    planned: list[dict] = []
    seen: set[str] = set()
    for item in raw_files:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().lstrip("/")
        if not path or ".." in path.split("/") or path in seen:
            continue
        if path.lower().endswith(".md"):
            continue  # knowledge base is owned by the platform, never model-generated
        # Single-page app: index.html is the only HTML file. Drop any extra pages the model
        # planned — the preview can't navigate to them and they break dynamic content loading.
        if path.lower().endswith((".html", ".htm")) and path != "index.html":
            continue
        seen.add(path)
        planned.append({
            "path": path,
            "language": str(item.get("language") or _lang_for_path(path)),
            "purpose": str(item.get("purpose") or "").strip()[:300],
        })

    for required, lang in (("index.html", "html"), ("styles.css", "css"), ("script.js", "javascript")):
        if required not in seen:
            planned.append({"path": required, "language": lang, "purpose": "File base obbligatorio."})
            seen.add(required)

    priority = {"index.html": 0, "styles.css": 1, "script.js": 2}
    planned.sort(key=lambda f: priority.get(f["path"], 50))
    return planned[:10]


# Paths the model must never own: the preview injects the HTML shell + React entry (createRoot) +
# the GolinelliAI bridge. Keeping a model-emitted copy would clash with the platform-owned versions.
_RESERVED_PATHS = {
    "index.tsx", "index.ts", "index.jsx", "index.js",
    "main.tsx", "main.ts", "main.jsx", "main.js",
    "golinelli-bridge.ts", "index.html",
}


def _is_react_files(files: list[dict]) -> bool:
    """A generation is a React project if it has any .tsx/.jsx file or a package.json that needs React."""
    for f in files:
        path = str(f.get("path") or "").lower()
        if path.endswith((".tsx", ".jsx")):
            return True
        if path == "package.json" and '"react"' in str(f.get("content") or ""):
            return True
    return False


def _normalize_generated_files(payload: dict) -> list[dict]:
    files = payload.get("files")
    if not isinstance(files, list):
        raise ValueError("Missing files array")

    # Detect React up front (on the raw set) so we only strip the platform-owned HTML shell / entry
    # for React projects — legacy static projects legitimately ship their own index.html.
    raw_files = [f for f in files if isinstance(f, dict)]
    react = _is_react_files([
        {"path": str(f.get("path") or ""), "content": str(f.get("content") or "")} for f in raw_files
    ])

    normalized: list[dict] = []
    seen_paths: set[str] = set()
    for file in raw_files:
        path = str(file.get("path") or "").strip().lstrip("/")
        content = str(file.get("content") or "")
        if not path or not content or ".." in path.split("/"):
            continue
        # For React projects the HTML shell and the React entry/bridge are platform-owned; drop any
        # model copy. Legacy static projects keep their index.html.
        if react and (path.lower() in _RESERVED_PATHS or path.lower().endswith((".html", ".htm"))):
            continue
        language = str(file.get("language") or path.rsplit(".", 1)[-1] or "text")
        normalized.append({"path": path, "content": content, "language": language})
        seen_paths.add(path)

    if react or not normalized:
        # React project: guarantee the root component + global stylesheet the preview expects.
        if "App.tsx" not in seen_paths and "App.jsx" not in seen_paths:
            normalized.insert(0, {
                "path": "App.tsx",
                "language": "typescript",
                "content": "export default function App() {\n  return <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}><h1>Mini app generata</h1></main>\n}\n",
            })
        if "styles.css" not in seen_paths:
            normalized.append({"path": "styles.css", "language": "css", "content": ":root{color-scheme:light}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a}"})
    else:
        # Legacy static project (older saved projects / fallback path).
        if "index.html" not in seen_paths:
            normalized.insert(0, {
                "path": "index.html",
                "language": "html",
                "content": '<!doctype html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mini app</title><link rel="stylesheet" href="styles.css"></head><body><main id="app"></main><script src="script.js"></script></body></html>',
            })
        if "styles.css" not in seen_paths:
            normalized.append({"path": "styles.css", "language": "css", "content": "body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:#f8fafc;color:#0f172a}"})
        if "script.js" not in seen_paths:
            normalized.append({"path": "script.js", "language": "javascript", "content": "document.getElementById('app').innerHTML='<h1>Mini app generata</h1>';"} )

    return normalized[:30]


def _seed_description_md(title: str, initial_prompt: str = "") -> str:
    """Starter project knowledge base, editable in the editor and always fed to codegen."""
    instructions = (initial_prompt or "").strip() or "Descrivi qui l'obiettivo del progetto e le regole da rispettare sempre."
    return (
        f"# {title or 'Progetto'}\n\n"
        "## Istruzioni di progetto\n"
        "Queste istruzioni vengono passate all'AI a ogni generazione. Modificale liberamente.\n\n"
        f"{instructions}\n\n"
        "## Richieste\n"
    )


def _kb_files(files: list[dict]) -> list[dict]:
    """Markdown files act as the project knowledge base (description.md + any user-added .md)."""
    return [file for file in files if str(file.get("path") or "").lower().endswith(".md")]


def _append_request_log(description_md: str, request: str) -> str:
    request = (request or "").strip()
    if not request:
        return description_md
    line = "- " + request.replace("\n", " ").strip()[:300]
    text = description_md if description_md.endswith("\n") else description_md + "\n"
    if "## Richieste" not in text:
        text += "\n## Richieste\n"
    # Avoid logging the exact same request twice in a row.
    if text.rstrip().endswith(line):
        return text
    return text + line + "\n"


# --- Design System: reusable visual contract injected into codegen as design-system.md ---------
# The preview is a network-less sandbox, so only system-safe font stacks are allowed (no web fonts).
DS_FONT_STACKS: dict[str, str] = {
    "sans": "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    "humanist": "'Segoe UI', 'Helvetica Neue', Optima, 'Gill Sans', 'Trebuchet MS', system-ui, sans-serif",
    "geometric": "Futura, 'Century Gothic', 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif",
    "rounded": "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
    "condensed": "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', 'Segoe UI', sans-serif",
    "serif": "Georgia, 'Times New Roman', 'Iowan Old Style', 'Apple Garamond', serif",
    "slab": "Rockwell, 'Roboto Slab', 'Courier New', Georgia, serif",
    "didone": "Didot, 'Bodoni MT', 'Playfair Display', 'Hoefler Text', Georgia, serif",
    "mono": "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
}
_SYSTEM_FONT_STACK = DS_FONT_STACKS["sans"]

DEFAULT_DESIGN_TOKENS: dict = {
    "mood": "",
    "palette": {
        "primary": "#2563eb", "primaryText": "#ffffff",
        "accent": "#f59e0b", "accentText": "#1f2937",
        "background": "#f8fafc", "surface": "#ffffff",
        "text": "#0f172a", "textMuted": "#64748b", "border": "#e2e8f0",
        "success": "#16a34a", "danger": "#dc2626",
    },
    "typography": {
        "fontHeading": "sans", "fontBody": "sans",
        "baseSize": 16, "scaleRatio": 1.25, "headingWeight": 700, "bodyWeight": 400,
    },
    "shape": {"radius": 12, "buttonShape": "soft", "buttonStyle": "solid", "surfaceStyle": "flat", "shadowLevel": "soft", "borderWidth": 1},
    "spacing": {"base": 8, "density": "comfortable"},
    "priorities": ["leggibilità", "gerarchia", "coerenza"],
}

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _clean_hex(value, fallback: str) -> str:
    s = str(value or "").strip()
    if not _HEX_RE.match(s):
        return fallback
    if len(s) == 4:  # expand #rgb -> #rrggbb
        s = "#" + "".join(ch * 2 for ch in s[1:])
    return s.lower()


def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def _relative_luminance(hex_color: str) -> float:
    def _lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (_lin(c) for c in _hex_to_rgb(hex_color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast_ratio(fg: str, bg: str) -> float:
    l1, l2 = _relative_luminance(fg), _relative_luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return round((hi + 0.05) / (lo + 0.05), 2)


def _resolve_font_stack(value) -> str:
    """Accept a known stack key or a full stack string, but never allow external fonts."""
    s = str(value or "").strip()
    if s in DS_FONT_STACKS:
        return DS_FONT_STACKS[s]
    if not s or "http" in s.lower() or "url(" in s.lower() or "@import" in s.lower():
        return _SYSTEM_FONT_STACK
    return s[:200]


def _clamp(value, lo: float, hi: float, fallback: float) -> float:
    try:
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return fallback


def _normalize_design_tokens(raw: dict | None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    d = DEFAULT_DESIGN_TOKENS
    p_in = raw.get("palette") if isinstance(raw.get("palette"), dict) else {}
    palette = {key: _clean_hex(p_in.get(key), d["palette"][key]) for key in d["palette"]}

    def _norm_font(value) -> str:
        if value in DS_FONT_STACKS:  # keep the stack key for round-trip / wizard highlighting
            return value
        if not value:
            return "sans"
        return _resolve_font_stack(value)  # custom full stack string, sanitised (no web fonts)

    t_in = raw.get("typography") if isinstance(raw.get("typography"), dict) else {}
    typography = {
        "fontHeading": _norm_font(t_in.get("fontHeading")),
        "fontBody": _norm_font(t_in.get("fontBody")),
        "baseSize": int(_clamp(t_in.get("baseSize"), 14, 20, 16)),
        "scaleRatio": round(_clamp(t_in.get("scaleRatio"), 1.1, 1.6, 1.25), 3),
        "headingWeight": int(_clamp(t_in.get("headingWeight"), 500, 900, 700)),
        "bodyWeight": int(_clamp(t_in.get("bodyWeight"), 300, 600, 400)),
    }

    s_in = raw.get("shape") if isinstance(raw.get("shape"), dict) else {}
    button_shape = str(s_in.get("buttonShape") or "soft")
    if button_shape not in ("squared", "soft", "pill"):
        button_shape = "soft"
    button_style = str(s_in.get("buttonStyle") or "solid")
    if button_style not in ("solid", "outline", "soft", "gradient", "glass", "glossy"):
        button_style = "solid"
    surface_style = str(s_in.get("surfaceStyle") or "flat")
    if surface_style not in ("flat", "transparent", "frosted", "glossy"):
        surface_style = "flat"
    shadow_level = str(s_in.get("shadowLevel") or "soft")
    if shadow_level not in ("none", "soft", "strong"):
        shadow_level = "soft"
    shape = {
        "radius": int(_clamp(s_in.get("radius"), 0, 32, 12)),
        "buttonShape": button_shape,
        "buttonStyle": button_style,
        "surfaceStyle": surface_style,
        "shadowLevel": shadow_level,
        "borderWidth": int(_clamp(s_in.get("borderWidth"), 0, 4, 1)),
    }

    sp_in = raw.get("spacing") if isinstance(raw.get("spacing"), dict) else {}
    density = str(sp_in.get("density") or "comfortable")
    if density not in ("compact", "comfortable", "spacious"):
        density = "comfortable"
    spacing = {"base": int(_clamp(sp_in.get("base"), 4, 16, 8)), "density": density}

    priorities = [str(x).strip()[:40] for x in (raw.get("priorities") or []) if str(x).strip()][:6] or list(d["priorities"])

    return {
        "mood": str(raw.get("mood") or "").strip()[:120],
        "palette": palette,
        "typography": typography,
        "shape": shape,
        "spacing": spacing,
        "priorities": priorities,
    }


def _design_contrast_checks(tokens: dict) -> list[dict]:
    p = tokens["palette"]
    pairs = [
        ("Testo su sfondo", p["text"], p["background"]),
        ("Testo su superficie", p["text"], p["surface"]),
        ("Testo attenuato su sfondo", p["textMuted"], p["background"]),
        ("Etichetta bottone primario", p["primaryText"], p["primary"]),
        ("Etichetta bottone accento", p["accentText"], p["accent"]),
    ]
    out = []
    for label, fg, bg in pairs:
        ratio = _contrast_ratio(fg, bg)
        out.append({"label": label, "foreground": fg, "background": bg, "ratio": ratio, "passes_aa": ratio >= 4.5})
    return out


def _design_btn_radius(tokens: dict) -> int:
    shape = tokens["shape"]["buttonShape"]
    if shape == "squared":
        return 4
    if shape == "pill":
        return 999
    return tokens["shape"]["radius"]


def _rgba(hex_color: str, alpha: float) -> str:
    r, g, b = (round(c * 255) for c in _hex_to_rgb(hex_color))
    return f"rgba({r}, {g}, {b}, {alpha})"


def _design_button_css(tokens: dict) -> dict:
    """Resolve the primary button appearance (fill / outline / soft tint / gradient / glass /
    glossy) into concrete CSS values, so the preview and the generated app render identically."""
    p = tokens["palette"]
    style = tokens["shape"].get("buttonStyle", "solid")
    border_w = max(1, int(tokens["shape"].get("borderWidth") or 1) + 1)
    gradient = f"linear-gradient(135deg, {p['primary']}, {p['accent']})"
    base = {"bg": p["primary"], "color": p["primaryText"], "border": "none", "backdrop": "none", "gradient": gradient}
    if style == "outline":
        return {**base, "bg": "transparent", "color": p["primary"], "border": f"{border_w}px solid {p['primary']}"}
    if style == "soft":
        return {**base, "bg": _rgba(p["primary"], 0.14), "color": p["primary"]}
    if style == "gradient":
        return {**base, "bg": gradient}
    if style == "glass":
        # Frosted button: translucent primary tint + blur + light edge (needs a colourful bg behind).
        return {**base, "bg": _rgba(p["primary"], 0.18), "color": p["primary"], "border": f"1px solid {_rgba(p['primary'], 0.4)}", "backdrop": "blur(8px) saturate(140%)"}
    if style == "glossy":
        # Solid primary with a top sheen overlay for a glossy, reflective look.
        return {**base, "bg": f"linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%), {p['primary']}"}
    return base


def _design_surface_css(tokens: dict) -> dict:
    """Resolve the card/surface appearance: opaque (flat), simple translucency, frosted glass
    (blur), or glossy (sheen). Frosted/transparent read best over a colourful page background."""
    p = tokens["palette"]
    style = tokens["shape"].get("surfaceStyle", "flat")
    dark_surface = _relative_luminance(p["surface"]) < 0.5
    glass_border = "rgba(255,255,255,0.30)" if dark_surface else _rgba(p["text"], 0.10)
    if style == "transparent":
        return {"bg": _rgba(p["surface"], 0.72), "backdrop": "none", "border": glass_border}
    if style == "frosted":
        return {"bg": _rgba(p["surface"], 0.55), "backdrop": "blur(14px) saturate(160%)", "border": glass_border}
    if style == "glossy":
        return {"bg": f"linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%), {p['surface']}", "backdrop": "none", "border": p["border"]}
    return {"bg": p["surface"], "backdrop": "none", "border": p["border"]}


def _design_shadow_value(level: str) -> str:
    if level == "none":
        return "none"
    if level == "strong":
        return "0 4px 6px rgba(15,23,42,.10), 0 12px 28px rgba(15,23,42,.16)"
    return "0 1px 2px rgba(15,23,42,.06), 0 6px 16px rgba(15,23,42,.08)"


def _design_root_css(tokens: dict) -> str:
    p = tokens["palette"]
    t = tokens["typography"]
    s = tokens["spacing"]
    # Typography may store a stack key ("sans") or a full stack string: resolve to a real CSS
    # font-family value (a bare "sans" is not valid CSS).
    font_heading = DS_FONT_STACKS.get(t["fontHeading"], t["fontHeading"])
    font_body = DS_FONT_STACKS.get(t["fontBody"], t["fontBody"])
    btn = _design_button_css(tokens)
    surf = _design_surface_css(tokens)
    return (
        ":root {\n"
        f"  --ds-color-primary: {p['primary']};\n"
        f"  --ds-color-primary-text: {p['primaryText']};\n"
        f"  --ds-color-accent: {p['accent']};\n"
        f"  --ds-color-accent-text: {p['accentText']};\n"
        f"  --ds-bg: {p['background']};\n"
        f"  --ds-surface: {p['surface']};\n"
        f"  --ds-text: {p['text']};\n"
        f"  --ds-text-muted: {p['textMuted']};\n"
        f"  --ds-border: {p['border']};\n"
        f"  --ds-success: {p['success']};\n"
        f"  --ds-danger: {p['danger']};\n"
        f"  --ds-font-heading: {font_heading};\n"
        f"  --ds-font-body: {font_body};\n"
        f"  --ds-text-base: {t['baseSize']}px;\n"
        f"  --ds-scale-ratio: {t['scaleRatio']};\n"
        f"  --ds-weight-heading: {t['headingWeight']};\n"
        f"  --ds-weight-body: {t['bodyWeight']};\n"
        f"  --ds-radius: {tokens['shape']['radius']}px;\n"
        f"  --ds-btn-radius: {_design_btn_radius(tokens)}px;\n"
        f"  --ds-border-width: {tokens['shape']['borderWidth']}px;\n"
        f"  --ds-shadow: {_design_shadow_value(tokens['shape']['shadowLevel'])};\n"
        f"  --ds-space: {s['base']}px;\n"
        f"  --ds-gradient: {btn['gradient']};\n"
        f"  --ds-btn-bg: {btn['bg']};\n"
        f"  --ds-btn-color: {btn['color']};\n"
        f"  --ds-btn-border: {btn['border']};\n"
        f"  --ds-btn-backdrop: {btn['backdrop']};\n"
        f"  --ds-card-bg: {surf['bg']};\n"
        f"  --ds-card-border: {surf['border']};\n"
        f"  --ds-card-backdrop: {surf['backdrop']};\n"
        "}"
    )


def _render_design_system_md(name: str, tokens: dict, description: str = "") -> str:
    """Produce the authoritative design-system.md fed to codegen. Contains the mandatory :root
    variables, component rules and a round-trippable token block."""
    checks = _design_contrast_checks(tokens)
    failing = [c for c in checks if not c["passes_aa"]]
    density_gap = {"compact": "12-16px", "comfortable": "16-24px", "spacious": "24-40px"}[tokens["spacing"]["density"]]
    shape_word = {"squared": "squadrati", "soft": "morbidi (angoli arrotondati)", "pill": "a pillola"}[tokens["shape"]["buttonShape"]]
    style_word = {
        "solid": "pieni (riempimento primario)",
        "outline": "con bordo (sfondo trasparente, contorno colorato)",
        "soft": "in tinta morbida (sfondo semitrasparente del primario)",
        "gradient": "con gradiente (dal primario all'accento)",
        "glass": "vetro smerigliato (tinta translucida + sfocatura)",
        "glossy": "lucidi (riflesso/sheen sul primario)",
    }[tokens["shape"].get("buttonStyle", "solid")]
    surface_style = tokens["shape"].get("surfaceStyle", "flat")
    surface_word = {
        "flat": "piene/opache",
        "transparent": "translucide semplici (semitrasparenti)",
        "frosted": "vetro smerigliato (semitrasparenti + sfocatura backdrop)",
        "glossy": "lucide (con riflesso/sheen)",
    }[surface_style]
    glass_note = (
        "\n- IMPORTANTE (effetto vetro): lo stile superfici/bottoni e` translucido. Perche` si veda, lo "
        "sfondo pagina DEVE essere ricco (un gradiente colorato o forme/blob sfumati dietro le card), "
        "altrimenti il vetro sembra grigio. Applica `backdrop-filter` (e `-webkit-backdrop-filter`).\n"
        if surface_style in ("frosted", "transparent") or tokens["shape"].get("buttonStyle") == "glass" else ""
    )
    shadow_word = {"none": "senza ombre (design piatto)", "soft": "ombre morbide e leggere", "strong": "ombre marcate per profondità"}[tokens["shape"]["shadowLevel"]]
    priorities = ", ".join(tokens["priorities"])
    tokens_block = json.dumps(tokens, ensure_ascii=False, indent=2)
    desc_line = (description.strip() + "\n\n") if description and description.strip() else ""

    return (
        f"# Design System — {name or 'Senza nome'}\n\n"
        f"{desc_line}"
        "Questo file e` il CONTRATTO VISIVO del progetto. Le regole qui sotto sono VINCOLANTI e "
        "PREVALGONO su qualsiasi scelta estetica autonoma: usa SEMPRE queste variabili e questi "
        "vincoli, non inventare altri colori, font, raggi o spaziature.\n\n"
        "## Variabili obbligatorie (incolla in :root di styles.css e usale ovunque)\n\n"
        f"```css\n{_design_root_css(tokens)}\n```\n\n"
        "## Regole d'uso\n"
        "- Colori: testo con `var(--ds-text)`, testo secondario `var(--ds-text-muted)`; sfondo pagina "
        "`var(--ds-bg)`, card/pannelli secondo la ricetta \"Stile card\" qui sotto (`var(--ds-card-bg)`). Le azioni "
        "primarie usano `var(--ds-color-primary)` con testo `var(--ds-color-primary-text)`; gli accenti "
        "`var(--ds-color-accent)` con testo `var(--ds-color-accent-text)`. Non usare colori fuori da queste variabili.\n"
        f"- Tipografia: titoli con `var(--ds-font-heading)` peso `var(--ds-weight-heading)`; corpo con "
        f"`var(--ds-font-body)` a `var(--ds-text-base)` peso `var(--ds-weight-body)`, line-height >= 1.5. "
        f"Scala tipografica con ratio {tokens['typography']['scaleRatio']} (es. h1 = base * ratio^3, h2 = base * ratio^2...). "
        "Niente font esterni: solo gli stack di sistema definiti nelle variabili.\n"
        f"- Forma: bottoni e input con `border-radius: var(--ds-btn-radius)` ({shape_word}); card con "
        f"`border-radius: var(--ds-radius)`. Profondita`: {shadow_word} via `var(--ds-shadow)`. Bordi `var(--ds-border-width)`.\n"
        f"- Stile bottoni: {style_word}. Il bottone primario DEVE usare questa ricetta esatta:\n"
        "  `background: var(--ds-btn-bg); color: var(--ds-btn-color); border: var(--ds-btn-border); "
        "border-radius: var(--ds-btn-radius); box-shadow: var(--ds-shadow); "
        "backdrop-filter: var(--ds-btn-backdrop); -webkit-backdrop-filter: var(--ds-btn-backdrop);`. "
        "Mantieni hover/focus visibili (es. leggero scurire/scala o anello di focus). Non cambiare il tipo di riempimento del bottone.\n"
        f"- Stile card/superfici: {surface_word}. Card e pannelli DEVONO usare questa ricetta esatta:\n"
        "  `background: var(--ds-card-bg); border: 1px solid var(--ds-card-border); "
        "border-radius: var(--ds-radius); box-shadow: var(--ds-shadow); "
        "backdrop-filter: var(--ds-card-backdrop); -webkit-backdrop-filter: var(--ds-card-backdrop);`.\n"
        f"{glass_note}"
        f"- Spaziatura: usa multipli di `var(--ds-space)`; ritmo verticale tra sezioni {density_gap}. "
        f"Densita`: {tokens['spacing']['density']}.\n"
        f"- Priorita` visive (in ordine): {priorities}. Rispettale nelle scelte di gerarchia e layout.\n"
        "- Accessibilita`: contrasto AA su tutto il testo, focus visibile, label sugli input.\n\n"
        + ("## Attenzione contrasto\n" + "\n".join(
            f"- {c['label']}: rapporto {c['ratio']} (sotto AA 4.5). Scurisci/schiarisci per migliorare la leggibilita`."
            for c in failing
          ) + "\n\n" if failing else "")
        + "## Token (sorgente, non modificare a mano)\n\n"
        f"```json\n{tokens_block}\n```\n"
    )


async def _suggest_design_tokens(req: DesignSystemSuggestRequest) -> tuple[dict, dict]:
    """Ask the model for a coherent starting design system + a short rationale per choice.
    Falls back to defaults (never raises) so the wizard always has something to show."""
    system_prompt = (
        "Sei un design educator. Proponi un design system COERENTE e accessibile per una mini app web "
        "rivolta a studenti, partendo dall'idea/mood forniti. Palette con contrasto AA tra testo e sfondi. "
        "I font sono SOLO stack di sistema: usa una di queste chiavi per fontHeading/fontBody: "
        "\"sans\", \"serif\", \"rounded\", \"mono\". buttonShape in [squared, soft, pill]; shadowLevel in "
        "[none, soft, strong]; spacing.density in [compact, comfortable, spacious]. "
        "Per ogni scelta principale aggiungi UNA frase di razionale educativo (perche` e` coerente). "
        "Rispondi SOLO con JSON valido:\n"
        "{\n  \"tokens\": {\"mood\": \"...\", \"palette\": {\"primary\":\"#..\",\"primaryText\":\"#..\","
        "\"accent\":\"#..\",\"accentText\":\"#..\",\"background\":\"#..\",\"surface\":\"#..\",\"text\":\"#..\","
        "\"textMuted\":\"#..\",\"border\":\"#..\",\"success\":\"#..\",\"danger\":\"#..\"}, "
        "\"typography\": {\"fontHeading\":\"sans\",\"fontBody\":\"sans\",\"baseSize\":16,\"scaleRatio\":1.25,"
        "\"headingWeight\":700,\"bodyWeight\":400}, \"shape\": {\"radius\":12,\"buttonShape\":\"soft\","
        "\"shadowLevel\":\"soft\",\"borderWidth\":1}, \"spacing\": {\"base\":8,\"density\":\"comfortable\"}, "
        "\"priorities\": [\"leggibilità\",\"gerarchia\",\"coerenza\"]},\n"
        "  \"rationale\": {\"palette\": \"...\", \"typography\": \"...\", \"shape\": \"...\", \"spacing\": \"...\"}\n}"
    )
    parts = []
    if req.mood:
        parts.append(f"Mood/identita`: {req.mood}")
    if req.title:
        parts.append(f"Titolo progetto: {req.title}")
    if req.audience:
        parts.append(f"Pubblico: {req.audience}")
    if req.idea:
        parts.append(f"Idea: {req.idea}")
    user_content = "\n".join(parts) or "Proponi un design system moderno, pulito e versatile."
    try:
        response = await _coding_generate(
            messages=[{"role": "user", "content": user_content}],
            system_prompt=system_prompt,
            temperature=0.6,
            max_tokens=1500,
        )
        payload = _extract_json_object(response.content)
        tokens = _normalize_design_tokens(payload.get("tokens") if isinstance(payload, dict) else {})
        rationale_raw = payload.get("rationale") if isinstance(payload, dict) else {}
        rationale = {
            str(k): str(v).strip()[:300]
            for k, v in (rationale_raw or {}).items()
            if str(v).strip()
        } if isinstance(rationale_raw, dict) else {}
        return tokens, rationale
    except Exception as exc:
        logger.warning("design system suggestion failed (%s); using defaults", exc)
        return _normalize_design_tokens({"mood": req.mood or ""}), {}


def _design_coherence(tokens: dict, checks: list[dict]) -> tuple[float, list[str]]:
    warnings: list[str] = []
    passing = sum(1 for c in checks if c["passes_aa"])
    score = passing / len(checks) if checks else 0.0
    for c in checks:
        if not c["passes_aa"]:
            warnings.append(f"{c['label']}: contrasto {c['ratio']} sotto AA (4.5).")
    # Light coherence nudges (educational, not blocking).
    if tokens["typography"]["fontHeading"] == tokens["typography"]["fontBody"] and tokens["typography"]["scaleRatio"] < 1.2:
        warnings.append("Stesso font per titoli e corpo con scala piccola: la gerarchia rischia di appiattirsi.")
    return round(min(1.0, score), 2), warnings[:6]


async def _record_coding_cost(
    db: AsyncSession,
    *,
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    context: str,
    tenant_id,
    session_id=None,
    student_id=None,
    teacher_id=None,
    image_count: int = 0,
):
    """Record provider consumption for a Coding Lab LLM call against the credit system.

    Resolves the class (and, for students, rolls the cost up to the class teacher) from the
    session so the same monthly limits used by the chatbots apply to the Coding Lab. Never
    raises — credit tracking must not break generation."""
    try:
        class_id = None
        if session_id:
            sess = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
            if sess:
                class_id = sess.class_id
                tenant_id = tenant_id or sess.tenant_id
                if class_id and student_id is not None and teacher_id is None:
                    cls = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
                    if cls:
                        teacher_id = cls.teacher_id
        if not tenant_id:
            return
        cost = credit_service.calculate_cost_for_model(
            provider, model, int(prompt_tokens or 0), int(completion_tokens or 0), int(image_count or 0)
        )
        usage = enrich_usage_with_environmental_impact(
            {
                "prompt_tokens": int(prompt_tokens or 0),
                "completion_tokens": int(completion_tokens or 0),
                "total_tokens": int(prompt_tokens or 0) + int(completion_tokens or 0),
                "image_count": int(image_count or 0),
                "estimated_tokens": True,
                "type": context,
            },
            provider=provider,
            model=model,
        )
        await credit_service.track_usage(
            db, tenant_id, provider, model, cost, usage,
            teacher_id, class_id, session_id, student_id,
        )
    except Exception:
        logger.exception("coding usage tracking failed (%s) provider=%s model=%s", context, provider, model)


async def _coding_generate(messages: list[dict], system_prompt: str, *, temperature: float = 0.4, max_tokens: int = 8000):
    """Generate with the stronger Coding Lab model, falling back to the platform default."""
    try:
        return await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=settings.CODING_LLM_PROVIDER,
            model=settings.CODING_LLM_MODEL,
            temperature=temperature,
            max_tokens=max_tokens,
            allow_web_search=False,
        )
    except Exception as exc:
        logger.warning("coding model %s/%s failed (%s); falling back to default", settings.CODING_LLM_PROVIDER, settings.CODING_LLM_MODEL, exc)
        return await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            allow_web_search=False,
        )


# Selectable Coding Lab generation models. The frontend sends a key; we resolve it here so a
# client can never inject an arbitrary provider/model string. Unknown/empty -> configured default.
CODING_MODEL_CHOICES: dict[str, tuple[str, str]] = {
    "sonnet": ("anthropic", "claude-sonnet-4-6"),
    "haiku": ("anthropic", "claude-haiku-4-5-20251001"),
    "gpt-mini": ("openai", "gpt-5.4-mini"),
    # DeepSeek V4 — Coding Lab only (not exposed in the global /available-models list).
    "deepseek-flash": ("deepseek", "deepseek-v4-flash"),
    "deepseek-pro": ("deepseek", "deepseek-v4-pro"),
}


def _resolve_coding_model(model_key: str | None) -> tuple[str, str]:
    return CODING_MODEL_CHOICES.get((model_key or "").strip(), (settings.CODING_LLM_PROVIDER, settings.CODING_LLM_MODEL))


async def _coding_generate_stream(messages: list[dict], system_prompt: str, *, provider: str, model: str, temperature: float = 0.4, max_tokens: int = 16000):
    """Streaming counterpart of _coding_generate. Yields text chunks from the chosen Coding Lab
    model, falling back to the platform default only if the primary fails before emitting."""
    started = False
    try:
        async for chunk in llm_service.generate_stream(
            messages=messages,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            started = True
            yield chunk
    except Exception as exc:
        if started:
            raise
        logger.warning("coding stream model %s/%s failed (%s); falling back to default", provider, model, exc)
        async for chunk in llm_service.generate_stream(
            messages=messages,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            yield chunk


async def _ui_review_files(files: list[dict]) -> tuple[list[dict], list[str]]:
    """Second pass: audit generated UI for contrast/overlap/readability defects and fix them.

    Returns (possibly fixed files, list of issues found). Never raises — on any problem the
    original files are returned unchanged so generation is never blocked.
    """
    review_targets = [f for f in files if not str(f.get("path") or "").lower().endswith(".md")]
    if not review_targets:
        return files, []
    # The design system (design-system.md) is the binding visual contract: feed it so the reviewer
    # can verify and fix adherence (--ds-* variables, button/card recipes, contrast).
    design_system = next(
        (str(f.get("content") or "") for f in files if str(f.get("path") or "").lower() == "design-system.md"),
        "",
    )
    ds_context = (
        f"\n\nCONTRATTO DESIGN SYSTEM da rispettare e far rispettare al codice (design-system.md):\n{design_system[:8000]}"
        if design_system else ""
    )
    try:
        bundle = "\n\n".join(
            f"FILE: {f.get('path')}\n{str(f.get('content') or '')[:12000]}" for f in review_targets
        )
        response = await _coding_generate(
            messages=[{"role": "user", "content": f"File della mini app da rivedere:\n\n{bundle}{ds_context}"}],
            system_prompt=UI_REVIEW_SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=8000,
        )
        payload = _extract_json_object(response.content)
        fixed = _normalize_generated_files(payload)
        fixed = [f for f in fixed if not str(f.get("path") or "").lower().endswith(".md")]
        if not fixed:
            return files, []
        issues = [str(i).strip() for i in (payload.get("issues_found") or []) if str(i).strip()][:6]
        # Preserve any non-md files the reviewer dropped.
        fixed_paths = {f["path"] for f in fixed}
        for f in review_targets:
            if f["path"] not in fixed_paths:
                fixed.append(f)
        return fixed, issues
    except Exception as exc:
        logger.warning("UI review pass skipped (%s)", exc)
        return files, []


def _parse_delimited_files(text: str) -> list[dict]:
    """Parse the '=== FILE: path ===\\n<content>' ... '=== END ===' format into file dicts."""
    file_marker = re.compile(r"^===\s*FILE:\s*(.+?)\s*===\s*$")
    end_marker = re.compile(r"^===\s*END\s*===\s*$")
    out: list[dict] = []
    current_path: str | None = None
    current_lines: list[str] = []

    def flush():
        nonlocal current_path, current_lines
        if current_path is not None:
            content = _strip_code_fences("\n".join(current_lines).strip("\n"))
            if content.strip():
                out.append({"path": current_path, "content": content, "language": _lang_for_path(current_path)})
        current_path = None
        current_lines = []

    for line in text.splitlines():
        marker = file_marker.match(line)
        if marker:
            flush()
            current_path = marker.group(1).strip().lstrip("/")
            continue
        if end_marker.match(line):
            flush()
            continue
        if current_path is not None:
            current_lines.append(line)
    flush()
    return out


async def _design_review_files(files: list[dict]) -> tuple[list[dict], list[str]]:
    """Agentic design-system enforcement for React projects: rewrite styling so the app obeys the
    design-system.md contract. Returns (files, changed_paths). Never raises (keeps originals)."""
    design_system = next(
        (str(f.get("content") or "") for f in files if str(f.get("path") or "").lower() == "design-system.md"),
        "",
    )
    if not design_system.strip():
        return files, []
    code_files = [f for f in files if not str(f.get("path") or "").lower().endswith(".md")]
    if not code_files:
        return files, []
    try:
        bundle = "\n\n".join(
            f"=== FILE: {f.get('path')} ===\n{str(f.get('content') or '')[:12000]}" for f in code_files
        )
        user = (
            f"CONTRATTO DESIGN SYSTEM (design-system.md):\n{design_system[:8000]}\n\n"
            f"File dell'app React da rendere conformi:\n\n{bundle}"
        )
        response = await _coding_generate(
            messages=[{"role": "user", "content": user}],
            system_prompt=DESIGN_REVIEW_SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=16000,
        )
        changed = _parse_delimited_files(response.content)
        changed = [
            f for f in changed
            if not str(f.get("path") or "").lower().endswith((".md", ".html", ".htm"))
            and str(f.get("path") or "").lower() not in _RESERVED_PATHS
        ]
        if not changed:
            return files, []
        by_path = {str(f.get("path")): f for f in files}
        for c in changed:
            by_path[c["path"]] = c
        return list(by_path.values()), [c["path"] for c in changed]
    except Exception as exc:
        logger.warning("design review pass skipped (%s)", exc)
        return files, []


def _file_line_count(file: dict) -> int:
    content = str(file.get("content") or "")
    if not content:
        return 0
    return content.count("\n") + 1


def _build_file_change_summary(previous_files: list[dict], next_files: list[dict]) -> tuple[str, dict]:
    previous_by_path = {str(file.get("path") or ""): file for file in previous_files}
    next_by_path = {str(file.get("path") or ""): file for file in next_files}
    rows: list[str] = []
    file_rows: list[dict] = []
    added = modified = unchanged = 0
    total_lines = 0

    for path in sorted(next_by_path):
        file = next_by_path[path]
        lines = _file_line_count(file)
        total_lines += lines
        previous = previous_by_path.get(path)
        if previous is None:
            status_label = "creato"
            delta = lines
            added += 1
        elif str(previous.get("content") or "") != str(file.get("content") or ""):
            delta = lines - _file_line_count(previous)
            sign = "+" if delta >= 0 else ""
            status_label = f"modificato ({sign}{delta} righe)"
            modified += 1
        else:
            delta = 0
            status_label = "invariato"
            unchanged += 1
        rows.append(f"- {path}: {status_label}, {lines} righe")
        file_rows.append({
            "path": path,
            "status": status_label,
            "lines": lines,
            "delta": delta if previous is not None else lines,
        })

    removed_paths = sorted(set(previous_by_path) - set(next_by_path))
    for path in removed_paths:
        rows.append(f"- {path}: rimosso")
        file_rows.append({"path": path, "status": "rimosso", "lines": 0, "delta": -_file_line_count(previous_by_path[path])})

    headline = f"Scrittura completata: {len(next_files)} file, {total_lines} righe totali."
    if added or modified or removed_paths:
        headline += f" {added} creati, {modified} modificati, {len(removed_paths)} rimossi."
    elif unchanged:
        headline += " Nessuna modifica sostanziale ai file."

    return "\n".join([headline, *rows]), {
        "file_count": len(next_files),
        "total_lines": total_lines,
        "added": added,
        "modified": modified,
        "removed": len(removed_paths),
        "unchanged": unchanged,
        "files": file_rows,
    }


def _build_static_html(files: list[dict], title: str = "Mini app", entry_path: str = "index.html") -> str:
    by_path = {str(file.get("path") or ""): str(file.get("content") or "") for file in files}
    html = by_path.get(entry_path) or by_path.get("index.html") or '<!doctype html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mini app</title><link rel="stylesheet" href="styles.css"></head><body><main id="app"></main><script src="script.js"></script></body></html>'
    css = by_path.get("styles.css") or ""
    js = by_path.get("script.js") or ""
    safe_css = css.replace("</style", "<\\/style")
    safe_js = (f"(() => {{\n{js}\n}})();" if js else "").replace("</script", "<\\/script")

    output = re.sub(r'<link[^>]+href=["\']styles\.css["\'][^>]*>', lambda _match: f"<style>{safe_css}</style>", html, flags=re.IGNORECASE)
    output = re.sub(r'<script[^>]+src=["\']script\.js["\'][^>]*>\s*</script>', lambda _match: f"<script>{safe_js}</script>", output, flags=re.IGNORECASE)
    if not re.search(r"<title[\s>]", output, flags=re.IGNORECASE):
        output = re.sub(r"</head>", f"<title>{title}</title></head>", output, flags=re.IGNORECASE)
    if css and not re.search(r"<style[\s>]", output, flags=re.IGNORECASE):
        output = re.sub(r"</head>", lambda _match: f"<style>{safe_css}</style></head>", output, flags=re.IGNORECASE)
    if js and not re.search(r"<script[\s>]", output, flags=re.IGNORECASE):
        output = re.sub(r"</body>", lambda _match: f"<script>{safe_js}</script></body>", output, flags=re.IGNORECASE)
    return _inject_static_router(output, files, title)


def _inject_static_router(html: str, files: list[dict], title: str) -> str:
    html_files = {
        str(file.get("path") or ""): str(file.get("content") or "")
        for file in files
        if str(file.get("path") or "").endswith(".html")
    }
    payload = json.dumps({
        "htmlFiles": html_files,
        "css": next((str(file.get("content") or "") for file in files if str(file.get("path") or "") == "styles.css"), ""),
        "js": next((str(file.get("content") or "") for file in files if str(file.get("path") or "") == "script.js"), ""),
        "title": title,
    }).replace("<", "\\u003c")
    runtime = f"""<script>
(() => {{
  const site = {payload};
  function pageCandidate(value) {{
    const clean = String(value || '').replace(/^#/, '').replace(/^\\.\\//, '').split('#')[0].split('?')[0].replace(/^\\//, '');
    if (!clean || clean === '/') return '';
    return clean.endsWith('.html') ? clean : clean + '.html';
  }}
  function normalizePath(raw) {{
    let hashCandidate = '';
    let pathCandidate = '';
    try {{
      const url = new URL(raw, window.location.href);
      hashCandidate = pageCandidate(url.hash.slice(1));
      pathCandidate = pageCandidate(url.pathname.split('/').pop() || '');
    }} catch {{}}
    const rawHash = String(raw || '').split('#')[1] || '';
    hashCandidate = hashCandidate || pageCandidate(rawHash);
    pathCandidate = pathCandidate || pageCandidate(String(raw || '').split('#')[0]);
    if (hashCandidate && site.htmlFiles[hashCandidate]) return hashCandidate;
    if (pathCandidate && site.htmlFiles[pathCandidate]) return pathCandidate;
    return pathCandidate || '';
  }}
  function renderPage(path, push = true) {{
    const nextPath = normalizePath(path);
    const nextHtml = site.htmlFiles[nextPath];
    if (!nextHtml) return false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(nextHtml, 'text/html');
    document.title = doc.querySelector('title')?.textContent || site.title || document.title;
    document.querySelectorAll('[data-published-page-head]').forEach((node) => node.remove());
    doc.head.querySelectorAll('style').forEach((node) => {{
      const style = document.createElement('style');
      style.setAttribute('data-published-page-head', 'true');
      style.textContent = node.textContent || '';
      document.head.appendChild(style);
    }});
    if (site.css) {{
      document.getElementById('published-shared-css')?.remove();
      const style = document.createElement('style');
      style.id = 'published-shared-css';
      style.textContent = site.css;
      document.head.appendChild(style);
    }}
    const inlineScripts = [];
    doc.querySelectorAll('script').forEach((node) => {{
      const src = node.getAttribute('src') || '';
      if (/script\\.js$/i.test(src)) return;
      if (node.textContent) inlineScripts.push(node.textContent);
      node.remove();
    }});
    document.body.innerHTML = doc.body.innerHTML;
    if (site.js) {{
      const script = document.createElement('script');
      script.textContent = '(() => {{\\n' + site.js + '\\n}})();';
      document.body.appendChild(script);
    }}
    inlineScripts.forEach((source) => {{
      const script = document.createElement('script');
      script.textContent = source;
      document.body.appendChild(script);
    }});
    if (push) history.pushState({{ path: nextPath }}, '', '#' + nextPath);
    return true;
  }}
  document.addEventListener('click', (event) => {{
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (href.startsWith('http://') || href.startsWith('https://')) return;
    if (href.startsWith('#')) return;
    event.preventDefault();
    const nextPath = normalizePath(href);
    if (nextPath && site.htmlFiles[nextPath]) renderPage(nextPath);
  }}, true);
  window.addEventListener('popstate', (event) => renderPage(event.state?.path || location.hash.slice(1) || 'index.html', false));
}})();
</script>"""
    if re.search(r"</body>", html, flags=re.IGNORECASE):
        return re.sub(r"</body>", lambda _match: f"{runtime}</body>", html, flags=re.IGNORECASE)
    return f"{html}{runtime}"


def _actor_identity(actor: StudentOrTeacher) -> tuple[str, UUID, UUID]:
    if actor.is_student:
        return "student", actor.student.id, actor.student.tenant_id
    return "teacher", actor.teacher.id, actor.teacher.tenant_id


async def _resolve_session(
    db: AsyncSession,
    actor: StudentOrTeacher,
    requested_session_id: Optional[UUID],
) -> Session:
    if actor.is_student:
        session_id = actor.student.session_id
        tenant_id = actor.student.tenant_id
    else:
        if not requested_session_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session_id is required")
        session_id = requested_session_id
        tenant_id = actor.teacher.tenant_id

    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if tenant_id and session.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session not accessible")
    return session


async def _get_accessible_project(
    db: AsyncSession,
    actor: StudentOrTeacher,
    project_id: UUID,
) -> CodingProject:
    result = await db.execute(select(CodingProject).where(CodingProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if actor.is_student:
        if project.owner_student_id != actor.student.id or project.session_id != actor.student.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project not accessible")
    else:
        if actor.teacher.tenant_id and project.tenant_id != actor.teacher.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project not accessible")

    return project


async def _get_session_project(
    db: AsyncSession,
    actor: StudentOrTeacher,
    project_id: UUID,
) -> CodingProject:
    result = await db.execute(select(CodingProject).where(CodingProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if actor.is_student:
        if project.session_id != actor.student.session_id or project.tenant_id != actor.student.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project not accessible")
    elif actor.teacher.tenant_id and project.tenant_id != actor.teacher.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project not accessible")

    return project


async def _get_current_version(db: AsyncSession, project: CodingProject) -> CodingVersion:
    if not project.current_version_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No generated version")
    result = await db.execute(select(CodingVersion).where(CodingVersion.id == project.current_version_id))
    version = result.scalar_one_or_none()
    files = (version.source_manifest_json or {}).get("files") if version else None
    if not version or not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No generated files")
    return version


async def _get_fork_metadata(db: AsyncSession, project: CodingProject) -> dict:
    versions_result = await db.execute(
        select(CodingVersion)
        .where(CodingVersion.project_id == project.id)
        .order_by(CodingVersion.version_number.desc())
    )
    for version in versions_result.scalars().all():
        metadata = (version.source_manifest_json or {}).get("collaboration")
        if isinstance(metadata, dict) and metadata.get("source_project_id"):
            return metadata
    return {}


async def _next_slug(db: AsyncSession, session_id: UUID, title: str) -> str:
    base_slug = _slugify(title)
    slug = base_slug
    suffix = 2
    while True:
        result = await db.execute(
            select(CodingProject.id).where(
                CodingProject.session_id == session_id,
                CodingProject.slug == slug,
            )
        )
        if result.scalar_one_or_none() is None:
            return slug
        slug = f"{base_slug[:110]}-{suffix}"
        suffix += 1


@router.get("/briefs", response_model=list[CodingBriefResponse])
async def list_briefs(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    session_id: Optional[UUID] = Query(default=None),
):
    if actor.is_student:
        query = select(CodingBrief).where(
            CodingBrief.tenant_id == actor.student.tenant_id,
            CodingBrief.session_id == actor.student.session_id,
        )
    else:
        query = select(CodingBrief)
        if actor.teacher.tenant_id:
            query = query.where(CodingBrief.tenant_id == actor.teacher.tenant_id)
        if session_id:
            query = query.where(CodingBrief.session_id == session_id)

    result = await db.execute(query.order_by(CodingBrief.updated_at.desc()))
    return list(result.scalars().all())


@router.post("/briefs", response_model=CodingBriefResponse, status_code=status.HTTP_201_CREATED)
async def create_brief(
    body: CodingBriefCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")

    unsupported = [template for template in body.allowed_templates_json if template not in SUPPORTED_TEMPLATES]
    if unsupported:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported templates: {', '.join(unsupported)}")

    session = await _resolve_session(db, actor, body.session_id)
    brief = CodingBrief(
        tenant_id=session.tenant_id,
        teacher_id=actor.teacher.id,
        session_id=session.id,
        title=body.title,
        description=body.description,
        constraints_json=body.constraints_json,
        rubric_json=body.rubric_json,
        allowed_templates_json=body.allowed_templates_json,
        publication_policy=body.publication_policy,
    )
    db.add(brief)
    await db.commit()
    await db.refresh(brief)
    return brief


@router.get("/projects", response_model=list[CodingProjectResponse])
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    session_id: Optional[UUID] = Query(default=None),
):
    query = select(CodingProject)
    if actor.is_student:
        query = query.where(
            CodingProject.owner_student_id == actor.student.id,
            CodingProject.session_id == actor.student.session_id,
        )
    else:
        if actor.teacher.tenant_id:
            query = query.where(CodingProject.tenant_id == actor.teacher.tenant_id)
        if session_id:
            query = query.where(CodingProject.session_id == session_id)

    result = await db.execute(query.order_by(CodingProject.updated_at.desc()))
    return list(result.scalars().all())


# --- Design System library (reusable, independent from any single project) --------------------
async def _get_owned_design_system(db: AsyncSession, actor: StudentOrTeacher, ds_id: UUID) -> CodingDesignSystem:
    result = await db.execute(select(CodingDesignSystem).where(CodingDesignSystem.id == ds_id))
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Design system not found")
    if actor.is_student:
        if ds.owner_student_id != actor.student.id or ds.tenant_id != actor.student.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Design system not accessible")
    else:
        if ds.owner_user_id != actor.teacher.id or (actor.teacher.tenant_id and ds.tenant_id != actor.teacher.tenant_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Design system not accessible")
    return ds


@router.get("/design-systems", response_model=list[DesignSystemResponse])
async def list_design_systems(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    query = select(CodingDesignSystem)
    if actor.is_student:
        query = query.where(
            CodingDesignSystem.owner_student_id == actor.student.id,
            CodingDesignSystem.tenant_id == actor.student.tenant_id,
        )
    else:
        query = query.where(CodingDesignSystem.owner_user_id == actor.teacher.id)
        if actor.teacher.tenant_id:
            query = query.where(CodingDesignSystem.tenant_id == actor.teacher.tenant_id)
    result = await db.execute(query.order_by(CodingDesignSystem.updated_at.desc()))
    return list(result.scalars().all())


@router.post("/design-systems", response_model=DesignSystemResponse, status_code=status.HTTP_201_CREATED)
async def create_design_system(
    body: DesignSystemCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_student:
        tenant_id = actor.student.tenant_id
        owner_student_id = actor.student.id
        owner_user_id = None
        session_id = actor.student.session_id
    else:
        tenant_id = actor.teacher.tenant_id
        owner_student_id = None
        owner_user_id = actor.teacher.id
        session_id = body.session_id
    ds = CodingDesignSystem(
        tenant_id=tenant_id,
        session_id=session_id,
        owner_student_id=owner_student_id,
        owner_user_id=owner_user_id,
        name=body.name.strip(),
        description=body.description,
        tokens_json=_normalize_design_tokens(body.tokens),
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return ds


@router.get("/design-systems/{ds_id}", response_model=DesignSystemResponse)
async def get_design_system(
    ds_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    return await _get_owned_design_system(db, actor, ds_id)


@router.put("/design-systems/{ds_id}", response_model=DesignSystemResponse)
async def update_design_system(
    ds_id: UUID,
    body: DesignSystemUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    ds = await _get_owned_design_system(db, actor, ds_id)
    if body.name is not None:
        ds.name = body.name.strip()
    if body.description is not None:
        ds.description = body.description
    if body.tokens is not None:
        ds.tokens_json = _normalize_design_tokens(body.tokens)
    await db.commit()
    await db.refresh(ds)
    return ds


@router.delete("/design-systems/{ds_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_design_system(
    ds_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    ds = await _get_owned_design_system(db, actor, ds_id)
    await db.delete(ds)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/design-systems/suggest", response_model=DesignSystemSuggestResponse)
async def suggest_design_system(
    body: DesignSystemSuggestRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    tokens, rationale = await _suggest_design_tokens(body)
    return DesignSystemSuggestResponse(tokens=tokens, rationale=rationale)


@router.post("/design-systems/compile", response_model=DesignSystemCompileResponse)
async def compile_design_system(
    body: DesignSystemCompileRequest,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Validate tokens (AA contrast), render the authoritative design-system.md and return a
    coherence score + warnings. Pure/stateless: powers the wizard's live preview and the file
    written into a project when a design system is applied."""
    tokens = _normalize_design_tokens(body.tokens)
    checks = _design_contrast_checks(tokens)
    score, warnings = _design_coherence(tokens, checks)
    name = str((body.tokens or {}).get("name") or tokens.get("mood") or "Design system")
    markdown = _render_design_system_md(name, tokens, str((body.tokens or {}).get("description") or ""))
    return DesignSystemCompileResponse(
        tokens=tokens,
        markdown=markdown,
        contrast_checks=[DesignSystemContrastCheck(**c) for c in checks],
        coherence_score=score,
        warnings=warnings,
    )


@router.post("/ai/chat")
async def coding_ai_chat(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    content = str(body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content required")

    history = body.get("history") if isinstance(body.get("history"), list) else []
    messages = []
    for item in history[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role") if item.get("role") in {"user", "assistant", "system"} else "user"
        text = str(item.get("content") or "").strip()
        if text:
            messages.append({"role": role, "content": text[:4000]})
    messages.append({"role": "user", "content": content[:8000]})

    actor_label = "studente" if actor.is_student else "docente"
    system_prompt = (
        "Sei un assistente AI dentro una mini-app del Coding Lab Golinelli.ai. "
        f"Stai rispondendo a un {actor_label}. Sii utile, conciso, educativo e adatto a studenti. "
        "Non citare dettagli tecnici interni della piattaforma."
    )
    requested_provider = (body.get("provider") or "").strip() or None
    requested_model = (body.get("model") or "").strip() or None

    async def _call(provider, model):
        return await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=0.35,
            max_tokens=1200,
            allow_web_search=False,
        )

    try:
        response = await _call(requested_provider, requested_model)
    except Exception as exc:
        # The mini-app may pass an unknown/unconfigured provider or model. Never fail the
        # integrated chatbot for that reason — fall back to the platform default provider.
        if requested_provider is None and requested_model is None:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI service unavailable: {exc}")
        logger.warning("coding ai/chat: provider=%r model=%r failed (%s); retrying with defaults", requested_provider, requested_model, exc)
        try:
            response = await _call(None, None)
        except Exception as exc2:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI service unavailable: {exc2}")

    await _record_coding_cost(
        db,
        provider=response.provider,
        model=response.model,
        prompt_tokens=response.prompt_tokens,
        completion_tokens=response.completion_tokens,
        context="coding_ai_chat",
        tenant_id=actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id,
        session_id=actor.student.session_id if actor.is_student else None,
        student_id=actor.student.id if actor.is_student else None,
        teacher_id=actor.teacher.id if actor.is_teacher else None,
    )

    return {
        "response": response.content,
        "provider": response.provider,
        "model": response.model,
        "prompt_tokens": response.prompt_tokens,
        "completion_tokens": response.completion_tokens,
    }


@router.post("/ai/interview")
async def coding_ai_interview(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Ask 3-4 clarifying questions about the requested mini-app before generating it."""
    title = str(body.get("title") or "").strip()
    prompt = str(body.get("prompt") or "").strip()
    if not prompt and not title:
        return {"questions": []}
    try:
        response = await _coding_generate(
            messages=[{
                "role": "user",
                "content": f"Titolo: {title or '(senza titolo)'}\n\nIdea dello studente:\n{prompt or '(nessuna descrizione)'}",
            }],
            system_prompt=INTERVIEW_SYSTEM_PROMPT,
            temperature=0.5,
            max_tokens=900,
        )
        await _record_coding_cost(
            db,
            provider=response.provider,
            model=response.model,
            prompt_tokens=response.prompt_tokens,
            completion_tokens=response.completion_tokens,
            context="coding_ai_interview",
            tenant_id=actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id,
            session_id=actor.student.session_id if actor.is_student else None,
            student_id=actor.student.id if actor.is_student else None,
            teacher_id=actor.teacher.id if actor.is_teacher else None,
        )
        payload = _extract_json_object(response.content)
        raw = payload.get("questions") if isinstance(payload, dict) else None
        questions = []
        for item in (raw or [])[:4]:
            if not isinstance(item, dict):
                continue
            q = str(item.get("question") or "").strip()
            if not q:
                continue
            suggestions = [str(s).strip() for s in (item.get("suggestions") or []) if str(s).strip()][:4]
            questions.append({"question": q, "suggestions": suggestions})
        return {"questions": questions}
    except Exception as exc:
        logger.warning("coding interview failed (%s)", exc)
        return {"questions": []}


@router.post("/projects", response_model=CodingProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: CodingProjectCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if body.template_key not in SUPPORTED_TEMPLATES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported template")

    session = await _resolve_session(db, actor, body.session_id)
    actor_type, actor_id, tenant_id = _actor_identity(actor)
    slug = await _next_slug(db, session.id, body.title)

    if body.brief_id:
        result = await db.execute(
            select(CodingBrief).where(
                CodingBrief.id == body.brief_id,
                CodingBrief.session_id == session.id,
                CodingBrief.tenant_id == session.tenant_id,
            )
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brief not found for session")

    project = CodingProject(
        tenant_id=session.tenant_id or tenant_id,
        session_id=session.id,
        brief_id=body.brief_id,
        owner_student_id=actor_id if actor_type == "student" else None,
        owner_user_id=actor_id if actor_type == "teacher" else None,
        title=body.title,
        slug=slug,
        template_key=body.template_key,
        status="draft",
    )
    db.add(project)
    await db.flush()

    prompt_message: CodingMessage | None = None
    if body.initial_prompt:
        prompt_message = CodingMessage(
            project_id=project.id,
            actor_type=actor_type,
            actor_id=actor_id,
            role="user",
            content=body.initial_prompt,
        )
        db.add(prompt_message)
        await db.flush()

    version = CodingVersion(
        project_id=project.id,
        version_number=1,
        prompt_message_id=prompt_message.id if prompt_message else None,
        source_manifest_json={},
        artifact_manifest_json={},
        build_status="pending",
        review_status="pending",
        created_by_actor_type=actor_type,
    )
    db.add(version)
    await db.flush()

    project.current_version_id = version.id
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=CodingProjectDetail)
async def get_project(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)

    messages_result = await db.execute(
        select(CodingMessage)
        .where(CodingMessage.project_id == project.id)
        .order_by(CodingMessage.created_at.asc())
    )
    versions_result = await db.execute(
        select(CodingVersion)
        .where(CodingVersion.project_id == project.id)
        .order_by(CodingVersion.version_number.asc())
    )

    return CodingProjectDetail(
        **CodingProjectResponse.model_validate(project).model_dump(),
        messages=list(messages_result.scalars().all()),
        versions=list(versions_result.scalars().all()),
    )


@router.post("/projects/{project_id}/messages", response_model=CodingMessageResponse, status_code=status.HTTP_201_CREATED)
async def add_project_message(
    project_id: UUID,
    body: CodingMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    actor_type, actor_id, _tenant_id = _actor_identity(actor)

    message = CodingMessage(
        project_id=project.id,
        actor_type=actor_type,
        actor_id=actor_id,
        role="user",
        content=body.content,
        metadata_json=body.metadata_json,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


@router.post("/projects/{project_id}/versions", response_model=CodingVersionResponse, status_code=status.HTTP_201_CREATED)
async def create_project_version(
    project_id: UUID,
    body: CodingVersionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    actor_type, _actor_id, _tenant_id = _actor_identity(actor)

    previous_files: list[dict] = []
    if project.current_version_id:
        current_result = await db.execute(select(CodingVersion).where(CodingVersion.id == project.current_version_id))
        current_version = current_result.scalar_one_or_none()
        if current_version:
            previous_files = (current_version.source_manifest_json or {}).get("files") or []

    result = await db.execute(
        select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project.id)
    )
    next_number = (result.scalar_one_or_none() or 0) + 1

    version = CodingVersion(
        project_id=project.id,
        parent_version_id=body.parent_version_id,
        version_number=next_number,
        source_manifest_json=body.source_manifest_json,
        artifact_manifest_json=body.artifact_manifest_json,
        build_status=body.build_status,
        review_status=body.review_status,
        created_by_actor_type=actor_type,
    )
    db.add(version)
    await db.flush()
    project.current_version_id = version.id
    next_files = (body.source_manifest_json or {}).get("files") or []
    if next_files:
        file_summary, file_summary_json = _build_file_change_summary(previous_files, next_files)
        db.add(CodingMessage(
            project_id=project.id,
            actor_type="agent",
            agent_name="Versioning",
            role="assistant",
            content=f"Versione {next_number} salvata.\n{file_summary}",
            metadata_json={
                "kind": "file_write_summary",
                "version_id": str(version.id),
                "auto_commit": True,
                **file_summary_json,
            },
        ))
    await db.commit()
    await db.refresh(version)
    return version


@router.post("/projects/{project_id}/generate", response_model=CodingGenerateResponse)
async def generate_project_code(
    project_id: UUID,
    body: CodingGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    actor_type, actor_id, _tenant_id = _actor_identity(actor)

    user_prompt = (body.prompt or "").strip()
    prompt_message: CodingMessage | None = None
    if user_prompt:
        prompt_message = CodingMessage(
            project_id=project.id,
            actor_type=actor_type,
            actor_id=actor_id,
            role="user",
            content=user_prompt,
            metadata_json={"kind": "codegen_request"},
        )
        db.add(prompt_message)
        await db.flush()
    else:
        result = await db.execute(
            select(CodingMessage)
            .where(CodingMessage.project_id == project.id, CodingMessage.role == "user")
            .order_by(CodingMessage.created_at.desc())
        )
        prompt_message = result.scalars().first()
        user_prompt = prompt_message.content if prompt_message else ""

    if not user_prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")

    planning_message = CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="Prompt Analyst",
        role="assistant",
        content="Leggo la richiesta, individuo le funzioni necessarie e preparo una versione eseguibile della mini app.",
        metadata_json={"kind": "agent_progress"},
    )
    db.add(planning_message)
    await db.flush()

    previous_files: list[dict] = []
    previous_collaboration: dict = {}
    if project.current_version_id:
        result = await db.execute(
            select(CodingVersion).where(CodingVersion.id == project.current_version_id)
        )
        current_version = result.scalar_one_or_none()
        if current_version:
            previous_manifest = current_version.source_manifest_json or {}
            previous_files = previous_manifest.get("files") or []
            previous_collaboration = previous_manifest.get("collaboration") or {}

    # The editor sends its current files (unsaved edits + added knowledge-base .md). Prefer
    # them as the base so the student's instructions and attachments are always respected.
    if body.files:
        previous_files = [
            {"path": f.path, "content": f.content, "language": f.language or ""}
            for f in body.files
            if f.path and ".." not in f.path.split("/")
        ]

    # Knowledge base: markdown files (description.md + any user-added .md) are authoritative
    # project instructions, always fed to codegen and never owned by the model.
    kb_files = _kb_files(previous_files)
    if not any(str(f.get("path") or "") == "description.md" for f in kb_files):
        seeded = {"path": "description.md", "language": "markdown", "content": _seed_description_md(project.title, user_prompt)}
        kb_files.insert(0, seeded)

    kb_context = ""
    if kb_files:
        kb_snippets = [f"FILE: {f.get('path')}\n{str(f.get('content') or '')[:8000]}" for f in kb_files]
        kb_context = (
            "\n\nKnowledge base di progetto (istruzioni autorevoli da rispettare SEMPRE, non includerle nell'output):\n"
            + "\n\n---\n\n".join(kb_snippets)
        )

    context = ""
    if previous_files:
        snippets = []
        for file in previous_files[:8]:
            if str(file.get("path") or "").lower().endswith(".md"):
                continue
            snippets.append(f"FILE: {file.get('path')}\n{str(file.get('content') or '')[:6000]}")
        if snippets:
            context = "\n\nStato attuale del progetto da migliorare:\n" + "\n\n---\n\n".join(snippets)

    llm_response = await _coding_generate(
        messages=[{
            "role": "user",
            "content": f"Titolo progetto: {project.title}\n\nRichiesta studente:\n{user_prompt}{kb_context}{context}",
        }],
        system_prompt=CODEGEN_SYSTEM_PROMPT + "\n- Esistono file .md di knowledge base (es. description.md): trattali come istruzioni autorevoli, NON modificarli e NON includerli tra i file dell'output.",
        temperature=0.35,
        max_tokens=8000,
    )

    # Token usage for this legacy (non-streaming) path; billed once after the final commit
    # below, using the real token counts returned by the provider.
    codegen_usage = {
        "provider": llm_response.provider,
        "model": llm_response.model,
        "prompt_tokens": llm_response.prompt_tokens or 0,
        "completion_tokens": llm_response.completion_tokens or 0,
    }
    track_tenant_id = project.tenant_id
    track_session_id = project.session_id
    track_student_id = actor.student.id if actor.is_student else None
    track_teacher_id = actor.teacher.id if actor.is_teacher else None

    try:
        payload = _extract_json_object(llm_response.content)
        files = _normalize_generated_files(payload)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Code generation returned invalid JSON: {exc}")

    # Second pass: automatic UI review to catch contrast/overlap/readability defects.
    files, ui_issues = await _ui_review_files(files)

    # The model must not own the knowledge base: drop any .md it emitted, carry forward ours,
    # and auto-append the student's request to description.md.
    files = [f for f in files if not str(f.get("path") or "").lower().endswith(".md")]
    for kb in kb_files:
        if str(kb.get("path") or "") == "description.md":
            kb = {**kb, "content": _append_request_log(str(kb.get("content") or ""), user_prompt if (body.prompt or "").strip() else "")}
        files.append(kb)

    summary = str(payload.get("summary") or "Mini app generata.")
    raw_notes = payload.get("agent_notes") or []
    agent_notes = [
        str(note).strip()
        for note in raw_notes
        if str(note).strip()
    ][:4] if isinstance(raw_notes, list) else []
    if ui_issues:
        agent_notes = (agent_notes + ["Revisione UI: " + "; ".join(ui_issues)])[:5]
    file_summary, file_summary_json = _build_file_change_summary(previous_files, files)
    result = await db.execute(
        select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project.id)
    )
    next_number = (result.scalar_one_or_none() or 0) + 1

    version = CodingVersion(
        project_id=project.id,
        parent_version_id=project.current_version_id,
        version_number=next_number,
        source_manifest_json={
            "files": files,
            "summary": summary,
            **({"collaboration": previous_collaboration} if previous_collaboration else {}),
            "generator": {
                "provider": llm_response.provider,
                "model": llm_response.model,
            },
        },
        artifact_manifest_json={},
        prompt_message_id=prompt_message.id if prompt_message else None,
        build_status="ready",
        review_status="pending",
        created_by_actor_type="agent",
    )
    db.add(version)
    await db.flush()

    project.current_version_id = version.id
    project.status = "generated"
    writing_message = CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="File Writer",
        role="assistant",
        content=file_summary,
        metadata_json={
            "kind": "file_write_summary",
            "version_id": str(version.id),
            **file_summary_json,
        },
    )
    db.add(writing_message)

    if agent_notes:
        reviewer_message = CodingMessage(
            project_id=project.id,
            actor_type="agent",
            agent_name="Reviewer",
            role="assistant",
            content="\n".join(f"- {note}" for note in agent_notes),
            metadata_json={
                "kind": "agent_feedback",
                "version_id": str(version.id),
            },
        )
        db.add(reviewer_message)

    assistant_message = CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="Coding Builder",
        role="assistant",
        content=summary,
        metadata_json={
            "kind": "codegen_result",
            "version_id": str(version.id),
            "file_count": len(files),
            "total_lines": file_summary_json["total_lines"],
        },
    )
    db.add(assistant_message)
    await db.commit()

    await _record_coding_cost(
        db,
        provider=codegen_usage["provider"],
        model=codegen_usage["model"],
        prompt_tokens=codegen_usage["prompt_tokens"],
        completion_tokens=codegen_usage["completion_tokens"],
        context="coding_generate",
        tenant_id=track_tenant_id,
        session_id=track_session_id,
        student_id=track_student_id,
        teacher_id=track_teacher_id,
    )
    # Refresh after the tracking commit so the response serialises fresh attributes.
    await db.refresh(version)

    return CodingGenerateResponse(
        version=version,
        files=[CodingGeneratedFile(**file) for file in files],
        summary=summary,
    )


@router.post("/projects/{project_id}/generate-stream")
async def generate_project_code_stream(
    project_id: UUID,
    body: CodingGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Streaming variant of generate_project_code. Emits Server-Sent Events so the connection
    keeps sending bytes while the LLM writes the mini app — this is what lets a 90-180s
    generation survive Cloudflare's ~100s proxy timeout. No second UI-review pass (the manual
    "Revisione UI" teacher tool covers that), so latency is roughly halved."""
    project = await _get_accessible_project(db, actor, project_id)
    actor_type, actor_id, _tenant_id = _actor_identity(actor)

    # Capture everything we need as primitives BEFORE streaming. We must not hold ORM objects
    # (or an uncommitted transaction) open across the long LLM stream: get_db() keeps one
    # session/transaction for the whole request, and the DB connection can be recycled
    # mid-stream — which would drop flushed-but-uncommitted rows and break FK references
    # (e.g. version.prompt_message_id). So we persist the request/progress messages up front
    # and re-open a fresh transaction once generation finishes.
    project_pk = project.id
    project_title = project.title
    current_version_id = project.current_version_id
    project_session_id = project.session_id
    project_tenant_id = project.tenant_id
    track_student_id = actor.student.id if actor.is_student else None
    track_teacher_id = actor.teacher.id if actor.is_teacher else None

    explicit_prompt = bool((body.prompt or "").strip())
    user_prompt = (body.prompt or "").strip()
    prompt_message_id: UUID | None = None

    if user_prompt:
        prompt_message = CodingMessage(
            project_id=project_pk,
            actor_type=actor_type,
            actor_id=actor_id,
            role="user",
            content=user_prompt,
            metadata_json={"kind": "codegen_request"},
        )
        db.add(prompt_message)
        await db.flush()
        prompt_message_id = prompt_message.id
    else:
        result = await db.execute(
            select(CodingMessage)
            .where(CodingMessage.project_id == project_pk, CodingMessage.role == "user")
            .order_by(CodingMessage.created_at.desc())
        )
        last_user = result.scalars().first()
        user_prompt = last_user.content if last_user else ""
        prompt_message_id = last_user.id if last_user else None

    if not user_prompt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")

    db.add(CodingMessage(
        project_id=project_pk,
        actor_type="agent",
        agent_name="Prompt Analyst",
        role="assistant",
        content="Leggo la richiesta, individuo le funzioni necessarie e preparo una versione eseguibile della mini app.",
        metadata_json={"kind": "agent_progress"},
    ))
    # Persist the request + progress message durably so the long stream below never holds an
    # open write transaction.
    await db.commit()

    # --- build generation context (reads only) ---
    previous_files: list[dict] = []
    previous_collaboration: dict = {}
    if current_version_id:
        result = await db.execute(
            select(CodingVersion).where(CodingVersion.id == current_version_id)
        )
        current_version = result.scalar_one_or_none()
        if current_version:
            previous_manifest = current_version.source_manifest_json or {}
            previous_files = previous_manifest.get("files") or []
            previous_collaboration = previous_manifest.get("collaboration") or {}

    if body.files:
        previous_files = [
            {"path": f.path, "content": f.content, "language": f.language or ""}
            for f in body.files
            if f.path and ".." not in f.path.split("/")
        ]

    kb_files = _kb_files(previous_files)
    if not any(str(f.get("path") or "") == "description.md" for f in kb_files):
        seeded = {"path": "description.md", "language": "markdown", "content": _seed_description_md(project_title, user_prompt)}
        kb_files.insert(0, seeded)

    kb_context = ""
    if kb_files:
        kb_snippets = [f"FILE: {f.get('path')}\n{str(f.get('content') or '')[:8000]}" for f in kb_files]
        kb_context = (
            "\n\nKnowledge base di progetto (istruzioni autorevoli da rispettare SEMPRE, non includerle nell'output):\n"
            + "\n\n---\n\n".join(kb_snippets)
        )

    base_context = f"Titolo progetto: {project_title}\n\nRichiesta studente:\n{user_prompt}{kb_context}"
    gen_provider, gen_model = _resolve_coding_model(body.model_key)

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    # Existing code files (for edits) — passed WHOLE so the model edits coherently. We also tell it
    # to behave agentically: change only what's needed and re-emit ONLY the files that change.
    prev_code_files = [f for f in previous_files if not str(f.get("path") or "").lower().endswith(".md")]
    is_edit = bool(prev_code_files)
    if is_edit:
        current_dump = "\n\n".join(
            f"=== FILE: {f.get('path')} ===\n{str(f.get('content') or '')}" for f in prev_code_files
        )
        gen_user = (
            f"{base_context}\n\n"
            "QUESTA È UNA MODIFICA PUNTUALE di un progetto React ESISTENTE (file completi qui sotto).\n"
            "Comportati in modo agentico e CHIRURGICO:\n"
            "- applica SOLO le modifiche richieste; lascia IDENTICO tutto il resto;\n"
            "- nel blocco dopo @@FILES@@ restituisci SOLO i file che cambiano davvero (o i file nuovi),\n"
            "  con il loro contenuto COMPLETO aggiornato; NON ristampare i file che restano invariati;\n"
            "- mantieni la coerenza: ogni import deve puntare a un file esistente con quell'export;\n"
            "  riusa gli STESSI nomi di componenti/funzioni/tipi gia presenti;\n"
            "- se aggiungi una libreria npm, aggiorna package.json (campo dependencies);\n"
            "- non scrivere index.html ne il file di entry (createRoot): sono della piattaforma.\n\n"
            f"Progetto attuale:\n{current_dump}"
        )
    else:
        gen_user = base_context

    async def event_stream():
        try:
            yield _sse({"type": "status", "message": "Sto progettando e scrivendo il progetto..."})
            usage_prompt = 0
            usage_completion = 0

            # ONE coherent generation. The model streams a short reasoning, then "@@FILES@@", then
            # every file as "=== FILE: path ===\n<content>" ending with "=== END ===". Parsed line by
            # line so we can show live reasoning + per-file progress, while keeping a single context
            # (coherent cross-file references) and a single, cost-effective LLM call.
            full = ""
            buffer = ""
            state = "reasoning"  # -> "files"
            reasoning_parts: list[str] = []
            current_path: str | None = None
            current_lines: list[str] = []
            current_reported = -1
            generated: list[dict] = []
            file_marker = re.compile(r"^===\s*FILE:\s*(.+?)\s*===\s*$")
            end_marker = re.compile(r"^===\s*END\s*===\s*$")

            def _finalize_current():
                """Store the file just finished; return its file_done SSE frame (or None)."""
                nonlocal current_path, current_lines
                if current_path is None:
                    current_lines = []
                    return None
                content = _strip_code_fences("\n".join(current_lines).strip("\n"))
                path = current_path
                current_path = None
                current_lines = []
                if content.strip():
                    generated.append({"path": path, "content": content, "language": _lang_for_path(path)})
                    return _sse({"type": "file_done", "path": path, "lines": content.count("\n") + 1})
                return None

            def _open_file(raw_path: str):
                """Start a new file unless it's an extra page/.md we must not keep; returns SSE or None."""
                nonlocal current_path, current_lines, current_reported
                path = raw_path.strip().lstrip("/")
                current_lines = []
                current_reported = -1
                lower = path.lower()
                # Platform-owned files the model must not produce: the HTML shell and the React entry
                # (createRoot) are injected by the preview; KB markdown belongs to the platform.
                if (
                    lower.endswith((".html", ".htm", ".md"))
                    or ".." in path.split("/")
                    or lower in {"index.tsx", "index.ts", "index.jsx", "index.js", "main.tsx", "main.ts", "main.jsx", "main.js", "golinelli-bridge.ts"}
                ):
                    current_path = None
                    return None
                current_path = path
                return _sse({"type": "file_start", "path": path})

            async for chunk in _coding_generate_stream(
                messages=[{"role": "user", "content": gen_user}],
                system_prompt=CODEGEN_STREAM_SYSTEM_PROMPT,
                provider=gen_provider,
                model=gen_model,
                temperature=0.4,
                max_tokens=24000,
            ):
                full += chunk
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if state == "reasoning":
                        if "@@FILES@@" in line:
                            pre = line.split("@@FILES@@", 1)[0]
                            if pre.strip():
                                reasoning_parts.append(pre)
                                yield _sse({"type": "reasoning", "content": pre + "\n"})
                            state = "files"
                            continue
                        reasoning_parts.append(line)
                        yield _sse({"type": "reasoning", "content": line + "\n"})
                        continue
                    if file_marker.match(line):
                        done = _finalize_current()
                        if done:
                            yield done
                        started = _open_file(file_marker.match(line).group(1))
                        if started:
                            yield started
                        continue
                    if end_marker.match(line):
                        done = _finalize_current()
                        if done:
                            yield done
                        continue
                    if current_path is not None:
                        current_lines.append(line)
                        n = len(current_lines)
                        if n - current_reported >= 15:
                            current_reported = n
                            yield _sse({"type": "file_progress", "path": current_path, "lines": n})

            # Flush the trailing (newline-less) tail.
            if buffer:
                if state == "reasoning":
                    if buffer.strip() != "@@FILES@@":
                        reasoning_parts.append(buffer)
                        yield _sse({"type": "reasoning", "content": buffer})
                elif file_marker.match(buffer):
                    done = _finalize_current()
                    if done:
                        yield done
                    _open_file(file_marker.match(buffer).group(1))
                elif not end_marker.match(buffer) and current_path is not None:
                    current_lines.append(buffer)
            done = _finalize_current()
            if done:
                yield done

            reasoning_text = "\n".join(reasoning_parts).strip()
            est = build_estimated_token_usage(
                [{"role": "system", "content": CODEGEN_STREAM_SYSTEM_PROMPT}, {"role": "user", "content": gen_user}],
                full,
            )
            usage_prompt += est["prompt_tokens"]
            usage_completion += est["completion_tokens"]

            if not generated:
                yield _sse({"type": "error", "message": "La generazione non ha prodotto file validi. Riprova o cambia modello."})
                return

            # Targeted edits: merge the regenerated files OVER the existing ones so files the model
            # left untouched are preserved EXACTLY (no accidental rewrites, no architecture drift).
            if is_edit:
                merged = {str(f.get("path")): f for f in prev_code_files}
                for g in generated:
                    merged[g["path"]] = g
                files = _normalize_generated_files({"files": list(merged.values())})
            else:
                files = _normalize_generated_files({"files": generated})

            # Legacy static projects run in a network-less srcDoc sandbox, so strip external
            # resources that would fail there. React projects run in the Sandpack bundler (which
            # HAS network + real npm), so their fonts/images/CDNs are left intact.
            if not _is_react_files(files):
                files = _sanitize_external_refs(files)

            # Knowledge base ownership: drop any .md the model emitted, carry forward ours,
            # and append the student's request to description.md.
            files = [f for f in files if not str(f.get("path") or "").lower().endswith(".md")]
            for kb in kb_files:
                if str(kb.get("path") or "") == "description.md":
                    kb = {**kb, "content": _append_request_log(str(kb.get("content") or ""), user_prompt if explicit_prompt else "")}
                files.append(kb)

            # Agentic design-system enforcement: when a design-system.md contract is attached, run a
            # dedicated pass that rewrites the generated React styling to actually obey it (paste :root,
            # use --ds-* everywhere). Only fires when a contract exists; an extra strong-model call.
            if _is_react_files(files) and any(str(f.get("path") or "").lower() == "design-system.md" for f in files):
                yield _sse({"type": "status", "message": "Revisione design system in corso..."})
                files, ds_changed = await _design_review_files(files)
                if ds_changed:
                    yield _sse({"type": "status", "message": f"Design system applicato ({len(ds_changed)} file aggiornati)."})

            file_summary, file_summary_json = _build_file_change_summary(previous_files, files)
            summary = f"Progetto aggiornato: {len(files)} file, {file_summary_json['total_lines']} righe."

            # Fresh transaction now that streaming is done; reference the prompt message that was
            # committed before the stream, so the FK is always satisfied.
            result = await db.execute(
                select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project_pk)
            )
            next_number = (result.scalar_one_or_none() or 0) + 1

            version = CodingVersion(
                project_id=project_pk,
                parent_version_id=current_version_id,
                version_number=next_number,
                source_manifest_json={
                    "files": files,
                    "summary": summary,
                    **({"collaboration": previous_collaboration} if previous_collaboration else {}),
                },
                artifact_manifest_json={},
                prompt_message_id=prompt_message_id,
                build_status="ready",
                review_status="pending",
                created_by_actor_type="agent",
            )
            db.add(version)
            await db.flush()
            new_version_id = version.id
            new_version_number = version.version_number

            proj = (await db.execute(select(CodingProject).where(CodingProject.id == project_pk))).scalar_one_or_none()
            if proj:
                proj.current_version_id = new_version_id
                proj.status = "generated"

            if reasoning_text:
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Architetto",
                    role="assistant",
                    content=reasoning_text[:6000],
                    metadata_json={"kind": "agent_reasoning", "version_id": str(new_version_id)},
                ))

            db.add(CodingMessage(
                project_id=project_pk,
                actor_type="agent",
                agent_name="File Writer",
                role="assistant",
                content=file_summary,
                metadata_json={
                    "kind": "file_write_summary",
                    "version_id": str(new_version_id),
                    **file_summary_json,
                },
            ))

            db.add(CodingMessage(
                project_id=project_pk,
                actor_type="agent",
                agent_name="Coding Builder",
                role="assistant",
                content=summary,
                metadata_json={
                    "kind": "codegen_result",
                    "version_id": str(new_version_id),
                    "file_count": len(files),
                    "total_lines": file_summary_json["total_lines"],
                },
            ))
            await db.commit()

            # Bill the whole multi-call generation once against the credit system.
            await _record_coding_cost(
                db,
                provider=gen_provider,
                model=gen_model,
                prompt_tokens=usage_prompt,
                completion_tokens=usage_completion,
                context="coding_generate_stream",
                tenant_id=project_tenant_id,
                session_id=project_session_id,
                student_id=track_student_id,
                teacher_id=track_teacher_id,
            )

            yield _sse({
                "type": "done",
                "files": files,
                "summary": summary,
                "version_id": str(new_version_id),
                "version_number": new_version_number,
            })
        except Exception as exc:
            logger.exception("coding generate stream failed")
            try:
                await db.rollback()
            except Exception:
                pass
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/projects/{project_id}/ui-review")
async def ui_review_project(
    project_id: UUID,
    body: CodingGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """On-demand UI review of the current files (teacher tool). Returns fixed files + issues."""
    project = await _get_accessible_project(db, actor, project_id)

    files_in: list[dict] = []
    if body.files:
        files_in = [
            {"path": f.path, "content": f.content, "language": f.language or ""}
            for f in body.files
            if f.path and ".." not in f.path.split("/")
        ]
    if not files_in and project.current_version_id:
        result = await db.execute(select(CodingVersion).where(CodingVersion.id == project.current_version_id))
        current_version = result.scalar_one_or_none()
        if current_version:
            files_in = (current_version.source_manifest_json or {}).get("files") or []

    if not files_in:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nessun file da rivedere.")

    reviewed, issues = await _ui_review_files(files_in)
    # Re-attach any file (e.g. knowledge-base .md) the review pass dropped.
    present = {str(f.get("path") or "") for f in reviewed}
    for f in files_in:
        if str(f.get("path") or "") not in present:
            reviewed.append(f)

    # Bill the review pass (it runs on settings.CODING_LLM_*). Tokens are estimated from the
    # input and output file bundles.
    in_bundle = "\n".join(str(f.get("content") or "") for f in files_in)
    out_bundle = "\n".join(str(f.get("content") or "") for f in reviewed)
    review_usage = build_estimated_token_usage(
        [{"role": "system", "content": UI_REVIEW_SYSTEM_PROMPT}, {"role": "user", "content": in_bundle}],
        out_bundle,
    )
    await _record_coding_cost(
        db,
        provider=settings.CODING_LLM_PROVIDER,
        model=settings.CODING_LLM_MODEL,
        prompt_tokens=review_usage["prompt_tokens"],
        completion_tokens=review_usage["completion_tokens"],
        context="coding_ui_review",
        tenant_id=project.tenant_id,
        session_id=project.session_id,
        student_id=actor.student.id if actor.is_student else None,
        teacher_id=actor.teacher.id if actor.is_teacher else None,
    )
    return {"files": reviewed, "issues": issues}


@router.post("/projects/{project_id}/share-to-class")
async def share_project_to_class(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    version = await _get_current_version(db, project)
    files = (version.source_manifest_json or {}).get("files") or []
    total_lines = sum(_file_line_count(file) for file in files)

    if actor.is_student:
        sender_type = SenderType.STUDENT
        sender_student_id = actor.student.id
        sender_teacher_id = None
        sender_name = actor.student.nickname
    else:
        sender_type = SenderType.TEACHER
        sender_student_id = None
        sender_teacher_id = actor.teacher.id
        sender_name = "Docente"

    room = await get_or_create_public_room(db, project.session_id, project.tenant_id)
    attachment = {
        "type": "coding_project",
        "project_id": str(project.id),
        "version_id": str(version.id),
        "title": project.title,
        "slug": project.slug,
        "file_count": len(files),
        "total_lines": total_lines,
        "action": "open_in_coding_lab",
        "creator_student_id": str(project.owner_student_id) if project.owner_student_id else None,
    }
    chat_message = ChatMessage(
        tenant_id=project.tenant_id,
        session_id=project.session_id,
        room_id=room.id,
        sender_type=sender_type,
        sender_student_id=sender_student_id,
        sender_teacher_id=sender_teacher_id,
        message_text=f"{sender_name} ha condiviso un progetto Coding Lab: {project.title}",
        attachments=[attachment],
    )
    db.add(chat_message)
    project.visibility = "class_shared"
    project.status = "shared"
    await db.commit()
    await db.refresh(chat_message)
    return {
        "shared": True,
        "chat_message_id": str(chat_message.id),
        "attachment": attachment,
    }


@router.post("/projects/{project_id}/fork", response_model=CodingProjectResponse)
async def fork_shared_project(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    source_project = await _get_session_project(db, actor, project_id)
    if source_project.visibility != "class_shared" and source_project.status != "shared":
        if not actor.is_student or source_project.owner_student_id != actor.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project is not shared with the class")

    if actor.is_student and source_project.owner_student_id == actor.student.id:
        return source_project

    if not actor.is_student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can fork class projects")

    source_version = await _get_current_version(db, source_project)
    source_files = (source_version.source_manifest_json or {}).get("files") or []

    existing_projects_result = await db.execute(
        select(CodingProject).where(
            CodingProject.session_id == source_project.session_id,
            CodingProject.owner_student_id == actor.student.id,
            CodingProject.status == "fork",
        )
    )
    for candidate in existing_projects_result.scalars().all():
        metadata = await _get_fork_metadata(db, candidate)
        if metadata.get("source_project_id") == str(source_project.id):
            return candidate

    slug = await _next_slug(db, source_project.session_id, f"{source_project.slug}-fork")
    fork = CodingProject(
        tenant_id=source_project.tenant_id,
        session_id=source_project.session_id,
        brief_id=source_project.brief_id,
        owner_student_id=actor.student.id,
        title=f"{source_project.title} - copia",
        slug=slug,
        template_key=source_project.template_key,
        status="fork",
        visibility="private",
    )
    db.add(fork)
    await db.flush()

    collaboration = {
        "source_project_id": str(source_project.id),
        "source_version_id": str(source_version.id),
        "creator_student_id": str(source_project.owner_student_id) if source_project.owner_student_id else None,
        "forked_by_student_id": str(actor.student.id),
    }
    version = CodingVersion(
        project_id=fork.id,
        parent_version_id=source_version.id,
        version_number=1,
        source_manifest_json={
            "files": source_files,
            "summary": f"Copia modificabile del progetto condiviso: {source_project.title}",
            "collaboration": collaboration,
        },
        artifact_manifest_json={},
        build_status="ready",
        review_status="pending",
        created_by_actor_type="student",
    )
    db.add(version)
    await db.flush()
    fork.current_version_id = version.id
    db.add(CodingMessage(
        project_id=fork.id,
        actor_type="agent",
        agent_name="Collaboration",
        role="assistant",
        content="Ho creato una copia personale del progetto condiviso. Puoi modificarla e poi inviare un commit al creatore.",
        metadata_json={"kind": "agent_feedback", "collaboration": collaboration},
    ))
    await db.commit()
    await db.refresh(fork)
    return fork


@router.post("/projects/{project_id}/commit-to-creator")
async def commit_to_creator(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    fork = await _get_accessible_project(db, actor, project_id)
    if not actor.is_student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can commit to creator")

    collaboration = await _get_fork_metadata(db, fork)
    source_project_id = collaboration.get("source_project_id")
    if not source_project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This project is not a fork")

    source_result = await db.execute(select(CodingProject).where(CodingProject.id == UUID(str(source_project_id))))
    source_project = source_result.scalar_one_or_none()
    if not source_project or source_project.session_id != fork.session_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source project not found")

    contributor_version = await _get_current_version(db, fork)
    contributor_files = (contributor_version.source_manifest_json or {}).get("files") or []
    source_version = await _get_current_version(db, source_project)
    source_files = (source_version.source_manifest_json or {}).get("files") or []
    file_summary, file_summary_json = _build_file_change_summary(source_files, contributor_files)

    commit_message = CodingMessage(
        project_id=source_project.id,
        actor_type="student",
        actor_id=actor.student.id,
        agent_name="Commit",
        role="assistant",
        content=f"{actor.student.nickname} propone un commit dalla propria copia.\n{file_summary}",
        metadata_json={
            "kind": "commit_request",
            "status": "pending",
            "source_project_id": str(source_project.id),
            "source_version_id": str(source_version.id),
            "contributor_project_id": str(fork.id),
            "contributor_version_id": str(contributor_version.id),
            "contributor_student_id": str(actor.student.id),
            "contributor_name": actor.student.nickname,
            "files": contributor_files,
            "summary": file_summary_json,
        },
    )
    db.add(commit_message)

    room = await get_or_create_public_room(db, source_project.session_id, source_project.tenant_id)
    db.add(ChatMessage(
        tenant_id=source_project.tenant_id,
        session_id=source_project.session_id,
        room_id=room.id,
        sender_type=SenderType.SYSTEM,
        message_text=f"Commit Coding Lab inviato a {source_project.title} da {actor.student.nickname}.",
        attachments=[{
            "type": "coding_commit",
            "project_id": str(source_project.id),
            "contributor_project_id": str(fork.id),
            "contributor_name": actor.student.nickname,
            "status": "pending",
        }],
    ))
    await db.commit()
    await db.refresh(commit_message)
    return {
        "commit_message_id": str(commit_message.id),
        "status": "pending",
        "summary": file_summary_json,
    }


@router.get("/projects/{project_id}/commits")
async def list_project_commits(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    result = await db.execute(
        select(CodingMessage)
        .where(CodingMessage.project_id == project.id)
        .order_by(CodingMessage.created_at.desc())
    )
    commits = []
    for message in result.scalars().all():
        metadata = message.metadata_json or {}
        if metadata.get("kind") != "commit_request":
            continue
        commits.append({
            "id": str(message.id),
            "content": message.content,
            "status": metadata.get("status", "pending"),
            "contributor_name": metadata.get("contributor_name", "Studente"),
            "contributor_project_id": metadata.get("contributor_project_id"),
            "contributor_version_id": metadata.get("contributor_version_id"),
            "files": metadata.get("files") or [],
            "summary": metadata.get("summary") or {},
            "created_at": message.created_at.isoformat(),
        })
    return commits


@router.post("/projects/{project_id}/commits/{commit_message_id}/merge")
async def merge_project_commit(
    project_id: UUID,
    commit_message_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    result = await db.execute(
        select(CodingMessage).where(
            CodingMessage.id == commit_message_id,
            CodingMessage.project_id == project.id,
        )
    )
    commit_message = result.scalar_one_or_none()
    metadata = commit_message.metadata_json if commit_message else None
    if not commit_message or not isinstance(metadata, dict) or metadata.get("kind") != "commit_request":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commit not found")
    if metadata.get("status") == "merged":
        return {"status": "merged", "already_merged": True}

    files = metadata.get("files") or []
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Commit has no files")

    result = await db.execute(
        select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project.id)
    )
    next_number = (result.scalar_one_or_none() or 0) + 1
    version = CodingVersion(
        project_id=project.id,
        parent_version_id=project.current_version_id,
        version_number=next_number,
        source_manifest_json={
            "files": files,
            "summary": f"Merge commit da {metadata.get('contributor_name', 'studente')}",
            "collaboration": {
                "merged_commit_message_id": str(commit_message.id),
                "contributor_project_id": metadata.get("contributor_project_id"),
                "contributor_version_id": metadata.get("contributor_version_id"),
            },
        },
        artifact_manifest_json={},
        build_status="ready",
        review_status="pending",
        created_by_actor_type="student" if actor.is_student else "teacher",
    )
    db.add(version)
    await db.flush()
    project.current_version_id = version.id
    project.status = "generated"
    next_metadata = dict(metadata)
    next_metadata["status"] = "merged"
    next_metadata["merged_version_id"] = str(version.id)
    commit_message.metadata_json = next_metadata
    db.add(CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="Collaboration",
        role="assistant",
        content=f"Commit di {metadata.get('contributor_name', 'studente')} mergiato nella versione {next_number}.",
        metadata_json={"kind": "agent_feedback", "version_id": str(version.id)},
    ))
    await db.commit()
    await db.refresh(version)
    return {"status": "merged", "version_id": str(version.id), "version_number": version.version_number}


@router.post("/projects/{project_id}/versions/{version_id}/rollback")
async def rollback_project_version(
    project_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    result = await db.execute(
        select(CodingVersion).where(
            CodingVersion.id == version_id,
            CodingVersion.project_id == project.id,
        )
    )
    target_version = result.scalar_one_or_none()
    files = (target_version.source_manifest_json or {}).get("files") if target_version else None
    if not target_version or not files:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")

    result = await db.execute(
        select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project.id)
    )
    next_number = (result.scalar_one_or_none() or 0) + 1
    source_manifest = target_version.source_manifest_json or {}
    version = CodingVersion(
        project_id=project.id,
        parent_version_id=project.current_version_id,
        version_number=next_number,
        source_manifest_json={
            "files": files,
            "summary": f"Rollback alla versione {target_version.version_number}",
            **({"collaboration": source_manifest.get("collaboration")} if source_manifest.get("collaboration") else {}),
            "rollback": {
                "from_version_id": str(target_version.id),
                "from_version_number": target_version.version_number,
            },
        },
        artifact_manifest_json={},
        build_status="ready",
        review_status="pending",
        created_by_actor_type="student" if actor.is_student else "teacher",
    )
    db.add(version)
    await db.flush()
    project.current_version_id = version.id
    db.add(CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="Versioning",
        role="assistant",
        content=f"Rollback completato: la versione {target_version.version_number} e` stata ripristinata come versione {next_number}.",
        metadata_json={
            "kind": "agent_feedback",
            "version_id": str(version.id),
            "rollback_from_version_id": str(target_version.id),
        },
    ))
    await db.commit()
    await db.refresh(version)
    return {"status": "rolled_back", "version_id": str(version.id), "version_number": version.version_number}


@router.get("/projects/{project_id}/upstream-status")
async def get_project_upstream_status(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    collaboration = await _get_fork_metadata(db, project)
    source_project_id = collaboration.get("source_project_id")
    if not source_project_id:
        return {"is_fork": False, "update_available": False}

    source_result = await db.execute(select(CodingProject).where(CodingProject.id == UUID(str(source_project_id))))
    source_project = source_result.scalar_one_or_none()
    if not source_project or source_project.session_id != project.session_id:
        return {"is_fork": True, "update_available": False, "source_missing": True}

    source_version = await _get_current_version(db, source_project)
    source_files = (source_version.source_manifest_json or {}).get("files") or []
    known_source_version_id = collaboration.get("source_version_id")
    update_available = str(source_version.id) != str(known_source_version_id)
    return {
        "is_fork": True,
        "update_available": update_available,
        "source_project_id": str(source_project.id),
        "source_title": source_project.title,
        "source_version_id": str(source_version.id),
        "source_version_number": source_version.version_number,
        "known_source_version_id": known_source_version_id,
        "file_count": len(source_files),
        "total_lines": sum(_file_line_count(file) for file in source_files),
        "summary": (source_version.source_manifest_json or {}).get("summary") or "",
    }


@router.post("/projects/{project_id}/pull-upstream")
async def pull_project_upstream(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    collaboration = await _get_fork_metadata(db, project)
    source_project_id = collaboration.get("source_project_id")
    if not source_project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This project is not a fork")

    source_result = await db.execute(select(CodingProject).where(CodingProject.id == UUID(str(source_project_id))))
    source_project = source_result.scalar_one_or_none()
    if not source_project or source_project.session_id != project.session_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source project not found")

    source_version = await _get_current_version(db, source_project)
    source_files = (source_version.source_manifest_json or {}).get("files") or []
    result = await db.execute(
        select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project.id)
    )
    next_number = (result.scalar_one_or_none() or 0) + 1
    next_collaboration = {
        **collaboration,
        "source_project_id": str(source_project.id),
        "source_version_id": str(source_version.id),
    }
    version = CodingVersion(
        project_id=project.id,
        parent_version_id=project.current_version_id,
        version_number=next_number,
        source_manifest_json={
            "files": source_files,
            "summary": f"Aggiornamento dalla versione {source_version.version_number} del creatore",
            "collaboration": next_collaboration,
            "upstream": {
                "source_project_id": str(source_project.id),
                "source_version_id": str(source_version.id),
                "source_version_number": source_version.version_number,
            },
        },
        artifact_manifest_json={},
        build_status="ready",
        review_status="pending",
        created_by_actor_type="student" if actor.is_student else "teacher",
    )
    db.add(version)
    await db.flush()
    project.current_version_id = version.id
    db.add(CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="Versioning",
        role="assistant",
        content=f"Copia aggiornata alla versione {source_version.version_number} condivisa dal creatore. La versione precedente resta nello storico.",
        metadata_json={
            "kind": "agent_feedback",
            "version_id": str(version.id),
            "source_version_id": str(source_version.id),
        },
    ))
    await db.commit()
    await db.refresh(version)
    return {"status": "updated", "version_id": str(version.id), "version_number": version.version_number}


@router.post("/projects/{project_id}/publish")
async def publish_project(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    if not project.current_version_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No generated version to publish")

    version_result = await db.execute(select(CodingVersion).where(CodingVersion.id == project.current_version_id))
    version = version_result.scalar_one_or_none()
    files = (version.source_manifest_json or {}).get("files") if version else None
    if not version or not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No generated files to publish")

    publication_slug = project.slug
    url_path = f"/students/{publication_slug}"
    existing_result = await db.execute(
        select(CodingPublication).where(
            CodingPublication.project_id == project.id,
            CodingPublication.version_id == version.id,
            CodingPublication.publication_slug == publication_slug,
        )
    )
    publication = existing_result.scalar_one_or_none()
    if publication:
        publication.status = "published"
        publication.url_path = url_path
    else:
        publication = CodingPublication(
            project_id=project.id,
            version_id=version.id,
            tenant_id=project.tenant_id,
            session_id=project.session_id,
            publication_slug=publication_slug,
            url_path=url_path,
            status="published",
        )
        db.add(publication)

    await db.commit()
    await db.refresh(publication)
    return {
        "publication_id": str(publication.id),
        "slug": publication_slug,
        "url_path": url_path,
        "api_path": f"/api/v1/coding/public/{publication_slug}",
        "version_id": str(version.id),
    }


@router.get("/public/{publication_slug}")
async def get_public_project_payload(
    publication_slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(CodingPublication, CodingProject, CodingVersion)
        .join(CodingProject, CodingPublication.project_id == CodingProject.id)
        .join(CodingVersion, CodingPublication.version_id == CodingVersion.id)
        .where(
            CodingPublication.publication_slug == publication_slug,
            CodingPublication.status == "published",
        )
        .order_by(CodingPublication.created_at.desc())
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published site not found")

    publication, project, version = row
    files = (version.source_manifest_json or {}).get("files") or []
    return {
        "title": project.title,
        "slug": publication.publication_slug,
        "url_path": publication.url_path,
        "version_id": str(version.id),
        "files": files,
    }


@public_router.get("/students/{publication_slug}")
async def serve_published_project(
    publication_slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await _serve_published_project_html(publication_slug, "index.html", db)


@public_router.get("/students/{publication_slug}/{page_path:path}")
async def serve_published_project_page(
    publication_slug: str,
    page_path: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    entry_path = page_path.strip("/") or "index.html"
    if not entry_path.endswith(".html"):
        entry_path = f"{entry_path}.html"
    return await _serve_published_project_html(publication_slug, entry_path, db)


async def _serve_published_project_html(
    publication_slug: str,
    entry_path: str,
    db: AsyncSession,
):
    result = await db.execute(
        select(CodingPublication, CodingProject, CodingVersion)
        .join(CodingProject, CodingPublication.project_id == CodingProject.id)
        .join(CodingVersion, CodingPublication.version_id == CodingVersion.id)
        .where(
            CodingPublication.publication_slug == publication_slug,
            CodingPublication.status == "published",
        )
        .order_by(CodingPublication.created_at.desc())
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published site not found")

    _publication, project, version = row
    files = (version.source_manifest_json or {}).get("files") or []
    html = _build_static_html(files, project.title, entry_path)
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "credentialless",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
