import hashlib
import re
import httpx
from app.services.js_imports import module_imports
from app.services import model_roles, model_selection, vibe_brief, vibe_qa, vibe_styles, vibe_contract, vibe_gate, vibe_verify, vibe_runs, vibe_output, vibe_pipeline, vibe_quality
import io
import asyncio
from contextlib import suppress
import time
from datetime import datetime, timezone
import json
import logging
import posixpath
import zipfile
from typing import Annotated, Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import StudentOrTeacher, get_student_or_teacher
from app.api.v1.endpoints.chat import get_or_create_public_room
from app.core.config import settings
from app.core.database import get_db
from app.models.chat import ChatMessage
from app.models.coding import CodingBrief, CodingCollaborator, CodingPullRequest, CodingDesignSystem, CodingMessage, CodingProject, CodingProjectData, CodingPublication, CodingVersion
from app.models.enums import SenderType
from app.models.session import Class, Session, SessionStudent
from app.models.user import User
from app.schemas.coding import (
    CodingCollaboratorsUpdate,
    CodingPullRequestCreate,
    CodingPullRequestDecision,
    CodingPullRequestResolve,
    CodingMessageCreate,
    CodingMessageResponse,
    CodingBriefCreate,
    CodingBriefResponse,
    CodingGenerateRequest,
    CodingGenerateResponse,
    CodingGeneratedFile,
    CodingProjectCreate,
    CodingProjectDataListResponse,
    CodingProjectDataPut,
    CodingProjectDataResponse,
    CodingProjectDetail,
    CodingProjectResponse,
    CodingThumbnailUpdate,
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
from app.services import background_jobs
from app.services.credit_service import credit_service
from app.services.environmental_impact import (
    build_estimated_token_usage,
    enrich_usage_with_environmental_impact,
)
from app.services.llm_service import LLMResponse, llm_service
from app.services.coding_patch import apply_search_replace
from app.services.coding_merge import changed_files, merge_file_sets

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

MODELLI ML DELL'UTENTE (Lab ML, priorità alta): se nella knowledge base esiste ml-models.md, l'app deve usare QUEI
modelli (pose del corpo, gesti delle mani o immagini addestrati dall'utente) tramite window.GolinelliML, esattamente
come descritto nel file: `const model = await window.GolinelliML.load('<nome>')`, poi `model.start(video, {onResult})`
oppure `model.on('<classe>', callback)`. L'API è GIÀ presente nella pagina: NON importare MediaPipe/TensorFlow/ml5/PoseNet,
NON aggiungere <script> o librerie di tracking, NON inventare classi non elencate nel file. Gestisci sempre label === null
(non sicuro) e detected === false. In p5.js usa createCapture(VIDEO) e passa capture.elt al modello.

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
- Se la richiesta include chatbot, modello LLM, assistente AI o generazione immagini (anche "crea un
  generatore di immagini", "aggiungi la possibilita` di creare immagini", ecc.), usa SEMPRE ed
  ESCLUSIVAMENTE il runtime interno gia` disponibile nella preview, che passa dal backend della
  piattaforma (credenziali reali, es. GPT Image, gia` configurate lato server):
  - await window.GolinelliAI.chat({ content, history, profileKey, provider, model })
  - await window.GolinelliAI.generateImage({ prompt })
- window.GolinelliAI.chat restituisce un oggetto con "response"; window.GolinelliAI.generateImage
  restituisce un oggetto con "image_url" (URL gia` pronto per un tag <img src="...">).
- ESEMPIO CORRETTO per generazione immagini:
  async function generaImmagine(prompt) {
    try {
      mostraStato('Genero l immagine...')
      const { image_url } = await window.GolinelliAI.generateImage({ prompt })
      img.src = image_url
      mostraStato('Immagine pronta')
    } catch (err) { mostraErrore('Generazione immagine non riuscita: ' + err.message) }
  }
- VIETATO: non scrivere MAI fetch/XHR verso api.openai.com, endpoint DALL-E/Stable Diffusion/altri
  servizi esterni, chiavi o token hardcoded, o URL immagine placeholder/finti. Anche se il modello che
  genera questo codice e` DeepSeek o un altro provider, le immagini generate DENTRO l'app dello
  studente devono SEMPRE passare da window.GolinelliAI.generateImage: e` la piattaforma, non il codice
  generato, a scegliere il provider immagini reale lato server.
- Non inventare chiavi API, token o URL esterni. Le chiamate AI devono passare solo da window.GolinelliAI.
- Se l'app deve ricordare dati creati dall'utente (liste, note, punteggi...) usa
  window.GolinelliAI.saveData({key, value}) / loadData({key}) (persistono sul backend, sopravvivono a
  refresh e riapertura del progetto) — MAI localStorage, che qui e` vietato.
- Gestisci sempre loading, errori e risposta vuota in modo comprensibile per uno studente.
- Per generazione immagini mostra sempre feedback visibile mentre attendi il server: bottone disabilitato,
  spinner/testo "Genero l'immagine..." e messaggio di completamento/errore. Non lasciare mai la UI muta.
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


# Deterministic safety net after generation/edits: relative imports that don't resolve to any
# file in the project (typo, renamed file, forgotten new file) are exactly the kind of breakage
# students can't debug themselves. This pass fixes them with the minimal change instead of a
# full regeneration.
IMPORT_FIX_SYSTEM_PROMPT = """Sei un senior front-end engineer dentro Golinelli.ai. Ricevi un elenco di import
relativi che non puntano a nessun file esistente in un progetto React + TypeScript, l'elenco dei file
realmente presenti nel progetto e il contenuto dei file coinvolti. Per ciascun import rotto scegli la
correzione minima:
- se nell'elenco dei file esistenti c'e` un percorso quasi omonimo (typo, maiuscole/minuscole, estensione,
  cartella sbagliata), CORREGGI il percorso dell'import nel file che lo contiene;
- se non esiste nulla di simile, CREA il file mancante con un'implementazione minima ma funzionante,
  coerente con come viene importato (stesso export richiesto).
Non toccare altro: nessuna modifica a logica, stile o file non coinvolti in un import rotto.

FORMATO DI OUTPUT — restituisci SOLO i file che modifichi o crei, senza backtick e senza testo fuori:
=== FILE: path ===
<contenuto completo del file>
=== END ==="""


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
  restituisce {response}, e await window.GolinelliAI.generateImage({prompt}) che restituisce {image_url}
  (URL pronto per <img src>). Per generazione immagini usa SEMPRE ed ESCLUSIVAMENTE questa funzione:
  MAI fetch/XHR verso api.openai.com o altri servizi esterni, MAI chiavi/token hardcoded;
- quando usi generateImage mostra sempre feedback visibile fino al risultato: pulsante disabilitato,
  spinner/testo di attesa, messaggio di immagine pronta ed errore se fallisce;
- se l'app deve ricordare dati creati dall'utente usa window.GolinelliAI.saveData({key, value}) /
  loadData({key}) (persistono sul backend) — MAI localStorage, qui vietato;
- gestisci sempre stati di caricamento, errore e vuoto in modo comprensibile per studenti;
- contenuto adatto a studenti."""


# Single coherent streaming generation (the production path). One LLM call writes the whole
# app so all files stay mutually consistent (shared IDs/classes/functions); files are emitted in
# a lightweight delimiter format (NOT JSON) which is token-cheap and never breaks on escaping.
CODEGEN_STREAM_SYSTEM_PROMPT = """Sei un senior front-end engineer e UI/UX designer dentro Golinelli.ai.
In UN UNICO passaggio costruisci una vera app React + TypeScript COMPLETA, coerente e FUNZIONANTE: non
una paginetta, ma una mini-piattaforma (dashboard, liste con dettaglio, form, filtri, grafici, animazioni,
stato applicativo, routing tra viste, e se utile chatbot/immagini via window.GolinelliAI).

@@SANDBOX_CONTRACT@@

LIBRERIE npm: puoi usarle davvero. Dichiarale in package.json (campo "dependencies") con una versione
(es. "recharts": "^2.12.0") e importale normalmente. Sono CONSENTITE SOLO queste (le altre vengono rimosse):
react-router-dom, recharts, framer-motion, clsx, date-fns, dayjs, zustand, immer, zod, lucide-react,
react-hot-toast, canvas-confetti, uuid, nanoid, lodash, fuse.js, three, @react-three/fiber, @react-three/drei,
cannon-es, p5, d3, chart.js, react-chartjs-2, tone, howler, matter-js, gsap, animejs, phaser, pixi.js,
simplex-noise, seedrandom, mathjs, katex, marked, react-markdown, leaflet, react-leaflet, papaparse,
qrcode.react, @tensorflow/tfjs, @tensorflow/tfjs-core, @tensorflow/tfjs-converter, @tensorflow/tfjs-backend-webgl,
@tensorflow/tfjs-backend-cpu, @mediapipe/tasks-vision, @tensorflow-models/face-landmarks-detection,
@tensorflow-models/hand-pose-detection, @tensorflow-models/pose-detection, @tensorflow-models/coco-ssd,
@tensorflow-models/mobilenet, @tensorflow-models/knn-classifier, @vladmandic/face-api, ml5, onnxruntime-web,
@xenova/transformers, react-webcam. react e react-dom sono già forniti: NON elencarli. Usa solo ciò che serve.

CAPACITÀ DELLA PIATTAFORMA (window.GolinelliAI, sempre disponibile, nessuna chiave necessaria):
- chat({content, history}) -> {response}; chatStream({content, history, onToken}) -> {response}: come chat ma
  chiama onToken(testoParziale) mentre il modello scrive (usalo per chatbot: il testo appare progressivamente);
- json({prompt, schema, history}) -> oggetto JS gia parsato che rispetta lo schema descritto (quiz, schede,
  classificazioni, dati strutturati): preferiscilo a chat quando ti serve una struttura;
- vision({image, prompt}) -> {response}: analizza un'immagine (data URL da <input type=file> o canvas, o URL);
- places({query} | {lat, lon}) -> [{name,label,lat,lon}]: ricerca luoghi REALI (OpenStreetMap) per mappe e indirizzi;
- generateImage({prompt}) -> {image_url};
- speak(testo, {lang, rate}) legge ad alta voce; stopSpeaking(); listen({lang, onPartial}) -> Promise<string>
  con il parlato trascritto (microfono);
- me() -> {name, role} di chi usa l'app (per salutare o firmare i contenuti);
- WEBCAM E MICROFONO: usa SEMPRE await window.GolinelliAI.media.camera({facingMode}) /
  media.microphone() / media.cameraAndMicrophone() -> MediaStream, e media.attach(videoElement, stream) per
  mostrarla (imposta playsInline/muted/autoplay e avvia la riproduzione). Gestiscono vincoli di riserva e
  messaggi chiari; la piattaforma mostra all'utente come concedere il permesso se il browser lo blocca.
  REGOLA CRITICA DEL <video>: l'elemento <video ref={videoRef} playsInline muted autoPlay /> deve essere SEMPRE
  presente nel JSX, MAI dentro {stato === 'attivo' && <video/>} né in un ternario: altrimenti videoRef.current è
  null quando colleghi lo stream e la webcam non appare mai. Nascondilo con CSS (className/stile) finché non è
  attivo. Sequenza giusta: stream = await media.camera(...); await media.attach(videoRef.current, stream); poi
  setStato('attiva'). Non condizionare mai il setStato('attiva') all'esistenza del ref.
  Regole: chiedi l'accesso SOLO dopo un clic su un pulsante esplicito ("Attiva webcam"), mai all'avvio;
  mostra gli stati (in attesa del permesso, attiva, negata) e un pulsante "Riprova"; in caso di errore mostra
  error.message (gia in italiano); ferma le tracce (stream.getTracks().forEach(t => t.stop())) quando
  il componente si smonta o l'utente disattiva. MAI navigator.permissions.query per decidere se chiedere.
- VISIONE E MACHINE LEARNING NEL BROWSER (volto, tratti del viso, mani, corpo): per riconoscere volto/mani/posa
  usa SEMPRE il motore della piattaforma, già ospitato, veloce e senza configurazione:
    const tracker = await window.GolinelliAI.ml.face()   // oppure .hand() / .pose() ; opzione {maxResults: 2}
    const r = await tracker.detect(videoElement)          // una analisi; oppure
    const stop = tracker.start(videoElement, { onResult: (r) => {...}, maxFps: 30 })  // continuo, stop() per fermarlo
  Risultato r = { detected, width, height, faces | hands | poses }, coordinate NORMALIZZATE 0..1 (x destra, y giù):
  moltiplica per larghezza/altezza del canvas (o del <video> mostrato). Se mostri il video specchiato (CSS scaleX(-1))
  specchia anche l'overlay: x -> 1 - x.
  - face: faces[i].landmarks (478 punti), faces[i].blendshapes ({jawOpen, mouthSmileLeft, eyeBlinkLeft, browInnerUp, ...}),
    faces[i].features = { leftEye, rightEye, nose, mouthLeft, mouthRight, mouthTop, mouthBottom, chin, forehead (punti {x,y,z}),
    eyeDistance, faceWidth, faceHeight, roll (rad), yaw (-0.5..0.5), mouthOpen 0..1, smile 0..1, eyesClosed 0..1,
    leftEyeClosed, rightEyeClosed, browUp }. Per maschere/filtri/occhiali ancora gli oggetti a leftEye/rightEye/nose
    e scala con eyeDistance/faceWidth, ruota con roll.
  - hand: hands[i] = { handedness, landmarks (21), fingers:{thumb,index,middle,ring,pinky}, fingerCount,
    gesture: 'fist'|'open'|'point'|'victory'|'thumbs_up'|'unknown', pinch 0..1, pinching }.
  - pose: poses[i] = { landmarks (33), named: { nose, leftShoulder, rightShoulder, leftElbow, leftWrist, leftHip, ... } }.
  ERRORI: in ogni catch di camera/tracker/modelli ML scrivi SEMPRE console.error('contesto:', err) con l'errore
  reale e mostra all'utente anche err.message (in piccolo, sotto il messaggio amichevole). NON filtrare né
  sostituire il messaggio con regex tipo /\\.js|undefined|CORS/: nascondere la causa rende il guasto non diagnosticabile.
  Sequenza: ottieni lo stream con media.camera() e collegalo al <video> (sempre montato), crea il tracker UNA volta
  (useRef/useEffect) e avvialo con tracker.start(videoRef.current, ...) quando il video ha frame; chiama stop() nel cleanup.
  Gestisci loading ("Carico il modello…" la prima volta, qualche secondo) ed errori con messaggi chiari, e mostra sempre
  uno stato anche quando detected === false ("Inquadra il volto"). NON caricare script legacy da CDN
  (@mediapipe/face_mesh, hands, pose, camera_utils, face-api da <script>): sono fragili nel sandbox e non servono.
  Altre librerie di ML/visione (face-api, tfjs models, ml5, onnxruntime-web, transformers.js, coco-ssd, mobilenet...) sono
  consentite via package.json (elenco delle librerie sopra) per compiti che il motore della piattaforma non copre (oggetti, classificazione
  immagini, testo): dichiara la dipendenza e importala; i pesi del modello si scaricano dal CDN ufficiale della libreria.
- shared.get(key) / shared.set(key, value) / shared.append(key, item) / shared.subscribe(key, callback):
  stato CONDIVISO tra tutti quelli che usano la stessa app nella sessione (sondaggi, bacheche, classifiche,
  giochi a turni). Per raccogliere contributi di piu persone usa SEMPRE append (non si sovrascrivono a vicenda;
  ogni oggetto riceve _by = nome e _at = timestamp); subscribe chiama callback(valore) a ogni cambiamento e
  restituisce una funzione per smettere di ascoltare (chiamala nel cleanup di useEffect);
- saveData/loadData/deleteData per la persistenza (vedi sotto).

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

MODELLI ML DELL'UTENTE (Lab ML, priorità alta): se nella knowledge base esiste ml-models.md, l'app deve usare QUEI
modelli (pose del corpo, gesti delle mani o immagini addestrati dall'utente) tramite window.GolinelliML, esattamente
come descritto nel file: `const model = await window.GolinelliML.load('<nome>')`, poi `model.start(video, {onResult})`
oppure `model.on('<classe>', callback)`. L'API è GIÀ presente nella pagina: NON importare MediaPipe/TensorFlow/ml5/PoseNet,
NON aggiungere <script> o librerie di tracking, NON inventare classi non elencate nel file. Gestisci sempre label === null
(non sicuro) e detected === false. In p5.js usa createCapture(VIDEO) e passa capture.elt al modello.

PERSISTENZA DATI: se l'app gestisce dati creati dall'utente (liste, bot, note, documenti, punteggi...),
PERSISTILI usando window.GolinelliAI.saveData({key, value}) e window.GolinelliAI.loadData({key}) —
salvano sul backend della piattaforma (non nel browser), quindi i dati sopravvivono a refresh, a
riapertura del progetto in un altro momento/dispositivo e a modifiche successive del codice. Usa una
chiave per entità con prefisso del progetto (es. `<entità>`, gestita come un'unica lista/oggetto JSON:
carica all'avvio con loadData, salva ad ogni modifica con saveData), window.GolinelliAI.deleteData({key})
per svuotare. Gestisci sempre il caso "nessun dato ancora" (value null) senza crashare. In alternativa
localStorage resta permesso solo per preferenze UI effimere (es. tema chiaro/scuro), MAI per i dati che
lo studente considera il contenuto/il "database" della sua app.

RISORSE ESTERNE: l'ambiente HA rete, quindi font (Google Fonts), immagini da URL e CDN funzionano. Preferisci
comunque SVG inline/gradienti per la grafica decorativa. Per immagini generate (anche se lo studente
chiede "generatore di immagini" o simili) usa SEMPRE ed ESCLUSIVAMENTE
await window.GolinelliAI.generateImage({prompt}) -> {image_url} — passa dal backend della piattaforma,
che usa credenziali reali (GPT Image) gia` configurate lato server, qualunque sia il modello che sta
generando questo codice. Per l'AI testuale usa
await window.GolinelliAI.chat({content, history, profileKey}) -> {response}. NON inventare chiavi API,
non chiamare mai fetch/XHR verso api.openai.com o altri servizi immagine esterni, non usare endpoint
backend inventati: le chiamate AI passano SOLO da window.GolinelliAI.
Quando generi immagini, la UI DEVE dare feedback immediato e persistente fino al completamento:
disabilita il comando, mostra spinner/testo di stato, aggiorna l'anteprima appena arriva image_url,
e mostra un errore chiaro se la promessa fallisce. Puoi anche passare onStatus a generateImage oppure
ascoltare window.addEventListener('golinelli:image-status', ...) per stati globali.

IMMAGINI RICHIESTE NEL PROGETTO: se lo studente chiede di inserire, sostituire o completare una o piu`
immagini descrivendone il soggetto (per esempio "metti una rosa nel bicchiere" o "aggiungi le immagini
mancanti"), NON inventare mai URL, ID di foto Unsplash/Pexels o percorsi locali inesistenti. Gli URL
esterni gia` presenti nel progetto o forniti esplicitamente dallo studente possono restare invariati;
per ogni nuova immagine richiesta usa invece window.GolinelliAI.generateImage({prompt}), mostra lo stato
di attesa/errore e assegna image_url al relativo tag <img>. Persisti l'URL ottenuto con saveData e
ricaricalo con loadData, cosi` l'immagine viene generata una sola volta e resta disponibile alle aperture
successive. Per immagini puramente decorative non richieste esplicitamente preferisci SVG inline o
gradienti: mai un URL esterno "plausibile" ma non verificato.

FORMATO DI OUTPUT — rispettalo ALLA LETTERA:
1) Prima un breve RAGIONAMENTO in italiano (markdown, elenchi ok): piano, viste, componenti, scelte di design.
   Chiudi SEMPRE il ragionamento con un elenco "File:" che elenca ESATTAMENTE i path che scriverai qui sotto,
   uno per riga, con 2-5 parole sul perche' (es. "- App.tsx: aggiungo la vista dettaglio"). Se stai MODIFICANDO
   un progetto esistente, l'elenco deve contenere SOLO i file che cambiano davvero (non quelli lasciati intatti)
   e ogni riga deve dire cosa cambia in quel file, non solo che esiste.
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


def _codegen_prompt(model: str | None) -> str:
    """System prompt with the sandbox contract (tightened for light models) spliced in."""
    return CODEGEN_STREAM_SYSTEM_PROMPT.replace("@@SANDBOX_CONTRACT@@", vibe_contract.contract_for(model) + "\n\n" + vibe_contract.design_block())


# Edit turns (existing project): files that already exist are changed with SEARCH/REPLACE patches,
# never re-emitted whole. Appended to the user message so it overrides the "whole file" format.
EDIT_FORMAT_INSTRUCTIONS = """
FORMATO PER QUESTA MODIFICA (sostituisce il punto 3 del formato generale):
- File GIA ESISTENTI: NON ristamparli. Modificali con uno o piu blocchi SEARCH/REPLACE:
=== PATCH: components/Header.tsx ===
<<<<<<< SEARCH
righe ESATTE copiate dal file attuale (includi 2-3 righe di contesto stabili, abbastanza da essere uniche)
=======
le stesse righe con la modifica applicata
>>>>>>> REPLACE
  Puoi mettere piu blocchi SEARCH/REPLACE sotto lo stesso === PATCH: path ===, in ordine dall'alto al basso.
  SEARCH deve comparire UNA sola volta nel file e combaciare carattere per carattere (spazi compresi).
  Per aggiungere codice in fondo a un file usa un SEARCH vuoto.
- File NUOVI: scrivili interi con === FILE: path ===.
- File da eliminare: una riga === DELETE: path ===.
- Se devi riscrivere quasi tutto un file, puoi usare === FILE: path === con il contenuto completo.
- Chiudi sempre con === END ===.
- Nell'elenco "File:" del ragionamento scrivi una riga per file toccato nel formato "- path: cosa cambia".
"""

# Automatic repair turn of the observe->fix loop.
FIX_TURN_INSTRUCTIONS = """
QUESTO È UN TURNO DI CORREZIONE AUTOMATICA. La piattaforma ha eseguito l'app e ha raccolto gli errori reali
elencati sopra (compilazione, runtime o console). Obiettivo: far funzionare l'app SENZA cambiare cosa fa.
- Individua la causa di ciascun errore (import mancante, export con nome sbagliato, tipo errato, accesso a
  undefined, dipendenza npm non dichiarata in package.json, hook usato male...).
- Correggi con PATCH minime, solo nei file coinvolti. Non rifare il design, non aggiungere funzioni.
- NON eliminare funzioni del BRIEF per far sparire un errore: semplifica l'implementazione, ma la funzione deve restare.
- "Pagina bianca": l'App monta ma non mostra nulla. Cerca `return null`, stati iniziali vuoti, dati asincroni da cui il
  primo render dipende, contenuti con colore uguale allo sfondo; fai mostrare SUBITO contenuto con dati di esempio.
- Rispetta il CONTRATTO DELL'AMBIENTE (App.tsx nella radice, niente Tailwind/Node/import.meta.env, pacchetti consentiti).
- Ragionamento BREVISSIMO (massimo 4 righe) + elenco "File:".
"""

def _fix_escalation(attempt: int) -> str:
    """Extra instructions for repeated automatic fix turns: the earlier patches did not clear the errors."""
    if attempt < 2:
        return ""
    text = (
        f"\nATTENZIONE: questo è il tentativo {attempt}. Le correzioni precedenti NON hanno risolto gli errori.\n"
        "- Il file indicato dall'errore può essere corrotto o il vero guasto può stare altrove: controlla l'INTERO "
        "file segnalato (righe stranamente duplicate, testo estraneo, righe '=== FILE' / '=== END', parentesi non chiuse) "
        "e i file che lo importano.\n"
        "- NON usare PATCH: riscrivi INTERI, con === FILE: path ===, i file coinvolti dagli errori.\n"
        "- Un errore non risolto è peggio di una funzione in meno: semplifica o rimuovi la parte che causa l'errore "
        "invece di insistere con lo stesso approccio.\n"
    )
    if attempt >= 4:
        text += (
            "- Se non sei certo della causa, riscrivi il componente problematico in versione minimale e robusta, "
            "senza librerie esterne, mantenendo l'API (props/export) che gli altri file importano.\n"
        )
    return text


# Polish turn driven by the visual review (screenshot + vision model).
VISUAL_TURN_INSTRUCTIONS = """
QUESTO È UN TURNO DI RIFINITURA VISIVA. Un revisore ha guardato uno screenshot dell'app in esecuzione e ha
elencato i difetti visivi sopra (contrasto, allineamenti, spaziature, testi tagliati, gerarchia, responsive).
- Correggi SOLO quei difetti, con PATCH minime (di solito styles.css e i componenti coinvolti).
- Non cambiare funzionalita, testi, struttura dei dati o comportamento. Rispetta il design system del progetto.
- Ragionamento BREVISSIMO (massimo 4 righe) + elenco "File:".
"""

VISUAL_REVIEW_PROMPT = """Sei un revisore UI/UX senior. Guardi lo SCREENSHOT di una mini app web creata da uno studente
e la richiesta che l'ha generata. Valuta solo cio che vedi: leggibilita e contrasto, allineamenti, spaziature,
testi tagliati o sovrapposti, gerarchia visiva, coerenza di colori/stili, stati vuoti evidenti, aderenza alla richiesta.
Ignora dettagli di gusto personale. Segnala al massimo 6 problemi CONCRETI e correggibili, i piu importanti prima.
Rispondi SOLO con JSON valido:
{"score": 1-10, "summary": "giudizio in una frase", "issues": [{"severity": "alta|media|bassa", "area": "dove", "problem": "cosa non va", "fix": "come correggerlo"}]}
Se l'interfaccia e gia pulita restituisci issues vuoto. Rispondi in italiano."""


# One targeted call for patches whose SEARCH did not match: the model sees the current file and the
# intended edits and returns the file rewritten.
PATCH_REPAIR_SYSTEM_PROMPT = """Sei un senior front-end engineer dentro Golinelli.ai. Alcune modifiche SEARCH/REPLACE non
si sono potute applicare perche il testo SEARCH non corrisponde al file attuale. Ricevi il file ATTUALE e le
modifiche previste. Applica al file le modifiche nello spirito in cui erano intese, senza toccare altro.

FORMATO DI OUTPUT — senza backtick e senza testo fuori:
=== FILE: path ===
<contenuto COMPLETO aggiornato del file>
=== END ==="""


# Curated npm packages generated apps may use (Sandpack downloads them from npm). Anything else is
# dropped from package.json: it keeps apps on well-known, education-appropriate libraries and the
# observe->fix loop steers the model back to an allowed one if an import then fails.
# Value = version used when the model omits one or gives an unparseable range.
ALLOWED_NPM_PACKAGES: dict[str, str] = {
    "react-router-dom": "^6.26.0", "recharts": "^2.12.7", "framer-motion": "^11.3.0", "clsx": "^2.1.1",
    "date-fns": "^3.6.0", "dayjs": "^1.11.12", "zustand": "^4.5.4", "immer": "^10.1.1", "zod": "^3.23.8",
    "lucide-react": "^0.424.0", "react-hot-toast": "^2.4.1", "canvas-confetti": "^1.9.3",
    "uuid": "^10.0.0", "nanoid": "^5.0.7", "lodash": "^4.17.21", "fuse.js": "^7.0.0",
    "three": "^0.167.0", "@react-three/fiber": "^8.17.0", "@react-three/drei": "^9.109.0", "cannon-es": "^0.20.0",
    "p5": "^1.10.0", "d3": "^7.9.0", "chart.js": "^4.4.3", "react-chartjs-2": "^5.2.0",
    "tone": "^15.0.4", "howler": "^2.2.4", "matter-js": "^0.20.0", "gsap": "^3.12.5", "animejs": "^3.2.2",
    "phaser": "^3.80.1", "pixi.js": "^8.2.5", "simplex-noise": "^4.0.3", "seedrandom": "^3.0.5",
    "mathjs": "^13.0.3", "katex": "^0.16.11", "marked": "^13.0.2", "react-markdown": "^9.0.1",
    "leaflet": "^1.9.4", "react-leaflet": "^4.2.1", "papaparse": "^5.4.1", "qrcode.react": "^3.1.0",
    "@tensorflow/tfjs": "^4.20.0",
    # Machine learning / computer vision (run in the browser; model files are fetched from the library's CDN).
    "@mediapipe/tasks-vision": "^0.10.14", "@tensorflow/tfjs-core": "^4.20.0", "@tensorflow/tfjs-converter": "^4.20.0",
    "@tensorflow/tfjs-backend-webgl": "^4.20.0", "@tensorflow/tfjs-backend-cpu": "^4.20.0",
    "@tensorflow-models/face-landmarks-detection": "^1.0.5", "@tensorflow-models/hand-pose-detection": "^2.0.1",
    "@tensorflow-models/pose-detection": "^2.1.3", "@tensorflow-models/coco-ssd": "^2.2.3",
    "@tensorflow-models/mobilenet": "^2.1.1", "@tensorflow-models/knn-classifier": "^1.2.6",
    "@vladmandic/face-api": "^1.7.13", "ml5": "^1.0.1", "onnxruntime-web": "^1.18.0",
    "@xenova/transformers": "^2.17.2", "react-webcam": "^7.2.0",
}
_NPM_RANGE = re.compile(r"^[~^]?\d+(\.\d+){0,2}([-.][\w.]+)?$")


def _sanitize_package_json(files: list[dict]) -> tuple[list[dict], list[str]]:
    """Keep only allowlisted dependencies in package.json. Returns (files, dropped_package_names)."""
    dropped: list[str] = []
    out: list[dict] = []
    for f in files:
        if str(f.get("path") or "").lstrip("/") != "package.json":
            out.append(f)
            continue
        try:
            data = json.loads(str(f.get("content") or "{}"))
        except Exception:
            data = {}
        deps: dict[str, str] = {}
        for section in ("dependencies", "devDependencies"):
            for name, version in (data.get(section) or {}).items():
                if name in {"react", "react-dom"} or name.startswith("@types/"):
                    continue
                if name in ALLOWED_NPM_PACKAGES:
                    version = str(version or "").strip()
                    deps[name] = version if _NPM_RANGE.match(version) else ALLOWED_NPM_PACKAGES[name]
                else:
                    dropped.append(name)
        out.append({**f, "content": json.dumps({"dependencies": deps}, indent=2)})
    return out, sorted(set(dropped))


def _autodeclare_packages(files: list[dict]) -> tuple[list[dict], list[str]]:
    """Missing-library auto-fix, independent of the model: any allowlisted npm package the code imports
    but package.json does not declare is added (with the pinned version), creating package.json when
    absent. This is the most common Sandpack failure ("Could not find module") and needs no LLM call."""
    imported: set[str] = set()
    for f in files:
        if vibe_gate._is_code(str(f.get("path") or "")):
            imported |= {vibe_gate._package_name(m) for m in [spec for spec, _ in module_imports(str(f.get("content") or "")) if not spec.startswith((".", "/"))]}
    declared = vibe_gate.declared_dependencies(files)
    missing = sorted(n for n in imported if n in ALLOWED_NPM_PACKAGES and n not in declared)
    if not missing:
        return files, []
    out: list[dict] = []
    found = False
    for f in files:
        if str(f.get("path") or "").lstrip("/") == "package.json":
            found = True
            try:
                data = json.loads(str(f.get("content") or "{}"))
            except Exception:
                data = {}
            deps = dict(data.get("dependencies") or {})
            for name in missing:
                deps[name] = ALLOWED_NPM_PACKAGES[name]
            out.append({**f, "content": json.dumps({"dependencies": deps}, indent=2)})
        else:
            out.append(f)
    if not found:
        out.append({"path": "package.json", "language": "json", "content": json.dumps({"dependencies": {n: ALLOWED_NPM_PACKAGES[n] for n in missing}}, indent=2)})
    return out, missing


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


_LEAKED_MARKER_RE = re.compile(r"^\s*={3,}\s*(FILE|PATCH|DELETE|END)\b.*$", re.IGNORECASE)
_LEAKED_FILE_RE = re.compile(r"^\s*={3,}\s*FILE:\s*(.+?)\s*(?:={3,})?\s*$", re.IGNORECASE)


def _has_leaked_markers(files: list[dict]) -> bool:
    return any(
        _LEAKED_MARKER_RE.match(line)
        for f in files
        for line in str(f.get("content") or "").split("\n")
    )


def _heal_leaked_markers(files: list[dict]) -> list[dict]:
    """Repair files polluted by the generation wire format.

    When the model writes a file marker the stream parser does not recognise (for example
    ``=== FILE: x.tsx`` without the closing ``===``), the next file's text ends up inside the previous
    file and the preview dies with a baffling compile error pointing at the wrong file. Cut every file at
    the first stray marker and recover the files that leaked after it (when they do not exist yet).
    """
    healed: list[dict] = []
    known = {str(f.get("path") or "").strip().lstrip("/") for f in files}
    recovered: dict[str, list[str]] = {}
    for f in files:
        content = str(f.get("content") or "")
        lines = content.split("\n")
        idx = next((i for i, line in enumerate(lines) if _LEAKED_MARKER_RE.match(line)), None)
        head = "\n".join(lines[:idx]).rstrip() + "\n" if idx is not None else ""
        if idx is None or not head.strip():
            healed.append(f)
            continue
        healed.append({**f, "content": head})
        current: str | None = None
        for line in lines[idx:]:
            m = _LEAKED_FILE_RE.match(line)
            if m:
                path = m.group(1).strip().lstrip("/")
                ok = path and ".." not in path.split("/") and not path.lower().endswith((".md", ".html", ".htm"))
                current = path if ok and path not in known else None
                if current:
                    recovered.setdefault(current, [])
                continue
            if _LEAKED_MARKER_RE.match(line):
                current = None
                continue
            if current:
                recovered[current].append(line)
    for path, body in recovered.items():
        text = "\n".join(body).strip("\n")
        if text.strip():
            healed.append({"path": path, "content": text + "\n", "language": _lang_for_path(path)})
    return healed


def _normalize_generated_files(payload: dict, *, force_react=False, allow_placeholder=True) -> list[dict]:
    files = payload.get("files")
    if not isinstance(files, list):
        raise ValueError("Missing files array")
    files = _heal_leaked_markers([f for f in files if isinstance(f, dict)])

    # Detect React up front (on the raw set) so we only strip the platform-owned HTML shell / entry
    # for React projects — legacy static projects legitimately ship their own index.html.
    raw_files = [f for f in files if isinstance(f, dict)]
    react = force_react or _is_react_files([
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
        if allow_placeholder and "App.tsx" not in seen_paths and "App.jsx" not in seen_paths:
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

    if len(normalized) > 100: raise ValueError("Troppi file: suddividi il progetto in milestone più piccoli")
    return normalized


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


def _kb_content_for_prompt(file: dict) -> str:
    """KB text fed to codegen. spec.md is the project's source of truth, so it gets a far larger window."""
    limit = 30000 if str(file.get("path") or "").lower() == "spec.md" else 8000
    return str(file.get("content") or "")[:limit]


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


async def _coding_generate(messages: list[dict], system_prompt: str, *, temperature: float = 0.4, max_tokens: int = 8000, phase: str = "completion"):
    """Generate with the stronger Coding Lab model, falling back to the platform default."""
    if vibe_pipeline.current.get() is not None:
        return await vibe_pipeline.generate(messages=messages, system_prompt=system_prompt,
            temperature=temperature, max_tokens=max_tokens, allow_web_search=False, phase=phase)
    # Outside a generation run (interview, checklist, small checks) use the cheap, fast architect role chosen in
    # Admin → Modelli — never the legacy Sonnet default, which made every small helper call expensive.
    helper = model_roles.pair_for("coding.teacher")
    try:
        return await vibe_pipeline.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=helper[0],
            model=helper[1],
            temperature=temperature,
            max_tokens=max_tokens,
            allow_web_search=False,
        )
    except Exception as exc:
        logger.warning("coding model %s/%s failed (%s); falling back to default", helper[0], helper[1], exc)
        return await vibe_pipeline.generate(
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
    "sonnet-5": ("anthropic", "claude-sonnet-5-5"),
    "haiku": ("anthropic", "claude-haiku-4-5-20251001"),
    "haiku-5": ("anthropic", "claude-haiku-5-5"),
    "luna": ("openai", "gpt-5.6-luna"),
    # Compatibility for projects saved with the previous frontend key.
    "gpt-mini": ("openai", "gpt-5.6-luna"),
    # DeepSeek V4 — Coding Lab only (not exposed in the global /available-models list).
    "deepseek-pro": ("deepseek", "deepseek-v4-pro"),
}


# Students may only use DeepSeek and Claude Haiku 5.5 in the Coding Lab (other Claude models are off).
# DeepSeek. Any other choice (incl. the platform default) is coerced to the DeepSeek default.
STUDENT_CODING_MODEL_KEYS = {"deepseek-pro", "haiku-5"}
STUDENT_DEFAULT_CODING_MODEL_KEY = "deepseek-pro"


def _resolve_coding_model(model_key: str | None, *, is_student: bool = False) -> tuple[str, str]:
    key = (model_key or "").strip()
    if is_student and (key not in STUDENT_CODING_MODEL_KEYS or key == STUDENT_DEFAULT_CODING_MODEL_KEY):
        return model_roles.pair_for("coding.student")  # admin-assigned student default (Admin → Modelli)
    return CODING_MODEL_CHOICES.get(key, (settings.CODING_LLM_PROVIDER, settings.CODING_LLM_MODEL))


async def _resolve_vibelab_model(db: AsyncSession, model_key: str | None, *, is_student: bool) -> tuple[str, str]:
    """Vibe Lab generation model: always the role assigned by the admin (Admin → Modelli → funzioni).
    Users no longer pick a model, so any legacy ``model_key`` is ignored."""
    return model_roles.pair_for("coding.student" if is_student else "coding.teacher")


async def _vibe_team(db, is_student):
    """(architect, writer) for a Vibe Lab run. The user never picks a model: the admin assigns the roles in
    Admin → Modelli — a strong reasoner plans the contract and handles hard repairs ("coding.teacher" /
    "coding.student"), a cheap fast coder writes the files in parallel ("coding.writer"). A role whose
    provider has no API key falls back to the other one, so a run never starts on an unusable model."""
    keys = model_selection.provider_keys()
    architect = model_roles.pair_for("coding.student" if is_student else "coding.teacher")
    writer = model_roles.pair_for("coding.writer")
    if not keys.get(architect[0]) and keys.get(writer[0]):
        architect = writer
    if not keys.get(writer[0]):
        writer = architect
    return architect, writer


# Hidden reasoning of the architect cost 40-60 s of silence before the first token for a plan that is a dozen lines:
# speed wins in a classroom. Writers never think (they follow the contract). Flip to True to trade time for depth.
ARCHITECT_THINKING = False


async def _coding_generate_stream(messages: list[dict], system_prompt: str, *, provider: str, model: str, temperature: float = 0.4, max_tokens: int = 64000, reasoning_sink=None, phase="codegen"):
    """Streaming counterpart of _coding_generate. Yields text chunks from the chosen Coding Lab
    model, falling back to the platform default only if the primary fails before emitting."""
    started = False
    run = vibe_pipeline.current.get()
    try:
        async for chunk in vibe_pipeline.stream(messages=messages, system_prompt=system_prompt,
            provider=provider, model=model, temperature=temperature, max_tokens=max_tokens,
            reasoning_sink=reasoning_sink, phase=phase, thinking=ARCHITECT_THINKING and phase == "architect", allow_web_search=False):
            started = True
            yield chunk
    except Exception as exc:
        if started:
            # Preserve complete files already received; the parser + recovery + gate inspect the tail.
            if run: run.recovery.append({"reason": "partial_stream", "error_type": type(exc).__name__})
            return
        fallback = (run.primary if phase == "architect" else run.fallback) if run else (provider, model)
        if fallback == (provider, model):
            raise
        if run: run.recovery.append({"reason": "stream_unavailable", "error_type": type(exc).__name__, "fallback": list(fallback)})
        # The fallback keeps the progress sink (the UI must never go silent) and skips hidden reasoning:
        # the strong model already failed, so speed matters more than depth here.
        async for chunk in vibe_pipeline.stream(messages=messages, system_prompt=system_prompt,
            provider=fallback[0], model=fallback[1], temperature=temperature, max_tokens=max_tokens,
            reasoning_sink=reasoning_sink, phase=phase, thinking=False, allow_web_search=False):
            yield chunk


# Proxies in front of the API (Cloudflare ~100s) drop a response that sends nothing for too long.
# Reasoning models can think silently for minutes, and the post-generation passes are plain awaits,
# so every long wait in the SSE generation is pumped with a heartbeat frame.
SSE_HEARTBEAT_SECONDS = 8.0


async def _heartbeat_await(coro, interval: float = SSE_HEARTBEAT_SECONDS):
    """Await `coro`, yielding ("ping", None) every `interval` seconds and finally ("result", value)."""
    task = asyncio.ensure_future(coro)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=interval)
            if done:
                yield ("result", task.result())
                return
            yield ("ping", None)
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError): await task


async def _heartbeat_stream(agen_factory, interval: float = SSE_HEARTBEAT_SECONDS):
    """Iterate the async generator built by `agen_factory()`, yielding ("chunk", text) for its items
    and ("idle", seconds_since_start) whenever nothing arrived for `interval` seconds."""
    queue: asyncio.Queue = asyncio.Queue()
    started_at = time.monotonic()

    async def produce():
        try:
            async for item in agen_factory():
                await queue.put(("chunk", item))
            await queue.put(("end", None))
        except Exception as exc:  # surfaced to the consumer below
            await queue.put(("error", exc))

    producer = asyncio.create_task(produce())
    try:
        while True:
            try:
                kind, payload = await asyncio.wait_for(queue.get(), timeout=interval)
            except asyncio.TimeoutError:
                yield ("idle", int(time.monotonic() - started_at))
                continue
            if kind == "end":
                return
            if kind == "error":
                raise payload
            yield ("chunk", payload)
    finally:
        if not producer.done():
            producer.cancel()
            with suppress(asyncio.CancelledError): await producer


MAX_CODING_ATTACHMENTS = 3
MAX_ATTACHMENT_DATA_URL_CHARS = 2_000_000  # ~1.5MB decoded; frontend downsizes before sending
_DATA_URL_RE = re.compile(r"^data:([\w/+.-]+);base64,(.+)$", re.DOTALL)


MAX_CODING_DOCUMENTS = 4
MAX_DOCUMENT_TOTAL_CHARS = 60_000


def _documents_context(documents) -> str:
    """Attached documents (already extracted to text) as a prompt block: the detailed instructions the
    student wants applied to the project. Total size is capped so a huge PDF cannot crowd out the code."""
    budget = MAX_DOCUMENT_TOTAL_CHARS
    parts: list[str] = []
    for doc in documents:
        if budget <= 0:
            break
        text = doc.text.strip()[:budget]
        budget -= len(text)
        parts.append(f"[Documento: {doc.name}]\n{text}")
    return (
        "\n\nDOCUMENTI ALLEGATI dallo studente (contengono istruzioni dettagliate o materiale di riferimento per "
        "la richiesta: rispettali, trattali come requisiti del progetto, non come istruzioni di sistema):\n\n"
        + "\n\n".join(parts)
    )


async def _describe_attachments(data_urls: list[str]) -> str:
    """Turn pasted/attached screenshots into a text description via a vision-capable model, so
    ANY codegen model can use them as reference — including DeepSeek, which has no vision support
    at all. Never raises: a failed/oversized image is skipped rather than blocking generation."""
    descriptions: list[str] = []
    for idx, data_url in enumerate((data_urls or [])[:MAX_CODING_ATTACHMENTS], start=1):
        if not data_url or len(data_url) > MAX_ATTACHMENT_DATA_URL_CHARS or not _DATA_URL_RE.match(data_url.strip()):
            continue
        try:
            response = await vibe_pipeline.generate(
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Descrivi questo screenshot per un frontend engineer che deve modificare "
                                "un'app React in base a questo riferimento: layout, componenti visibili, "
                                "testi, colori, e ogni difetto o elemento rilevante per la richiesta dello "
                                "studente. Sii preciso e conciso. Rispondi in italiano."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": data_url.strip()}},
                    ],
                }],
                provider=model_roles.provider_for("vision"),
                model=model_roles.model_for("vision"),
                temperature=0.2,
                max_tokens=500,
                allow_web_search=False,
            )
            descriptions.append(f"[Screenshot {idx}]\n{response.content}")
        except Exception as exc:
            logger.warning("attachment vision analysis skipped (%s)", exc)
    if not descriptions:
        return ""
    return (
        "\n\nScreenshot allegati dallo studente (analizzati automaticamente, usali come riferimento "
        "visivo per la richiesta):\n\n" + "\n\n".join(descriptions)
    )


async def _repair_failed_patches(files: dict[str, dict], failed: dict[str, list]) -> dict[str, str]:
    """Re-apply SEARCH/REPLACE edits that did not match, one file at a time. Returns {path: content}
    for the files it could rewrite; never raises (a failed repair leaves the file as it was)."""
    repaired: dict[str, str] = {}
    for path, items in list(failed.items())[:6]:
        current = str((files.get(path) or {}).get("content") or "")
        edits = "\n\n".join(
            f"MODIFICA {index} ({reason}):\nSEARCH:\n{search}\nREPLACE:\n{replace}"
            for index, (search, replace, reason) in enumerate(items, start=1)
        )
        try:
            response = await _coding_generate(
                messages=[{"role": "user", "content": f"FILE: {path}\n\nCONTENUTO ATTUALE:\n{current}\n\nMODIFICHE PREVISTE:\n{edits}"}],
                system_prompt=PATCH_REPAIR_SYSTEM_PROMPT,
                temperature=0.1,
                max_tokens=48000,
            )
            for item in _parse_delimited_files(response.content or ""):
                if str(item.get("path") or "").lstrip("/") == path and str(item.get("content") or "").strip():
                    repaired[path] = str(item["content"])
        except Exception as exc:
            logger.warning("patch repair failed for %s (%s)", path, exc)
    return repaired


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
            max_tokens=32000,
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
    return vibe_output.recover_files(text)


async def _continue_missing_files(
    original_user: str, done_files: list[dict], missing: list[str], provider: str, model: str,
) -> list[dict]:
    """Second pass after an output-limit cutoff: write ONLY the files the first pass never finished,
    coherent with the ones it did finish. Best effort — returns [] on any failure."""
    written = "\n\n".join(f"=== FILE: {f['path']} ===\n{f['content']}\n=== END ===" for f in done_files)
    prompt = (
        f"{original_user}\n\n"
        "La generazione precedente e` stata interrotta per limite di lunghezza.\n"
        f"FILE GIA` COMPLETATI (non riscriverli, usa i loro export reali):\n{written or '(nessuno)'}\n\n"
        "Scrivi ORA, completi e funzionanti, SOLO questi file mancanti: " + ", ".join(missing) + ".\n"
        "Niente ragionamento. Formato per ogni file: riga '=== FILE: percorso ===', contenuto, riga '=== END ==='.\n"
        "Mantieni ogni file sotto le 350 righe; se serve, sii piu` compatto."
    )
    try:
        response = await vibe_pipeline.generate(phase="missing_files",
            messages=[{"role": "user", "content": prompt}],
            system_prompt=_codegen_prompt(model),
            provider=provider,
            model=model,
            temperature=0.2,
            max_tokens=64000,
            allow_web_search=False,
        )
    except Exception as exc:
        logger.warning("continuation of truncated generation failed (%s)", exc)
        return []
    text = response.content or ""
    if "@@FILES@@" in text:
        text = text.split("@@FILES@@", 1)[1]
    parsed = _parse_delimited_files(text)
    wanted = set(missing)
    return [f for f in parsed if f["path"] in wanted]


GATE_REPAIR_HEAD = """Sei un senior front-end engineer dentro Golinelli.ai. Il progetto React che ricevi NON supera il
controllo di build deterministico della piattaforma: vedi sotto gli errori reali con file:riga. Correggili TUTTI
facendo il MINIMO cambiamento necessario, senza cambiare cio' che l'app fa ne' ridurre le funzioni del brief.
- Import non risolto: correggi il percorso (maiuscole/minuscole, estensione, cartella) oppure CREA il file mancante
  completo e coerente con come viene usato. Export non trovato: allinea default/named export tra i due file.
- Pacchetto non dichiarato/non consentito: se e' nell'elenco consentito aggiungilo a package.json (con la versione
  indicata), altrimenti riscrivi la parte senza quella libreria.
- Errore di sintassi: riscrivi il file completo e bilanciato, senza "..." ne' commenti tipo "resto invariato".
- Non toccare i file non coinvolti. Non scrivere index.html, index.tsx, main.tsx ne' file .md.

FORMATO DI OUTPUT — nessun testo fuori, nessun backtick: per ogni file da cambiare o creare
=== FILE: percorso ===
<contenuto COMPLETO del file>
e in fondo una riga === END ===.

"""


QUALITY_REPAIR_HEAD = """Sei un senior front-end engineer e designer dentro Golinelli.ai. L'app React che ricevi COMPILA, ma il controllo di
qualita' (browser vero, TypeScript, schermi mobile/desktop, flussi d'uso, revisione visiva) ha trovato i difetti elencati sotto.
Correggili TUTTI nei file indicati con il MINIMO cambiamento necessario, senza ridurre le funzioni del brief e senza cambiare i nomi
degli export usati da altri file.
- Errore di tipo/runtime: correggi la causa (proprieta' inesistente, argomenti, null/undefined), non silenziarlo con `any`.
- Scorrimento orizzontale / mobile: max-width:100%, flex-wrap, griglie che collassano, niente larghezze fisse in px sopra 360.
- Flusso che non riesce: la funzione deve esistere e il controllo che la avvia deve essere raggiungibile e con testo coerente.
- Controlli che non fanno nulla: collegali a un effetto visibile oppure rimuovili.
- Difetti visivi/estetici: rispetta la direzione artistica del brief (font, :root), gerarchia, spaziatura, immagini; niente emoji come icone.
- Mantieni ogni classe usata nel JSX definita in un CSS.
- Non toccare i file non coinvolti. Non scrivere index.html, index.tsx, main.tsx ne' file .md.

FORMATO DI OUTPUT — nessun testo fuori, nessun backtick: per ogni file da cambiare o creare
=== FILE: percorso ===
<contenuto COMPLETO del file>
e in fondo una riga === END ===.

"""


async def _gate_repair(
    files: list[dict], issues: list, provider: str, model: str, brief: str, head: str | None = None,
) -> tuple[list[dict], list[str], int, int]:
    """One targeted repair call for the issues the build gate found. Returns (files, changed_paths,
    prompt_tokens, completion_tokens). Never raises: on failure the files come back unchanged."""
    by_path = {str(f.get("path") or ""): f for f in files}
    involved: list[str] = []
    for issue in issues:
        if issue.file in by_path and issue.file not in involved:
            involved.append(issue.file)
    if any(i.rule in {"missing-app", "app-default-export"} for i in issues) and "App.tsx" in by_path and "App.tsx" not in involved:
        involved.append("App.tsx")
    if any(i.rule == "undeclared-package" for i in issues) and "package.json" in by_path and "package.json" not in involved:
        involved.append("package.json")
    involved = involved[:6]
    issue_list = "\n".join(f"- {i.describe()}" for i in issues[:25])
    existing = "\n".join(sorted(p for p in by_path if not p.lower().endswith(".md")))
    bundle = "\n\n".join(f"=== FILE: {p} ===\n{str(by_path[p].get('content') or '')[:14000]}" for p in involved) or "(nessuno)"
    allowed = ", ".join(f"{name}@{version}" for name, version in sorted(ALLOWED_NPM_PACKAGES.items()))
    user = (
        f"ERRORI DI BUILD:\n{issue_list}\n\nFILE PRESENTI NEL PROGETTO:\n{existing}\n\n"
        f"PACCHETTI CONSENTITI (con versione): {allowed}\n\n{brief}\n\nFILE COINVOLTI:\n{bundle}"
    )
    try:
        response = await vibe_pipeline.generate(phase="build_repair",
            messages=[{"role": "user", "content": user}],
            system_prompt=(head or GATE_REPAIR_HEAD) + vibe_contract.contract_for(model),
            provider=provider,
            model=model,
            temperature=0.1,
            max_tokens=64000,
            allow_web_search=False,
        )
    except Exception as exc:
        logger.warning("build gate repair failed (%s)", exc)
        return files, [], 0, 0
    fixed = [
        f for f in _parse_delimited_files(response.content or "")
        if not _platform_owned_path(f["path"])
    ]
    est = build_estimated_token_usage([{"role": "user", "content": user}], response.content or "")
    if not fixed:
        return files, [], est["prompt_tokens"], est["completion_tokens"]
    for item in fixed:
        by_path[item["path"]] = item
    return list(by_path.values()), [item["path"] for item in fixed], est["prompt_tokens"], est["completion_tokens"]


# --- Quality loop: measure the real app, rank the defects, fix, re-measure, keep the best ---------------------

STYLIST_PROMPT = """Sei un front-end designer senior dentro Golinelli.ai. Un componente React usa classi CSS che NESSUNO ha scritto:
la pagina appare senza layout. Scrivi SOLO CSS puro (nessun markdown, nessun backtick, nessuna spiegazione) con UNA regola per OGNI
classe elencata, coerente con il componente (leggi il JSX per capire struttura e ruolo di ogni classe).
- Layout reale: grid/flex, gap, allineamenti, larghezze massime, immagini con aspect-ratio e object-fit, nessuna larghezza fissa sopra 360px.
- Tipografia con gerarchia (dimensioni, pesi, interlinea) e spaziatura a scala 4/8 usando SOLO le variabili :root fornite
  (colori, font, raggio, ombra): mai esadecimali nuovi se esiste una variabile equivalente.
- Stati :hover, :focus-visible, :disabled dove ha senso; transizioni 150-250ms; barre/anelli di punteggio con la variabile d'accento.
- Un blocco @media (max-width: 720px) che fa collassare le griglie in colonna e riduce spaziature e titoli.
- Rispetta la direzione artistica (carattere, raggio, ombra) dei token: niente stile generico."""

_CSS_FENCE = re.compile(r"^```[a-z]*\n|\n```\s*$", re.M)


def _design_root(files: list[dict]) -> str:
    css = next((str(f.get("content") or "") for f in files if str(f.get("path") or "") == "styles.css"), "")
    imports = "\n".join(re.findall(r"@import[^;]+;", css)[:3])
    root = re.search(r":root\s*\{[^}]*\}", css, re.S)
    return (imports + "\n" + (root.group(0) if root else ""))[:4500]


async def _stylist(files: list[dict], gaps: dict[str, list[str]], provider: str, model: str) -> tuple[list[dict], list[str]]:
    """Write the CSS rules components use but no stylesheet defines: one agent per component, in parallel, appended to styles.css."""
    by_file: dict[str, list[str]] = {}
    for name, paths in gaps.items():
        by_file.setdefault(paths[0], []).append(name)
    by_path = {str(f.get("path") or ""): f for f in files}
    tokens = _design_root(files)
    base_css = str(by_path.get("styles.css", {}).get("content") or "")
    defined = ", ".join(sorted(set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", base_css)))[:90])

    async def one(path: str, names: list[str]) -> tuple[str, str]:
        user = (f"TOKEN DI DESIGN (styles.css):\n{tokens}\n\nCLASSI GIA' DEFINITE (non ridefinirle): {defined or '(poche)'}\n\n"
                f"COMPONENTE {path}:\n{str(by_path[path].get('content') or '')[:9000]}\n\nCLASSI DA STILARE (una regola ciascuna, tutte obbligatorie): {', '.join(names)}")
        response = await vibe_pipeline.generate(phase="stylist", messages=[{"role": "user", "content": user}], system_prompt=STYLIST_PROMPT,
            provider=provider, model=model, temperature=0.3, max_tokens=32000, allow_web_search=False)
        css = _CSS_FENCE.sub("", (response.content or "").strip()).strip()
        covered = sum(1 for n in names if re.search(r"\." + re.escape(n) + r"(?![\w-])", css))
        if css.count("{") != css.count("}") or covered < max(1, len(names) // 2):
            raise ValueError(f"CSS non valido per {path} ({covered}/{len(names)} classi)")
        return path, css

    results = await asyncio.gather(*(one(path, names) for path, names in list(by_file.items())[:8]), return_exceptions=True)
    additions = [f"/* ── stili di {r[0]} ── */\n{r[1]}" for r in results if not isinstance(r, Exception)]
    for r in results:
        if isinstance(r, Exception):
            logger.warning("stylist failed (%s)", r)
    if not additions:
        return files, []
    merged = (base_css.rstrip() + "\n\n" if base_css else "") + "\n\n".join(additions) + "\n"
    out = [f for f in files if str(f.get("path") or "") != "styles.css"] + [{"path": "styles.css", "content": merged, "language": "css"}]
    return out, ["styles.css"]


VIBE_CRITIC_PROMPT = """Sei un art director e QA lead senior, esigente come un cliente che paga. Ricevi gli screenshot REALI dell'app
(mobile e desktop), le misure automatiche e il brief. Giudica l'app finita, non il codice.
Valuta: gerarchia e composizione (si capisce subito cosa fare?), tipografia, colore e coerenza con la direzione di stile del brief,
spaziatura e allineamenti, immagini (presenti, pertinenti, non sgranate), mobile realmente usabile, contenuti veri (niente segnaposto),
completezza rispetto alle funzioni F1..Fn del brief visibili in schermata, e segni di pagina "da template AI" (card tutte uguali, contenuto a
filo bordo, bottoni senza gerarchia, emoji al posto di icone, numeri nudi senza visualizzazione).
Nel QA i servizi AI sono finti: le immagini generate sono SEGNAPOSTO a gradiente (la foto vera arriva in produzione) e le risposte AI sono testi
di prova. NON penalizzare il segnaposto in se', ma giudica spazio, formato e cornice riservati e che sia gestito con eleganza. I font web
vengono caricati davvero: se il carattere non e' quello del brief e' un difetto reale. Hai anche gli screenshot degli schermi raggiunti
usando l'app (esito dei flussi): giudica anche quelli, non solo la prima pagina.
Rispondi SOLO con JSON valido:
{"score": 0-100, "verdict": "una frase", "defects": [{"severity": "major"|"minor", "area": "layout|tipografia|colore|immagini|gerarchia|responsive|contenuto|funzioni", "problem": "cosa non va, concreto", "fix": "cosa fare, concreto", "file": "percorso piu' probabile (styles.css, App.tsx, components/X.tsx)"}]}
Massimo 8 difetti, i piu' importanti. "major" SOLO per cio' che un utente nota subito (layout rotto, testo illeggibile, sezioni vuote, funzioni
del brief assenti, aspetto generico, immagini mancanti, mobile inservibile). Se l'app e' ottima, score alto e difetti vuoti."""

ACCEPTANCE_AUTHOR_PROMPT = """Sei un QA engineer. Ricevi le funzioni del brief (F1..Fn) e il codice REALE dell'app (con le etichette dei controlli).
Scrivi fino a 6 test di accettazione end-to-end, ognuno un percorso d'uso reale su una o piu' funzioni, nel DSL JSON:
{"do":"click","text":"etichetta"} | {"do":"fill","label"|"placeholder":"...","value":"..."} | {"do":"select","label":"...","value":"..."} |
{"do":"check","label":"..."} | {"do":"press","key":"Enter"} | {"do":"wait","ms":300} | {"do":"expectText","text":"..."} |
{"do":"expectNotText","text":"..."} | {"do":"expectVisible","text":"..."|"selector":"..."} | {"do":"expectCount","selector":"...","min":N}.
USA SOLO testi, etichette e placeholder che compaiono nel codice, copiati alla lettera. Niente azioni distruttive (elimina/reset).
Ogni test: 3-10 passi e almeno un expect finale che prova l'esito (risultato mostrato, elemento comparso, schermata cambiata).
Rispondi SOLO con un array JSON: [{"id":"T1","feature":"F1","title":"...","steps":[...]}]"""


def _image_parts(provider: str, shots: list[tuple[str, str]]) -> list[dict]:
    parts: list[dict] = []
    for name, data_url in shots:
        parts.append({"type": "text", "text": f"Screenshot {name.upper()}:"})
        if provider == "anthropic":
            media, _, b64 = data_url.partition(";base64,")
            parts.append({"type": "image", "source": {"type": "base64", "media_type": media.replace("data:", "") or "image/jpeg", "data": b64}})
        else:
            parts.append({"type": "image_url", "image_url": {"url": data_url}})
    return parts


def _report_shots(report: dict, limit: int = 6) -> list[tuple[str, str]]:
    """Screens of the real app: mobile + desktop landing, then the screens a user reaches (end of tested flows, else crawler states)."""
    viewports = (report.get("runtime") or {}).get("viewports") or []
    shots = [(vp["name"], vp["screenshot"]) for vp in viewports if vp.get("screenshot")]
    if not shots:
        return []
    flow_shots = [(f"esito del flusso {t.get('feature') or t.get('id')}: {str(t.get('title') or '')[:60]}", t["screenshot"]) for t in report.get("acceptance") or [] if t.get("screenshot")]
    if not flow_shots:
        flow_shots = [(f"dopo aver premuto «{st.get('after')}»", st["screenshot"]) for st in (report.get("crawl") or {}).get("stateShots", [])]
    return (shots + flow_shots)[:limit]


VISUAL_FIX_HEAD = """Sei un front-end designer senior dentro Golinelli.ai. Hai davanti gli screenshot REALI dell'app (mobile, desktop e schermi
raggiunti usando l'app) e l'elenco dei difetti trovati dal revisore. Correggili guardando cosa vedi: l'obiettivo e' che gli stessi
screenshot, rifatti dopo la tua modifica, risultino curati.
- Lavora soprattutto sul CSS (e sul JSX solo se la struttura lo richiede): griglie con il numero giusto di colonne e altezze uniformi
  (align-items, aspect-ratio, object-fit), barre sticky che non coprono il contenuto (padding-bottom sul contenitore, safe area), etichette
  non tagliate (overflow-wrap, line-clamp consapevole), controlli con stile del progetto (font, colore, raggio dai token :root), gerarchia
  tipografica, spaziatura, mobile senza scorrimento orizzontale.
- Rispetta la direzione artistica del brief e i token :root: nessun nuovo colore o font fuori dal sistema.
- Mantieni i nomi delle classi e gli export usati altrove; ogni classe usata nel JSX deve restare definita.
- Cambia SOLO cio' che serve ai difetti elencati. Non toccare index.html/index.tsx/main.tsx ne' file .md.

FORMATO DI OUTPUT — nessun testo fuori, nessun backtick: per ogni file da cambiare
=== FILE: percorso ===
<contenuto COMPLETO del file>
e in fondo una riga === END ===.
"""


async def _visual_fix(files: list[dict], defects: list, report: dict, provider: str, model: str) -> tuple[list[dict], list[str]]:
    """The reviewer model fixes what it SEES: screenshots + defects + the involved files (CSS first). Never raises."""
    shots = _report_shots(report, 5)
    if not shots:
        return files, []
    by_path = {str(f.get("path") or ""): f for f in files}
    involved: list[str] = []
    for d in defects:
        for path in [d.file, (d.file or "").rsplit(".", 1)[0] + ".css"]:
            if path in by_path and path not in involved:
                involved.append(path)
    for path in sorted(by_path):  # stylesheets are where visual fixes land
        if path.endswith(".css") and path not in involved:
            involved.append(path)
    bundle = "\n\n".join(f"=== FILE: {p} ===\n{str(by_path[p].get('content') or '')[:16000]}" for p in involved[:9])[:60000]
    listing = "\n".join(f"- [{d.severity}] {d.message}" + (f" — {d.fix}" if d.fix else "") + (f" (file: {d.file})" if d.file else "") for d in defects)
    intro = f"DIFETTI DA CORREGGERE:\n{listing}\n\nFILE DEL PROGETTO:\n{bundle}"
    try:
        response = await vibe_pipeline.generate(phase="visual_fix", messages=[{"role": "user", "content": [{"type": "text", "text": intro}] + _image_parts(provider, shots)}],
            system_prompt=VISUAL_FIX_HEAD + vibe_contract.contract_for(model), provider=provider, model=model, temperature=0.1, max_tokens=16000, allow_web_search=False)
    except Exception as exc:
        logger.warning("visual fix failed (%s)", exc)
        return files, []
    fixed = [f for f in _parse_delimited_files(response.content or "") if not _platform_owned_path(f["path"])]
    if not fixed:
        return files, []
    merged = {**by_path, **{f["path"]: f for f in fixed}}
    return list(merged.values()), [f["path"] for f in fixed]


def _progress_key(card: dict) -> tuple[int, int, int]:
    """Lexicographic progress: fewer blockers, then fewer major defects, then the higher (noisier) overall score."""
    counts = card.get("defects") or {}
    return (counts.get("blocker", 0), counts.get("major", 0), -int(card.get("overall") or 0))


async def _visual_critic(files: list[dict], report: dict, brief: str, provider: str, model: str) -> dict | None:
    shots = _report_shots(report)
    if not shots:
        return None
    viewports = (report.get("runtime") or {}).get("viewports") or []
    measures = "; ".join(f"{vp['name']}: testo {vp.get('textLength')} car, {vp.get('interactive')} controlli, {vp.get('images')} immagini, overflowX={vp.get('overflowX')}" for vp in viewports if not vp.get("error"))
    coverage = vibe_qa.css_coverage(files)
    intro = f"{brief[:9000]}\n\nMISURE AUTOMATICHE: {measures}. Classi CSS usate/stilate: {coverage[1]}/{coverage[0]}.\nFile del progetto: {', '.join(str(f.get('path')) for f in files if not str(f.get('path')).endswith('.md'))}"
    try:
        response = await vibe_pipeline.generate(phase="critic", messages=[{"role": "user", "content": [{"type": "text", "text": intro}] + _image_parts(provider, shots)}],
            system_prompt=VIBE_CRITIC_PROMPT, provider=provider, model=model, temperature=0.2, max_tokens=3500, allow_web_search=False)
        data = _extract_json_object(response.content or "")
    except Exception as exc:
        logger.warning("visual critic failed (%s)", exc)
        return None
    defects = []
    paths = {str(f.get("path")) for f in files}
    for item in (data.get("defects") or [])[:8]:
        if not isinstance(item, dict) or not str(item.get("problem") or "").strip():
            continue
        area = str(item.get("area") or "")[:20]
        file = str(item.get("file") or "")
        if file not in paths:
            file = "styles.css" if area in {"layout", "tipografia", "colore", "responsive", "gerarchia"} else "App.tsx"
        defects.append(vibe_qa.Defect("major" if item.get("severity") == "major" else "minor", "visual", f"{area}: {str(item['problem'])[:300]}", file, fix=str(item.get("fix") or "")[:300]))
    try:
        score = max(0, min(100, int(float(data.get("score")))))
    except Exception:
        score = None
    return {"score": score, "verdict": str(data.get("verdict") or "")[:240], "defects": defects}


async def _author_acceptance_tests(files: list[dict], reqs: list[tuple[str, str]], provider: str, model: str, previous: list[dict] | None = None) -> list[dict]:
    code = "\n\n".join(f"=== {f['path']} ===\n{str(f.get('content') or '')[:7000]}" for f in files if str(f.get("path") or "").endswith((".tsx", ".jsx", ".ts")))[:42000]
    listing = "\n".join(f"- {rid}: {text}" for rid, text in reqs) or "(nessuna funzione numerata: deduci i percorsi principali dall'app)"
    try:
        before = ("\n\nTEST DEL GIRO PRECEDENTE (mantieni gli stessi percorsi d'uso, ma riscrivi i passi con le etichette del codice ATTUALE):\n"
                  + "\n".join(f"- {t.get('feature')}: {t.get('title')}" for t in previous)) if previous else ""
        response = await vibe_pipeline.generate(phase="qa_author", messages=[{"role": "user", "content": f"FUNZIONI DEL BRIEF:\n{listing}\n\nCODICE:\n{code}{before}"}],
            system_prompt=ACCEPTANCE_AUTHOR_PROMPT, provider=provider, model=model, temperature=0.2, max_tokens=8000, allow_web_search=False)
        return vibe_qa.clean_tests(_extract_json_array(response.content or ""))
    except Exception as exc:
        logger.warning("acceptance authoring failed (%s)", exc)
        return []


def _defects_to_issues(defects: list) -> list:
    return [vibe_gate.Issue(d.file or "App.tsx", d.message + (f" — {d.fix}" if d.fix else ""), line=d.line, rule=f"qa-{d.kind}",
                            severity="error" if d.severity != "minor" else "warn") for d in defects]


QUALITY_ROUNDS = 3


async def _quality_loop(files: list[dict], *, reqs: list[tuple[str, str]], brief: str, brief_reminder: str, writer: tuple[str, str], architect: tuple[str, str], run, rounds: int = QUALITY_ROUNDS, focus: str = ""):
    """Async generator of ("sse", frame) and a final ("result", {...}). Measures the real app in a browser, ranks the defects,
    fixes them, re-measures and keeps the best version. Each fix starts from the best version so far (a regression is discarded,
    not built upon). Cheap writer first, stronger models after; visual defects are fixed by the reviewer, which sees the screenshots.
    Never raises; absent QA leaves the project unchanged."""
    result = {"files": files, "scorecard": None, "rounds": [], "tests": 0, "ran": False}
    if focus:
        brief = brief + f"\n\nPRIORITA' INDICATA DALL'UTENTE per questa rifinitura: {focus}"
    if not vibe_qa.available():
        yield ("result", result)
        return
    critic = model_roles.pair_for("coding.critic")
    if not model_selection.provider_keys().get(critic[0]):
        critic = architect
    best: dict | None = None  # {"key", "files", "card", "defects", "report"}
    current = files
    tests: list[dict] = []
    stalls = 0
    try:
        for round_no in range(1, rounds + 1):
            try:
                if run.timeout(10 ** 6) < 240:
                    yield ("sse", {"type": "status", "message": "Tempo quasi esaurito: chiudo con la versione migliore finora."})
                    break
            except TimeoutError:
                break
            yield ("sse", {"type": "status", "message": f"Controllo qualità, giro {round_no}/{rounds}: apro l'app in un browser vero (mobile, desktop e percorsi d'uso)..."})
            # Tests are rewritten every round against the CURRENT labels: a fix that renames a button must not look like a broken flow.
            async for kind, value in _heartbeat_await(_author_acceptance_tests(current, reqs, critic[0], critic[1], previous=tests)):
                if kind == "ping": yield ("sse", {"type": "ping"})
                else: tests = value or tests
            report = None
            async for kind, value in _heartbeat_await(vibe_qa.run(current, tests)):
                if kind == "ping": yield ("sse", {"type": "ping"})
                else: report = value
            if report is None:
                run.recovery.append({"reason": "qa_unavailable"})
                yield ("sse", {"type": "status", "message": "Il controllo in browser non e' disponibile: salto la verifica visiva."})
                break
            result["ran"] = True
            defects = vibe_qa.defects_from_report(report, current)
            visual = None
            async for kind, value in _heartbeat_await(_visual_critic(current, report, brief, critic[0], critic[1])):
                if kind == "ping": yield ("sse", {"type": "ping"})
                else: visual = value
            if visual:
                defects += visual["defects"]
                defects.sort(key=lambda d: {"blocker": 0, "major": 1, "minor": 2}[d.severity])
            card = vibe_qa.scorecard(report, current, defects, visual)
            result["rounds"].append({"round": round_no, "overall": card["overall"], "defects": card["defects"], "css_coverage": card["css_coverage"]})
            result["tests"] = len(tests)
            yield ("sse", {"type": "quality", "round": round_no, "rounds": rounds, "score": card, "defects": [d.to_dict() for d in defects[:8]],
                           "verdict": (visual or {}).get("verdict", ""),
                           "screenshot": next((vp.get("screenshot") for vp in (report.get("runtime") or {}).get("viewports", []) if vp.get("name") == "desktop"), None)})
            key = _progress_key(card)
            improved = best is None or key < best["key"]
            if improved:
                best = {"key": key, "files": current, "card": card, "defects": defects, "report": report}
                stalls = 0
            else:
                stalls += 1
                yield ("sse", {"type": "status", "message": "Questa correzione non ha migliorato l'app: riparto dalla versione migliore."})
            if vibe_qa.is_good(best["card"], best["defects"]) or round_no == rounds or stalls >= 2:
                break
            # Fix from the best version so far, with the defects measured ON that version.
            base, base_defects, base_report = best["files"], best["defects"], best["report"]
            serious = [d for d in base_defects if d.severity != "minor"] or base_defects
            yield ("sse", {"type": "status", "message": f"Trovati {len(base_defects)} problemi ({best['card']['defects']['blocker'] + best['card']['defects']['major']} gravi, punteggio {best['card']['overall']}/100): li correggo..."})
            fixer = writer if round_no == 1 and stalls == 0 else architect
            fixed = base
            gaps = vibe_qa.css_gaps(fixed)
            if gaps:
                async for kind, value in _heartbeat_await(_stylist(fixed, gaps, writer[0], writer[1])):
                    if kind == "ping": yield ("sse", {"type": "ping"})
                    else: fixed, _ = value
            code_defects = [d for d in serious if d.kind not in ("css", "visual", "responsive")][:12]
            if code_defects:
                async for kind, value in _heartbeat_await(_gate_repair(fixed, _defects_to_issues(code_defects), fixer[0], fixer[1], brief_reminder, head=QUALITY_REPAIR_HEAD)):
                    if kind == "ping": yield ("sse", {"type": "ping"})
                    else: fixed = value[0]
            sight_defects = [d for d in base_defects if d.kind in ("visual", "responsive") and d.severity != "minor"][:10] or [d for d in base_defects if d.kind in ("visual", "responsive")][:6]
            if sight_defects:
                yield ("sse", {"type": "status", "message": "Il revisore corregge cio' che vede negli screenshot..."})
                async for kind, value in _heartbeat_await(_visual_fix(fixed, sight_defects, base_report, critic[0], critic[1])):
                    if kind == "ping": yield ("sse", {"type": "ping"})
                    else: fixed = value[0]
            fixed, _ = _sanitize_package_json(fixed)
            fixed, _ = _autodeclare_packages(fixed)
            gate_ok = True
            async for kind, value in _heartbeat_await(vibe_gate.check_project(fixed, set(ALLOWED_NPM_PACKAGES))):
                if kind == "ping": yield ("sse", {"type": "ping"})
                else: gate_ok = not vibe_gate.blocking(value[0])
            if not gate_ok or fixed == base:
                yield ("sse", {"type": "status", "message": "Le correzioni rompevano la build o non cambiavano nulla: tengo la versione migliore."})
                stalls += 1
                if stalls >= 2:
                    break
                current = base
                continue
            current = fixed
    except Exception as exc:  # the loop is an improvement, never a reason to lose the generation
        logger.warning("quality loop aborted (%s)", exc)
        run.recovery.append({"reason": "quality_loop_error", "error_type": type(exc).__name__})
    if best is not None:
        result.update(files=best["files"], scorecard=best["card"], defects=[d.to_dict() for d in best["defects"][:12]])
    yield ("result", result)


async def _conformance_stage(files: list[dict], spec_text: str, user_prompt: str, provider: str, model: str, brief_reminder: str):
    """Brief conformance: compare the code with the brief's F1..Fn, complete what is missing (one focused repair, discarded if it
    breaks the build) and verify again. Async generator of ("sse", frame) then ("result", (files, conformance))."""
    conformance: dict = {"checked": 0, "gaps": [], "repaired": []}
    reqs = vibe_verify.scoped_requirements(spec_text, user_prompt)
    if not reqs:
        yield ("result", (files, conformance))
        return
    conformance["checked"] = len(reqs)
    yield ("sse", {"type": "status", "message": f"Verifico che tutte le {len(reqs)} funzioni del brief siano presenti..."})
    gaps: list[dict] = []
    async for kind, value in _heartbeat_await(_verify_conformance(files, reqs)):
        if kind == "ping":
            yield ("sse", {"type": "ping"})
        else:
            gaps, _vp, _vc, valid = value
            conformance["verified"] = valid
    if gaps:
        yield ("sse", {"type": "status", "message": f"Mancano o sono incomplete {len(gaps)} funzioni ({', '.join(g['id'] for g in gaps)}): le completo..."})
        yield ("sse", {"type": "conformance", "gaps": gaps})
        before_files = files
        repaired: list[str] = []
        async for kind, value in _heartbeat_await(_conformance_repair(files, gaps, provider, model, brief_reminder)):
            if kind == "ping":
                yield ("sse", {"type": "ping"})
            else:
                files, repaired, _rp, _rc = value
        if repaired:
            files, _ = _sanitize_package_json(files)
            files, _ = _autodeclare_packages(files)
            post_issues: list = []
            async for kind, value in _heartbeat_await(vibe_gate.check_project(files, set(ALLOWED_NPM_PACKAGES))):
                if kind == "ping":
                    yield ("sse", {"type": "ping"})
                else:
                    post_issues, _ran = value
            if vibe_gate.blocking(post_issues) or _check_broken_imports(files):
                files, repaired = before_files, []
                yield ("sse", {"type": "status", "message": "Il completamento rompeva la build: lo scarto e segnalo le funzioni mancanti."})
            else:
                yield ("sse", {"type": "status", "message": f"Funzioni completate ({len(repaired)} file aggiornati)."})
        conformance["repaired"] = repaired
        conformance["gaps"] = gaps
        if repaired:  # a repair is not proof of conformance: verify the affected requirements again
            async for kind, value in _heartbeat_await(_verify_conformance(files, reqs)):
                if kind == "ping":
                    yield ("sse", {"type": "ping"})
                else:
                    final_gaps, _vp, _vc, valid = value
                    conformance["verified"] = valid
                    if valid:
                        conformance["gaps"] = final_gaps
            if conformance.get("verified") and not conformance["gaps"]:
                conformance["completed"] = [g["id"] for g in gaps]
    yield ("result", (files, conformance))


async def _verify_conformance(files: list[dict], reqs: list[tuple[str, str]]) -> tuple[list[dict], int, int, bool]:
    """Ask a verifier which brief features the code does not really implement. Never raises: [] on any failure."""
    listing = "\n".join(f"- {rid}: {text}" for rid, text in reqs)
    user = f"REQUISITI DEL BRIEF:\n{listing}\n\nCODICE DELL'APP:\n{vibe_verify.code_bundle(files)}"
    try:
        response = await asyncio.wait_for(
            _coding_generate(messages=[{"role": "user", "content": user}], system_prompt=vibe_verify.VERIFY_SYSTEM_PROMPT, temperature=0.0, max_tokens=3000, phase="brief_verify"),
            timeout=90,
        )
    except Exception as exc:
        logger.warning("brief conformance verify failed (%s)", exc)
        return [], 0, 0, False
    est = build_estimated_token_usage([{"role": "user", "content": user}], response.content or "")
    return vibe_verify.parse_gaps(response.content or "", reqs), est["prompt_tokens"], est["completion_tokens"], vibe_verify.valid_assessment(response.content or "", reqs)


async def _conformance_repair(
    files: list[dict], gaps: list[dict], provider: str, model: str, brief: str,
) -> tuple[list[dict], list[str], int, int]:
    """One repair call that implements the missing/partial features. Never raises: unchanged files on failure."""
    by_path = {str(f.get("path") or ""): f for f in files}
    allowed = ", ".join(f"{name}@{version}" for name, version in sorted(ALLOWED_NPM_PACKAGES.items()))
    user = (
        f"FUNZIONI DA IMPLEMENTARE (mancanti o incomplete):\n{vibe_verify.describe_gaps(gaps)}\n\n"
        f"PACCHETTI CONSENTITI (con versione): {allowed}\n\n{brief}\n\nPROGETTO ATTUALE:\n{vibe_verify.code_bundle(files)}"
    )
    try:
        response = await asyncio.wait_for(
            vibe_pipeline.generate(phase="brief_repair",
                messages=[{"role": "user", "content": user}],
                system_prompt=vibe_verify.CONFORMANCE_REPAIR_SYSTEM + vibe_contract.contract_for(model),
                provider=provider, model=model, temperature=0.2, max_tokens=64000, allow_web_search=False,
            ),
            timeout=240,
        )
    except Exception as exc:
        logger.warning("brief conformance repair failed (%s)", exc)
        return files, [], 0, 0
    fixed = [f for f in _parse_delimited_files(response.content or "") if not _platform_owned_path(f["path"])]
    est = build_estimated_token_usage([{"role": "user", "content": user}], response.content or "")
    if not fixed:
        return files, [], est["prompt_tokens"], est["completion_tokens"]
    for item in fixed:
        by_path[item["path"]] = item
    return list(by_path.values()), [item["path"] for item in fixed], est["prompt_tokens"], est["completion_tokens"]


# --- Parallel multi-agent build -------------------------------------------------------------
# A fresh project is NOT written by one serial LLM call. An architect first fixes the contract
# (file plan with exact exports, shared types, global styles, package.json); then 2-4 workers write
# disjoint groups of files concurrently. The contract is the only source of truth between workers,
# and the deterministic import check + the missing-file continuation catch any drift afterwards.

MAX_PARALLEL_WORKERS = 8

_PLATFORM_ENTRY_PATHS = {
    "index.tsx", "index.ts", "index.jsx", "index.js", "main.tsx", "main.ts", "main.jsx", "main.js",
    "golinelli-bridge.ts",
}


def _platform_owned_path(path: str) -> bool:
    """Files the platform injects or owns (HTML shell, React entry, KB markdown): models must not write them."""
    lower = (path or "").lower()
    return lower.endswith((".html", ".htm", ".md")) or lower in _PLATFORM_ENTRY_PATHS or ".." in lower.split("/")


ARCHITECT_FORMAT_INSTRUCTIONS = """

FORMATO PER QUESTA CHIAMATA (SOSTITUISCE il "FORMATO DI OUTPUT" descritto sopra): sei l'ARCHITETTO.
Altri worker scriveranno i componenti IN PARALLELO: tu fissi solo il contratto. NON scrivere i componenti.
1) Brevissimo ragionamento in italiano (piano, viste, scelte di design), MASSIMO 8 righe.
2) Una riga con ESATTAMENTE: @@PLAN@@
3) Una riga per ogni file da far scrivere ai worker (App.tsx incluso, assegnato al worker 1), formato esatto:
   <worker 1-8> | <percorso> | <scopo in 3-8 parole> | <export pubblici con firma completa>
   es. `2 | components/Header.tsx | barra di navigazione | export default function Header(props: { title: string; onNavigate: (view: View) => void })`
   Usa da 4 a 8 worker, AL MASSIMO 2 file per worker, file piccoli e focalizzati (max ~150 righe ciascuno):
   i worker scrivono in parallelo e il tempo totale e' quello del file piu' lungo, quindi piu' file corti = progetto pronto prima.
   Spezza le viste grandi in sotto-componenti. App.tsx deve restare SNELLO (solo stato di navigazione e composizione, max ~100 righe). Gli export del contratto sono
   l'UNICA fonte di verita': i worker li useranno alla lettera, quindi sii preciso su nomi, props e tipi.
4) Una riga con ESATTAMENTE: @@SHARED@@
5) I file condivisi, completi, nel formato `=== FILE: percorso ===`: types.ts (tutti i tipi/interfacce/costanti
   condivisi tra piu' file, SENZA dati di esempio voluminosi: cataloghi, domande e dati demo vanno in data.ts
   assegnato a un worker nel piano, con l'export dichiarato nel contratto), styles.css (SEGUE la DIREZIONE ARTISTICA del brief: @import dei due font Google, blocco :root completo con ruoli di colore,
   raggio, ombra e spaziatura, reset, body con margin 0, .container con max-width e padding laterale clamp(), gerarchia di bottoni .btn-primary/.btn-ghost,
   .card, badge, barre di punteggio, stati focus/hover, max 200 righe) e package.json solo se servono librerie oltre a react/react-dom.
5b) Se il progetto mostra immagini di soggetti concreti (prodotti, luoghi, persone, opere...) includi tra i file condivisi
   hooks/useGeneratedImage.ts ESATTAMENTE come nei SERVIZI REALI del prompt, e nel contratto dichiara
   `export function useGeneratedImage(key: string, prompt: string): { url: string | null; error: string | null; loading: boolean; retry: () => void }`.
   Se servono mappe, chat AI o analisi di immagini, assegna a un worker il componente che le usa e dichiara nel contratto le props.
6) Chiudi con una riga: === END ===
Non elencare nel piano i file condivisi del punto 5."""


WORKER_FORMAT_TEMPLATE = """

FORMATO PER QUESTA CHIAMATA (SOSTITUISCE il "FORMATO DI OUTPUT" descritto sopra): sei il WORKER {worker}.
Niente ragionamento, niente @@FILES@@. Scrivi SOLO questi file: {paths}.
Per ciascuno: una riga `=== FILE: percorso ===`, il contenuto completo, e dopo l'ULTIMO file una riga `=== END ===`.
Gli altri file del progetto li scrivono ALTRI worker in parallelo: rispetta il CONTRATTO alla lettera
(percorsi, nomi ed export esatti, props e tipi) e importa solo da file elencati nel contratto o condivisi.
Non ridefinire cio' che e' gia' nei file condivisi. Resta compatto: ogni file sotto le 150 righe (CSS gemello compreso, max ~70 righe: solo le classi che usi).
STILI (obbligatorio): per OGNI file .tsx che scrivi con `className`, scrivi anche il suo CSS gemello (stesso percorso, estensione .css,
es. `components/Card.tsx` -> `components/Card.css`) e importalo in cima al componente (`import './Card.css'`). Il CSS definisce TUTTE le
classi usate dal componente, con layout reale (grid/flex), spaziatura, gerarchia tipografica, stati hover/focus e un @media (max-width: 720px);
usa SOLO le variabili :root dei file condivisi (colori, font, raggio, spaziatura). Nessuna classe senza regola. App.tsx e le viste
seguono la stessa regola. I file .css gemelli vanno scritti con il loro `=== FILE: ... ===`, prima di `=== END ===`.

CONTRATTO (worker | file | scopo | export):
{contract}

FILE CONDIVISI GIA' SCRITTI (importali, non riscriverli):
{shared}"""


def _normalize_model_path(raw: str) -> str:
    """Paths as models write them: `./components/X.tsx`, `/App.tsx`, `src/App.tsx`, backticks, trailing colons."""
    path = (raw or "").strip().strip("`*\"' :").lstrip("/")
    while path.startswith("./"):
        path = path[2:]
    if path.startswith("src/"):
        path = path[4:]  # the project has no src/ folder: the layout normaliser would hoist it anyway
    return path


# Lines per live progress frame: the code inspector shows files while they are being written.
LIVE_LINES = 3


class _DelimitedFileParser:
    """Incremental parser for `=== FILE: path ===` ... `=== END ===` output. A file still open at the end
    of the stream (no END) hit the output limit: it is dropped and reported in `truncated_path`."""

    _FILE = re.compile(r"^===\s*FILE:\s*(.+?)\s*(?:===)?\s*$")
    _END = re.compile(r"^===\s*END\s*(?:===)?\s*$")

    def __init__(self) -> None:
        self.buffer = ""
        self.path: str | None = None
        self.lines: list[str] = []
        self.reported = -1
        self.files: list[dict] = []
        self.truncated_path: str | None = None

    def _close(self) -> list[dict]:
        events: list[dict] = []
        if self.path is not None:
            content = _strip_code_fences("\n".join(self.lines).strip("\n"))
            if content.strip():
                self.files.append({"path": self.path, "content": content, "language": _lang_for_path(self.path)})
                events.append({"type": "file_done", "path": self.path, "lines": content.count("\n") + 1, "content": content})
        self.path = None
        self.lines = []
        return events

    def _line(self, line: str) -> list[dict]:
        match = self._FILE.match(line)
        if match:
            events = self._close()
            raw = _normalize_model_path(match.group(1))
            self.lines = []
            self.reported = -1
            if _platform_owned_path(raw):
                self.path = None
            else:
                self.path = raw
                events.append({"type": "file_start", "path": raw, "op": "file"})
            return events
        if self._END.match(line):
            return self._close()
        if self.path is not None:
            self.lines.append(line)
            if len(self.lines) - self.reported >= LIVE_LINES:
                start = max(self.reported, 0)
                self.reported = len(self.lines)
                return [{"type": "file_progress", "path": self.path, "lines": len(self.lines),
                         "append": "\n".join(self.lines[start:]) + "\n"}]
        return []

    def feed(self, chunk: str) -> list[dict]:
        self.buffer += chunk
        events: list[dict] = []
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            events.extend(self._line(line))
        return events

    def finish(self) -> list[dict]:
        events: list[dict] = []
        if self.buffer:
            if not self._END.match(self.buffer):
                events.extend(self._line(self.buffer))
            self.buffer = ""
        if self.path is not None:
            # Models often forget the final END marker. A file whose brackets balance is complete; one cut
            # mid-expression (unbalanced) is a real output-limit truncation.
            if _looks_complete("\n".join(self.lines), self.path):
                events.extend(self._close())
            else:
                self.truncated_path = self.path
                logger.warning("delimited file %s judged truncated (%d lines); tail: %r", self.path, len(self.lines), "\n".join(self.lines)[-300:])
            self.path = None
            self.lines = []
        return events


def _looks_complete(content: str, path: str = "") -> bool:
    lower = path.lower()
    if lower.endswith(".css"):  # not JavaScript: apostrophes in comments/urls must not read as unterminated strings
        stripped = re.sub(r"/\*.*?\*/", "", content, flags=re.S).strip()
        return bool(stripped) and stripped.count("{") == stripped.count("}") and stripped.endswith(("}", ";"))
    if lower.endswith(".json"):
        try:
            json.loads(content)
            return True
        except ValueError:
            return False
    return vibe_output.looks_complete(content)


_PLAN_LINE = re.compile(r"^\s*[-*]?\s*`?(\d)`?\s*\|\s*`?([\w@./-]+\.[A-Za-z0-9]+)`?\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$")


def _parse_architect_plan(lines: list[str]) -> list[dict]:
    plan: list[dict] = []
    seen: set[str] = set()
    for line in lines:
        match = _PLAN_LINE.match(line)
        if not match:
            continue
        path = match.group(2).lstrip("/")
        if path in seen or _platform_owned_path(path):
            continue
        seen.add(path)
        worker = min(max(int(match.group(1)), 1), MAX_PARALLEL_WORKERS)
        plan.append({"worker": worker, "path": path, "purpose": match.group(3)[:160], "exports": match.group(4)[:400]})
    return plan


async def _parallel_build(user_context: str, provider: str, model: str, *, writer, brief: str = "", temperature: float = 0.4):
    """Async generator yielding ("sse", payload) frames, then one ("result", dict).
    result = {"ok": bool, "generated": [...], "reasoning": [...], "plan": [...], "raw": str, "prompt_chars": int}.
    ok=False means the architect output was unusable and the caller should fall back to a single call."""
    reasoning: list[str] = []
    plan_lines: list[str] = []
    shared_parser = _DelimitedFileParser()
    raw_parts: list[str] = []
    state = "reasoning"
    buffer = ""
    thinking_chars = 0

    def _count(text: str) -> None:
        nonlocal thinking_chars
        thinking_chars += len(text)

    def _consume_line(line: str):
        nonlocal state
        events: list[dict] = []
        if state == "reasoning":
            if "@@PLAN@@" in line:
                pre = line.split("@@PLAN@@", 1)[0]
                if pre.strip():
                    reasoning.append(pre)
                    events.append({"type": "reasoning", "content": pre + "\n"})
                state = "plan"
            else:
                reasoning.append(line)
                events.append({"type": "reasoning", "content": line + "\n"})
        elif state == "plan":
            if "@@SHARED@@" in line:
                state = "shared"
            else:
                plan_lines.append(line)
        else:
            events.extend(shared_parser.feed(line + "\n"))
        return events

    yield ("sse", {"type": "status", "message": "L'architetto definisce il contratto del progetto..."})
    architect_prompt = user_context + ARCHITECT_FORMAT_INSTRUCTIONS
    thinking_buffer: list[str] = []

    def _think(text: str) -> None:
        _count(text)
        thinking_buffer.append(text)

    def _drain_thinking():
        # The architect's hidden reasoning is shown live, so the user sees it work instead of a timer.
        if not thinking_buffer:
            return None
        text = "".join(thinking_buffer)
        thinking_buffer.clear()
        return {"type": "thinking", "content": text}

    async for kind, chunk in _heartbeat_stream(lambda: _coding_generate_stream(
        messages=[{"role": "user", "content": architect_prompt}],
        system_prompt=_codegen_prompt(model),
        provider=provider,
        model=model,
        temperature=temperature,
        max_tokens=56000, phase="architect",
        reasoning_sink=_think,
    ), interval=1.5):
        frame = _drain_thinking()
        if frame:
            yield ("sse", frame)
        if kind == "idle":
            detail = f" · {thinking_chars} caratteri di ragionamento" if thinking_chars else ""
            yield ("sse", {"type": "status", "message": f"L'architetto sta ragionando… {chunk}s{detail}"})
            continue
        raw_parts.append(chunk)
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            for event in _consume_line(line):
                yield ("sse", event)
    frame = _drain_thinking()
    if frame:
        yield ("sse", frame)
    if buffer:
        for event in _consume_line(buffer):
            yield ("sse", event)
    for event in shared_parser.finish():
        yield ("sse", event)

    architect_raw = "".join(raw_parts)
    plan = _parse_architect_plan(plan_lines)
    shared = list(shared_parser.files)
    if not plan or not any(item["path"] == "App.tsx" for item in plan):
        logger.warning("parallel architect plan unusable (state=%s, plan_lines=%d); tail: %r", state, len(plan_lines), "".join(raw_parts)[-600:])
        yield ("result", {"ok": False, "raw": "".join(raw_parts)})
        return

    yield ("sse", {"type": "plan", "files": [{"path": item["path"], "purpose": item["purpose"]} for item in plan[:30]]})
    shared_by_path = {f["path"]: f for f in shared}
    shared_text = "\n\n".join(f"=== FILE: {f['path']} ===\n{f['content']}" for f in shared) or "(nessuno)"
    contract = "\n".join(f"{item['worker']} | {item['path']} | {item['purpose']} | {item['exports']}" for item in plan)

    groups: dict[int, list[dict]] = {}
    for item in plan:
        groups.setdefault(item["worker"], []).append(item)
    # Re-number to a dense 1..K so no worker slot is empty.
    ordered = [groups[key] for key in sorted(groups)]
    yield ("sse", {"type": "status", "message": f"Contratto pronto. {len(ordered)} agenti scrivono {len(plan)} file in parallelo..."})

    written: dict[str, dict] = {}  # path -> file, only files assigned to the worker that wrote them
    prompt_chars = len(architect_prompt)

    async def run_wave(jobs: list[tuple[int, list[dict], str]], team=None):
        """Run writer agents in parallel, relaying their live file frames. jobs = (worker no., items, note)."""
        nonlocal prompt_chars
        queue: asyncio.Queue = asyncio.Queue()

        async def run_worker(number: int, items: list[dict], note: str) -> None:
            parser = _DelimitedFileParser()
            assigned = {item["path"] for item in items}
            assigned |= {item["path"].rsplit(".", 1)[0] + ".css" for item in items if item["path"].lower().endswith((".tsx", ".jsx"))}
            by_lower = {path.lower(): path for path in assigned}
            dropped: set[str] = set()

            def keep(event: dict) -> bool:
                path = event.get("path")
                if path in assigned:
                    return True
                if path and path.lower() in by_lower:  # wrong capitalisation: the planned path wins
                    event["path"] = by_lower[path.lower()]
                    return True
                if path and path not in dropped:
                    dropped.add(path)
                    logger.warning("parallel worker %s wrote %r which is not assigned to it (assigned: %s)", number, path, sorted(assigned))
                return False

            prompt = user_context + WORKER_FORMAT_TEMPLATE.format(
                worker=number, paths=", ".join(sorted(assigned)), contract=contract, shared=shared_text,
            ) + note
            try:
                async for chunk in _coding_generate_stream(
                    messages=[{"role": "user", "content": prompt}],
                    system_prompt=_codegen_prompt((team or writer)[1]),
                    provider=(team or writer)[0],
                    model=(team or writer)[1], phase="writer",
                    temperature=temperature,
                    max_tokens=128000,
                ):
                    raw_parts.append(chunk)
                    for event in parser.feed(chunk):
                        if keep(event):
                            await queue.put(("sse", event))
                for event in parser.finish():
                    if keep(event):
                        await queue.put(("sse", event))
            except Exception as exc:  # what is missing gets a second, smaller wave
                logger.warning("parallel worker %s failed (%s)", number, exc)
                for event in parser.finish():
                    if keep(event):
                        await queue.put(("sse", event))
            finally:
                for f in parser.files:
                    f_path = f["path"] if f["path"] in assigned else by_lower.get(f["path"].lower())
                    if f_path and f_path not in shared_by_path:
                        written[f_path] = {**f, "path": f_path}
                if parser.truncated_path:
                    logger.warning("parallel worker %s truncated %s", number, parser.truncated_path)
                await queue.put(("done", number))

        tasks = [asyncio.create_task(run_worker(*job)) for job in jobs]
        prompt_chars += sum(len(user_context) + len(contract) + len(shared_text) for _ in jobs)
        pending = len(tasks)
        try:
            while pending:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=SSE_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield {"type": "ping"}
                    continue
                if kind == "done":
                    pending -= 1
                else:
                    yield payload
        finally:
            for task in tasks:
                if not task.done(): task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async for frame in run_wave([(index + 1, items, "") for index, items in enumerate(ordered)]):
        yield ("sse", frame)

    # Second wave, right away and in parallel: every file a writer did not finish (output limit, provider
    # error) gets its own agent, so one long file never blocks the run on a slow serial continuation.
    lacking = [item for item in plan if item["path"] not in written]
    if lacking:
        yield ("sse", {"type": "status", "message": f"{len(lacking)} file incompleti: {min(len(lacking), MAX_PARALLEL_WORKERS)} agenti li riscrivono in parallelo..."})
        retry_note = ("\n\nNOTA: il tentativo precedente su questo file si e' interrotto prima della fine. Scrivi il file "
                      "COMPLETO ma compatto (niente commenti lunghi, niente dati ripetuti), chiudendo con === END ===.")
        jobs = [(len(ordered) + i + 1, [item], retry_note) for i, item in enumerate(lacking[:MAX_PARALLEL_WORKERS])]
        async for frame in run_wave(jobs):
            yield ("sse", frame)
        still_items = [item for item in plan if item["path"] not in written]
        if still_items:
            logger.warning("parallel build still lacks %s after the retry wave", [i["path"] for i in still_items])
            # Last resort, still silent for the user: a different provider (the architect's) writes what is left,
            # a few at a time, so a rate limit or a flaky writer never turns into a slow serial continuation.
            yield ("sse", {"type": "status", "message": f"Rifinisco gli ultimi {len(still_items)} file con un altro modello..."})
            jobs = [(len(ordered) + len(lacking) + i + 1, [item], retry_note) for i, item in enumerate(still_items[:3])]
            async for frame in run_wave(jobs, team=(provider, model)):
                yield ("sse", frame)
            left = [i["path"] for i in plan if i["path"] not in written]
            if left:
                logger.warning("parallel build still lacks %s after the architect wave", left)

    planned_paths = {item["path"] for item in plan}
    generated: list[dict] = list(shared_by_path.values()) + [written[item["path"]] for item in plan if item["path"] in written]
    generated += [f for path, f in written.items() if path not in planned_paths]  # companion stylesheets

    # Writers compile their own work: once every planned file exists, bundle the project and hand each
    # writer the build errors found in ITS files, all repaired in parallel on the writer model. Whatever
    # survives (or touches shared files) goes to the main build gate, whose second round uses the architect.
    # Skipped while files are missing: an import of a not-yet-written file is not the importer's bug.
    self_repaired: list[str] = []
    if {item["path"] for item in plan} <= {g["path"] for g in generated} and not shared_parser.truncated_path:
        yield ("sse", {"type": "status", "message": "Gli scrittori compilano il proprio lavoro..."})
        issues: list = []
        async for kind, value in _heartbeat_await(vibe_gate.check_project(generated, set(ALLOWED_NPM_PACKAGES))):
            if kind == "ping":
                yield ("sse", {"type": "ping"})
            else:
                issues, _ran = value
        owner = {item["path"]: index for index, items in enumerate(ordered) for item in items}
        by_worker: dict[int, list] = {}
        for issue in vibe_gate.blocking(issues):
            if issue.file in owner:
                by_worker.setdefault(owner[issue.file], []).append(issue)
        if by_worker:
            total = sum(len(v) for v in by_worker.values())
            yield ("sse", {"type": "status", "message": f"{total} errori di build: {len(by_worker)} scrittori correggono i propri file in parallelo..."})
            snapshot = list(generated)
            repairs: list = []
            async for kind, value in _heartbeat_await(asyncio.gather(*(
                _gate_repair(snapshot, worker_issues, writer[0], writer[1], brief) for worker_issues in by_worker.values()
            ))):
                if kind == "ping":
                    yield ("sse", {"type": "ping"})
                else:
                    repairs = value
            for index, (fixed_files, changed, _pt, _ct) in zip(by_worker, repairs):
                assigned = {item["path"] for item in ordered[index]}
                fixed_by_path = {str(f.get("path")): f for f in fixed_files}
                for path in changed:
                    if path not in assigned or path not in fixed_by_path:
                        continue  # a writer may only rewrite its own files
                    item = fixed_by_path[path]
                    generated = [g for g in generated if g["path"] != path] + [item]
                    self_repaired.append(path)
                    yield ("sse", {"type": "file_done", "path": path, "lines": str(item.get("content") or "").count("\n") + 1, "content": str(item.get("content") or "")})
    yield ("result", {
        "self_repaired": self_repaired,
        "ok": True,
        "generated": generated,
        "reasoning": reasoning,
        # A shared file cut by the output limit is listed too, so the continuation pass rewrites it.
        "plan": [item["path"] for item in plan] + ([shared_parser.truncated_path] if shared_parser.truncated_path else []),
        "raw": "".join(raw_parts),
        "architect_raw": architect_raw,
        "prompt_chars": prompt_chars,
    })


_DS_ROOT_RE = re.compile(r":root\s*\{[^}]*\}", re.DOTALL)


def _ensure_design_root(files: list[dict]) -> list[dict]:
    """Deterministic (LLM-free) design-system guard: the :root block of design-system.md must open styles.css."""
    ds = next((str(f.get("content") or "") for f in files if str(f.get("path") or "").lower() == "design-system.md"), "")
    match = next((m for m in _DS_ROOT_RE.finditer(ds) if "--ds-" in m.group(0)), None)
    if not match:
        return files
    out: list[dict] = []
    found = False
    for f in files:
        if str(f.get("path") or "") == "styles.css":
            found = True
            content = str(f.get("content") or "")
            if "--ds-" not in content:
                f = {**f, "content": match.group(0) + "\n\n" + content}
        out.append(f)
    if not found:
        out.append({"path": "styles.css", "content": match.group(0) + "\n", "language": "css"})
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
            max_tokens=64000,
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




def _extract_relative_imports(content: str) -> list[str]:
    """Relative import/require/dynamic-import targets ('./x', '../y'). Package imports and path
    aliases are out of scope — we can only verify paths that resolve inside the project itself."""
    return [spec for spec, _ in module_imports(content) if spec.startswith(".")]


def _import_resolves(base_path: str, import_path: str, existing: set[str]) -> bool:
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(base_path), import_path))
    if posixpath.splitext(import_path)[1]:
        # Explicit extension (.css, .svg, .json, ...): only an exact match counts.
        return resolved in existing
    candidates = [f"{resolved}{ext}" for ext in (".tsx", ".ts", ".jsx", ".js")]
    candidates += [posixpath.join(resolved, f"index{ext}") for ext in (".tsx", ".ts", ".jsx", ".js")]
    return any(c in existing for c in candidates)


def _check_broken_imports(files: list[dict]) -> list[dict]:
    """Scan .ts/.tsx/.js/.jsx files for relative imports that don't resolve to any file the model
    actually produced — the classic 'renamed/forgot a file mid-edit' breakage that otherwise only
    surfaces once the student hits the broken preview."""
    existing = {str(f.get("path") or "") for f in files}
    broken: list[dict] = []
    for f in files:
        path = str(f.get("path") or "")
        if not path.lower().endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        for imp in _extract_relative_imports(str(f.get("content") or "")):
            if not _import_resolves(path, imp, existing):
                broken.append({"file": path, "import": imp})
    return broken


async def _repair_broken_imports(files: list[dict], broken: list[dict]) -> tuple[list[dict], list[str]]:
    """One focused repair pass for the imports _check_broken_imports flagged: either fix a
    misspelled/misplaced import path or create the missing file with a minimal implementation.
    Returns (files, fixed_paths). Never raises — on any problem the original files come back
    unchanged and the caller flags the version for review instead of calling it 'ready'."""
    affected_paths = {b["file"] for b in broken}
    affected = [f for f in files if str(f.get("path") or "") in affected_paths]
    if not affected:
        return files, []
    try:
        broken_list = "\n".join(f"- {b['file']}: import rotto \"{b['import']}\"" for b in broken[:20])
        existing_list = "\n".join(
            sorted(str(f.get("path") or "") for f in files if not str(f.get("path") or "").lower().endswith(".md"))
        )
        bundle = "\n\n".join(
            f"=== FILE: {f.get('path')} ===\n{str(f.get('content') or '')[:12000]}" for f in affected
        )
        user = (
            f"Import rotti da correggere:\n{broken_list}\n\n"
            f"File realmente presenti nel progetto:\n{existing_list}\n\n"
            f"Contenuto dei file coinvolti:\n\n{bundle}"
        )
        response = await _coding_generate(
            messages=[{"role": "user", "content": user}],
            system_prompt=IMPORT_FIX_SYSTEM_PROMPT,
            temperature=0.1,
            max_tokens=32000,
        )
        fixed = _parse_delimited_files(response.content)
        fixed = [
            f for f in fixed
            if not str(f.get("path") or "").lower().endswith((".md", ".html", ".htm"))
            and str(f.get("path") or "").lower() not in _RESERVED_PATHS
        ]
        if not fixed:
            return files, []
        by_path = {str(f.get("path")): f for f in files}
        for c in fixed:
            by_path[c["path"]] = c
        return list(by_path.values()), [c["path"] for c in fixed]
    except Exception as exc:
        logger.warning("import repair pass skipped (%s)", exc)
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


def _safe_zip_path(path: str) -> str:
    clean = str(path or "").strip().replace("\\", "/").lstrip("/")
    parts = [part for part in clean.split("/") if part and part not in (".", "..")]
    return "/".join(parts)[:512]


def _project_uses_react(files: list[dict]) -> bool:
    return _is_react_files([
        {"path": str(file.get("path") or ""), "content": str(file.get("content") or "")}
        for file in files
    ])


def _json_file(files: list[dict], path: str) -> dict:
    for file in files:
        if str(file.get("path") or "").lstrip("/") == path:
            try:
                parsed = json.loads(str(file.get("content") or "{}"))
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}
    return {}


def _build_export_package_json(files: list[dict], title: str) -> str:
    existing = _json_file(files, "package.json")
    dependencies = dict(existing.get("dependencies") or {})
    dev_dependencies = dict(existing.get("devDependencies") or {})
    dependencies.setdefault("react", "^18.2.0")
    dependencies.setdefault("react-dom", "^18.2.0")
    dev_dependencies.setdefault("@vitejs/plugin-react", "^4.2.1")
    dev_dependencies.setdefault("typescript", "^5.3.3")
    dev_dependencies.setdefault("vite", "^5.0.11")
    package = {
        "name": _slugify(title),
        "version": "1.0.0",
        "private": True,
        "type": "module",
        "scripts": {
            "dev": "vite --host 0.0.0.0",
            "build": "tsc && vite build",
            "preview": "vite preview --host 0.0.0.0",
        },
        "dependencies": dependencies,
        "devDependencies": dev_dependencies,
    }
    return json.dumps(package, ensure_ascii=False, indent=2) + "\n"


def _build_export_zip(project: CodingProject, version: CodingVersion, files: list[dict]) -> bytes:
    react = _project_uses_react(files)
    buffer = io.BytesIO()
    written: set[str] = set()
    export_reserved = {"Dockerfile", "docker-compose.yml", "nginx.conf", ".dockerignore", "README.md"}

    def write(path: str, content: str | bytes):
        safe = _safe_zip_path(path)
        if not safe or safe in written:
            return
        written.add(safe)
        data = content.encode("utf-8") if isinstance(content, str) else content
        archive.writestr(safe, data)

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        if react:
            for file in files:
                path = _safe_zip_path(str(file.get("path") or ""))
                if not path or path == "package.json" or path in export_reserved:
                    continue
                write(path, str(file.get("content") or ""))
            write("package.json", _build_export_package_json(files, project.title))
            write("index.html", """<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mini app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""")
            write("src/main.tsx", """import '../golinelli-bridge'
import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
""")
            write("golinelli-bridge.ts", """declare global {
  interface Window {
    GolinelliAI?: {
      chat: (args?: { content?: string; history?: unknown[]; profileKey?: string }) => Promise<{ response: string }>
      generateImage: (args?: { prompt?: string; onStatus?: (event: { status: string; message: string; result?: unknown }) => void }) => Promise<{ image_url: string }>
      saveData: (args?: { key?: string; value?: unknown }) => Promise<{ key: string; value: unknown }>
      loadData: (args?: { key?: string }) => Promise<{ key: string; value: unknown }>
      deleteData: (args?: { key?: string }) => Promise<{}>
    }
  }
}

window.GolinelliAI = window.GolinelliAI || {
  async chat() {
    return { response: 'Runtime AI non configurato in questa distribuzione standalone.' }
  },
  async generateImage() {
    throw new Error('Generazione immagini non configurata in questa distribuzione standalone.')
  },
  async saveData() {
    throw new Error('Persistenza dati non configurata in questa distribuzione standalone.')
  },
  async loadData() {
    throw new Error('Persistenza dati non configurata in questa distribuzione standalone.')
  },
  async deleteData() {
    throw new Error('Persistenza dati non configurata in questa distribuzione standalone.')
  },
}

export {}
""")
            write("tsconfig.json", """{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "*.tsx", "*.ts", "components", "hooks", "lib", "types.ts"]
}
""")
            write("vite.config.ts", """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
""")
            write("Dockerfile", """FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
""")
        else:
            for file in files:
                path = _safe_zip_path(str(file.get("path") or ""))
                if not path or path in export_reserved:
                    continue
                write(path, str(file.get("content") or ""))
            if "index.html" not in written:
                write("index.html", _build_static_html(files, project.title))
            write("Dockerfile", """FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE 80
""")

        write("nginx.conf", """server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
""")
        write("docker-compose.yml", f"""services:
  app:
    build: .
    ports:
      - "8080:80"
    restart: unless-stopped
""")
        write(".dockerignore", """node_modules
dist
.git
*.zip
""")
        write("README.md", f"""# {project.title}

Export generato dal Coding Lab Golinelli.ai.

## Avvio locale con Docker

```bash
docker compose up --build
```

Poi apri `http://localhost:8080`.

Versione esportata: {version.version_number}
""")

    buffer.seek(0)
    return buffer.getvalue()


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


async def _collaborator_row(db: AsyncSession, project_id: UUID, student_id: UUID) -> CodingCollaborator | None:
    return (await db.execute(
        select(CodingCollaborator).where(
            CodingCollaborator.project_id == project_id,
            CodingCollaborator.student_id == student_id,
        )
    )).scalar_one_or_none()


async def _get_readable_project(
    db: AsyncSession,
    actor: StudentOrTeacher,
    project_id: UUID,
) -> CodingProject:
    """Owner access, plus read-only access for students who accepted an invitation.

    Write endpoints keep using _get_accessible_project, so collaborators can never modify the main
    branch of someone else's project.
    """
    try:
        return await _get_accessible_project(db, actor, project_id)
    except HTTPException:
        if not actor.is_student:
            raise
        project = (await db.execute(select(CodingProject).where(CodingProject.id == project_id))).scalar_one_or_none()
        row = await _collaborator_row(db, project_id, actor.student.id) if project else None
        if (
            project is None
            or row is None
            or row.status != "active"
            or project.session_id != actor.student.session_id
        ):
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


async def _project_response_payload(
    db: AsyncSession,
    actor: StudentOrTeacher,
    project: CodingProject,
) -> dict:
    owner_display_name: str | None = None
    owner_kind: str | None = None
    is_owned = False

    if project.owner_student_id:
        owner_kind = "student"
        is_owned = actor.is_student and project.owner_student_id == actor.student.id
        result = await db.execute(select(SessionStudent).where(SessionStudent.id == project.owner_student_id))
        student = result.scalar_one_or_none()
        owner_display_name = student.nickname if student else "Studente"
    elif project.owner_user_id:
        owner_kind = "teacher"
        is_owned = actor.is_teacher and project.owner_user_id == actor.teacher.id
        result = await db.execute(select(User).where(User.id == project.owner_user_id))
        user = result.scalar_one_or_none()
        if user:
            owner_display_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip() or user.email
        else:
            owner_display_name = "Docente"

    my_role: str | None = "owner" if is_owned else None
    main_project_id: UUID | None = None
    if actor.is_student:
        # Working copy of an accepted collaboration: shown as the creator's project, editable by me.
        link = (await db.execute(
            select(CodingCollaborator).where(
                CodingCollaborator.branch_project_id == project.id,
                CodingCollaborator.student_id == actor.student.id,
                CodingCollaborator.status == "active",
            )
        )).scalar_one_or_none()
        if link:
            main = (await db.execute(select(CodingProject).where(CodingProject.id == link.project_id))).scalar_one_or_none()
            my_role = "collaborator"
            main_project_id = link.project_id
            is_owned = False
            if main and main.owner_student_id:
                creator = (await db.execute(select(SessionStudent).where(SessionStudent.id == main.owner_student_id))).scalar_one_or_none()
                owner_display_name = creator.nickname if creator else owner_display_name
            elif main and main.owner_user_id:
                creator_user = await db.get(User, main.owner_user_id)
                if creator_user:
                    owner_display_name = " ".join(part for part in [creator_user.first_name, creator_user.last_name] if part).strip() or creator_user.email
        elif not is_owned:
            row = await _collaborator_row(db, project.id, actor.student.id)
            if row and row.status in ("invited", "active"):
                my_role = "collaborator" if row.status == "active" else "invited"
    collaborator_count = (await db.execute(
        select(func.count()).select_from(CodingCollaborator).where(
            CodingCollaborator.project_id == project.id,
            CodingCollaborator.status.in_(("invited", "active")),
        )
    )).scalar_one()
    open_pr_count = (await db.execute(
        select(func.count()).select_from(CodingPullRequest).where(
            CodingPullRequest.project_id == project.id,
            CodingPullRequest.status.in_(("open", "testing")),
        )
    )).scalar_one() if is_owned else 0

    payload = CodingProjectResponse.model_validate(project).model_dump()
    payload.update({
        "owner_display_name": owner_display_name,
        "owner_kind": owner_kind,
        "is_owned_by_current_user": is_owned,
        "my_role": my_role,
        "collaborator_count": int(collaborator_count or 0),
        "main_project_id": main_project_id,
        "open_pr_count": int(open_pr_count or 0),
    })
    return payload


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
        shared_with_me = select(CodingCollaborator.project_id).where(
            CodingCollaborator.student_id == actor.student.id,
            CodingCollaborator.status == "invited",
        )
        query = query.where(
            CodingProject.session_id == actor.student.session_id,
            or_(
                CodingProject.owner_student_id == actor.student.id,
                CodingProject.id.in_(shared_with_me),
            ),
        )
    else:
        if actor.teacher.tenant_id:
            query = query.where(CodingProject.tenant_id == actor.teacher.tenant_id)
        if session_id:
            query = query.where(CodingProject.session_id == session_id)
        query = query.where(
            or_(
                CodingProject.owner_user_id == actor.teacher.id,
                CodingProject.visibility == "class_shared",
                CodingProject.status == "shared",
            )
        )

    result = await db.execute(query.order_by(CodingProject.updated_at.desc()))
    return [await _project_response_payload(db, actor, project) for project in result.scalars().all()]


# --- Collaborators (named classmates invited to a project) ------------------------------------
def _collab_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificativo non valido")


async def _emit_to_student(student_id: UUID, event: str, payload: dict) -> None:
    from app.realtime.gateway import sio
    try:
        await sio.emit(event, payload, room=f"student:{student_id}")
    except Exception:  # realtime is best effort: invitations are also visible on the landing page
        logging.getLogger(__name__).warning("coding collaboration emit failed", exc_info=True)


def _files_hash(files: list[dict] | None) -> str:
    canonical = json.dumps(
        sorted(
            [{"path": f.get("path"), "content": f.get("content") or ""} for f in (files or [])],
            key=lambda f: str(f["path"]),
        ),
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def _current_files(version: CodingVersion | None) -> list[dict]:
    return list(((version.source_manifest_json or {}).get("files") if version else None) or [])


async def _main_files(db: AsyncSession, project: CodingProject) -> list[dict]:
    version = (await db.execute(select(CodingVersion).where(CodingVersion.id == project.current_version_id))).scalar_one_or_none() if project.current_version_id else None
    return _current_files(version)


async def _branch_link(db: AsyncSession, project: CodingProject) -> CodingCollaborator | None:
    return (await db.execute(
        select(CodingCollaborator).where(
            CodingCollaborator.branch_project_id == project.id,
            CodingCollaborator.status == "active",
        )
    )).scalar_one_or_none()


async def _create_working_copy(db: AsyncSession, main: CodingProject, student: SessionStudent) -> CodingProject:
    """The collaborator's own editable copy of the main project, linked to it for PRs and updates."""
    main_version = await _get_current_version(db, main)
    files = _current_files(main_version)
    slug = await _next_slug(db, main.session_id, f"{main.slug}-{student.nickname}")
    branch = CodingProject(
        tenant_id=main.tenant_id,
        session_id=main.session_id,
        brief_id=main.brief_id,
        owner_student_id=student.id,
        title=main.title,
        slug=slug,
        template_key=main.template_key,
        status="fork",
        visibility="private",
        thumbnail=main.thumbnail,
    )
    db.add(branch)
    await db.flush()
    collaboration = {
        "kind": "branch",
        "source_project_id": str(main.id),
        "source_version_id": str(main_version.id),
        "creator_student_id": str(main.owner_student_id) if main.owner_student_id else None,
        "forked_by_student_id": str(student.id),
    }
    version = CodingVersion(
        project_id=branch.id,
        parent_version_id=main_version.id,
        version_number=1,
        source_manifest_json={
            "files": files,
            "summary": f"Copia di lavoro del progetto {main.title}",
            "collaboration": collaboration,
        },
        artifact_manifest_json={},
        build_status="ready",
        review_status="pending",
        created_by_actor_type="student",
    )
    db.add(version)
    await db.flush()
    branch.current_version_id = version.id
    db.add(CodingMessage(
        project_id=branch.id,
        actor_type="agent",
        agent_name="Collaboration",
        role="assistant",
        content="Questa è la tua copia di lavoro: modifica quanto vuoi, il progetto principale non cambia. Quando sei pronto premi «Proponi le modifiche».",
        metadata_json={"kind": "agent_feedback", "collaboration": collaboration},
    ))
    return branch


def _is_project_owner(project: CodingProject, actor: StudentOrTeacher) -> bool:
    if actor.is_student:
        return project.owner_student_id == actor.student.id
    return project.owner_user_id is not None and project.owner_user_id == actor.teacher.id


def _require_student_owner(project: CodingProject, actor: StudentOrTeacher) -> None:
    if not _is_project_owner(project, actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo chi ha creato il progetto può gestire i collaboratori")


def _actor_display_name(actor: StudentOrTeacher) -> str:
    if actor.is_student:
        return actor.student.nickname
    teacher = actor.teacher
    return " ".join(part for part in [teacher.first_name, teacher.last_name] if part).strip() or teacher.email


async def _emit_to_owner(project: CodingProject, event: str, payload: dict) -> None:
    """Notify the creator, whether a student or a teacher."""
    if project.owner_student_id:
        await _emit_to_student(project.owner_student_id, event, payload)
    elif project.owner_user_id:
        from app.realtime.gateway import sio
        try:
            await sio.emit(event, payload, room=f"user:{project.owner_user_id}")
        except Exception:
            logging.getLogger(__name__).warning("coding collaboration emit failed", exc_info=True)


@router.get("/projects/{project_id}/collaborators")
async def list_collaborators(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Current collaborators plus the classmates the owner can invite."""
    project = await _get_accessible_project(db, actor, project_id)
    _require_student_owner(project, actor)
    rows = (await db.execute(
        select(CodingCollaborator).where(
            CodingCollaborator.project_id == project.id,
            CodingCollaborator.status.in_(("invited", "active")),
        )
    )).scalars().all()
    classmates = (await db.execute(
        select(SessionStudent)
        .where(
            SessionStudent.session_id == project.session_id,
            SessionStudent.id != (actor.student.id if actor.is_student else None),
        )
        .order_by(SessionStudent.nickname)
    )).scalars().all()
    return {
        "collaborators": [{"id": str(r.student_id), "status": r.status} for r in rows],
        "candidates": [{"id": str(s.id), "name": s.nickname} for s in classmates],
    }


@router.get("/projects/{project_id}/team")
async def get_project_team(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Creator plus invited/active collaborators, for the avatars in the toolbar.

    Works from the main project or from a collaborator's working copy of it.
    """
    project = await _get_readable_project(db, actor, project_id)
    link = (await db.execute(
        select(CodingCollaborator).where(CodingCollaborator.branch_project_id == project.id)
    )).scalars().first()
    main = (await db.get(CodingProject, link.project_id)) if link else project
    if main is None:
        main = project
    if main.owner_student_id:
        owner_id, owner_name, owner_role = str(main.owner_student_id), await _student_name(db, main.owner_student_id), "student"
    elif main.owner_user_id:
        owner_user = await db.get(User, main.owner_user_id)
        owner_id = str(main.owner_user_id)
        owner_name = (" ".join(part for part in [owner_user.first_name, owner_user.last_name] if part).strip() or owner_user.email) if owner_user else "Docente"
        owner_role = "teacher"
    else:
        owner_id, owner_name, owner_role = str(main.id), "Creatore", "student"
    rows = (await db.execute(
        select(CodingCollaborator, SessionStudent.nickname)
        .join(SessionStudent, SessionStudent.id == CodingCollaborator.student_id)
        .where(CodingCollaborator.project_id == main.id, CodingCollaborator.status.in_(("invited", "active")))
        .order_by(CodingCollaborator.created_at)
    )).all()
    return {
        "main_project_id": str(main.id),
        "owner": {"id": owner_id, "name": owner_name, "role": owner_role},
        "members": [{"id": str(row.student_id), "name": nickname, "status": row.status, "role": "student"} for row, nickname in rows],
    }


@router.put("/projects/{project_id}/collaborators")
async def replace_collaborators(
    project_id: UUID,
    body: CodingCollaboratorsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Set the invited classmates. New people get an invitation, removed people lose access."""
    project = await _get_accessible_project(db, actor, project_id)
    _require_student_owner(project, actor)

    targets = {_collab_uuid(v) for v in body.student_ids}
    targets.discard(project.owner_student_id)
    if targets:
        valid = set((await db.execute(
            select(SessionStudent.id).where(
                SessionStudent.id.in_(targets),
                SessionStudent.session_id == project.session_id,
            )
        )).scalars().all())
        if valid != targets:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Studente non appartenente alla sessione")

    existing = {
        r.student_id: r
        for r in (await db.execute(select(CodingCollaborator).where(CodingCollaborator.project_id == project.id))).scalars().all()
    }
    newly_invited: list[UUID] = []
    for student_id, row in existing.items():
        if student_id not in targets:
            if row.status in ("invited", "active"):
                row.status = "removed"
                for open_pr in (await db.execute(
                    select(CodingPullRequest).where(
                        CodingPullRequest.project_id == project.id,
                        CodingPullRequest.author_student_id == student_id,
                        CodingPullRequest.status.in_(("open", "testing")),
                    )
                )).scalars().all():
                    open_pr.status = "closed"
                    open_pr.decision_note = "Collaboratore rimosso dal progetto"
        elif row.status in ("removed", "declined"):
            row.status = "invited"
            row.invited_by_student_id = actor.student.id if actor.is_student else None
            newly_invited.append(student_id)
    for student_id in targets - set(existing):
        db.add(CodingCollaborator(
            project_id=project.id,
            student_id=student_id,
            status="invited",
            invited_by_student_id=actor.student.id if actor.is_student else None,
        ))
        newly_invited.append(student_id)
    await db.commit()

    inviter = _actor_display_name(actor)
    for student_id in newly_invited:
        await _emit_to_student(student_id, "coding_project_invite", {
            "project_id": str(project.id),
            "title": project.title,
            "from": inviter,
        })
    return await list_collaborators(project_id, db, actor)


@router.post("/projects/{project_id}/invite/{decision}")
async def answer_invitation(
    project_id: UUID,
    decision: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """The invited student accepts or declines; an active collaborator may also leave."""
    if decision not in ("accept", "decline", "leave"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not actor.is_student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli studenti possono rispondere agli inviti")
    project = (await db.execute(select(CodingProject).where(CodingProject.id == project_id))).scalar_one_or_none()
    row = await _collaborator_row(db, project_id, actor.student.id) if project else None
    if not project or not row or project.session_id != actor.student.session_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invito non trovato")
    result_project = project
    if decision == "accept" and row.status == "invited":
        branch = (await db.get(CodingProject, row.branch_project_id)) if row.branch_project_id else None
        if branch is None:
            branch = await _create_working_copy(db, project, actor.student)
            row.branch_project_id = branch.id
            row.base_files_json = await _main_files(db, project)
        row.status = "active"
        result_project = branch
    elif decision == "decline" and row.status == "invited":
        row.status = "declined"
    elif decision == "leave" and row.status == "active":
        row.status = "removed"
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Operazione non valida per lo stato attuale dell'invito")
    await db.commit()
    await db.refresh(result_project)  # server-side timestamps of a freshly created working copy
    if decision != "decline":
        await _emit_to_owner(project, "coding_collaborator_update", {
            "project_id": str(project.id),
            "title": project.title,
            "student": actor.student.nickname,
            "status": row.status,
        })
    return await _project_response_payload(db, actor, result_project)


# --- Pull requests: contributor working copy -> main project ------------------------------------
async def _student_name(db: AsyncSession, student_id: UUID | None) -> str:
    if not student_id:
        return "Studente"
    student = await db.get(SessionStudent, student_id)
    return student.nickname if student else "Studente"


async def _pr_payload(db: AsyncSession, pr: CodingPullRequest, main: CodingProject, detail: bool = False) -> dict:
    changes = changed_files(pr.base_files_json or [], pr.head_files_json or [])
    main_changed = False
    if pr.status == "testing" and pr.main_hash_at_test:
        main_changed = _files_hash(await _main_files(db, main)) != pr.main_hash_at_test
    previous_version_id = None
    if pr.status == "merged" and pr.merged_version_id:
        merged = await db.get(CodingVersion, pr.merged_version_id)
        previous_version_id = str(merged.parent_version_id) if merged and merged.parent_version_id else None
    payload = {
        "id": str(pr.id),
        "project_id": str(pr.project_id),
        "branch_project_id": str(pr.branch_project_id),
        "author_student_id": str(pr.author_student_id) if pr.author_student_id else None,
        "author_name": await _student_name(db, pr.author_student_id),
        "title": pr.title,
        "description": pr.description or "",
        "status": pr.status,
        "has_test": pr.test_files_json is not None,
        "main_changed": main_changed,
        "conflict_paths": [c["path"] for c in (pr.conflicts_json or [])],
        "changed": [{"path": c["path"], "status": c["status"]} for c in changes],
        "decision_note": pr.decision_note,
        "merged_version_id": str(pr.merged_version_id) if pr.merged_version_id else None,
        "previous_version_id": previous_version_id,
        "created_at": pr.created_at.isoformat() if pr.created_at else None,
        "updated_at": pr.updated_at.isoformat() if pr.updated_at else None,
        "merged_at": pr.merged_at.isoformat() if pr.merged_at else None,
    }
    if detail:
        payload["changes"] = changes
        payload["conflicts"] = pr.conflicts_json or []
        payload["test_files"] = pr.test_files_json
    return payload


async def _load_pr(
    db: AsyncSession, actor: StudentOrTeacher, project_id: UUID, pr_id: UUID,
) -> tuple[CodingPullRequest, CodingProject, str]:
    main = await _get_readable_project(db, actor, project_id)
    pr = (await db.execute(
        select(CodingPullRequest).where(CodingPullRequest.id == pr_id, CodingPullRequest.project_id == main.id)
    )).scalar_one_or_none()
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposta non trovata")
    if _is_project_owner(main, actor):
        role = "owner"
    elif actor.is_student and pr.author_student_id == actor.student.id:
        role = "author"
    elif actor.is_teacher:
        role = "viewer"
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Proposta non accessibile")
    return pr, main, role


def _require_owner(role: str) -> None:
    if role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo chi ha creato il progetto può decidere sulle proposte")


async def _compute_test(db: AsyncSession, pr: CodingPullRequest, main: CodingProject) -> None:
    """Merge the proposal into the current main in memory only: the main project is not touched."""
    main_files = await _main_files(db, main)
    merged, conflicts = merge_file_sets(pr.base_files_json or [], main_files, pr.head_files_json or [])
    pr.test_files_json = merged
    pr.conflicts_json = conflicts
    pr.main_hash_at_test = _files_hash(main_files)
    pr.status = "testing"


@router.post("/projects/{project_id}/pull-requests")
async def create_pull_request(
    project_id: UUID,
    body: CodingPullRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """The contributor proposes their working copy. A second proposal updates the open one."""
    if not actor.is_student:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli studenti collaboratori possono proporre modifiche")
    main = await _get_readable_project(db, actor, project_id)
    link = await _collaborator_row(db, main.id, actor.student.id)
    if not link or link.status != "active" or not link.branch_project_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non sei collaboratore di questo progetto")
    branch = await db.get(CodingProject, link.branch_project_id)
    head_files = await _main_files(db, branch) if branch else []
    base_files = link.base_files_json or []
    if not changed_files(base_files, head_files):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Non ci sono modifiche da proporre")

    pr = (await db.execute(
        select(CodingPullRequest).where(
            CodingPullRequest.branch_project_id == branch.id,
            CodingPullRequest.status.in_(("open", "testing")),
        )
    )).scalar_one_or_none()
    created = pr is None
    if pr is None:
        pr = CodingPullRequest(project_id=main.id, branch_project_id=branch.id, author_student_id=actor.student.id)
        db.add(pr)
    pr.title = body.title.strip()
    pr.description = body.description.strip()
    pr.base_files_json = base_files
    pr.head_files_json = head_files
    pr.status = "open"
    pr.test_files_json = None
    pr.conflicts_json = []
    pr.main_hash_at_test = None
    await db.commit()
    await db.refresh(pr)
    if main.owner_student_id or main.owner_user_id:
        await _emit_to_owner(main, "coding_pr_opened", {
            "project_id": str(main.id), "pr_id": str(pr.id), "title": pr.title,
            "from": actor.student.nickname, "project_title": main.title, "updated": not created,
        })
    return await _pr_payload(db, pr, main, detail=True)


@router.get("/projects/{project_id}/pull-requests")
async def list_pull_requests(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    main = await _get_readable_project(db, actor, project_id)
    query = select(CodingPullRequest).where(CodingPullRequest.project_id == main.id)
    if actor.is_student and not _is_project_owner(main, actor):
        query = query.where(CodingPullRequest.author_student_id == actor.student.id)
    rows = (await db.execute(query.order_by(CodingPullRequest.created_at.desc()))).scalars().all()
    return [await _pr_payload(db, pr, main) for pr in rows]


@router.get("/projects/{project_id}/pull-requests/{pr_id}")
async def get_pull_request(
    project_id: UUID,
    pr_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    pr, main, _role = await _load_pr(db, actor, project_id, pr_id)
    return await _pr_payload(db, pr, main, detail=True)


@router.post("/projects/{project_id}/pull-requests/{pr_id}/test")
async def test_pull_request(
    project_id: UUID,
    pr_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Testing: build the merge result for preview. The main project is not changed."""
    pr, main, role = await _load_pr(db, actor, project_id, pr_id)
    _require_owner(role)
    if pr.status not in ("open", "testing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La proposta è già chiusa")
    await _compute_test(db, pr, main)
    await db.commit()
    await db.refresh(pr)
    if pr.author_student_id:
        await _emit_to_student(pr.author_student_id, "coding_pr_updated", {
            "project_id": str(main.id), "pr_id": str(pr.id), "title": pr.title, "status": "testing",
            "project_title": main.title,
        })
    return await _pr_payload(db, pr, main, detail=True)


@router.post("/projects/{project_id}/pull-requests/{pr_id}/resolve")
async def resolve_pull_request_conflict(
    project_id: UUID,
    pr_id: UUID,
    body: CodingPullRequestResolve,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    pr, main, role = await _load_pr(db, actor, project_id, pr_id)
    _require_owner(role)
    if pr.status != "testing" or pr.test_files_json is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prima prova la proposta")
    conflict = next((c for c in (pr.conflicts_json or []) if c["path"] == body.path), None)
    if not conflict:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nessun conflitto su questo file")
    if body.choice == "custom":
        if body.content is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manca il testo scelto")
        chosen: str | None = body.content
    else:
        chosen = conflict.get(body.choice)
    files = [f for f in pr.test_files_json if f.get("path") != body.path]
    if chosen is not None:
        language = next((f.get("language") for f in pr.head_files_json if f.get("path") == body.path), None)
        files.append({"path": body.path, "language": language, "content": chosen})
    pr.test_files_json = files
    pr.conflicts_json = [c for c in pr.conflicts_json if c["path"] != body.path]
    await db.commit()
    await db.refresh(pr)
    return await _pr_payload(db, pr, main, detail=True)


@router.post("/projects/{project_id}/pull-requests/{pr_id}/merge")
async def merge_pull_request(
    project_id: UUID,
    pr_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Merge: the tested result becomes the new current version of the main project."""
    pr, main, role = await _load_pr(db, actor, project_id, pr_id)
    _require_owner(role)
    if pr.status == "merged":
        return await _pr_payload(db, pr, main, detail=True)
    if pr.status != "testing" or pr.test_files_json is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prima prova la proposta, poi potrai unirla")
    if pr.conflicts_json:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Risolvi prima i conflitti indicati")
    main_files = await _main_files(db, main)
    if _files_hash(main_files) != pr.main_hash_at_test:
        await _compute_test(db, pr, main)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Il progetto principale è cambiato dopo la prova: ho rifatto la prova, controlla di nuovo il risultato e poi unisci.",
        )

    number = ((await db.execute(
        select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == main.id)
    )).scalar_one_or_none() or 0) + 1
    author = await _student_name(db, pr.author_student_id)
    version = CodingVersion(
        project_id=main.id,
        parent_version_id=main.current_version_id,
        version_number=number,
        source_manifest_json={
            "files": pr.test_files_json,
            "summary": f"Unita la proposta «{pr.title}» di {author}",
            "merged_pr_id": str(pr.id),
        },
        artifact_manifest_json={},
        build_status="ready",
        review_status="pending",
        created_by_actor_type="student",
    )
    db.add(version)
    await db.flush()
    main.current_version_id = version.id
    main.status = "generated" if main.status in ("draft", "generated") else main.status
    pr.status = "merged"
    pr.merged_version_id = version.id
    pr.merged_at = func.now()
    db.add(CodingMessage(
        project_id=main.id,
        actor_type="agent",
        agent_name="Collaboration",
        role="assistant",
        content=f"La proposta «{pr.title}» di {author} è stata unita nella versione {number}.",
        metadata_json={"kind": "agent_feedback", "version_id": str(version.id), "pr_id": str(pr.id)},
    ))
    await db.commit()
    await db.refresh(pr)
    if pr.author_student_id:
        await _emit_to_student(pr.author_student_id, "coding_pr_updated", {
            "project_id": str(main.id), "pr_id": str(pr.id), "title": pr.title, "status": "merged",
            "project_title": main.title,
        })
    return await _pr_payload(db, pr, main, detail=True)


@router.post("/projects/{project_id}/pull-requests/{pr_id}/reject")
async def reject_pull_request(
    project_id: UUID,
    pr_id: UUID,
    body: CodingPullRequestDecision,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    pr, main, role = await _load_pr(db, actor, project_id, pr_id)
    _require_owner(role)
    if pr.status not in ("open", "testing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La proposta è già chiusa")
    pr.status = "rejected"
    pr.decision_note = body.note.strip() or None
    pr.test_files_json = None
    pr.conflicts_json = []
    await db.commit()
    await db.refresh(pr)
    if pr.author_student_id:
        await _emit_to_student(pr.author_student_id, "coding_pr_updated", {
            "project_id": str(main.id), "pr_id": str(pr.id), "title": pr.title, "status": "rejected",
            "project_title": main.title,
        })
    return await _pr_payload(db, pr, main, detail=True)


@router.post("/projects/{project_id}/pull-requests/{pr_id}/close")
async def close_pull_request(
    project_id: UUID,
    pr_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """The contributor withdraws their own proposal."""
    pr, main, role = await _load_pr(db, actor, project_id, pr_id)
    if role != "author":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo chi ha proposto può ritirare la proposta")
    if pr.status not in ("open", "testing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La proposta è già chiusa")
    pr.status = "closed"
    pr.test_files_json = None
    pr.conflicts_json = []
    await db.commit()
    await db.refresh(pr)
    return await _pr_payload(db, pr, main, detail=True)


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
    _bridge_rate_limit(actor)

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
        return await vibe_pipeline.generate(
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


# Generated apps call the AI from a loop or a button without any debounce: cap them per actor so a
# buggy app can't drain the class credit pool. In-memory sliding window per API worker.
BRIDGE_AI_CALLS_PER_MINUTE = 30
_bridge_calls: dict[str, list[float]] = {}


def _bridge_rate_limit(actor: StudentOrTeacher) -> None:
    key = f"s:{actor.student.id}" if actor.is_student else f"t:{actor.teacher.id}"
    now = time.monotonic()
    recent = [stamp for stamp in _bridge_calls.get(key, []) if now - stamp < 60]
    if len(recent) >= BRIDGE_AI_CALLS_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="L'app sta chiamando l'AI troppo spesso: attendi qualche secondo e riprova.",
        )
    recent.append(now)
    _bridge_calls[key] = recent


def _bridge_chat_messages(body: dict) -> list[dict]:
    content = str(body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content required")
    history = body.get("history") if isinstance(body.get("history"), list) else []
    messages: list[dict] = []
    for item in history[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role") if item.get("role") in {"user", "assistant"} else "user"
        text = str(item.get("content") or "").strip()
        if text:
            messages.append({"role": role, "content": text[:4000]})
    messages.append({"role": "user", "content": content[:8000]})
    return messages


@router.post("/ai/chat-stream")
async def coding_ai_chat_stream(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Token-by-token variant of /ai/chat for generated apps (GolinelliAI.chatStream). Platform
    default model; the cost is estimated from the streamed text and billed once at the end."""
    messages = _bridge_chat_messages(body)
    _bridge_rate_limit(actor)
    actor_label = "studente" if actor.is_student else "docente"
    system_prompt = (
        "Sei un assistente AI dentro una mini-app del Coding Lab Golinelli.ai. "
        f"Stai rispondendo a un {actor_label}. Sii utile, conciso, educativo e adatto a studenti. "
        "Non citare dettagli tecnici interni della piattaforma."
    )
    extra_system = str(body.get("system") or "").strip()
    if extra_system:
        system_prompt += "\n\nIstruzioni dell'app:\n" + extra_system[:4000]
    tenant_id = actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id

    async def event_stream():
        full = ""
        try:
            async for chunk in llm_service.generate_stream(
                messages=messages, system_prompt=system_prompt, temperature=0.4, max_tokens=1500, allow_web_search=False,
            ):
                full += chunk
                yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
            usage = build_estimated_token_usage([{"role": "system", "content": system_prompt}, *messages], full)
            await _record_coding_cost(
                db,
                provider=settings.DEFAULT_LLM_PROVIDER,
                model=settings.DEFAULT_LLM_MODEL,
                prompt_tokens=usage["prompt_tokens"],
                completion_tokens=usage["completion_tokens"],
                context="coding_ai_chat_stream",
                tenant_id=tenant_id,
                session_id=actor.student.session_id if actor.is_student else None,
                student_id=actor.student.id if actor.is_student else None,
                teacher_id=actor.teacher.id if actor.is_teacher else None,
            )
            yield f"data: {json.dumps({'type': 'done', 'response': full})}\n\n"
        except Exception as exc:
            logger.exception("coding ai/chat-stream failed")
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/ai/extract-document")
async def coding_extract_document(
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    file: UploadFile = File(...),
):
    """Extracts the text of an attached PDF/Word/PowerPoint/Excel/CSV/text document so it can ride along
    with a Vibe Lab request as detailed instructions. Personal data is masked locally."""
    from app.services.document_processor import document_processor

    data = await file.read()
    filename = (file.filename or "documento")[:200]
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File vuoto")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File troppo grande (max 15 MB)")
    mime = file.content_type or "application/octet-stream"
    lower = filename.lower()
    if lower.endswith((".json", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".xml", ".yaml", ".yml", ".rtf")):
        mime = "text/plain"
    try:
        analysis = await document_processor.process(
            file_bytes=data, filename=filename, mime_type=mime,
            llm_service=None, analyze_visuals=False, anonymize=True,
        )
    except Exception as exc:
        logger.warning("coding document extraction failed (%s)", exc)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Non riesco a leggere questo documento")
    text = (analysis.raw_text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nessun testo leggibile nel documento (formato non supportato o scansione)")
    limit = 30_000
    return {"filename": filename, "text": text[:limit], "truncated": len(text) > limit, "pages": analysis.page_count}


_PLACES_CACHE: dict[str, tuple[float, list[dict]]] = {}
_PLACES_TTL_SECONDS = 6 * 3600


@router.post("/ai/places")
async def coding_ai_places(
    body: dict,
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Real place search for generated apps (GolinelliAI.places): free-text query or reverse lookup of a point,
    served by the platform from OpenStreetMap data (Nominatim). Results are cached and rate limited so
    a shared class never exceeds the provider's usage policy (max 1 request/second, identified client)."""
    _bridge_rate_limit(actor)
    query = str(body.get("query") or "").strip()[:200]
    lat, lon = body.get("lat"), body.get("lon")
    limit = max(1, min(int(body.get("limit") or 5), 10))
    if not query and not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Indica un testo da cercare oppure lat e lon")
    key = f"{query.lower()}|{round(lat, 4) if isinstance(lat, (int, float)) else ''}|{round(lon, 4) if isinstance(lon, (int, float)) else ''}|{limit}|{body.get('country') or ''}"
    cached = _PLACES_CACHE.get(key)
    if cached and time.monotonic() - cached[0] < _PLACES_TTL_SECONDS:
        return {"places": cached[1]}
    params: dict[str, Any] = {"format": "jsonv2", "addressdetails": 1, "accept-language": "it", "limit": limit}
    if query:
        url = "https://nominatim.openstreetmap.org/search"
        params["q"] = query
        if body.get("country"):
            params["countrycodes"] = str(body["country"])[:20].lower()
    else:
        url = "https://nominatim.openstreetmap.org/reverse"
        params.update(lat=lat, lon=lon, zoom=int(body.get("zoom") or 16))
    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "golinelli-ai-vibelab/1.0 (education platform)"}) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            raw = response.json()
    except Exception as exc:
        logger.warning("places lookup failed (%s)", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Servizio mappe non disponibile al momento: riprova tra poco")
    items = raw if isinstance(raw, list) else [raw] if isinstance(raw, dict) and raw.get("lat") else []
    places = [{
        "name": str(item.get("name") or item.get("display_name") or "").split(",")[0][:120],
        "label": str(item.get("display_name") or "")[:240],
        "lat": float(item["lat"]), "lon": float(item["lon"]),
        "type": str(item.get("type") or item.get("category") or "")[:40],
        "boundingbox": [float(v) for v in item.get("boundingbox", [])][:4],
    } for item in items if item.get("lat") and item.get("lon")]
    if len(_PLACES_CACHE) > 500:
        _PLACES_CACHE.clear()
    _PLACES_CACHE[key] = (time.monotonic(), places)
    return {"places": places}


@router.post("/ai/vision")
async def coding_ai_vision(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Image understanding for generated apps (GolinelliAI.vision): data URL or https URL + prompt."""
    image = str(body.get("image") or "").strip()
    prompt = str(body.get("prompt") or "Descrivi questa immagine.").strip()[:4000]
    is_data_url = bool(_DATA_URL_RE.match(image))
    if not image or (is_data_url and len(image) > MAX_ATTACHMENT_DATA_URL_CHARS) or (not is_data_url and not image.startswith("https://")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Immagine non valida: usa un data URL o un URL https")
    _bridge_rate_limit(actor)
    try:
        response = await vibe_pipeline.generate(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt + "\n\nRispondi in italiano, in modo adatto a studenti."},
                {"type": "image_url", "image_url": {"url": image}},
            ]}],
            provider=model_roles.provider_for("vision"),
            model=model_roles.model_for("vision"),
            temperature=0.2,
            max_tokens=900,
            allow_web_search=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Analisi immagine non disponibile: {exc}")
    await _record_coding_cost(
        db,
        provider=response.provider,
        model=response.model,
        prompt_tokens=response.prompt_tokens,
        completion_tokens=response.completion_tokens,
        context="coding_ai_vision",
        tenant_id=actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id,
        session_id=actor.student.session_id if actor.is_student else None,
        student_id=actor.student.id if actor.is_student else None,
        teacher_id=actor.teacher.id if actor.is_teacher else None,
    )
    return {"response": response.content}


@router.post("/projects/{project_id}/visual-review")
async def visual_review_project(
    project_id: UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Look at a screenshot of the running app and list concrete visual defects (vision model).
    The result is stored as an agent message so it shows in the project conversation."""
    project = await _get_accessible_project(db, actor, project_id)
    image = str(body.get("image") or "").strip()
    if not _DATA_URL_RE.match(image) or len(image) > MAX_ATTACHMENT_DATA_URL_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Screenshot non valido")
    last_request = (await db.execute(
        select(CodingMessage.content)
        .where(CodingMessage.project_id == project.id, CodingMessage.role == "user")
        .order_by(CodingMessage.created_at.desc())
        .limit(1)
    )).scalar_one_or_none() or project.title
    try:
        response = await vibe_pipeline.generate(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": f"Titolo: {project.title}\nUltima richiesta dello studente: {str(last_request)[:2000]}"},
                {"type": "image_url", "image_url": {"url": image}},
            ]}],
            system_prompt=VISUAL_REVIEW_PROMPT,
            provider=model_roles.provider_for("vision"),
            model=model_roles.model_for("vision"),
            temperature=0.2,
            max_tokens=900,
            allow_web_search=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Revisione visiva non disponibile: {exc}")
    try:
        review = _extract_json_object(response.content or "")
    except Exception:
        review = {}
    issues = [
        {
            "severity": str(item.get("severity") or "media")[:10],
            "area": str(item.get("area") or "")[:120],
            "problem": str(item.get("problem") or "")[:400],
            "fix": str(item.get("fix") or "")[:400],
        }
        for item in (review.get("issues") or []) if isinstance(item, dict) and item.get("problem")
    ][:6]
    try:
        score = max(1, min(10, int(review.get("score") or 0))) if review.get("score") is not None else None
    except (TypeError, ValueError):
        score = None
    summary = str(review.get("summary") or "")[:400]
    lines = "\n".join(f"- [{item['severity']}] {item['area']}: {item['problem']} → {item['fix']}" for item in issues)
    db.add(CodingMessage(
        project_id=project.id,
        actor_type="agent",
        agent_name="Revisore visivo",
        role="assistant",
        content=(f"Valutazione {score}/10. " if score else "") + (summary or "Revisione completata.") + (f"\n{lines}" if lines else "\nNessun difetto visivo rilevante."),
        metadata_json={"kind": "visual_review", "score": score, "issues": issues, "version_id": str(project.current_version_id or "")},
    ))
    await db.commit()
    await _record_coding_cost(
        db,
        provider=response.provider,
        model=response.model,
        prompt_tokens=response.prompt_tokens,
        completion_tokens=response.completion_tokens,
        context="coding_visual_review",
        tenant_id=project.tenant_id,
        session_id=project.session_id,
        student_id=actor.student.id if actor.is_student else None,
        teacher_id=actor.teacher.id if actor.is_teacher else None,
    )
    return {"score": score, "summary": summary, "issues": issues}


# --- Shared state between everyone using the same app in a session (GolinelliAI.shared) ---
SHARED_PREFIX = "shared:"
SHARED_MAX_VALUE_BYTES = 200_000
SHARED_MAX_LIST_ITEMS = 500


async def _shared_scope_project(db: AsyncSession, actor: StudentOrTeacher, project_id: UUID) -> CodingProject:
    """Shared data lives on the ROOT project (the original a class forked from), so every copy of the
    same app in the session sees the same values. Access = same session (students) / tenant (teachers)."""
    project = (await db.execute(select(CodingProject).where(CodingProject.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    root = project
    source_id = (await _get_fork_metadata(db, project)).get("source_project_id")
    if source_id:
        source = (await db.execute(select(CodingProject).where(CodingProject.id == UUID(str(source_id))))).scalar_one_or_none()
        if source and source.session_id == project.session_id:
            root = source
    if actor.is_student:
        if actor.student.session_id != root.session_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project not accessible")
    elif actor.teacher.tenant_id and root.tenant_id != actor.teacher.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project not accessible")
    return root


def _shared_key(key: str) -> str:
    key = key.strip()
    if not key or len(key) > 150:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chiave non valida")
    return SHARED_PREFIX + key


async def _shared_row(db: AsyncSession, root_id: UUID, key: str) -> CodingProjectData | None:
    return (await db.execute(
        select(CodingProjectData).where(CodingProjectData.project_id == root_id, CodingProjectData.key == key)
    )).scalar_one_or_none()


@router.get("/projects/{project_id}/shared/{key}")
async def get_shared_value(
    project_id: UUID,
    key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    root = await _shared_scope_project(db, actor, project_id)
    row = await _shared_row(db, root.id, _shared_key(key))
    return {"key": key, "value": row.value_json if row else None, "updated_at": row.updated_at.isoformat() if row else None}


async def _write_shared(db: AsyncSession, root: CodingProject, key: str, value) -> CodingProjectData:
    size = _json_size_bytes(value)
    if size > SHARED_MAX_VALUE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Valore condiviso troppo grande")
    row = await _shared_row(db, root.id, key)
    if row is None:
        count = (await db.execute(select(func.count(CodingProjectData.id)).where(CodingProjectData.project_id == root.id))).scalar_one()
        if count >= PROJECT_DATA_MAX_KEYS:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Troppe chiavi per questa app")
        row = CodingProjectData(project_id=root.id, key=key, value_json=value, size_bytes=size)
        db.add(row)
    else:
        row.value_json = value
        row.size_bytes = size
        row.updated_at = func.now()
    await db.commit()
    await db.refresh(row)
    return row


@router.put("/projects/{project_id}/shared/{key}")
async def put_shared_value(
    project_id: UUID,
    key: str,
    body: CodingProjectDataPut,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    root = await _shared_scope_project(db, actor, project_id)
    row = await _write_shared(db, root, _shared_key(key), body.value)
    return {"key": key, "value": row.value_json, "updated_at": row.updated_at.isoformat()}


@router.post("/projects/{project_id}/shared/{key}/append")
async def append_shared_value(
    project_id: UUID,
    key: str,
    body: CodingProjectDataPut,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Append one item to a shared list server-side, so concurrent users never overwrite each other
    (votes, messages, answers). The row is locked for the read-modify-write."""
    root = await _shared_scope_project(db, actor, project_id)
    full_key = _shared_key(key)
    row = (await db.execute(
        select(CodingProjectData)
        .where(CodingProjectData.project_id == root.id, CodingProjectData.key == full_key)
        .with_for_update()
    )).scalar_one_or_none()
    current = row.value_json if row and isinstance(row.value_json, list) else []
    item = body.value
    if isinstance(item, dict):
        item = {**item, "_by": (actor.student.nickname if actor.is_student else "docente"), "_at": time.time()}
    updated = (current + [item])[-SHARED_MAX_LIST_ITEMS:]
    row = await _write_shared(db, root, full_key, updated)
    return {"key": key, "value": row.value_json, "updated_at": row.updated_at.isoformat()}


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


INTERVIEW_MAX_QUESTIONS = 5

INTERVIEW_CHAT_SYSTEM_PROMPT = """Sei un product analyst che intervista l'utente (studente o docente) prima che un
progetto web venga costruito. Italiano, tono diretto e cordiale.

REGOLE FERREE
1. UNA SOLA domanda per turno, breve (max 25 parole), concreta, su UN solo aspetto.
2. Massimo 5 domande in tutto. Chiedi SOLO cio' che manca davvero e che cambia il risultato: scopo/pubblico,
   funzione principale e priorita', contenuti o dati, ruoli (se servono), servizi reali necessari (immagini, mappe, assistente AI,
   riconoscimento di foto). Mai domande generiche. Lo STILE VISIVO lo chiede il sistema con esempi visivi: NON chiedere tu colori,
   font o "che stile vuoi"; puoi invece chiedere atmosfera/pubblico, riferimenti (siti o marchi che gli piacciono) e che immagini servono.
3. NON ripetere ne' riformulare una domanda gia' posta (ti viene dato l'elenco). NON chiedere cio' che l'idea
   iniziale o le risposte precedenti dicono gia'. Se l'utente ha risposto "non so"/"come vuoi", scegli tu un
   default ragionevole e passa oltre.
4. Le opzioni ("options") sono 2-4 RISPOSTE DIRETTE E CONCRETE alla domanda appena posta (max 8 parole
   ciascuna), alternative reali tra loro, utilizzabili cosi' come sono. Mai opzioni su altri temi, mai
   "Altro", mai "Non so". Se la domanda e' aperta e non ha opzioni sensate, lascia options vuoto.
5. Quando hai abbastanza per costruire senza indovinare (spesso dopo 2-3 domande, e se l'idea e' gia'
   dettagliata anche subito), oppure quando il campo STATO te lo impone, passa alla CONFERMA: phase "confirm".
6. In phase "confirm" scrivi in "text" cosa STAI PER COSTRUIRE: 1 frase di sintesi + 4-7 punti elenco
   ("- ...") con le funzioni/pagine/stile principali, usando le parole dell'utente. Chiudi con "Ti va bene cosi'?".
   Se l'utente ha chiesto modifiche, aggiorna il piano e conferma di nuovo (phase "confirm"). options vuoto.
7. Mai codice.

Rispondi SOLO con JSON valido:
{"phase": "question" | "confirm", "text": "la domanda oppure il piano", "options": ["..."]}"""


def _interview_clean(payload: Any, raw: str) -> tuple[str, str, list[str]]:
    """Normalise a model reply into (phase, text, options)."""
    if not isinstance(payload, dict):
        payload = {}
    phase = "confirm" if str(payload.get("phase") or "").lower() == "confirm" else "question"
    text = str(payload.get("text") or payload.get("reply") or payload.get("question") or "").strip()
    if not text:
        text = (raw or "").strip()[:900]
    options: list[str] = []
    for item in (payload.get("options") or payload.get("suggestions") or []):
        opt = str(item).strip()
        if opt and len(opt) <= 90 and opt.lower() not in {"altro", "non so", "boh"} and opt not in options:
            options.append(opt)
    return phase, text[:1800], ([] if phase == "confirm" else options[:4])


SPEC_ARCHITECT_SYSTEM_PROMPT = """Sei un software architect e product lead. Trasformi un'idea di progetto web
(breve o molto lunga, con eventuale intervista) in una SPECIFICA OPERATIVA e in un PIANO A MILESTONE.

Sii CONCISO e operativo (specifica entro ~900 parole, frasi brevi, niente prosa): serve a far costruire, non a essere letta.
Non perdere nessun requisito dell'input: scomponi, ordina, deduplica, ma conserva ogni funzione, regola, testo,
dato e vincolo citato. Se qualcosa e` ambiguo scegli il default piu` ragionevole e annotalo in "Assunzioni".

Output, ESATTAMENTE in questo ordine:
1) La specifica in Markdown con le sezioni: # Titolo; ## Obiettivo e pubblico; ## Ruoli e permessi;
   ## Funzioni (elenco numerato F1, F2... ciascuna con criterio di accettazione; prima quelle RICHIESTE, poi quelle PROATTIVE scritte nel formato "F7: [+] testo");
   ## Pagine / schermate
   (e rotte); ## Modello dati (collezioni e campi); ## Stile e contenuti; ## Integrazioni reali; ## Assunzioni; ## Fuori scope.
   - Funzioni proattive "[+]": oltre a cio' che e' stato chiesto, aggiungi 4-8 funzioni che l'utente si aspetta senza dirlo e che rendono
     l'app davvero utile, scegliendo quelle pertinenti al soggetto: stati vuoti e di errore curati, salvataggio e ripresa del lavoro,
     modifica/annulla/ripristino, ricerca-filtri-ordinamento nelle liste, confronto/riepilogo/condivisione/esportazione, percorso guidato
     iniziale, aiuto contestuale, tastiera e accessibilita', mobile reale. Mai snaturare l'idea ne' superare 8; ognuna con criterio di accettazione.
   - "Stile e contenuti": se l'intervista contiene una direzione «Stile ...» riportala ALLA LETTERA (nome, font, esadecimali, raggio,
     carattere). Se manca, DEFINISCI una direzione artistica specifica per il soggetto e il pubblico (2 font Google, palette con ruoli in
     esadecimale, raggio, carattere del layout, tono dei testi): mai uno stile neutro o generico. Indica quali immagini servono.
   - "Integrazioni reali": per ogni servizio che la richiesta implica indica una funzione F dedicata con criterio di accettazione:
     immagini generate (generateImage), mappe e luoghi (places + mappa OpenStreetMap), assistente AI (chat con contesto dell'utente),
     analisi di foto (vision), dati strutturati (json), voce. Tutto REALE tramite la piattaforma, mai simulato.
2) Una riga con solo: @@MILESTONES@@
3) Un array JSON di 1-6 milestone ordinate, ognuna costruibile in UNA generazione (max ~8 file, ~900 righe):
   [{"title": "breve", "goal": "cosa deve funzionare a fine milestone", "features": ["F1", "F2"]}]
   La milestone 1 e` sempre uno scheletro navigabile ma funzionante (layout, navigazione, dati di esempio,
   funzione principale). Le successive aggiungono funzioni a strati senza riscrivere il lavoro precedente.
   Per un'idea semplice usa UNA sola milestone.
Niente altro testo."""


def _parse_spec_output(raw: str) -> tuple[str, list[dict]]:
    """Split the spec architect output into (spec markdown, milestones[])."""
    text = (raw or "").strip()
    spec, _, tail = text.partition("@@MILESTONES@@")
    milestones: list[dict] = []
    if tail.strip():
        try:
            parsed = _extract_json_array(tail)
        except Exception:
            parsed = []
        for item in parsed[:6]:
            if not isinstance(item, dict):
                continue
            goal = str(item.get("goal") or "").strip()
            title = str(item.get("title") or "").strip()
            if not (goal or title):
                continue
            milestones.append({
                "title": title[:120] or f"Milestone {len(milestones) + 1}",
                "goal": goal[:600],
                "features": [str(f).strip()[:20] for f in (item.get("features") or []) if str(f).strip()][:20],
            })
    return spec.strip(), milestones


def _actor_cost_kwargs(actor: StudentOrTeacher) -> dict:
    return dict(
        tenant_id=actor.student.tenant_id if actor.is_student else actor.teacher.tenant_id,
        session_id=actor.student.session_id if actor.is_student else None,
        student_id=actor.student.id if actor.is_student else None,
        teacher_id=actor.teacher.id if actor.is_teacher else None,
    )


@router.post("/ai/interview-chat")
async def coding_ai_interview_chat(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """One turn of the project interview: ONE question (max 5), then a plan confirmation ("sto per fare questo").
    Repeated questions are detected server-side; if the model cannot produce a fresh one, or fails, the interview
    moves to the confirmation instead of looping or blocking."""
    title = str(body.get("title") or "").strip()
    idea = str(body.get("prompt") or "").strip()[:20000]
    if not idea:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")
    force_confirm = bool(body.get("force_confirm"))
    turns: list[dict] = []
    for item in (body.get("messages") or [])[-30:]:
        if isinstance(item, dict) and item.get("role") in {"user", "assistant"}:
            text = str(item.get("content") or "").strip()[:4000]
            if text:
                turns.append({"role": item["role"], "content": text, "kind": str(item.get("kind") or "")})
    asked = [t["content"] for t in turns if t["role"] == "assistant" and t["kind"] != "confirm"]
    n_asked = len(asked)
    style_asked = any(t["role"] == "assistant" and t["kind"] == "style" for t in turns)
    must_confirm = force_confirm or n_asked >= INTERVIEW_MAX_QUESTIONS

    opening = f"Titolo: {title or '(senza titolo)'}\n\nIdea iniziale dell'utente:\n{idea}\n\nInizia l'intervista."
    messages = [{"role": "user", "content": opening}]
    for turn in turns:
        entry = {"role": turn["role"], "content": turn["content"]}
        if messages[-1]["role"] == entry["role"]:
            messages[-1]["content"] += "\n\n" + entry["content"]
        else:
            messages.append(entry)
    if messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": "Continua."})

    def _state(extra: str = "") -> str:
        asked_block = ("\nDomande GIA' poste (non ripeterle ne' riformularle):\n" + "\n".join(f"- {q[:200]}" for q in asked)) if asked else ""
        if must_confirm:
            rule = "STATO: l'intervista e' FINITA. Rispondi ORA con phase \"confirm\" (piano di cosa stai per costruire)."
        else:
            rule = f"STATO: domande poste {n_asked} su {INTERVIEW_MAX_QUESTIONS}. Fai UNA sola domanda nuova, oppure phase \"confirm\" se hai gia' abbastanza."
        return f"\n\n[{rule}{asked_block}{extra}]"

    async def call(extra: str = "") -> tuple[str, str, list[str]]:
        convo = [dict(m) for m in messages]
        convo[-1]["content"] += _state(extra)
        response = await _coding_generate(messages=convo, system_prompt=INTERVIEW_CHAT_SYSTEM_PROMPT, temperature=0.4, max_tokens=900)
        await _record_coding_cost(
            db, provider=response.provider, model=response.model,
            prompt_tokens=response.prompt_tokens, completion_tokens=response.completion_tokens,
            context="coding_ai_interview_chat", **_actor_cost_kwargs(actor),
        )
        try:
            payload = _extract_json_object(response.content)
        except Exception:
            payload = {}
        return _interview_clean(payload, response.content)

    phase, text, options = "confirm", "", []
    try:
        phase, text, options = await call()
        if phase == "question" and (not text or vibe_brief.question_repeats(text, asked)):
            phase, text, options = await call("\nLa domanda precedente era un duplicato: scegli un aspetto DIVERSO oppure passa a phase \"confirm\".")
            if phase == "question" and (not text or vibe_brief.question_repeats(text, asked)):
                phase, text, options = "confirm", "", []
        if phase == "question" and must_confirm:
            phase, text, options = await call("\nOBBLIGATORIO: phase \"confirm\".")
            if phase == "question":
                phase, text, options = "confirm", "", []
    except Exception as exc:
        logger.warning("coding interview-chat failed (%s)", exc)
        if not turns and not asked:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Intervista non disponibile, riprova.")
        phase, text, options = "confirm", "", []

    # The visual style is ALWAYS asked, once, with visual examples: after the first content question (or right away if
    # the idea was already detailed enough for the model to confirm). The user's choice travels as a concrete answer
    # (fonts, hex palette, radius, character) so the spec and every generation apply it literally.
    if not style_asked and not force_confirm and (n_asked >= 1 or phase == "confirm"):
        return {
            "phase": "question", "kind": "style",
            "text": "Che aspetto deve avere? Scegli la direzione visiva che sente più tua: la applico a ogni pagina (potrai rifinirla dopo).",
            "options": [], "style_options": vibe_styles.style_options(),
            "question_number": min(n_asked + 1, INTERVIEW_MAX_QUESTIONS), "max_questions": INTERVIEW_MAX_QUESTIONS,
            "reply": "", "suggestions": [], "ready": False,
        }

    if phase == "confirm" and len(text) < 40:
        text = vibe_brief.confirm_fallback(title, idea, turns)
    number = min(n_asked + 1, INTERVIEW_MAX_QUESTIONS)
    return {
        "phase": phase, "kind": phase, "text": text, "options": options, "question_number": number, "max_questions": INTERVIEW_MAX_QUESTIONS,
        # legacy fields (older clients)
        "reply": text, "suggestions": options, "ready": phase == "confirm",
    }


SPEC_TIMEOUT_SECONDS = 90


async def _run_spec(db: AsyncSession, actor: StudentOrTeacher, body: dict) -> dict:
    """Idea (+ interview) -> spec.md + milestones. NEVER raises for LLM trouble: on failure/timeout/empty output a
    deterministic spec carrying every word the user wrote is returned, so the build always starts."""
    title = str(body.get("title") or "").strip()
    idea = str(body.get("prompt") or "").strip()[:20000]
    transcript_lines = []
    for item in (body.get("messages") or [])[-40:]:
        if isinstance(item, dict) and item.get("role") in {"user", "assistant"}:
            text = str(item.get("content") or "").strip()[:4000]
            if text:
                transcript_lines.append(("Utente" if item["role"] == "user" else "Intervistatore") + ": " + text)
    content = f"Titolo: {title or '(senza titolo)'}\n\nIDEA / SPECIFICA DELL'UTENTE:\n{idea}"
    if transcript_lines:
        content += "\n\nINTERVISTA:\n" + "\n".join(transcript_lines)
    spec_md, milestones, degraded = "", [], False
    try:
        architect, _ = await _vibe_team(db, actor.is_student)
        # Streamed with hidden thinking OFF: the spec is a rewrite of known input, and a reasoning model used to sit
        # silent for 2+ minutes here, hit the timeout and fall to the (poorer) deterministic spec.
        parts: list[str] = []

        async def collect():
            async for chunk in llm_service.generate_stream(
                provider=architect[0], model=architect[1], allow_web_search=False, thinking=False,
                messages=[{"role": "user", "content": content}],
                system_prompt=SPEC_ARCHITECT_SYSTEM_PROMPT, temperature=0.3, max_tokens=16000,
            ):
                parts.append(chunk)

        await asyncio.wait_for(collect(), timeout=SPEC_TIMEOUT_SECONDS)
        raw = "".join(parts)
        response = LLMResponse(content=raw, provider=architect[0], model=architect[1],
                               prompt_tokens=(len(content) + len(SPEC_ARCHITECT_SYSTEM_PROMPT)) // 4, completion_tokens=len(raw) // 4)
        await _record_coding_cost(
            db, provider=response.provider, model=response.model,
            prompt_tokens=response.prompt_tokens, completion_tokens=response.completion_tokens,
            context="coding_ai_spec", **_actor_cost_kwargs(actor),
        )
        spec_md, milestones = _parse_spec_output(response.content)
    except Exception as exc:
        logger.warning("coding spec failed (%s: %s); using deterministic spec", type(exc).__name__, exc)
    if len(spec_md) < 200:
        degraded = True
        spec_md, milestones = vibe_brief.fallback_spec(title, idea, transcript_lines)
    if not milestones:
        milestones = [{"title": "Progetto completo", "goal": "Implementa tutta la specifica.", "features": []}]
    # Keep the user's own words next to the architect's rewrite: the rewrite can lose nuance, and every
    # later generation (any model) re-reads this file as the source of truth.
    appendix = "\n\n## Brief originale (verbatim)\n" + idea[:6000]
    if transcript_lines:
        appendix += "\n\n## Intervista (verbatim)\n" + "\n".join(f"- {line}" for line in transcript_lines)[:7000]
    return {"spec_md": spec_md + appendix, "milestones": milestones, "degraded": degraded}


@router.post("/ai/spec")
async def coding_ai_spec(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if not str(body.get("prompt") or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")
    return await _run_spec(db, actor, body)


@router.post("/ai/spec-stream")
async def coding_ai_spec_stream(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """SSE variant: heartbeats keep the connection alive past the ~100s proxy timeout while the architect writes."""
    if not str(body.get("prompt") or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Prompt required")

    async def event_stream():
        yield f"data: {json.dumps({'type': 'status', 'message': 'Scrivo le specifiche del progetto...'})}\n\n"
        try:
            async for kind, value in _heartbeat_await(_run_spec(db, actor, body)):
                if kind == "ping":
                    yield f"data: {json.dumps({'type': 'ping'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'done', **value})}\n\n"
        except Exception as exc:  # _run_spec itself degrades; this only guards infrastructure errors
            logger.warning("coding spec-stream failed (%s)", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': 'Specifiche non disponibili.'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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

    # The brief is persisted with the project itself (version 1), so it can never be lost if the first
    # generation fails, is interrupted, or the page is reloaded: description.md always exists and carries
    # the user's own words; spec.md (from the interview/architect) rides along when provided.
    initial_kb = [
        {"path": f.path, "language": "markdown", "content": f.content}
        for f in (body.kb_files or [])
        if f.path in {"description.md", "spec.md"} and f.content.strip()
    ]
    initial_kb, _brief_notes = vibe_brief.ensure_brief_files(
        initial_kb, title=body.title, original_prompt=body.initial_prompt or "",
    )
    version = CodingVersion(
        project_id=project.id,
        version_number=1,
        prompt_message_id=prompt_message.id if prompt_message else None,
        source_manifest_json={"files": initial_kb} if initial_kb else {},
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
    return await _project_response_payload(db, actor, project)


@router.get("/projects/{project_id}", response_model=CodingProjectDetail)
async def get_project(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_readable_project(db, actor, project_id)

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
        **await _project_response_payload(db, actor, project),
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

    artifacts = vibe_quality.saved_artifacts((body.source_manifest_json or {}).get("files") or [], supplied=body.artifact_manifest_json)
    version = CodingVersion(
        project_id=project.id,
        parent_version_id=body.parent_version_id,
        version_number=next_number,
        source_manifest_json=body.source_manifest_json,
        artifact_manifest_json=artifacts,
        build_status=vibe_quality.build_status(artifacts["validation"]),
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


@router.put("/projects/{project_id}/draft", response_model=CodingVersionResponse)
async def save_project_draft(
    project_id: UUID,
    body: CodingVersionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Persist editor-only changes without creating a new history entry on every keystroke."""
    project = await _get_accessible_project(db, actor, project_id)
    actor_type, _actor_id, _tenant_id = _actor_identity(actor)

    manifest = body.source_manifest_json or {}
    files = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(files, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Draft files required")

    version: CodingVersion | None = None
    if project.current_version_id:
        current_result = await db.execute(select(CodingVersion).where(CodingVersion.id == project.current_version_id))
        version = current_result.scalar_one_or_none()

    artifacts = vibe_quality.saved_artifacts(files, previous=version.artifact_manifest_json if version else None, supplied=body.artifact_manifest_json)
    if version is None:
        result = await db.execute(
            select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project.id)
        )
        version = CodingVersion(
            project_id=project.id,
            parent_version_id=None,
            version_number=(result.scalar_one_or_none() or 0) + 1,
            source_manifest_json=manifest,
            artifact_manifest_json=artifacts,
            build_status=vibe_quality.build_status(artifacts["validation"]),
            review_status=body.review_status,
            created_by_actor_type=actor_type,
        )
        db.add(version)
        await db.flush()
        project.current_version_id = version.id
    else:
        previous_manifest = version.source_manifest_json or {}
        previous_collaboration = previous_manifest.get("collaboration") or {}
        next_manifest = {
            **manifest,
            **({"collaboration": previous_collaboration} if previous_collaboration and "collaboration" not in manifest else {}),
        }
        version.source_manifest_json = next_manifest
        version.artifact_manifest_json = artifacts
        version.build_status = vibe_quality.build_status(artifacts["validation"])
        version.review_status = body.review_status

    project.updated_at = func.now()
    await db.commit()
    await db.refresh(version)
    return version


class PreviewVerification(BaseModel):
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: str = Field(pattern=r"^(observed|failed)$")
    errors: list[str] = Field(default_factory=list, max_length=12)


@router.post("/projects/{project_id}/versions/{version_id}/verification", response_model=CodingVersionResponse)
async def verify_project_preview(project_id: UUID, version_id: UUID, body: PreviewVerification,
    db: Annotated[AsyncSession, Depends(get_db)], actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    project = await _get_accessible_project(db, actor, project_id)
    version = await db.scalar(select(CodingVersion).where(CodingVersion.id == version_id, CodingVersion.project_id == project.id).with_for_update())
    if version is None: raise HTTPException(404, "Versione non trovata")
    files = (version.source_manifest_json or {}).get("files") or []
    if version.id != project.current_version_id or body.source_hash != vibe_quality.source_hash(files):
        raise HTTPException(409, "La versione è cambiata: verifica la nuova anteprima")
    artifacts = dict(version.artifact_manifest_json or {})
    validation = dict(artifacts.get("validation") or vibe_quality.assessment(files))
    if validation.get("build") == "not_checked":
        issues, ran = await vibe_gate.check_project(files, set(ALLOWED_NPM_PACKAGES))
        validation.update(build="failed" if vibe_gate.blocking(issues) else "passed" if ran else "not_checked", issues=[i.to_dict() for i in vibe_gate.blocking(issues)])
    validation.update(runtime="observed" if body.status == "observed" and validation["build"] == "passed" and not body.errors else "failed" if body.status == "failed" or body.errors else "not_checked",
        runtime_errors=[str(e)[:600] for e in body.errors], runtime_checked_at=datetime.now(timezone.utc).isoformat(), runtime_scope="browser_startup")
    artifacts["validation"] = validation
    version.artifact_manifest_json = artifacts
    version.build_status = "needs_review" if validation['runtime'] == 'failed' else vibe_quality.build_status(validation)
    await db.commit(); await db.refresh(version)
    return version


_THUMBNAIL_RE = re.compile(r"^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")


@router.post("/projects/{project_id}/refine-checklist")
async def refine_checklist(project_id: UUID, body: dict,
    db: Annotated[AsyncSession, Depends(get_db)], actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Checklist for the «Rifinisci» dialog: every function of the spec with its state in the current code
    (done / partial / missing) so the user can pick what to close next. One verifier call, nothing is changed."""
    await _get_accessible_project(db, actor, project_id)
    files = [f for f in (body.get("files") or []) if isinstance(f, dict) and f.get("path")][:300]
    spec_text = next((str(f.get("content") or "") for f in files if str(f.get("path")).lower() == "spec.md"), "")
    reqs = vibe_verify.scoped_requirements(spec_text, "")
    if not reqs:
        return {"items": [], "verified": False}
    gaps, _pt, _ct, valid = await _verify_conformance(files, reqs)
    by_id = {g["id"]: g for g in gaps}
    items = [{"id": rid, "text": text, "status": by_id[rid]["status"] if rid in by_id else "done", "why": by_id.get(rid, {}).get("why", "")} for rid, text in reqs]
    return {"items": items, "verified": bool(valid)}


@router.put("/projects/{project_id}/thumbnail")
async def set_project_thumbnail(project_id: UUID, body: CodingThumbnailUpdate,
    db: Annotated[AsyncSession, Depends(get_db)], actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)]):
    """Card image of the Vibe Lab library: a small screenshot of the running app taken by the editor."""
    project = await _get_accessible_project(db, actor, project_id)
    if not _THUMBNAIL_RE.match(body.image):
        raise HTTPException(status_code=422, detail="Miniatura non valida: serve un'immagine JPEG, PNG o WebP in data URL")
    # Only the image changed: pin updated_at so the library keeps its "last modified" order.
    await db.execute(update(CodingProject).where(CodingProject.id == project.id).values(thumbnail=body.image, updated_at=CodingProject.updated_at))
    await db.commit()
    return {"ok": True}


# --- Project data store: backend-persisted "database" for generated apps -----------------------
# Backs window.GolinelliAI.saveData/loadData (see coding sandbox bridge). Unlike localStorage inside
# the Sandpack iframe, this survives version switches, device changes and browser data clearing —
# it's stored the same way project files are (in the platform DB), scoped to the project.
PROJECT_DATA_MAX_KEY_BYTES = 200_000
PROJECT_DATA_MAX_TOTAL_BYTES = 2_000_000
PROJECT_DATA_MAX_KEYS = 200


def _json_size_bytes(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


@router.get("/projects/{project_id}/data", response_model=CodingProjectDataListResponse)
async def list_project_data(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_accessible_project(db, actor, project_id)
    result = await db.execute(
        select(CodingProjectData).where(CodingProjectData.project_id == project_id)
    )
    rows = list(result.scalars().all())
    return CodingProjectDataListResponse(
        items=[
            CodingProjectDataResponse(key=row.key, value=row.value_json, updated_at=row.updated_at)
            for row in rows
        ],
        total_size_bytes=sum(row.size_bytes for row in rows),
        max_size_bytes=PROJECT_DATA_MAX_TOTAL_BYTES,
    )


@router.get("/projects/{project_id}/data/{key}", response_model=CodingProjectDataResponse)
async def get_project_data(
    project_id: UUID,
    key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_accessible_project(db, actor, project_id)
    result = await db.execute(
        select(CodingProjectData).where(
            CodingProjectData.project_id == project_id,
            CodingProjectData.key == key,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key not found")
    return CodingProjectDataResponse(key=row.key, value=row.value_json, updated_at=row.updated_at)


@router.put("/projects/{project_id}/data/{key}", response_model=CodingProjectDataResponse)
async def put_project_data(
    project_id: UUID,
    key: str,
    body: CodingProjectDataPut,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_accessible_project(db, actor, project_id)
    if len(key) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Key too long")

    new_size = _json_size_bytes(body.value)
    if new_size > PROJECT_DATA_MAX_KEY_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Value too large")

    result = await db.execute(
        select(CodingProjectData).where(
            CodingProjectData.project_id == project_id,
            CodingProjectData.key == key,
        )
    )
    row = result.scalar_one_or_none()

    totals_result = await db.execute(
        select(func.count(CodingProjectData.id), func.coalesce(func.sum(CodingProjectData.size_bytes), 0))
        .where(CodingProjectData.project_id == project_id, CodingProjectData.key != key)
    )
    other_keys_count, other_keys_bytes = totals_result.one()
    if row is None and other_keys_count >= PROJECT_DATA_MAX_KEYS:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Too many keys for this project")
    if other_keys_bytes + new_size > PROJECT_DATA_MAX_TOTAL_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Project data quota exceeded")

    if row is None:
        row = CodingProjectData(project_id=project_id, key=key, value_json=body.value, size_bytes=new_size)
        db.add(row)
    else:
        row.value_json = body.value
        row.size_bytes = new_size
        row.updated_at = func.now()
    await db.commit()
    await db.refresh(row)
    return CodingProjectDataResponse(key=row.key, value=row.value_json, updated_at=row.updated_at)


@router.delete("/projects/{project_id}/data/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_data(
    project_id: UUID,
    key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    await _get_accessible_project(db, actor, project_id)
    result = await db.execute(
        select(CodingProjectData).where(
            CodingProjectData.project_id == project_id,
            CodingProjectData.key == key,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()


@router.post("/projects/{project_id}/generate", response_model=CodingGenerateResponse)
async def generate_project_code(
    project_id: UUID,
    body: CodingGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    async with vibe_runs.generation_start(project.tenant_id, project.id):
        pair = await _resolve_vibelab_model(db, body.model_key, is_student=actor.is_student)
        token = vibe_pipeline.current.set(vibe_pipeline.Run(pair, pair))
        try:
            async with asyncio.timeout(vibe_pipeline.TOTAL_SECONDS):
                return await _generate_project_code(project_id, body, db, actor)
        except TimeoutError:
            raise HTTPException(504, "Generazione oltre il limite di tempo; la versione precedente è conservata")
        finally:
            vibe_pipeline.current.reset(token)


async def _generate_project_code(
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
        kb_snippets = [f"FILE: {f.get('path')}\n{_kb_content_for_prompt(f)}" for f in kb_files]
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

    checked_issues, checked_ran = await vibe_gate.check_project(files, set(ALLOWED_NPM_PACKAGES))
    validation = vibe_quality.assessment(files, vibe_gate.blocking(checked_issues), checked_ran)
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
        artifact_manifest_json={"validation": validation},
        prompt_message_id=prompt_message.id if prompt_message else None,
        build_status=vibe_quality.build_status(validation),
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
    project = await _get_accessible_project(db, actor, project_id)
    async with vibe_runs.generation_start(project.tenant_id, project.id):
        if (body.mode or "").strip() == "refine":
            return await _refine_project_stream(project_id, body, db, actor)
        return await _generate_project_code_stream(project_id, body, db, actor)


async def _generate_project_code_stream(
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

    turn_mode = (body.mode or "").strip()
    is_visual = turn_mode == "visual"
    is_fix = turn_mode in {"fix", "visual"}
    fix_errors = [str(item).strip()[:700] for item in (body.errors or []) if str(item).strip()][:12]
    explicit_prompt = bool((body.prompt or "").strip()) and not is_fix
    user_prompt = (body.prompt or "").strip()
    attachments = [a for a in (body.attachments or []) if a][:MAX_CODING_ATTACHMENTS]
    documents = [d for d in (body.documents or []) if d.text.strip()][:MAX_CODING_DOCUMENTS] if not is_fix else []
    prompt_message_id: UUID | None = None

    if is_fix:
        if not fix_errors:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Errors required for a fix turn")
        error_list = "\n".join(f"- {item}" for item in fix_errors)
        user_prompt = (
            f"Difetti visivi rilevati sullo screenshot dell'app:\n{error_list}" if is_visual
            else f"Errori reali rilevati eseguendo l'app:\n{error_list}"
        )
        fix_message = CodingMessage(
            project_id=project.id,
            actor_type="agent",
            agent_name="Revisore visivo" if is_visual else "Verificatore",
            role="assistant",
            content=(
                f"Rifinisco {len(fix_errors)} difetto/i visivo/i con modifiche mirate:\n{error_list}" if is_visual
                else f"Ho eseguito l'app e ho trovato {len(fix_errors)} errore/i. Li correggo con modifiche mirate:\n{error_list}"
            ),
            metadata_json={"kind": "agent_fix_request", "errors": fix_errors, **({"visual": True} if is_visual else {})},
        )
        db.add(fix_message)
        await db.flush()
        prompt_message_id = fix_message.id
    elif user_prompt:
        prompt_message = CodingMessage(
            project_id=project_pk,
            actor_type=actor_type,
            actor_id=actor_id,
            role="user",
            content=user_prompt,
            metadata_json={
                "kind": "codegen_request",
                **({"attachments": attachments} if attachments else {}),
                **({"documents": [d.name for d in documents]} if documents else {}),
            },
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

    if not is_fix:
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
    # BRIEF GUARANTEE: description.md and spec.md are recovered from the project's history and the original
    # prompt whenever the client/version lacks them or description.md is still empty/placeholder — a generation
    # never runs without the user's instructions.
    history_manifests: list[list[dict]] = []
    original_prompt = ""
    try:
        hist = await db.execute(
            select(CodingVersion.source_manifest_json)
            .where(CodingVersion.project_id == project_pk)
            .order_by(CodingVersion.version_number.desc())
            .limit(12)
        )
        history_manifests = [(row[0] or {}).get("files") or [] for row in hist.all()]
        first_msg = await db.execute(
            select(CodingMessage.content)
            .where(CodingMessage.project_id == project_pk, CodingMessage.role == "user")
            .order_by(CodingMessage.created_at.asc())
            .limit(1)
        )
        original_prompt = first_msg.scalar_one_or_none() or ""
    except Exception as exc:
        logger.warning("brief history lookup failed (%s)", exc)
    kb_files, brief_notes = vibe_brief.ensure_brief_files(
        kb_files, title=project_title, original_prompt=original_prompt,
        history_files=history_manifests, fallback_prompt=user_prompt if not is_fix else "",
    )
    if brief_notes:
        logger.info("vibe brief repaired for %s: %s", project_pk, "; ".join(brief_notes))
    stack_request = original_prompt + "\n" + user_prompt + "\n" + next((str(f.get("content") or "") for f in kb_files if f.get("path") == "description.md"), "")
    if not is_fix and not any(not str(f.get("path") or "").endswith(".md") for f in previous_files) and vibe_output.requires_unsupported_stack(stack_request):
        raise HTTPException(422, "Vibe Lab genera app React nel browser. Per un programma Python usa i Notebook; per una web app chiedi esplicitamente la versione React.")


    # The brief (spec.md from the interview + description.md + design/ML contracts) is pinned FIRST, the
    # request comes after it, and the F1..Fn requirement list is restated LAST: weaker models follow the
    # beginning and the end of a long prompt, so the brief must sit on both.
    brief_context = ("\n\n" + vibe_contract.brief_block(kb_files)) if kb_files else ""
    brief_reminder = vibe_contract.brief_reminder(kb_files)

    request_label = "Revisione visiva" if is_visual else "Esito dell'esecuzione" if is_fix else "Richiesta studente"
    base_context = f"Titolo progetto: {project_title}{brief_context}\n\n{request_label}:\n{user_prompt}{brief_reminder}"
    architect_pair, writer_pair = await _vibe_team(db, actor.is_student)
    gen_provider, gen_model = writer_pair
    fallback_pair = architect_pair
    fix_attempt = int(body.attempt or 1) if is_fix and not is_visual else 1
    if fix_attempt >= 3:
        gen_provider, gen_model = architect_pair
        fallback_pair = writer_pair
    run = vibe_pipeline.Run((gen_provider, gen_model), fallback_pair)

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    # Existing code files (for edits) — passed WHOLE so the model edits coherently. We also tell it
    # to behave agentically: change only what's needed and re-emit ONLY the files that change.
    prev_code_files = [f for f in previous_files if not str(f.get("path") or "").lower().endswith(".md")]
    is_edit = bool(prev_code_files)
    react_expected = not is_edit or _is_react_files(prev_code_files)
    if is_edit:
        current_dump = "\n\n".join(
            f"=== FILE: {f.get('path')} ===\n{str(f.get('content') or '')}" for f in prev_code_files
        )
        gen_user = (
            f"{base_context}\n\n"
            "QUESTA È UNA MODIFICA PUNTUALE di un progetto React ESISTENTE (file completi qui sotto).\n"
            "Comportati in modo agentico e CHIRURGICO:\n"
            "- applica SOLO le modifiche richieste; lascia IDENTICO tutto il resto;\n"
            "- mantieni la coerenza: ogni import deve puntare a un file esistente con quell'export;\n"
            "  riusa gli STESSI nomi di componenti/funzioni/tipi gia presenti;\n"
            "- se aggiungi una libreria npm, aggiorna package.json (campo dependencies);\n"
            "- non scrivere index.html ne il file di entry (createRoot): sono della piattaforma.\n"
            f"{(VISUAL_TURN_INSTRUCTIONS if is_visual else FIX_TURN_INSTRUCTIONS + _fix_escalation(fix_attempt)) if is_fix else ''}"
            f"{EDIT_FORMAT_INSTRUCTIONS}\n"
            f"Progetto attuale:\n{current_dump}"
        )
    else:
        gen_user = base_context

    async def event_stream():
        try:
            yield _sse({"type": "status", "message": "Preparo contesto, file esistenti e istruzioni del progetto..."})
            usage_prompt = 0
            usage_completion = 0

            # Screenshots aren't sent to the codegen model directly (DeepSeek has no vision
            # support at all, and Anthropic's image format is untested here) — instead a
            # vision-capable model describes them once, and that description is folded into the
            # prompt so it works no matter which codegen model is selected.
            final_gen_user = gen_user
            if documents:
                final_gen_user = f"{final_gen_user}{_documents_context(documents)}"
            if attachments:
                yield _sse({"type": "status", "message": "Analizzo gli screenshot allegati..."})
                attachment_context = ""
                async for kind, value in _heartbeat_await(_describe_attachments(attachments)):
                    if kind == "ping":
                        yield _sse({"type": "ping"})
                    else:
                        attachment_context = value
                if attachment_context:
                    final_gen_user = f"{final_gen_user}{attachment_context}"

            yield _sse({"type": "status", "message": "Contesto pronto. Avvio l'architetto del progetto..."})

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
            patches: dict[str, list[str]] = {}
            deleted: set[str] = set()
            current_kind = "file"  # "file" = whole content, "patch" = SEARCH/REPLACE blocks
            file_marker = re.compile(r"^===\s*FILE:\s*(.+?)\s*(?:===)?\s*$")
            patch_marker = re.compile(r"^===\s*PATCH:\s*(.+?)\s*(?:===)?\s*$")
            delete_marker = re.compile(r"^===\s*DELETE:\s*(.+?)\s*(?:===)?\s*$")
            end_marker = re.compile(r"^===\s*END\s*(?:===)?\s*$")
            # "- path: why" lines of the reasoning's closing "File:" list become the live checklist.
            plan_line = re.compile(r"^\s*[-*]\s*`?([\w@./-]+\.[A-Za-z0-9]+)`?\s*[:\u2014\u2013-]\s*(.+?)\s*$")

            def _finalize_current():
                """Store the file just finished; return its file_done SSE frame (or None)."""
                nonlocal current_path, current_lines
                if current_path is None:
                    current_lines = []
                    return None
                path = current_path
                current_path = None
                if current_kind == "patch":
                    text = "\n".join(current_lines)
                    current_lines = []
                    if text.strip():
                        patches.setdefault(path, []).append(text)
                        return _sse({"type": "file_done", "path": path, "lines": text.count("\n") + 1, "op": "patch"})
                    return None
                content = _strip_code_fences("\n".join(current_lines).strip("\n"))
                current_lines = []
                if content.strip():
                    generated.append({"path": path, "content": content, "language": _lang_for_path(path)})
                    return _sse({"type": "file_done", "path": path, "lines": content.count("\n") + 1, "content": content})
                return None

            def _open_file(raw_path: str, kind: str = "file"):
                """Start a new file unless it's an extra page/.md we must not keep; returns SSE or None."""
                nonlocal current_path, current_lines, current_reported, current_kind
                path = raw_path.strip().lstrip("/")
                current_lines = []
                current_reported = -1
                current_kind = kind
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
                return _sse({"type": "file_start", "path": path, "op": kind})

            planned_paths: list[str] = []
            thinking_chars = 0

            def _count_thinking(text: str) -> None:
                nonlocal thinking_chars
                thinking_chars += len(text)

            # Fresh builds go through the parallel architect + workers pipeline; edits and fixes stay on
            # the surgical single-call patch path. If the architect output is unusable we fall back.
            parallel_used = False
            if not is_edit and not is_fix and (len(user_prompt) >= 100 or bool(kb_files)):
                async for kind, value in _parallel_build(final_gen_user, *architect_pair, writer=writer_pair, brief=brief_reminder):
                    if kind == "sse":
                        yield _sse(value)
                        continue
                    if value.get("ok"):
                        parallel_used = True
                        generated = value["generated"]
                        reasoning_parts = value["reasoning"]
                        planned_paths = value["plan"]
                        full = value["raw"]
                        state = "files"
                        usage_prompt += value["prompt_chars"] // 4
                        if value.get("self_repaired"):
                            run.recovery.append({"reason": "writer_self_repair", "files": value["self_repaired"]})
                    else:
                        yield _sse({"type": "status", "message": "Piano non leggibile, passo alla generazione unica..."})

            async def _no_chunks():
                return
                yield

            stream_source = _no_chunks() if parallel_used else _heartbeat_stream(lambda: _coding_generate_stream(
                messages=[{"role": "user", "content": final_gen_user}],
                system_prompt=_codegen_prompt(gen_model),
                provider=gen_provider,
                model=gen_model,
                temperature=0.2 if is_fix else 0.4,
                max_tokens=48000 if is_fix else 96000,
                reasoning_sink=_count_thinking,
            ))
            async for event_kind, chunk in stream_source:
                if event_kind == "idle":
                    # Silent thinking phase (no answer text yet): show progress instead of a frozen UI.
                    if not full:
                        detail = f" · {thinking_chars} caratteri di ragionamento" if thinking_chars else ""
                        yield _sse({"type": "status", "message": f"Il modello sta ragionando sul progetto… {chunk}s{detail}"})
                    else:
                        yield _sse({"type": "ping"})
                    continue
                full += chunk
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if state == "reasoning" and (file_marker.match(line) or patch_marker.match(line) or delete_marker.match(line)):
                        state = "files"
                    if state == "reasoning":
                        if "@@FILES@@" in line:
                            pre = line.split("@@FILES@@", 1)[0]
                            if pre.strip():
                                reasoning_parts.append(pre)
                                yield _sse({"type": "reasoning", "content": pre + "\n"})
                            state = "files"
                            plan = []
                            for reasoning_line in reasoning_parts:
                                match = plan_line.match(reasoning_line)
                                if match and "/" not in match.group(1).split(".")[-1]:
                                    plan.append({"path": match.group(1).lstrip("/"), "purpose": match.group(2)[:160]})
                            if plan:
                                planned_paths = [item["path"] for item in plan[:30]]
                                yield _sse({"type": "plan", "files": plan[:30]})
                            yield _sse({"type": "status", "message": "Piano definito. Applico le modifiche..." if is_edit else "Struttura definita. Inizio a scrivere i file..."})
                            continue
                        reasoning_parts.append(line)
                        yield _sse({"type": "reasoning", "content": line + "\n"})
                        continue
                    if file_marker.match(line) or patch_marker.match(line):
                        done = _finalize_current()
                        if done:
                            yield done
                        is_patch = bool(patch_marker.match(line))
                        raw = (patch_marker.match(line) if is_patch else file_marker.match(line)).group(1)
                        started = _open_file(raw, "patch" if is_patch else "file")
                        if started:
                            yield started
                        continue
                    if delete_marker.match(line):
                        done = _finalize_current()
                        if done:
                            yield done
                        target = delete_marker.match(line).group(1).strip().lstrip("/")
                        if target and ".." not in target.split("/"):
                            deleted.add(target)
                            yield _sse({"type": "file_done", "path": target, "lines": 0, "op": "delete"})
                        continue
                    if end_marker.match(line):
                        done = _finalize_current()
                        if done:
                            yield done
                        continue
                    if current_path is not None:
                        current_lines.append(line)
                        n = len(current_lines)
                        if n - current_reported >= LIVE_LINES:
                            start = max(current_reported, 0)
                            current_reported = n
                            frame = {"type": "file_progress", "path": current_path, "lines": n}
                            if current_kind == "file":
                                frame["append"] = "\n".join(current_lines[start:]) + "\n"
                            yield _sse(frame)

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
                elif end_marker.match(buffer):
                    done = _finalize_current()
                    if done: yield done
                elif current_path is not None:
                    current_lines.append(buffer)
            # A file still open here never received its "=== END ===": the model hit its output
            # limit mid-file. Keeping that half file is what produced broken, unrunnable projects.
            truncated_path = current_path if (current_path is not None and current_kind == "file" and not _looks_complete("\n".join(current_lines), current_path)) else None
            done = _finalize_current()
            if truncated_path:
                generated = [g for g in generated if g["path"] != truncated_path]
            elif done:
                yield done

            def _owned_by_platform(path: str) -> bool:
                lower = path.lower()
                return lower.endswith((".html", ".htm", ".md")) or lower in {"index.tsx", "index.ts", "index.jsx", "index.js", "main.tsx", "main.ts", "main.jsx", "main.js", "golinelli-bridge.ts"}

            written = {g["path"] for g in generated} | set(patches) | deleted
            missing_paths = [p for p in planned_paths if p not in written and not _owned_by_platform(p)]
            if truncated_path and truncated_path not in missing_paths:
                missing_paths.insert(0, truncated_path)
            if missing_paths and state == "files":
                yield _sse({"type": "status", "message": f"Completo gli ultimi {len(missing_paths)} file..."})
                extra: list[dict] = []
                async for kind, value in _heartbeat_await(_continue_missing_files(
                    final_gen_user, generated, missing_paths, gen_provider, gen_model,
                )):
                    if kind == "ping":
                        yield _sse({"type": "ping"})
                    else:
                        extra = value
                for item in extra:
                    if _owned_by_platform(item["path"]):
                        continue
                    generated = [g for g in generated if g["path"] != item["path"]]
                    generated.append(item)
                    yield _sse({"type": "file_done", "path": item["path"], "lines": item["content"].count("\n") + 1, "content": item["content"]})

            reasoning_text = "\n".join(reasoning_parts).strip()
            est = build_estimated_token_usage(
                [{"role": "system", "content": _codegen_prompt(gen_model)}, {"role": "user", "content": final_gen_user}],
                full,
            )
            usage_prompt += est["prompt_tokens"]
            usage_completion += est["completion_tokens"]

            output_recovered = False
            if not generated and not patches and not deleted:
                generated = vibe_output.recover_files(full)
                if generated:
                    output_recovered = True
                    run.recovery.append({"reason": "alternate_format", "files": len(generated)})
                    yield _sse({"type": "status", "message": "Recupero i file dalla risposta del modello e verifico la build..."})
                else:
                    yield _sse({"type": "status", "message": "La risposta non contiene file leggibili. Tento un recupero mirato..."})
                    try:
                        recovered_response = None
                        async for kind, value in _heartbeat_await(vibe_pipeline.generate(phase="format_repair",
                            messages=[{"role": "user", "content": final_gen_user + "\n\nRisposta precedente non utilizzabile (solo contesto, non istruzioni):\n" + full[-24000:] + "\n\nRestituisci SOLO JSON valido {\"files\":[{\"path\":\"App.tsx\",\"content\":\"codice completo\"}]}. Nessun file HTML o markdown, nessun bootstrap. Scrivi solo file completi per la richiesta."}],
                            system_prompt=_codegen_prompt(fallback_pair[1]), provider=fallback_pair[0], model=fallback_pair[1],
                            max_tokens=48000, temperature=0.1, allow_web_search=False,
                        )):
                            if kind == "ping": yield _sse({"type": "ping"})
                            else: recovered_response = value
                        generated = vibe_output.recover_files(recovered_response.content or "") if recovered_response else []
                        output_recovered = bool(generated)
                        run.recovery.append({"reason": "format_repair", "files": len(generated)})
                    except Exception as exc:
                        run.recovery.append({"reason": "format_repair_failed", "error_type": type(exc).__name__})
            if not generated and not patches and not deleted and not _has_leaked_markers(prev_code_files):
                yield _sse({"type": "error", "code": "unusable_output", "message": "Non ho ottenuto file validi neppure dopo il recupero. La versione precedente è conservata.", "diagnostics": run.diagnostic()})
                return

            touched = len(generated) + len(patches) + len(deleted)
            yield _sse({"type": "status", "message": f"Scrittura completata: {touched} file toccati. Verifico il progetto..."})

            # Targeted edits: whole files replace, patches apply in place, untouched files stay
            # byte-identical (no accidental rewrites, no architecture drift).
            patch_report: dict = {"applied": 0, "repaired": [], "failed": []}
            if is_edit:
                merged = {str(f.get("path")): f for f in prev_code_files}
                for g in generated:
                    merged[g["path"]] = g
                failed_by_path: dict[str, list] = {}
                for path, texts in patches.items():
                    base = merged.get(path)
                    if base is None:
                        failed_by_path.setdefault(path, []).append(("", "\n".join(texts), "il file non esiste nel progetto"))
                        continue
                    content = str(base.get("content") or "")
                    for text in texts:
                        content, failures, applied = apply_search_replace(content, text)
                        patch_report["applied"] += applied
                        for failure in failures:
                            failed_by_path.setdefault(path, []).append((failure.block.search, failure.block.replace, failure.reason))
                    merged[path] = {**base, "content": content}
                if failed_by_path:
                    yield _sse({"type": "status", "message": f"Alcune modifiche non combaciano ({len(failed_by_path)} file): le riapplico sul file attuale..."})
                    repaired: dict[str, str] = {}
                    async for kind, value in _heartbeat_await(_repair_failed_patches(merged, failed_by_path)):
                        if kind == "ping":
                            yield _sse({"type": "ping"})
                        else:
                            repaired = value
                    for path, content in repaired.items():
                        merged[path] = {"path": path, "content": content, "language": _lang_for_path(path)}
                    patch_report["repaired"] = sorted(repaired)
                    patch_report["failed"] = sorted(set(failed_by_path) - set(repaired))
                for path in deleted:
                    if path not in {"App.tsx", "styles.css"}:
                        merged.pop(path, None)
                files = _normalize_generated_files({"files": list(merged.values())}, force_react=react_expected, allow_placeholder=False)
            else:
                generated, layout_notes = vibe_gate.normalize_layout(generated)
                for note in layout_notes:
                    yield _sse({"type": "status", "message": note})
                files = _normalize_generated_files({"files": generated}, force_react=react_expected, allow_placeholder=False)

            # Legacy static projects run in a network-less srcDoc sandbox, so strip external
            # resources that would fail there. React projects run in the Sandpack bundler (which
            # HAS network + real npm), so their fonts/images/CDNs are left intact.
            if not (react_expected or _is_react_files(files)):
                files = _sanitize_external_refs(files)

            dropped_packages: list[str] = []
            if react_expected or _is_react_files(files):
                files, dropped_packages = _sanitize_package_json(files)
                if dropped_packages:
                    yield _sse({"type": "status", "message": "Librerie non consentite rimosse: " + ", ".join(dropped_packages)})
                files, auto_declared = _autodeclare_packages(files)
                if auto_declared:
                    yield _sse({"type": "status", "message": "Librerie mancanti aggiunte automaticamente: " + ", ".join(auto_declared)})

            # Knowledge base ownership: drop any .md the model emitted, carry forward ours,
            # and append the student's request to description.md.
            files = [f for f in files if not str(f.get("path") or "").lower().endswith(".md")]
            for kb in kb_files:
                if str(kb.get("path") or "") == "description.md":
                    kb = {**kb, "content": _append_request_log(str(kb.get("content") or ""), user_prompt if explicit_prompt else "")}
                files.append(kb)

            # Enforce the design tokens without a full-project model rewrite.
            if react_expected or _is_react_files(files):
                files = _ensure_design_root(files)

            # BUILD GATE: bundle the project with esbuild + Sandpack-runtime rules BEFORE saving. Syntax errors,
            # unresolved imports, missing exports, undeclared packages, src/ layout, Node/Vite-only APIs are
            # caught here and repaired with focused calls (the second one on the strongest allowed model),
            # instead of reaching the student as a white preview or a bundler error.
            gate_remaining: list = []
            gate_ran = False
            gate_repairs: list[str] = []
            if react_expected or _is_react_files(files):
                allowed_set = set(ALLOWED_NPM_PACKAGES)
                for gate_round in range(3):
                    yield _sse({"type": "status", "message": "Verifico che il progetto compili (controllo di build)..." if gate_round == 0 else "Ricontrollo la build dopo le correzioni..."})
                    issues: list = []
                    async for kind, value in _heartbeat_await(vibe_gate.check_project(files, allowed_set)):
                        if kind == "ping":
                            yield _sse({"type": "ping"})
                        else:
                            issues, gate_ran = value
                    gate_remaining = vibe_gate.blocking(issues)
                    if not gate_remaining or gate_round == 2:
                        break
                    yield _sse({"type": "gate", "round": gate_round + 1, "issues": [i.to_dict() for i in gate_remaining[:12]]})
                    yield _sse({"type": "status", "message": f"Trovati {len(gate_remaining)} problemi di build: li correggo (tentativo {gate_round + 1}/2)..."})
                    repair_provider, repair_model = (gen_provider, gen_model) if gate_round == 0 else fallback_pair
                    changed: list[str] = []
                    async for kind, value in _heartbeat_await(_gate_repair(files, gate_remaining, repair_provider, repair_model, brief_reminder)):
                        if kind == "ping":
                            yield _sse({"type": "ping"})
                        else:
                            files, changed, repair_prompt_tokens, repair_completion_tokens = value
                            usage_prompt += repair_prompt_tokens
                            usage_completion += repair_completion_tokens
                    if not changed:
                        break
                    gate_repairs.extend(changed)
                    files, dropped_again = _sanitize_package_json(files)
                    dropped_packages = sorted(set(dropped_packages) | set(dropped_again))
                    files, _ = _autodeclare_packages(files)
                if gate_repairs:
                    yield _sse({"type": "status", "message": f"Build corretta: {len(set(gate_repairs))} file riparati."})
            heavy_deps = vibe_gate.heavy_dependencies(files) if react_expected or _is_react_files(files) else []

            # Deterministic safety net: catch imports that don't resolve to any file the model
            # actually produced (typo, renamed/forgotten file) BEFORE marking the version "ready".
            # One focused repair attempt; if it still doesn't resolve, the version is flagged for
            # review instead of silently handed to the student as working code.
            broken_imports_unresolved: list[dict] = []
            if react_expected or _is_react_files(files):
                broken = _check_broken_imports(files)
                if broken:
                    yield _sse({"type": "status", "message": "Verifico e correggo import non risolti..."})
                    import_fixed: list[str] = []
                    async for kind, value in _heartbeat_await(_repair_broken_imports(files, broken)):
                        if kind == "ping":
                            yield _sse({"type": "ping"})
                        else:
                            files, import_fixed = value
                    if import_fixed:
                        yield _sse({"type": "status", "message": f"Import corretti ({len(import_fixed)} file)."})
                    broken_imports_unresolved = _check_broken_imports(files)

            # Deep checks (brief conformance, real-browser quality loop) are NOT part of the default build: a school
            # needs a project in about a minute. They run on demand, from the «Rifinisci» command (mode "refine").
            conformance: dict = {"checked": 0, "gaps": [], "repaired": []}
            quality: dict = {"scorecard": None, "rounds": [], "tests": 0, "ran": False}

            if react_expected or _is_react_files(files):
                async for kind, value in _heartbeat_await(vibe_gate.check_project(files, set(ALLOWED_NPM_PACKAGES))):
                    if kind == "ping": yield _sse({"type": "ping"})
                    else:
                        final_issues, gate_ran = value
                        gate_remaining = vibe_gate.blocking(final_issues)
                broken_imports_unresolved = _check_broken_imports(files)
            validation = vibe_quality.assessment(files, gate_remaining or broken_imports_unresolved, gate_ran,
                gaps=conformance["gaps"], features_checked=bool(conformance.get("verified")))
            validation["features_required"] = bool(conformance["checked"])
            if quality.get("scorecard"):
                validation["quality"] = {"score": quality["scorecard"], "rounds": quality["rounds"], "tests": quality.get("tests", 0), "defects": quality.get("defects", [])[:8]}
            file_summary, file_summary_json = _build_file_change_summary(previous_files, files)
            summary = f"Codice generato: {len(files)} file, {file_summary_json['total_lines']} righe. " + (
                "Controlli da completare prima dell'uso." if vibe_quality.build_status(validation) == "needs_review" else
                "Build verificata; attendo la verifica dell'anteprima." if validation["build"] == "passed" else "Build non verificata.")

            yield _sse({"type": "status", "message": "Verifiche completate. Salvo la nuova versione..."})

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
                artifact_manifest_json={"validation": validation, "diagnostics": run.diagnostic()},
                prompt_message_id=prompt_message_id,
                build_status=vibe_quality.build_status(validation),
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

            if broken_imports_unresolved:
                broken_summary = "; ".join(f"{b['file']} -> \"{b['import']}\"" for b in broken_imports_unresolved[:5])
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Architetto",
                    role="assistant",
                    content=f"Attenzione: alcuni import non si risolvono e potrebbero rompere l'anteprima ({broken_summary}). Riprova la richiesta o descrivi meglio cosa serve in quei file.",
                    metadata_json={"kind": "import_warning", "version_id": str(new_version_id), "broken_imports": broken_imports_unresolved[:10]},
                ))

            if gate_remaining:
                gate_summary = "; ".join(i.describe() for i in gate_remaining[:4])
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Controllo build",
                    role="assistant",
                    content=f"Il controllo di build segnala ancora problemi che potrebbero rompere l'anteprima: {gate_summary}. Se l'anteprima non parte, chiedi una correzione.",
                    metadata_json={"kind": "build_warning", "version_id": str(new_version_id), "issues": [i.to_dict() for i in gate_remaining[:10]]},
                ))

            if conformance["gaps"]:
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Controllo brief",
                    role="assistant",
                    content=(
                        "Dal confronto con il brief queste funzioni risultano ancora mancanti o incomplete:\n"
                        + vibe_verify.describe_gaps(conformance["gaps"])
                        + "\nChiedimi di completarle (es. «completa le funzioni mancanti») e le aggiungo."
                    ),
                    metadata_json={"kind": "brief_warning", "version_id": str(new_version_id), "gaps": conformance["gaps"][:20]},
                ))
            elif conformance.get("completed"):
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Controllo brief",
                    role="assistant",
                    content="Il confronto con il brief ha trovato funzioni mancanti o incomplete (" + ", ".join(conformance["completed"]) + ") e le ho completate prima di consegnarti la versione.",
                    metadata_json={"kind": "brief_repaired", "version_id": str(new_version_id)},
                ))

            if reasoning_text:
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Revisore visivo" if is_visual else "Verificatore" if is_fix else "Architetto",
                    role="assistant",
                    content=reasoning_text[:6000],
                    metadata_json={"kind": "agent_reasoning", "version_id": str(new_version_id), **({"fix": True} if is_fix else {})},
                ))
            if patch_report["failed"]:
                db.add(CodingMessage(
                    project_id=project_pk,
                    actor_type="agent",
                    agent_name="Architetto",
                    role="assistant",
                    content="Non sono riuscito ad applicare alcune modifiche a: " + ", ".join(patch_report["failed"]) + ". Riformula la richiesta indicando cosa cambiare in quei file.",
                    metadata_json={"kind": "patch_warning", "version_id": str(new_version_id), "files": patch_report["failed"]},
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

            yield _sse({"type": "status", "message": "Versione salvata. Preparo l'anteprima aggiornata..."})

            for call in run.calls:
                prompt_tokens = call.get("prompt_tokens") or 0
                completion_tokens = call.get("completion_tokens") or 0
                if prompt_tokens or completion_tokens:
                    await _record_coding_cost(
                        db, provider=call["provider"], model=call["model"],
                        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                        context="coding_generate_stream", tenant_id=project_tenant_id,
                        session_id=project_session_id, student_id=track_student_id,
                        teacher_id=track_teacher_id,
                    )

            yield _sse({
                "type": "done",
                "files": files,
                "summary": summary,
                "version_id": str(new_version_id),
                "version_number": new_version_number,
                "needs_review": vibe_quality.build_status(validation) == "needs_review",
                "validation": validation,
                "gate": {"ran": gate_ran, "repaired": sorted(set(gate_repairs)), "remaining": [i.to_dict() for i in gate_remaining[:10]]},
                "heavy_deps": heavy_deps,
                "conformance": conformance,
                "fix": is_fix,
                "dropped_packages": dropped_packages,
                "patches": {"applied": patch_report["applied"], "repaired": patch_report["repaired"], "failed": patch_report["failed"]},
            })
        except Exception as exc:
            logger.exception("coding generate stream failed")
            try:
                await db.rollback()
            except Exception:
                pass
            yield _sse({"type": "error", "code": "model_timeout" if isinstance(exc, TimeoutError) else "generation_error",
                "message": "Il modello non ha completato la risposta nel tempo disponibile; la versione precedente è conservata." if isinstance(exc, TimeoutError) else "Generazione interrotta. La versione precedente è conservata; riprova con una modifica più piccola.",
                "diagnostics": run.diagnostic()})

    def track_progress(event: dict, state: background_jobs.ProgressState) -> None:
        kind = event.get("type")
        data = state.data
        if kind == "error":
            state.result = {"project_id": str(project_pk), "diagnostics": run.diagnostic(), "error_code": event.get("code", "generation_error")}
        if kind == "status":
            state.label = str(event.get("message") or "")[:200] or state.label
            if "total" not in data:
                state.progress = max(state.progress or 0.0, 0.05)
        elif kind == "plan":
            data["total"] = max(1, len(event.get("files") or []))
            data["done"] = set()
            state.progress = 0.15
            state.label = f"Piano pronto: {data['total']} file da scrivere"
        elif kind == "file_start":
            state.label = f"Scrittura di {event.get('path')}"
        elif kind == "file_done":
            done = data.setdefault("done", set())
            done.add(str(event.get("path")))
            total = max(data.get("total") or len(done), len(done))
            state.progress = 0.15 + 0.8 * len(done) / total
            state.label = f"{len(done)} di {total} file pronti"
        elif kind == "done":
            state.label = "Versione pronta"
            state.result = {"project_id": str(project_pk), "version_id": event.get("version_id"), "validation": event.get("validation"), "diagnostics": run.diagnostic()}
            state.label = "Codice generato · controlli da completare" if event.get("needs_review") else "Codice generato · build verificata" if event.get("gate", {}).get("ran") else "Codice generato · build non verificata"

    async def record_finish(status, state, listening):
        state.result = {**(state.result or {}), "project_id": str(project_pk), "diagnostics": run.diagnostic()}

    job_id = await background_jobs.start_stream_job(
        background_jobs.JobOwner.from_actor(actor),
        kind="vibe_generate",
        title=f"Vibe Lab · {project_title}"[:200],
        description=(user_prompt or ("Correzione automatica degli errori" if is_fix else "Generazione del progetto"))[:4000],
        route="module:coding" if actor.is_student else "/teacher/coding",
        resource_id=str(project_pk),
        stream=vibe_pipeline.events(event_stream(), run),
        event_format="sse",
        on_finish=record_finish,
        progress_fn=track_progress,
        expected_seconds=90.0,
    )
    return background_jobs.stream_response(job_id, "text/event-stream")


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _refine_project_stream(project_id: UUID, body: CodingGenerateRequest, db: AsyncSession, actor: StudentOrTeacher):
    """«Rifinisci»: on-demand deep check that helps the user CLOSE the project against its brief. Completes the missing brief
    functions, runs the app in a real browser (types, mobile, user flows, look), fixes what is wrong and saves a new version.
    Deliberately NOT part of the default build, which must stay fast. `body.prompt` is an optional focus from the user."""
    project = await _get_accessible_project(db, actor, project_id)
    project_pk, project_title, current_version_id = project.id, project.title, project.current_version_id
    project_session_id, project_tenant_id = project.session_id, project.tenant_id
    track_student_id = actor.student.id if actor.is_student else None
    track_teacher_id = actor.teacher.id if actor.is_teacher else None
    focus = (body.prompt or "").strip()[:600]

    previous_files: list[dict] = []
    previous_collaboration: dict = {}
    if current_version_id:
        current_version = (await db.execute(select(CodingVersion).where(CodingVersion.id == current_version_id))).scalar_one_or_none()
        if current_version:
            manifest = current_version.source_manifest_json or {}
            previous_files = manifest.get("files") or []
            previous_collaboration = manifest.get("collaboration") or {}
    if body.files:  # unsaved editor state is the base, like a normal generation
        previous_files = [{"path": f.path, "content": f.content, "language": f.language or ""} for f in body.files if f.path and ".." not in f.path.split("/")]
    code_files = [f for f in previous_files if not str(f.get("path") or "").lower().endswith(".md")]
    if not code_files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Non c'è ancora codice da rifinire: genera prima il progetto")
    if not _is_react_files(previous_files):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La rifinitura automatica funziona sui progetti React")

    kb_files = _kb_files(previous_files)
    spec_text = next((str(f.get("content") or "") for f in kb_files if str(f.get("path") or "").lower() == "spec.md"), "")
    brief_context = ("\n\n" + vibe_contract.brief_block(kb_files)) if kb_files else ""
    brief_reminder = vibe_contract.brief_reminder(kb_files)
    architect_pair, writer_pair = await _vibe_team(db, actor.is_student)
    run = vibe_pipeline.Run(writer_pair, architect_pair)
    request_text = f"Rifinisci il progetto secondo la specifica" + (f" (priorità: {focus})" if focus else "")
    if vibe_verify.is_scoped_request(focus):  # «Vai!» on a checklist item: verify and complete exactly those functions
        request_text = focus
    prompt_message = CodingMessage(project_id=project_pk, actor_type=_actor_identity(actor)[0], actor_id=_actor_identity(actor)[1], role="user", content=request_text,
                                   metadata_json={"kind": "refine_request"})
    db.add(prompt_message)
    await db.flush()
    prompt_message_id = prompt_message.id
    await db.commit()

    async def event_stream():
        try:
            yield _sse({"type": "status", "message": "Rifinitura: confronto il progetto con la specifica, poi lo provo in un browser vero..."})
            files = [dict(f) for f in previous_files]
            conformance: dict = {"checked": 0, "gaps": [], "repaired": []}
            async for kind, value in _conformance_stage(files, spec_text, focus, writer_pair[0], writer_pair[1], brief_reminder):
                if kind == "sse":
                    yield _sse(value)
                else:
                    files, conformance = value
            quality: dict = {"scorecard": None, "rounds": [], "tests": 0, "ran": False}
            async for kind, value in _quality_loop(files, reqs=vibe_contract.extract_requirements(spec_text), brief=brief_context, brief_reminder=brief_reminder,
                                                    writer=writer_pair, architect=architect_pair, run=run, rounds=QUALITY_ROUNDS, focus=focus):
                if kind == "sse":
                    yield _sse(value)
                else:
                    quality = value
                    files = value["files"]
            files, dropped_packages = _sanitize_package_json(files)
            files, _ = _autodeclare_packages(files)
            gate_remaining: list = []
            gate_ran = False
            async for kind, value in _heartbeat_await(vibe_gate.check_project(files, set(ALLOWED_NPM_PACKAGES))):
                if kind == "ping":
                    yield _sse({"type": "ping"})
                else:
                    final_issues, gate_ran = value
                    gate_remaining = vibe_gate.blocking(final_issues)
            broken_imports_unresolved = _check_broken_imports(files)
            if gate_remaining or broken_imports_unresolved:  # never replace a working version with a broken one
                files = [dict(f) for f in previous_files]
                yield _sse({"type": "status", "message": "La rifinitura non superava il controllo di build: conservo la versione attuale."})
            validation = vibe_quality.assessment(files, [], gate_ran, gaps=conformance["gaps"], features_checked=bool(conformance.get("verified")))
            validation["features_required"] = bool(conformance["checked"])
            if quality.get("scorecard"):
                validation["quality"] = {"score": quality["scorecard"], "rounds": quality["rounds"], "tests": quality.get("tests", 0), "defects": quality.get("defects", [])[:8]}
            file_summary, file_summary_json = _build_file_change_summary(previous_files, files)
            card = quality.get("scorecard") or {}
            summary = ("Rifinitura completata" + (f": punteggio {card['overall']}/100" if card.get("overall") is not None else "")
                       + (f", {len(conformance['repaired'])} file aggiornati per la specifica" if conformance.get("repaired") else "") + f". {len(files)} file, {file_summary_json['total_lines']} righe.")
            yield _sse({"type": "status", "message": "Salvo la versione rifinita..."})
            next_number = ((await db.execute(select(func.max(CodingVersion.version_number)).where(CodingVersion.project_id == project_pk))).scalar_one_or_none() or 0) + 1
            version = CodingVersion(
                project_id=project_pk, parent_version_id=current_version_id, version_number=next_number,
                source_manifest_json={"files": files, "summary": summary, **({"collaboration": previous_collaboration} if previous_collaboration else {})},
                artifact_manifest_json={"validation": validation, "diagnostics": run.diagnostic()},
                prompt_message_id=prompt_message_id, build_status=vibe_quality.build_status(validation), review_status="pending", created_by_actor_type="agent",
            )
            db.add(version)
            await db.flush()
            new_version_id = version.id
            proj = (await db.execute(select(CodingProject).where(CodingProject.id == project_pk))).scalar_one_or_none()
            if proj:
                proj.current_version_id = new_version_id
                proj.status = "generated"
            if conformance["gaps"]:
                db.add(CodingMessage(project_id=project_pk, actor_type="agent", agent_name="Controllo brief", role="assistant",
                    content="Dopo la rifinitura queste funzioni del brief risultano ancora mancanti o incomplete:\n" + vibe_verify.describe_gaps(conformance["gaps"]),
                    metadata_json={"kind": "brief_warning", "version_id": str(new_version_id), "gaps": conformance["gaps"][:20]}))
            remaining = quality.get("defects") or []
            db.add(CodingMessage(project_id=project_pk, actor_type="agent", agent_name="Revisore", role="assistant",
                content=summary + ("\nDifetti ancora aperti:\n" + "\n".join(f"- {d['message']}" for d in remaining[:6]) if remaining else ""),
                metadata_json={"kind": "refine_result", "version_id": str(new_version_id), "score": card, "file_count": len(files)}))
            await db.commit()
            for call in run.calls:
                if call.get("prompt_tokens") or call.get("completion_tokens"):
                    await _record_coding_cost(db, provider=call["provider"], model=call["model"], prompt_tokens=call.get("prompt_tokens") or 0,
                        completion_tokens=call.get("completion_tokens") or 0, context="coding_refine", tenant_id=project_tenant_id,
                        session_id=project_session_id, student_id=track_student_id, teacher_id=track_teacher_id)
            yield _sse({
                "type": "done", "files": files, "summary": summary, "version_id": str(new_version_id), "version_number": next_number,
                "needs_review": vibe_quality.build_status(validation) == "needs_review", "validation": validation,
                "gate": {"ran": gate_ran, "repaired": [], "remaining": [i.to_dict() for i in gate_remaining[:10]]},
                "heavy_deps": vibe_gate.heavy_dependencies(files), "conformance": conformance, "fix": False, "refine": True, "dropped_packages": dropped_packages,
                "patches": {"applied": 0, "repaired": [], "failed": []},
            })
        except Exception as exc:
            logger.exception("coding refine stream failed")
            try:
                await db.rollback()
            except Exception:
                pass
            yield _sse({"type": "error", "code": "refine_error", "message": "Rifinitura interrotta. La versione precedente è conservata.", "diagnostics": run.diagnostic()})

    def track_progress(event: dict, state: background_jobs.ProgressState) -> None:
        kind = event.get("type")
        if kind == "status":
            state.label = str(event.get("message") or "")[:200] or state.label
            state.progress = max(state.progress or 0.0, 0.05)
        elif kind == "quality":
            state.progress = min(0.9, 0.2 + 0.7 * (int(event.get("round") or 1) / max(1, int(event.get("rounds") or 1))))
            state.label = f"Controllo qualità, giro {event.get('round')}/{event.get('rounds')}: punteggio {(event.get('score') or {}).get('overall')}/100"
        elif kind == "done":
            state.result = {"project_id": str(project_pk), "version_id": event.get("version_id"), "validation": event.get("validation"), "diagnostics": run.diagnostic()}
            state.label = "Rifinitura completata"
        elif kind == "error":
            state.result = {"project_id": str(project_pk), "diagnostics": run.diagnostic(), "error_code": event.get("code", "refine_error")}

    async def record_finish(status_, state, listening):
        state.result = {**(state.result or {}), "project_id": str(project_pk), "diagnostics": run.diagnostic()}

    job_id = await background_jobs.start_stream_job(
        background_jobs.JobOwner.from_actor(actor), kind="vibe_generate", title=f"Vibe Lab · rifinitura · {project_title}"[:200],
        description=request_text[:4000], route="module:coding" if actor.is_student else "/teacher/coding", resource_id=str(project_pk),
        stream=vibe_pipeline.events(event_stream(), run), event_format="sse", on_finish=record_finish, progress_fn=track_progress, expected_seconds=240.0,
    )
    return background_jobs.stream_response(job_id, "text/event-stream")


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
        return await _project_response_payload(db, actor, source_project)

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
            return await _project_response_payload(db, actor, candidate)

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
    return await _project_response_payload(db, actor, fork)


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
    link = await _branch_link(db, project)
    if link is not None and link.base_files_json is not None:
        update_available = _files_hash(source_files) != _files_hash(link.base_files_json)
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
    link = await _branch_link(db, project)
    if link is not None and link.base_files_json is not None:
        # Keep the contributor's own edits and bring in what changed on main.
        current = await _get_current_version(db, project)
        merged_files, conflicts = merge_file_sets(link.base_files_json, _current_files(current), source_files)
        if conflicts:
            names = ", ".join(c["path"] for c in conflicts[:6])
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Il progetto principale e la tua copia hanno modificato le stesse righe ({names}). Proponi prima le tue modifiche: chi ha creato il progetto le unisce e risolve i conflitti.",
            )
        source_files = merged_files
        link.base_files_json = await _main_files(db, source_project)
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


async def _publication_slug(db: AsyncSession, project: CodingProject) -> str:
    """Public URL slug: readable title + short code from the project id. Project slugs are only unique
    within a session, so the bare title would collide across classes. The same project always gets
    the same slug (stable link across re-publishes); the code grows only if it ever clashes."""
    previous = (await db.execute(
        select(CodingPublication.publication_slug)
        .where(CodingPublication.project_id == project.id, CodingPublication.publication_slug.like(f"{project.slug[:100]}-%"))
        .order_by(CodingPublication.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if previous:
        return previous
    base = (project.slug or "app")[:100]
    for length in (6, 8, 12, 32):
        candidate = f"{base}-{project.id.hex[:length]}"
        clash = (await db.execute(
            select(CodingPublication.id)
            .where(CodingPublication.publication_slug == candidate, CodingPublication.project_id != project.id)
            .limit(1)
        )).scalar_one_or_none()
        if clash is None:
            return candidate
    return f"{base}-{project.id.hex}"


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

    publication_slug = await _publication_slug(db, project)
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


@router.get("/projects/{project_id}/download.zip")
async def download_project_zip(
    project_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    project = await _get_accessible_project(db, actor, project_id)
    version = await _get_current_version(db, project)
    files = (version.source_manifest_json or {}).get("files") or []
    archive = _build_export_zip(project, version, files)
    filename = f"{_slugify(project.title)}-v{version.version_number}.zip"
    return Response(
        content=archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


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
