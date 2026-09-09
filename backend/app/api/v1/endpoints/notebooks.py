from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Annotated, List, Optional
from datetime import datetime
from uuid import UUID
import uuid
import json
import re
import ast
import math

import httpx
import esprima

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_student_or_teacher, StudentOrTeacher
from app.models.notebook import Notebook
from app.models.notebook_version import NotebookVersion
from app.models.notebook_assignment import NotebookAssignment, NotebookFork
from app.models.session import Class, Session, SessionStudent
from app.models.task import Task, TaskSubmission, TaskStatus, TaskType
from app.services.llm_service import llm_service
from app.services.credit_service import credit_service
from app.api.v1.endpoints.coding import _resolve_coding_model
import logging

router = APIRouter()
logger = logging.getLogger(__name__)
SUPPORTED_PROJECT_TYPES = {"python", "p5js", "strudel", "game2d", "microbit", "circuitplayground"}
NOTEBOOK_CONTEXT_CELL_LIMIT = 6
NOTEBOOK_SNIPPET_CHAR_LIMIT = 1200

# Riferimento API vincolante per il target pxt-adafruit (Circuit Playground Express).
# Il microservizio PXT compila SOLO questo dialetto MakeCode TypeScript: ogni API
# inventata o presa dal micro:bit fa fallire la build (error TS2339 / TS2304).
CIRCUITPLAYGROUND_API_REFERENCE = """Target di compilazione: pxt-adafruit (Circuit Playground Express). Linguaggio: MakeCode TypeScript.
Usa SOLO queste API reali (qualsiasi altra fa fallire la compilazione UF2):
- Loop/tempo: forever(() => { ... }), pause(ms), control.runInParallel(() => {...})
- Eventi: input.onGesture(Gesture.Shake, () => {...}), input.buttonA.onEvent(ButtonEvent.Click, () => {...})
- Sensori: input.temperature(TemperatureUnit.Celsius), input.lightLevel(), input.soundLevel(),
  input.acceleration(Dimension.X|Y|Z), input.buttonA.isPressed(), input.buttonB.isPressed()
- NeoPixel: light.setAll(0xRRGGBB), light.setPixelColor(i, 0xRRGGBB), light.clear(), light.showRing(...)
  I NeoPixel si aggiornano DA SOLI dopo setPixelColor/setAll: NON esiste light.show().
  Colori predefiniti: Colors.Red, Colors.Green, Colors.Blue, Colors.White (oppure esadecimale 0x00ff00)
- Matematica utile: Math.map(x, fromLow, fromHigh, toLow, toHigh), Math.constrain(x, min, max), Math.abs(x)
- Audio: music.playTone(Note.C, music.beat(BeatFraction.Whole)), music.playSound(...)
- Seriale verso il browser: serial.writeLine("temp=" + temp + " luce=" + luce)
  La seriale è GIÀ su USB: scrivi direttamente con serial.writeLine, righe key=value su una sola riga.
VIETATO: basic.* (è del micro:bit, non esiste qui), led.*, light.show(), serial.redirectToUSB(),
serial.redirect(...), CircuitPython (import, def, while True:, cp.*), print(), console.log(),
e qualunque funzione non elencata sopra.
Esempio MINIMO che COMPILA e che puoi usare come base:
let temp = 0
let luce = 0
forever(function () {
    // Leggo i sensori onboard della scheda
    temp = input.temperature(TemperatureUnit.Celsius)
    luce = input.lightLevel()
    // Invio i dati al cruscotto del browser come riga key=value
    serial.writeLine("temp=" + temp + " luce=" + luce)
    // Feedback visivo sui NeoPixel
    if (temp > 28) {
        light.setAll(0xff0040)
    } else {
        light.setAll(0x0066ff)
    }
    pause(500)
})"""


# Riferimento API vincolante per la micro:bit. Il notebook compila il codice
# come main.py dentro il firmware MicroPython e lo flasha sulla scheda via WebUSB.
# Riferimento ufficiale: https://microbit-micropython.readthedocs.io/en/v2-docs/
# NB: la MicroPython della micro:bit NON è il CPython del PC: alcune sintassi
# moderne (in primis le f-string) danno SyntaxError sulla scheda.
MICROBIT_MICROPYTHON_REFERENCE = """Linguaggio: MicroPython per BBC micro:bit V2 (riferimento: microbit-micropython.readthedocs.io/en/v2-docs).
Il codice è il main.py che viene caricato sulla scheda: deve essere MicroPython VALIDO per micro:bit, NON Python da PC e NON JavaScript/MakeCode.

REGOLA CRITICA SULLE STRINGHE — le f-string NON sono supportate dalla micro:bit e danno SyntaxError.
- VIETATO:  print(f"heading={angolo}")          # f-string -> SyntaxError sulla scheda
- CORRETTO: print("heading={}".format(angolo))   # usa sempre .format()
- CORRETTO: print("heading=" + str(angolo))      # oppure concatenazione con str()
Non usare MAI il prefisso f"..." o f'...'. Converti SEMPRE i numeri con str() o con "{}".format(...).

Moduli disponibili (import all'inizio del file):
- from microbit import *   (sempre, dà display, pulsanti, sensori, pin, Image, sleep, running_time, temperature)
- import music | import radio | import neopixel | import speech | import audio | import log | import math | import random

API reali da usare (qualsiasi altra cosa è inventata):
- Tempo: sleep(ms), running_time(), temperature()
- Display LED 5x5: display.show(Image.HAPPY), display.scroll("ciao"), display.set_pixel(x, y, 0-9),
  display.get_pixel(x, y), display.clear(), display.read_light_level()
- Pulsanti: button_a.is_pressed(), button_a.was_pressed(), button_a.get_presses() (e button_b)
- Accelerometro: accelerometer.get_x()/get_y()/get_z(), accelerometer.get_values(),
  accelerometer.current_gesture(), accelerometer.is_gesture("shake")
- Bussola: compass.heading(), compass.is_calibrated(), compass.calibrate(), compass.get_field_strength()
- Microfono (V2): microphone.sound_level()  (0-255)
- Pin: pin0.read_analog(), pin0.write_digital(0/1), pin0.is_touched() ...
- Immagini: Image.HEART, Image.HAPPY, Image.YES, Image.NO, Image.ARROW_N, ecc.
- Musica: music.play(music.NYAN), music.pitch(440, 500)
- Radio: radio.on(), radio.config(group=1), radio.send("ciao"), radio.receive()

Comunicazione con il browser: usa print() con UNA riga key=value per ciclo, così il cruscotto del browser
la legge dal monitor seriale e aggiorna i sensori in tempo reale. Le chiavi note al cruscotto sono:
temp, light, compass, accx, accy, accz, sound, a, b.
Ogni blocco di codice proposto deve avere commenti in italiano che spieghino cosa fa e a cosa serve.

Esempio MINIMO che FUNZIONA sulla micro:bit (usalo come base, niente f-string):
from microbit import *

while True:
    # Leggo i sensori di bordo
    angolo = compass.heading()
    luce = display.read_light_level()
    # Invio una riga key=value al cruscotto del browser (con .format, non f-string)
    print("compass={} light={}".format(angolo, luce))
    sleep(200)"""


# Riferimento API p5.js (2D + WEBGL) e libreria librerie extra caricabili dal pannello
# "Librerie" del notebook. Il codice gira in un iframe con p5.js 1.9.3 già caricato via CDN.
P5JS_LIBRARY_IDS = {"ml5", "matterjs", "tonejs", "p5sound", "mediapipe-hands"}
P5JS_REFERENCE = """Riferimento p5.js (ambiente: iframe browser con p5.js 1.9.3 in instance globale, no bundler/npm).
Struttura base: function setup() { createCanvas(w, h); } e function draw() { ... } eseguiti in loop.
Altre funzioni richiamate automaticamente se definite: preload(), mousePressed(), mouseMoved(), mouseDragged(),
keyPressed(), keyReleased(), windowResized(), touchStarted().

API 2D core: background(), fill(), stroke(), noFill(), noStroke(), strokeWeight(), rect(), ellipse(), circle(),
line(), triangle(), quad(), beginShape()/vertex()/endShape(CLOSE), push()/pop(), translate(), rotate(), scale(),
colorMode(RGB|HSB), lerpColor(), map(), constrain(), random(), noise(), frameCount, frameRate(), deltaTime,
text(), textSize(), textAlign(), textFont(), loadFont(). Input: mouseX/mouseY, pmouseX/pmouseY, mouseIsPressed,
keyIsPressed, key/keyCode. Media: createCapture(VIDEO) per webcam, loadImage()/image(), loadSound() (richiede
la libreria p5sound), createGraphics() per canvas offscreen.

Modalità WEBGL (grafica 3D) — usa createCanvas(w, h, WEBGL):
- L'origine (0,0,0) è al CENTRO del canvas (non in alto a sinistra come in modalità 2D)
- Geometrie pronte: box(size), sphere(r), cylinder(), cone(), torus(), plane(w, h)
- Camera: camera(x,y,z, centerX,centerY,centerZ, upX,upY,upZ), perspective(), ortho(), orbitControl() per
  controllo mouse gratuito (drag=ruota, scroll=zoom, tasto destro=pan)
- Luci: ambientLight(), directionalLight(), pointLight(), lights() (set di luci di default)
- Materiali: normalMaterial() (debug), ambientMaterial(), specularMaterial(), texture(img), shininess()
- Rotazioni tipiche in draw(): rotateX(angle), rotateY(angle), rotateZ(angle) dentro push()/pop()
- Testo e alcune funzioni 2D (es. alcuni filtri) NON sono disponibili/affidabili in WEBGL: se serve overlay 2D
  di testo/HUD sopra una scena 3D, valuta un secondo createGraphics() 2D disegnato con image(), oppure testo 3D
  con text() solo se un font è caricato con loadFont() + textFont()
- Errori comuni da evitare: dimenticare push()/pop() attorno alle trasformazioni (si accumulano tra un frame e
  l'altro), usare coordinate 2D (0,0 in alto a sinistra) invece che centrate, chiamare orbitControl() fuori da draw()

Librerie esterne disponibili SOLO se lo studente le attiva dal pannello "Librerie" del notebook (checkbox);
il tutor non può iniettare <script> arbitrari, ma può indicare quali abilitare tramite il campo required_libraries.
ID validi e globali che espongono una volta attivate:
- "ml5" -> variabile globale ml5 (ml5.handPose, ml5.bodyPose, ml5.objectDetector, ml5.bodySegmentation,
  ml5.imageClassifier; tutte con API v1: costruttore + callback ready, poi .detectStart(video, cb))
- "matterjs" -> variabile globale Matter (motore fisico 2D: Matter.Engine, Matter.Bodies, Matter.Composite,
  Matter.Mouse, Matter.MouseConstraint, Matter.Constraint, Matter.Body)
- "tonejs" -> variabile globale Tone (sintesi/sequencer audio: Tone.Synth, Tone.MembraneSynth, Tone.Sequence,
  Tone.Transport, Tone.Reverb; richiede await Tone.start() dentro un gesto utente come mousePressed)
- "p5sound" -> addon ufficiale p5.sound: p5.AudioIn, p5.FFT, p5.SoundFile, getAudioContext()
- "mediapipe-hands" -> variabili globali Hands e Camera (API raw Google MediaPipe, alternativa più avanzata a
  ml5 per il tracciamento mani: new Hands({locateFile}), hands.setOptions(...), hands.onResults(cb),
  new Camera(videoEl, {onFrame, width, height}).start(); i landmark sono normalizzati 0..1, vanno scalati
  per width/height per disegnarli con le funzioni p5)
Se il codice richiesto usa una di queste librerie, includi SEMPRE il suo id nel campo required_libraries della
proposta: verrà attivata automaticamente per lo studente insieme al codice. Non inventare altre librerie o CDN:
se lo studente chiede una libreria non in questo elenco, spiegalo nella risposta invece di inventare un id.

Vincolo sintassi: il controllo di sintassi interno non supporta optional chaining (?.) né nullish coalescing (??).
Evita questi due operatori: usa if/else, || oppure controlli espliciti (es. typeof x !== 'undefined')."""


def _strip_code_fences(code: str) -> str:
    """Rimuove i recinti markdown (```lang ... ```) che l'LLM lascia talvolta nel
    replacement: quei backtick finirebbero nella cella e farebbero fallire la build
    MakeCode con TS1128."""
    lines = [line for line in code.splitlines() if not line.lstrip().startswith("```")]
    return "\n".join(lines).strip()


def _drop_overlapping_proposals(proposals: list[dict]) -> list[dict]:
    """Rete di sicurezza server-side: anche se il prompt chiede range disgiunti, il
    modello può sbagliare. Proposte con line range sovrapposti sono inapplicabili in
    sequenza (applicarne una sposta le righe delle altre) e rompono lo script — qui le
    scartiamo prima ancora di mandarle allo studente, tenendo solo la prima per range
    (già ordinata per rilevanza/ordine del modello)."""
    kept: list[dict] = []
    for prop in sorted(proposals, key=lambda p: p["line_start"]):
        if any(prop["line_start"] <= k["line_end"] and prop["line_end"] >= k["line_start"] for k in kept):
            continue
        kept.append(prop)
    return kept


def _apply_line_range(source: str, line_start: int, line_end: int, replacement: str) -> str:
    """Replica lato server lo splice che il frontend usa per applicare una proposta,
    così possiamo compilare il risultato esatto che vedrà lo studente."""
    lines = source.split("\n")
    repl = replacement.replace("\r\n", "\n").split("\n")
    start = max(0, line_start - 1)
    count = max(1, line_end - line_start + 1)
    lines[start:start + count] = repl
    return "\n".join(lines)


async def _compile_circuitplayground(code: str) -> tuple[bool, str]:
    """Compila il codice col microservizio PXT. Ritorna (ok, errori).
    Fail-open: se il compilatore non risponde non blocchiamo la proposta."""
    compiler_url = settings.PXT_COMPILER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=settings.PXT_COMPILER_TIMEOUT_SECONDS) as client:
            resp = await client.post(f"{compiler_url}/compile/circuitplayground", json={"code": code})
    except httpx.HTTPError as exc:
        logger.warning("PXT compiler non raggiungibile durante la validazione: %s", exc)
        return True, ""
    if resp.status_code < 400:
        return True, ""
    try:
        data = resp.json()
        logs = data.get("logs") or data.get("error") or ""
    except ValueError:
        logs = resp.text
    error_lines = [ln for ln in (logs or "").splitlines() if "error" in ln.lower() or "main.ts" in ln.lower()]
    return False, ("\n".join(error_lines) or logs or "Compilazione fallita.")[:1500]


async def _autofix_makecode(code: str, error_logs: str) -> str:
    """Chiede al modello di correggere il codice usando l'errore reale del compilatore."""
    system_prompt = (
        "Sei un correttore di codice MakeCode TypeScript per Circuit Playground Express.\n"
        "Ricevi un programma che NON compila e l'errore esatto del compilatore PXT.\n"
        "Restituisci SOLO il programma completo corretto che compila: niente markdown, "
        "niente spiegazioni, niente backtick. Mantieni l'intento originale e i commenti in italiano.\n\n"
        + CIRCUITPLAYGROUND_API_REFERENCE
    )
    user_msg = (
        f"Errore del compilatore PXT:\n{error_logs}\n\n"
        f"Codice da correggere:\n{code}\n\n"
        "Riscrivi il programma completo corretto."
    )
    response = await llm_service.generate(
        messages=[{"role": "user", "content": user_msg}],
        system_prompt=system_prompt,
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        temperature=0.0,
        max_tokens=1200,
        allow_web_search=False,
    )
    return _strip_code_fences(response.content or "")


async def _validate_and_autofix_circuitplayground(
    proposals: list[dict], active_source: str, active_line_count: int
) -> tuple[list[dict], bool]:
    """Per ogni proposta compila il risultato applicato alla cella; se non compila,
    tenta fino a 2 autocorrezioni guidate dall'errore del compilatore. Le proposte
    corrette diventano riscritture di tutta la cella (line 1..fine)."""
    all_ok = True
    for prop in proposals:
        replacement = prop.get("replacement") or ""
        if not replacement.strip():
            continue
        candidate = _apply_line_range(active_source, prop["line_start"], prop["line_end"], replacement)
        ok, logs = await _compile_circuitplayground(candidate)
        if ok:
            continue

        fixed_code = None
        attempt_code, attempt_logs = candidate, logs
        for _ in range(2):
            corrected = await _autofix_makecode(attempt_code, attempt_logs)
            if not corrected.strip():
                break
            ok2, logs2 = await _compile_circuitplayground(corrected)
            if ok2:
                fixed_code = corrected
                break
            attempt_code, attempt_logs = corrected, logs2

        if fixed_code is not None:
            prop["line_start"] = 1
            prop["line_end"] = active_line_count
            prop["replacement"] = fixed_code[:4000]
            prop["message"] = (prop.get("message") or "Proposta").strip()[:160] + " — verificata: compila"
        else:
            all_ok = False
            prop["severity"] = "warning"
            prop["message"] = (prop.get("message") or "Proposta").strip()[:140] + " — non compila ancora, controlla il codice"
    return proposals, all_ok


def _check_python_syntax(code: str) -> tuple[bool, str]:
    try:
        ast.parse(code)
        return True, ""
    except SyntaxError as e:
        return False, f"{e.msg} alla riga {e.lineno}: {(e.text or '').strip()}"


def _check_p5js_syntax(code: str) -> tuple[bool, str]:
    try:
        esprima.parseScript(code)
        return True, ""
    except Exception as e:
        return False, str(e)[:500]


def _check_syntax(code: str, project_type: str) -> tuple[bool, str]:
    if project_type == "python":
        return _check_python_syntax(code)
    if project_type == "p5js":
        return _check_p5js_syntax(code)
    return True, ""


async def _autofix_script(code: str, error_msg: str, project_type: str) -> str:
    """Corregge un errore di sintassi puntuale mantenendo intatto il resto del programma.
    È il 'test di preload' interno per python/p5js: nessuna esecuzione reale nel browser,
    solo verifica che il codice sia sintatticamente valido prima di consegnarlo allo studente."""
    lang = "Python" if project_type == "python" else "JavaScript (p5.js, gira in un browser)"
    system_prompt = (
        f"Sei un correttore di errori di sintassi {lang}.\n"
        "Ricevi un programma con un errore di sintassi puntuale e il messaggio esatto dell'errore del parser.\n"
        "Correggi SOLO l'errore di sintassi indicato, senza riscrivere, riorganizzare o migliorare il resto del codice.\n"
        "Restituisci SOLO il programma completo corretto: niente markdown, niente spiegazioni, niente backtick."
    )
    user_msg = (
        f"Errore di sintassi rilevato dal parser:\n{error_msg}\n\n"
        f"Codice da correggere:\n{code}\n\n"
        "Restituisci il programma completo con il solo errore di sintassi corretto."
    )
    response = await llm_service.generate(
        messages=[{"role": "user", "content": user_msg}],
        system_prompt=system_prompt,
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        temperature=0.0,
        max_tokens=1600,
        allow_web_search=False,
    )
    return _strip_code_fences(response.content or "")


async def _generate_text_accumulated(
    messages: list[dict], system_prompt: str, provider: str, model: str,
    temperature: float, max_tokens: int,
) -> str:
    """Chiama il modello in STREAMING e accumula il testo completo. L'SDK Anthropic rifiuta
    le richieste NON-streaming con max_tokens alto (24000) perché potrebbero superare i 10
    minuti ("Streaming is required..."); lo streaming aggira il limite. Web search disattivata
    (le prompt contengono parole tipo 'corrente' che altrimenti la attiverebbero, restituendo
    testo vuoto)."""
    parts: list[str] = []
    async for chunk in llm_service.generate_stream(
        messages=messages, system_prompt=system_prompt,
        provider=provider, model=model,
        temperature=temperature, max_tokens=max_tokens,
        allow_web_search=False,
    ):
        parts.append(chunk)
    return "".join(parts)


async def _notebook_codegen(
    project_type: str, active_source: str, last_output: str, user_prompt: str,
    provider: str, model: str,
) -> tuple[str, str, str, list]:
    """Generazione agentica — stesso pattern del generatore non-streaming di Coding Lab
    (`/coding/projects/{id}/generate`): UNA chiamata che riceve il file COMPLETO e
    restituisce il file COMPLETO aggiornato, invece di diff a righe. Un file (qui: la
    cella) è un'unità atomica: o lo si sostituisce per intero o non lo si tocca, quindi
    non esistono range di righe da tenere sincronizzati tra proposte multiple — è la
    stessa ragione per cui Coding Lab non ha mai sofferto dei problemi di corruzione da
    diff visti nel notebook."""
    lang_label = "p5.js (JavaScript, gira in un browser)" if project_type == "p5js" else "Python"
    code_fence = "javascript" if project_type == "p5js" else "python"
    system_prompt = f"""Sei un assistente di coding agentico per un singolo file {lang_label} in un notebook didattico.
Comportati in modo agentico e CHIRURGICO: applica SOLO le modifiche richieste dallo studente, lascia IDENTICO
tutto il resto del file. Se ci sono errori console riportati, la tua priorità assoluta è risolverli.
Restituisci SOLO l'oggetto JSON, NIENTE testo prima o dopo: il PRIMO carattere della tua risposta deve essere
la graffa aperta {{ e l'ULTIMO la graffa chiusa }}. Niente markdown, niente preamboli tipo "Analizziamo...".

Formato JSON richiesto:
{{
  "reasoning": "2-4 frasi in italiano: cosa cambi e perché, come spiegheresti il piano a un collega prima di scrivere il codice",
  "summary": "breve sintesi in italiano di cosa hai cambiato (o perché non serve cambiare nulla)",
  "content": "contenuto COMPLETO e aggiornato del file",
  "required_libraries": ["ml5"]
}}

Regole:
- reasoning viene prima, come un architetto che spiega il piano prima di scrivere: NON codice, solo ragionamento
- content deve essere il file INTERO: copia esattamente le parti che non cambiano, non solo le righe nuove
- Se il file soddisfa già la richiesta, restituisci content invariato e spiegalo in reasoning/summary
- required_libraries è opzionale (solo p5js): elenca SOLO id di librerie realmente necessarie al codice
- Rispondi in italiano""" + (
        "\n\n" + P5JS_REFERENCE if project_type == "p5js" else ""
    )
    messages = [{
        "role": "user",
        "content": (
            f"Richiesta dello studente: {user_prompt}\n\n"
            f"Errori o output console riportati:\n{last_output[:1200] or '(nessuno)'}\n\n"
            f"File corrente:\n```{code_fence}\n{active_source[:40000]}\n```"
        ),
    }]
    # Rete di sicurezza: una singola chiamata può occasionalmente tornare vuota o non-JSON
    # (hiccup del provider, file grande vicino al budget di token). Un retry silenzioso
    # evita che l'intera richiesta fallisca con un 500 per un problema tipicamente transitorio.
    last_error: Exception | None = None
    for attempt in range(2):
        # Budget alto: la proposta re-emette il FILE INTERO come stringa JSON (i newline
        # escaped raddoppiano la lunghezza). Con file grandi token bassi troncano il JSON
        # a metà -> parse fallito. 24000 copre file fino a ~90k caratteri. Serve lo streaming
        # (via _generate_text_accumulated) perché l'SDK Anthropic rifiuta le richieste
        # non-streaming con max_tokens così alto.
        raw = await _generate_text_accumulated(
            messages, system_prompt, provider, model, temperature=0.3, max_tokens=24000,
        )
        try:
            parsed = _extract_json_object(raw)
            reasoning = str(parsed.get("reasoning", "")).strip()[:1500]
            summary = str(parsed.get("summary", "")).strip()[:500]
            content = _strip_code_fences(str(parsed.get("content", "")) or active_source)
            raw_libs = parsed.get("required_libraries", [])
            required_libraries = (
                [lib for lib in raw_libs if isinstance(lib, str) and lib in P5JS_LIBRARY_IDS][:3]
                if project_type == "p5js" and isinstance(raw_libs, list) else []
            )
            return reasoning, summary, content, required_libraries
        except Exception as exc:
            last_error = exc
            logger.warning("Notebook codegen attempt %d returned invalid JSON (%s)", attempt + 1, exc)
    raise RuntimeError(f"Codegen non ha restituito JSON valido dopo 2 tentativi: {last_error}")


async def _notebook_review_file(
    project_type: str, content: str, user_prompt: str, last_output: str, provider: str, model: str,
) -> tuple[str, list[str]]:
    """Revisione finale — stesso pattern di `_ui_review_files` in Coding Lab: una seconda
    chiamata indipendente rilegge il file finale e, se trova un problema concreto, lo
    CORREGGE direttamente (non si limita a segnalarlo). Non solleva mai eccezioni: in caso
    di errore ritorna il file invariato, così la revisione non blocca mai la consegna."""
    lang_label = "p5.js (JavaScript)" if project_type == "p5js" else "Python"
    system_prompt = (
        f"Sei un revisore di codice {lang_label}. Ricevi un file dopo una modifica, la richiesta originale "
        "dello studente e gli eventuali errori console riportati PRIMA della modifica.\n"
        "Se noti un problema concreto (la richiesta non è soddisfatta, gli errori console non sono risolti, "
        "il codice non funzionerebbe), CORREGGILO tu stesso e restituisci il file corretto per intero. "
        "Se va bene così, restituiscilo invariato. Non segnalare stile o rifiniture, solo problemi reali.\n"
        "Rispondi SOLO con JSON valido, senza markdown:\n"
        '{"content": "<file completo>", "issues_found": ["problema risolto o residuo", ...]}\n'
        "issues_found vuoto se non hai trovato problemi."
    )
    user_msg = (
        f"Richiesta originale dello studente: {user_prompt}\n\n"
        f"Errori console riportati PRIMA della modifica:\n{last_output[:800] or '(nessuno)'}\n\n"
        f"File da rivedere:\n```\n{content[:40000]}\n```"
    )
    try:
        # Anche la review re-emette il file intero: stesso budget alto e streaming del codegen.
        raw = await _generate_text_accumulated(
            [{"role": "user", "content": user_msg}], system_prompt, provider, model,
            temperature=0.2, max_tokens=24000,
        )
        parsed = _extract_json_object(raw)
        fixed = _strip_code_fences(str(parsed.get("content", "")) or content)
        issues = [str(i).strip() for i in (parsed.get("issues_found") or []) if str(i).strip()][:5]
        return fixed, issues
    except Exception as exc:
        logger.warning("Notebook review pass skipped (%s)", exc)
        return content, []


PROMPT_ANALYST_PROGRESS_MESSAGE = "Leggo la richiesta, controllo il codice e preparo una versione aggiornata della cella."


async def _run_agent_pipeline_stream(
    project_type: str, active_source: str, last_output: str, user_prompt: str, is_student: bool,
):
    """Versione streaming della pipeline: invece di restituire tutto alla fine, EMETTE ogni
    bolla di agente non appena lo stadio finisce, poi un frame finale con le proposte. È il
    motivo per cui Coding Lab non incorre nel 524 di Cloudflare: due chiamate Sonnet in serie
    su un file grande superano i ~100s del proxy, ma lo streaming manda subito il primo byte e
    tiene viva la connessione. In più lo studente vede i widget degli agenti comparire dal vivo.

    Yield di tuple: ("stage", messaggio_bolla) ripetuto, poi ("final", (proposals, summary)).
    """
    # Tutor p5js/python su DeepSeek per tutti (docenti e studenti). "deepseek-pro" è la
    # variante DeepSeek migliore per il codice; il resolver la mappa su provider/model reali.
    provider, model = _resolve_coding_model("deepseek-pro", is_student=is_student)

    yield ("stage", {
        "role": "assistant", "agent_name": "Prompt Analyst",
        "content": PROMPT_ANALYST_PROGRESS_MESSAGE,
        "metadata": {"kind": "agent_progress"},
    })

    reasoning, summary, new_source, required_libraries = await _notebook_codegen(
        project_type, active_source, last_output, user_prompt, provider, model
    )
    if reasoning:
        yield ("stage", {
            "role": "assistant", "agent_name": "Architetto",
            "content": reasoning,
            "metadata": {"kind": "agent_reasoning"},
        })

    if new_source.strip() == active_source.strip():
        final_summary = summary or "Il codice soddisfa già la richiesta."
        yield ("stage", {
            "role": "assistant", "agent_name": "Coding Builder",
            "content": final_summary,
            "metadata": {"kind": "codegen_result"},
        })
        yield ("final", ([], final_summary))
        return

    ok, err = _check_syntax(new_source, project_type)
    if not ok:
        for _ in range(2):
            corrected = await _autofix_script(new_source, err, project_type)
            if not corrected.strip():
                break
            ok2, err2 = _check_syntax(corrected, project_type)
            new_source = corrected
            if ok2:
                ok = True
                break
            err = err2

    active_line_count = len(active_source.splitlines()) or 1
    new_line_count = len(new_source.splitlines()) or 1
    yield ("stage", {
        "role": "assistant", "agent_name": "File Writer",
        "content": (summary or "Cella aggiornata.").strip(),
        "metadata": {"kind": "file_write_summary", "files": [
            {"path": "cella corrente", "lines": new_line_count, "status": "modificato"},
        ]},
    })

    reviewed_source, issues = await _notebook_review_file(
        project_type, new_source, user_prompt, last_output, provider, model
    )
    if reviewed_source.strip() != new_source.strip():
        ok_after, _ = _check_syntax(reviewed_source, project_type)
        if ok_after:
            new_source = reviewed_source
            ok = True
    if issues:
        yield ("stage", {
            "role": "assistant", "agent_name": "Reviewer",
            "content": "\n".join(f"- {issue}" for issue in issues),
            "metadata": {"kind": "agent_feedback"},
        })

    final_summary = summary or "Modifica applicata."
    if not ok:
        final_summary += " Nota: possibile errore di sintassi residuo, controlla il codice."
    yield ("stage", {
        "role": "assistant", "agent_name": "Coding Builder",
        "content": final_summary,
        "metadata": {"kind": "codegen_result"},
    })

    proposal = {
        "id": "p-0",
        "line_start": 1,
        "line_end": active_line_count,
        "severity": "info" if ok else "warning",
        "message": final_summary[:200],
        "replacement": new_source[:60000],
        "explanation": (summary or "").strip()[:700],
        "teacher_note": "",
        "required_libraries": required_libraries,
    }
    yield ("final", ([proposal], final_summary))


async def _run_agent_pipeline(
    project_type: str, active_source: str, last_output: str, user_prompt: str, is_student: bool,
) -> tuple[list[dict], str, list[dict]]:
    """Wrapper non-streaming attorno a _run_agent_pipeline_stream: raccoglie tutte le bolle
    e il risultato finale. Usato dove non serve lo streaming (es. test)."""
    staged: list[dict] = []
    proposals: list[dict] = []
    summary = "Analisi completata."
    async for kind, payload in _run_agent_pipeline_stream(
        project_type, active_source, last_output, user_prompt, is_student
    ):
        if kind == "stage":
            staged.append(payload)
        else:
            proposals, summary = payload
    return proposals, summary, staged


async def _run_legacy_single_pass(
    project_type: str, notebook_title: str, all_code: str, relevant_context: str,
    active_source: str, last_output: str, user_prompt: str,
) -> tuple[list[dict], str]:
    """Percorso a singola chiamata per microbit/circuitplayground/game2d — invariato
    rispetto a prima. Circuit Playground ha già il proprio autofix reale via compilatore
    PXT (_validate_and_autofix_circuitplayground); microbit e game2d non hanno un
    validatore di sintassi dedicato, come già in produzione."""
    code_fence = "typescript" if project_type == "circuitplayground" else "python" if project_type == "microbit" else "json"

    system_prompt = f"""Sei un assistente tutor agentico per notebook {project_type}, esperto e preciso.
Devi analizzare il codice e restituire SOLO JSON valido, senza markdown.

Formato JSON richiesto:
{{
  "summary": "breve sintesi in italiano",
  "proposals": [
    {{
      "line_start": 1,
      "line_end": 1,
      "full_rewrite": false,
      "severity": "error|warning|info",
      "message": "messaggio breve",
      "replacement": "codice sostitutivo proposto",
      "explanation": "spiegazione didattica",
      "teacher_note": "spiegazione breve da mostrare vicino al codice"
    }}
  ]
}}

Regole:
- Massimo 5 proposte
- Usa line numeri 1-based riferiti alla cella corrente
- replacement deve contenere il codice completo che sostituisce l'intervallo line_start..line_end, e SOLO
  quello: non includere righe che restano invariate, nemmeno se la proposta inizia a riga 1
- Non inventare errori se il codice sembra corretto
- Se non serve cambiare il codice, restituisci proposals: []
- Ogni proposta deve essere didattica e conservativa: modifica il minimo indispensabile per ottenere il risultato richiesto, non di più
- Se il progetto è game2d, correggi solo JSON/schema: niente codice JavaScript libero
- full_rewrite: true SOLO se la proposta sostituisce l'INTERA cella dall'inizio alla fine (es. trasformare
  un'intenzione creativa in un programma hardware completo per microbit/circuitplayground) — in quel caso
  metti line_start=1, line_end=ultima riga, e replacement deve essere il programma COMPLETO e bilanciato
  (ogni parentesi/graffa aperta chiusa una sola volta, nessuna riga duplicata in coda). Se full_rewrite è
  false (il caso normale), line_end NON viene esteso automaticamente: il resto della cella resta intatto
- Se il progetto è microbit, ogni replacement deve contenere commenti in italiano nei blocchi principali spiegando cosa fanno e a cosa servono
- Se il progetto è microbit, preferisci output seriale leggibile dal cruscotto browser: key=value o JSON su una riga
- Se il progetto è circuitplayground, ogni replacement deve contenere commenti in italiano nei blocchi principali spiegando cosa fanno e a cosa servono
- Se il progetto è circuitplayground, preferisci output seriale leggibile dal cruscotto browser: key=value o JSON su una riga
- Se il progetto è circuitplayground, genera solo MakeCode TypeScript compilabile da PXT; non generare CircuitPython
- Rispondi in italiano""" + (
        "\n\n" + CIRCUITPLAYGROUND_API_REFERENCE if project_type == "circuitplayground" else ""
    )

    messages = [
        {
            "role": "user",
            "content": (
                f"Notebook: {notebook_title}\n"
                f"Tipo progetto: {project_type}\n\n"
                f"Codice completo:\n```{code_fence}\n{all_code[:5000]}\n```\n\n"
                f"Contesto recuperato del notebook:\n```text\n{relevant_context[:4000]}\n```\n\n"
                f"Cella corrente:\n```{code_fence}\n{active_source[:2500]}\n```\n\n"
                f"Ultimo output o errore:\n{last_output[:1200] or '(nessuno)'}\n\n"
                f"Richiesta utente: {user_prompt}"
            ),
        }
    ]

    response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        temperature=0.2,
        max_tokens=3200,
        allow_web_search=False,
    )
    parsed = _extract_json_object(response.content)
    proposals = parsed.get("proposals", [])
    normalized = []
    active_line_count = len(active_source.splitlines()) or 1
    for idx, proposal in enumerate(proposals[:5]):
        if not isinstance(proposal, dict):
            continue
        line_start = max(1, int(proposal.get("line_start", 1) or 1))
        line_end = max(line_start, int(proposal.get("line_end", line_start) or line_start))
        # Estendiamo a tutta la cella SOLO se dichiarato esplicitamente: forzarlo solo
        # perché line_start capita a essere 1 cancellerebbe silenziosamente il resto
        # del codice quando la proposta era in realtà una piccola modifica puntuale.
        if proposal.get("full_rewrite") is True:
            line_start = 1
            line_end = active_line_count
        normalized.append({
            "id": f"p-{idx}",
            "line_start": line_start,
            "line_end": line_end,
            "severity": proposal.get("severity", "info") if proposal.get("severity") in {"error", "warning", "info"} else "info",
            "message": str(proposal.get("message", "")).strip()[:200],
            "replacement": _strip_code_fences(str(proposal.get("replacement", "")))[:9000],
            "explanation": str(proposal.get("explanation", "")).strip()[:700],
            "teacher_note": str(proposal.get("teacher_note", "")).strip()[:300],
            "required_libraries": [],
        })

    normalized = _drop_overlapping_proposals(normalized)
    summary_text = str(parsed.get("summary", "Analisi completata.")).strip()[:500]

    # Auto-fix loop: per Circuit Playground compiliamo davvero ogni proposta col
    # microservizio PXT e correggiamo finché non compila, così lo studente non
    # riceve mai codice rotto (API inventate, code orfane, ecc.).
    if project_type == "circuitplayground" and normalized:
        normalized, all_ok = await _validate_and_autofix_circuitplayground(
            normalized, active_source, active_line_count
        )
        if not all_ok:
            summary_text = (summary_text + " Nota: una proposta non compila ancora, l'ho segnalata.").strip()[:500]

    return normalized, summary_text


def _estimated_tokens(*parts: str) -> int:
    return max(1, math.ceil(sum(len(part or "") for part in parts) / 4))


def _notebook_agent_usage_estimate(
    project_type: str,
    active_source: str,
    last_output: str,
    user_prompt: str,
) -> tuple[str, str, int, int]:
    if project_type in {"python", "p5js"}:
        provider, model = _resolve_coding_model("deepseek-pro", is_student=False)
        # Codegen and review both read and emit the full file.
        prompt_tokens = _estimated_tokens(active_source, active_source, user_prompt, user_prompt, last_output)
        completion_tokens = max(800, _estimated_tokens(active_source, active_source))
    else:
        provider, model = "anthropic", "claude-haiku-4-5-20251001"
        prompt_tokens = _estimated_tokens(active_source, user_prompt, last_output)
        completion_tokens = max(500, _estimated_tokens(active_source))
    return provider, model, prompt_tokens, completion_tokens


async def _notebook_credit_scope(db: AsyncSession, actor: StudentOrTeacher) -> dict:
    if actor.is_teacher:
        return {
            "tenant_id": actor.teacher.tenant_id,
            "teacher_id": actor.teacher.id,
            "class_id": None,
            "session_id": None,
            "student_id": None,
        }

    result = await db.execute(
        select(Session, Class)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == actor.student.session_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessione dello studente non trovata")
    session, class_ = row
    return {
        "tenant_id": actor.student.tenant_id,
        "teacher_id": class_.teacher_id,
        "class_id": class_.id,
        "session_id": session.id,
        "student_id": actor.student.id,
    }


async def _require_notebook_agent_credits(
    db: AsyncSession,
    scope: dict,
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    estimated_cost = credit_service.calculate_cost_for_model(
        provider, model, prompt_tokens, completion_tokens
    )
    allowed = await credit_service.check_availability(db, estimated_cost=estimated_cost, **scope)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Crediti AI esauriti. Attendi il rinnovo del plafond o contatta il docente/amministratore.",
        )


async def _track_notebook_agent_usage(
    db: AsyncSession,
    scope: dict,
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    project_type: str,
) -> None:
    cost = credit_service.calculate_cost_for_model(
        provider, model, prompt_tokens, completion_tokens
    )
    await credit_service.track_usage(
        db,
        provider=provider,
        model=model,
        cost=cost,
        usage_details={
            "type": "notebook_coding_agent",
            "project_type": project_type,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "estimated_tokens": True,
        },
        **scope,
    )


def _owner_id_and_tenant(actor: StudentOrTeacher) -> tuple[UUID, UUID]:
    """Return (owner_id, tenant_id) for the current actor."""
    if actor.is_teacher:
        return actor.teacher.id, actor.teacher.tenant_id
    else:
        return actor.student.id, actor.student.tenant_id


def _tokenize_for_match(*parts: str) -> set[str]:
    tokens: set[str] = set()
    for part in parts:
        for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", part or ""):
            lowered = token.lower()
            if lowered not in {"the", "and", "for", "with", "this", "that", "print", "const", "function"}:
                tokens.add(lowered)
    return tokens


def _summarize_output(outputs: list[dict] | None) -> str:
    if not outputs:
        return ""
    rendered: list[str] = []
    for output in outputs[:3]:
        if not isinstance(output, dict):
            continue
        if output.get("output_type") == "error":
            rendered.append(f"ERRORE: {output.get('ename', 'Error')}: {output.get('evalue', '')}")
        elif output.get("text"):
            rendered.append(str(output.get("text")).strip())
        elif isinstance(output.get("data"), dict):
            data = output.get("data") or {}
            text_preview = data.get("text/plain")
            if text_preview:
                rendered.append(str(text_preview).strip())
            elif data.get("image/png"):
                rendered.append("[grafico generato]")
    return "\n".join(item for item in rendered if item).strip()[:500]


def _score_notebook_cell(cell: dict, query_tokens: set[str], current_cell: str) -> int:
    source = str(cell.get("source", ""))
    outputs = _summarize_output(cell.get("outputs"))
    haystack = f"{source}\n{outputs}".lower()
    score = sum(1 for token in query_tokens if token in haystack)
    if current_cell and source.strip() == current_cell.strip():
        score += 8
    if cell.get("execution_count"):
        score += 1
    if outputs:
        score += 2
    return score


def _build_notebook_context(nb: Notebook, query: str, current_cell: str, last_output: str) -> str:
    cells = [cell for cell in (nb.cells or []) if isinstance(cell, dict) and cell.get("type") == "code"]
    if not cells:
        return ""

    query_tokens = _tokenize_for_match(query, current_cell, last_output)
    ranked_cells = sorted(
        cells,
        key=lambda cell: _score_notebook_cell(cell, query_tokens, current_cell),
        reverse=True,
    )

    selected = ranked_cells[:NOTEBOOK_CONTEXT_CELL_LIMIT]
    sections: list[str] = []
    for index, cell in enumerate(selected, start=1):
        source = str(cell.get("source", "")).strip()
        output = _summarize_output(cell.get("outputs"))
        sections.append(
            "\n".join(filter(None, [
                f"Cella rilevante #{index}",
                f"execution_count: {cell.get('execution_count') or 'n.d.'}",
                f"codice:\n{source[:NOTEBOOK_SNIPPET_CHAR_LIMIT]}",
                f"output:\n{output}" if output else "",
            ]))
        )

    return "\n\n---\n\n".join(sections)


def _sanitize_tutor_history(raw_history: object, limit: int = 60) -> list[dict]:
    """Sanitizza la cronologia. Oltre a role/content preserva agent_name e metadata.kind
    (+ metadata.files) quando presenti — sono ciò che permette alla chat di mostrare le
    bolle a stadi (Prompt Analyst / Architetto / File Writer / Reviewer / Coding Builder)
    esattamente come in Coding Lab, invece di un'unica risposta generica."""
    if not isinstance(raw_history, list):
        return []

    sanitized: list[dict] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        entry: dict = {"role": role, "content": content[:4000]}

        agent_name = item.get("agent_name")
        if isinstance(agent_name, str) and agent_name.strip():
            entry["agent_name"] = agent_name.strip()[:40]

        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            clean_meta: dict = {}
            kind = metadata.get("kind")
            if isinstance(kind, str) and kind.strip():
                clean_meta["kind"] = kind.strip()[:40]
            files = metadata.get("files")
            if isinstance(files, list):
                clean_files = [
                    {
                        "path": str(f.get("path"))[:200],
                        "lines": int(f.get("lines", 0) or 0),
                        "status": str(f.get("status", ""))[:40],
                    }
                    for f in files[:5] if isinstance(f, dict) and f.get("path")
                ]
                if clean_files:
                    clean_meta["files"] = clean_files
            if clean_meta:
                entry["metadata"] = clean_meta

        sanitized.append(entry)

    return sanitized[-limit:]


# ── List notebooks ──────────────────────────────────────────────────────────

@router.get("/notebooks", response_model=List[dict])
async def list_notebooks(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    owner_id, tenant_id = _owner_id_and_tenant(actor)
    result = await db.execute(
        select(Notebook)
        .where(Notebook.tenant_id == tenant_id, Notebook.owner_id == owner_id)
        .order_by(Notebook.updated_at.desc())
    )
    notebooks = result.scalars().all()
    return [
        {
            "id": str(nb.id),
            "title": nb.title,
            "project_type": nb.project_type or "python",
            "cell_count": len(nb.cells) if nb.cells else 0,
            "created_at": nb.created_at.isoformat(),
            "updated_at": nb.updated_at.isoformat(),
        }
        for nb in notebooks
    ]


# ── Create notebook ──────────────────────────────────────────────────────────

@router.post("/notebooks", response_model=dict, status_code=201)
async def create_notebook(
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    owner_id, tenant_id = _owner_id_and_tenant(actor)
    title = request.get("title", "Nuovo Notebook") or "Nuovo Notebook"
    project_type = _normalize_project_type(request.get("project_type"))
    template_key = request.get("template_key")

    nb = Notebook(
        tenant_id=tenant_id,
        owner_id=owner_id,
        title=title,
        project_type=project_type,
        cells=_starter_cells(project_type, template_key),
        editor_settings=_default_editor_settings(project_type),
    )
    db.add(nb)
    await db.commit()
    await db.refresh(nb)
    return _notebook_detail(nb)


# ── Versioned assignments / student forks ──────────────────────────────────

def _assignment_summary(assignment: NotebookAssignment, **extra) -> dict:
    return {
        "id": str(assignment.id),
        "task_id": str(assignment.task_id),
        "session_id": str(assignment.session_id),
        "source_notebook_id": str(assignment.source_notebook_id),
        "source_version_id": str(assignment.source_version_id),
        "title": assignment.title,
        "project_type": assignment.project_type,
        "is_active": assignment.is_active,
        "created_at": assignment.created_at.isoformat(),
        **extra,
    }


@router.post("/notebooks/{notebook_id}/assign", response_model=dict, status_code=201)
async def assign_notebook(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if not actor.is_teacher:
        raise HTTPException(status_code=403, detail="Solo un docente può assegnare un notebook")
    nb = await _get_owned_notebook(db, notebook_id, actor)
    try:
        session_id = UUID(str(request.get("session_id")))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Sessione non valida")

    session_result = await db.execute(
        select(Session)
        .join(Class, Session.class_id == Class.id)
        .where(Session.id == session_id, Class.teacher_id == actor.teacher.id, Session.deleted_at.is_(None))
    )
    if session_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Sessione non trovata")

    version = await _snapshot_notebook(db, nb, "Versione assegnata", "manual")
    task = Task(
        tenant_id=actor.teacher.tenant_id,
        session_id=session_id,
        title=nb.title,
        description=request.get("description") or "Notebook assegnato dal docente",
        task_type=TaskType.PROJECT,
        status=TaskStatus.PUBLISHED,
        content_json=json.dumps({
            "kind": "notebook_assignment",
            "notebook_title": nb.title,
            "project_type": nb.project_type,
            "source_notebook_id": str(nb.id),
            "source_version_id": str(version.id),
        }, ensure_ascii=False),
    )
    db.add(task)
    await db.flush()
    assignment = NotebookAssignment(
        tenant_id=actor.teacher.tenant_id,
        teacher_id=actor.teacher.id,
        session_id=session_id,
        task_id=task.id,
        source_notebook_id=nb.id,
        source_version_id=version.id,
        title=nb.title,
        project_type=nb.project_type or "python",
        cells=nb.cells or [],
        editor_settings=nb.editor_settings or {},
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return _assignment_summary(assignment)


@router.get("/notebooks/assignments", response_model=List[dict])
async def list_notebook_assignments(
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_teacher:
        result = await db.execute(
            select(NotebookAssignment, Session.title)
            .join(Session, NotebookAssignment.session_id == Session.id)
            .where(NotebookAssignment.teacher_id == actor.teacher.id)
            .order_by(NotebookAssignment.created_at.desc())
        )
        rows = []
        for assignment, session_title in result.all():
            count_result = await db.execute(
                select(TaskSubmission.id).where(TaskSubmission.task_id == assignment.task_id)
            )
            rows.append(_assignment_summary(
                assignment,
                session_title=session_title,
                submission_count=len(count_result.all()),
            ))
        return rows

    result = await db.execute(
        select(NotebookAssignment, NotebookFork)
        .outerjoin(
            NotebookFork,
            (NotebookFork.assignment_id == NotebookAssignment.id)
            & (NotebookFork.student_id == actor.student.id),
        )
        .where(
            NotebookAssignment.session_id == actor.student.session_id,
            NotebookAssignment.is_active.is_(True),
        )
        .order_by(NotebookAssignment.created_at.desc())
    )
    rows = []
    for assignment, fork in result.all():
        submitted = await db.execute(
            select(TaskSubmission.submitted_at)
            .where(TaskSubmission.task_id == assignment.task_id, TaskSubmission.student_id == actor.student.id)
            .order_by(TaskSubmission.submitted_at.desc())
            .limit(1)
        )
        submitted_at = submitted.scalar_one_or_none()
        rows.append(_assignment_summary(
            assignment,
            fork_notebook_id=str(fork.notebook_id) if fork else None,
            submitted_at=submitted_at.isoformat() if submitted_at else None,
        ))
    return rows


@router.post("/notebooks/assignments/{assignment_id}/fork", response_model=dict, status_code=201)
async def fork_notebook_assignment(
    assignment_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_teacher:
        raise HTTPException(status_code=403, detail="Questa azione è riservata agli studenti")
    result = await db.execute(
        select(NotebookAssignment).where(
            NotebookAssignment.id == assignment_id,
            NotebookAssignment.session_id == actor.student.session_id,
            NotebookAssignment.is_active.is_(True),
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Notebook assegnato non trovato")
    existing = await db.execute(
        select(NotebookFork).where(
            NotebookFork.assignment_id == assignment.id,
            NotebookFork.student_id == actor.student.id,
        )
    )
    fork = existing.scalar_one_or_none()
    if fork:
        return {"notebook_id": str(fork.notebook_id), "created": False}

    nb = Notebook(
        tenant_id=actor.student.tenant_id,
        owner_id=actor.student.id,
        title=assignment.title,
        project_type=assignment.project_type,
        cells=assignment.cells or [],
        editor_settings=assignment.editor_settings or {},
    )
    db.add(nb)
    await db.flush()
    fork = NotebookFork(assignment_id=assignment.id, student_id=actor.student.id, notebook_id=nb.id)
    db.add(fork)
    await db.commit()
    return {"notebook_id": str(nb.id), "created": True}


@router.post("/notebooks/{notebook_id}/submit", response_model=dict, status_code=201)
async def submit_notebook(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    if actor.is_teacher:
        raise HTTPException(status_code=403, detail="Questa azione è riservata agli studenti")
    nb = await _get_owned_notebook(db, notebook_id, actor)
    result = await db.execute(
        select(NotebookFork, NotebookAssignment)
        .join(NotebookAssignment, NotebookFork.assignment_id == NotebookAssignment.id)
        .where(NotebookFork.notebook_id == nb.id, NotebookFork.student_id == actor.student.id)
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=409, detail="Questo notebook non deriva da un compito assegnato")
    fork, assignment = row
    version = await _snapshot_notebook(db, nb, "Versione consegnata", "manual")
    payload = {
        "kind": "notebook_submission",
        "assignment_id": str(assignment.id),
        "source_version_id": str(assignment.source_version_id),
        "student_notebook_id": str(nb.id),
        "student_version_id": str(version.id),
        "title": nb.title,
        "project_type": nb.project_type,
        "cells": nb.cells or [],
        "editor_settings": nb.editor_settings or {},
    }
    submission = TaskSubmission(
        task_id=assignment.task_id,
        student_id=actor.student.id,
        content=f"notebook: {nb.title}",
        content_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return {
        "id": str(submission.id),
        "version_id": str(version.id),
        "submitted_at": submission.submitted_at.isoformat(),
    }


# ── Get notebook ─────────────────────────────────────────────────────────────

@router.get("/notebooks/{notebook_id}", response_model=dict)
async def get_notebook(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    return _notebook_detail(nb)


# ── Update notebook (title + cells) ─────────────────────────────────────────

@router.put("/notebooks/{notebook_id}", response_model=dict)
async def update_notebook(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)

    if "title" in request and request["title"]:
        nb.title = request["title"]
    if "cells" in request:
        nb.cells = request["cells"]
    if "project_type" in request:
        nb.project_type = _normalize_project_type(request["project_type"])
    if "editor_settings" in request and isinstance(request["editor_settings"], dict):
        current_settings = _default_editor_settings(nb.project_type)
        current_settings.update(nb.editor_settings or {})
        current_settings.update(request["editor_settings"])
        nb.editor_settings = current_settings

    # Force updated_at
    nb.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(nb)
    return _notebook_detail(nb)


# ── Delete notebook ──────────────────────────────────────────────────────────

@router.delete("/notebooks/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    await db.delete(nb)
    await db.commit()


# ── Version history / rollback ──────────────────────────────────────────────

# Quante versioni teniamo per notebook: oltre questa soglia le più vecchie
# vengono potate per non far crescere la tabella all'infinito.
MAX_VERSIONS_PER_NOTEBOOK = 50
VALID_VERSION_SOURCES = {"manual", "ai", "auto", "rollback"}


def _version_summary(v: NotebookVersion) -> dict:
    """Versione 'leggera' per l'elenco: niente celle, solo i metadati."""
    cells = v.cells or []
    return {
        "id": str(v.id),
        "label": v.label,
        "source": v.source,
        "title": v.title,
        "project_type": v.project_type,
        "cell_count": len(cells) if isinstance(cells, list) else 0,
        "created_at": v.created_at.isoformat(),
    }


def _version_detail(v: NotebookVersion) -> dict:
    return {
        **_version_summary(v),
        "cells": v.cells or [],
        "editor_settings": v.editor_settings or {},
    }


async def _snapshot_notebook(
    db: AsyncSession,
    nb: Notebook,
    label: str,
    source: str,
) -> NotebookVersion:
    """Crea una versione con lo stato CORRENTE del notebook e pota le più vecchie.
    Non fa commit: lo fa il chiamante."""
    version = NotebookVersion(
        notebook_id=nb.id,
        tenant_id=nb.tenant_id,
        label=(label or "Snapshot")[:160],
        source=source if source in VALID_VERSION_SOURCES else "manual",
        title=nb.title,
        project_type=nb.project_type or "python",
        cells=nb.cells or [],
        editor_settings=nb.editor_settings or {},
    )
    db.add(version)
    await db.flush()

    # Potatura: tieni solo le ultime MAX_VERSIONS_PER_NOTEBOOK.
    stale = await db.execute(
        select(NotebookVersion.id)
        .where(NotebookVersion.notebook_id == nb.id)
        .order_by(NotebookVersion.created_at.desc())
        .offset(MAX_VERSIONS_PER_NOTEBOOK)
    )
    stale_ids = [row[0] for row in stale.all()]
    protected_result = await db.execute(
        select(NotebookAssignment.source_version_id).where(
            NotebookAssignment.source_notebook_id == nb.id,
            NotebookAssignment.source_version_id.in_(stale_ids),
        )
    ) if stale_ids else None
    protected_ids = {row[0] for row in protected_result.all()} if protected_result else set()
    for sid in stale_ids:
        # Published template versions are immutable references and must remain
        # available even after the notebook exceeds the normal history limit.
        if sid in protected_ids:
            continue
        old = await db.get(NotebookVersion, sid)
        if old is not None:
            await db.delete(old)
    return version


@router.get("/notebooks/{notebook_id}/versions", response_model=List[dict])
async def list_notebook_versions(
    notebook_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    result = await db.execute(
        select(NotebookVersion)
        .where(NotebookVersion.notebook_id == nb.id)
        .order_by(NotebookVersion.created_at.desc())
    )
    return [_version_summary(v) for v in result.scalars().all()]


@router.post("/notebooks/{notebook_id}/versions", response_model=dict, status_code=201)
async def create_notebook_version(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    label = (request.get("label") or "Salvataggio manuale").strip()
    source = request.get("source") or "manual"
    version = await _snapshot_notebook(db, nb, label, source)
    await db.commit()
    await db.refresh(version)
    return _version_summary(version)


@router.get("/notebooks/{notebook_id}/versions/{version_id}", response_model=dict)
async def get_notebook_version(
    notebook_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    version = await db.get(NotebookVersion, version_id)
    if version is None or version.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Versione non trovata")
    return _version_detail(version)


@router.post("/notebooks/{notebook_id}/versions/{version_id}/restore", response_model=dict)
async def restore_notebook_version(
    notebook_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    version = await db.get(NotebookVersion, version_id)
    if version is None or version.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Versione non trovata")

    # Prima di sovrascrivere, salviamo lo stato attuale come checkpoint, così
    # anche il ripristino è reversibile.
    await _snapshot_notebook(db, nb, "Prima del ripristino", "auto")

    nb.title = version.title or nb.title
    nb.project_type = _normalize_project_type(version.project_type)
    nb.cells = version.cells or []
    if isinstance(version.editor_settings, dict):
        nb.editor_settings = version.editor_settings
    nb.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(nb)
    return _notebook_detail(nb)


@router.delete("/notebooks/{notebook_id}/versions/{version_id}", status_code=204)
async def delete_notebook_version(
    notebook_id: UUID,
    version_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)
    version = await db.get(NotebookVersion, version_id)
    if version is None or version.notebook_id != nb.id:
        raise HTTPException(status_code=404, detail="Versione non trovata")
    await db.delete(version)
    await db.commit()


# ── Tutor chat ───────────────────────────────────────────────────────────────

@router.post("/notebooks/{notebook_id}/tutor", response_model=dict)
async def notebook_tutor_chat(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """
    Tutor chat with full notebook context.
    Request body: { message, history, notebook_title, current_cell_source, last_output }
    """
    nb = await _get_owned_notebook(db, notebook_id, actor)

    message = request.get("message", "")
    if not str(message or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Messaggio mancante")

    requested_history = _sanitize_tutor_history(request.get("history", []))
    server_history = _sanitize_tutor_history(nb.tutor_messages or [])
    history = server_history or requested_history
    current_cell = request.get("current_cell_source", "")
    last_output = request.get("last_output", "")
    pending_proposals = request.get("pending_proposals", [])
    project_type = nb.project_type or "python"

    # Build rich context
    all_code = "\n\n# --- next cell ---\n".join(
        cell.get("source", "") for cell in (nb.cells or []) if cell.get("type") == "code"
    )
    relevant_context = _build_notebook_context(nb, message, current_cell, last_output)

    if project_type == "python":
        language_label = "Python"
        code_fence = "python"
    elif project_type == "microbit":
        language_label = "micro:bit con MicroPython (codice caricato sulla scheda via WebUSB e monitor seriale)"
        code_fence = "python"
    elif project_type == "circuitplayground":
        language_label = "Circuit Playground Express con MakeCode TypeScript, compilazione UF2 e comunicazione seriale Web Serial"
        code_fence = "typescript"
    elif project_type == "game2d":
        language_label = "Game 2D schema JSON con runner Phaser"
        code_fence = "json"
    elif project_type == "strudel":
        language_label = "Strudel (live coding musicale con mini notation)"
        code_fence = "javascript"
    else:
        language_label = "p5.js / JavaScript creativo"
        code_fence = "javascript"
    proposals_context = ""
    if pending_proposals:
        proposals_context = f"""

Proposte di modifica attualmente in attesa di approvazione:
{json.dumps(pending_proposals[:5], ensure_ascii=False)}
"""

    strudel_extra = ""
    if project_type == "strudel":
        strudel_extra = """
Strudel è un sistema di live coding musicale basato su JavaScript. Concetti chiave:
- Mini notation: pattern ritmici tra virgolette, es. "bd sd" o "c3 e3 g3"
- Funzioni principali: note(), s(), sound(), n(), freq()
- Parametri audio: gain(), pan(), room(), delay(), cutoff(), speed()
- Inviluppo: attack(), decay(), sustain(), release()
- Trasformazioni pattern: .slow(n), .fast(n), .rev(), .palindrome(), .every(n, fn)
- Combinatori: stack(...), seq(...), cat(...)
- Il codice viene eseguito in tempo reale e produce audio nel browser via WebAudio
- Shift+Enter o il pulsante Play eseguono il codice; l'audio parte solo dopo il primo clic "Attiva audio"
"""
    game2d_extra = ""
    if project_type == "game2d":
        game2d_extra = """
Game 2D usa un runner Phaser fisso e una cella JSON come configurazione.
Concetti chiave:
- Lo schema descrive metadata, world, player, entities, collectibles, goal e ui
- Non serve scrivere codice JavaScript per il prototipo: cambia i dati JSON
- player.speed controlla la velocità, world.gravity controlla il movimento verticale
- entities include platform, hazard, enemy; collectibles include oggetti raccoglibili
- behaviors come patrol definiscono movimenti pre-scritti dal runner
- Il JSON deve restare valido e serializzabile
"""
    p5js_extra = ""
    if project_type == "p5js":
        p5js_extra = "\n" + P5JS_REFERENCE + "\n"
    microbit_extra = ""
    if project_type == "microbit":
        microbit_extra = """
micro:bit usa una singola pagina di codice MicroPython che viene caricata sulla scheda via WebUSB.
Il tutor deve trasformare intenzioni creative in passi realizzabili e codice MicroPython che gira DAVVERO
sulla scheda, facendo una domanda socratica quando l'intenzione è ambigua.

""" + MICROBIT_MICROPYTHON_REFERENCE + "\n"
    circuitplayground_extra = ""
    if project_type == "circuitplayground":
        circuitplayground_extra = """
Circuit Playground Express usa una singola pagina di codice MakeCode TypeScript per programmare la scheda.
Concetti chiave:
- MakeCode TypeScript: forever, pause, light.setAll, input.temperature(TemperatureUnit.Celsius), input.lightLevel(), serial.writeLine
- Il codice viene compilato dal microservizio PXT in un firmware UF2 per Circuit Playground Express
- Per parlare con il browser usa output seriale semplice, es. temp=22 luce=120 movimento=3, oppure JSON serializzabile
- Il browser legge la seriale con Web Serial: Chrome/Edge, HTTPS o localhost
- La scheda in bootloader UF2/CPLAYBOOT e pronta per ricevere il firmware compilato; in runtime esegue il codice e invia dati seriali
- Ogni blocco di codice proposto deve avere commenti in italiano che spieghino cosa fa e a cosa serve
- Il tutor deve collegare sempre intenzione creativa, sensori onboard, NeoPixel/audio e dati seriali verso il browser

""" + CIRCUITPLAYGROUND_API_REFERENCE + "\n"

    system_prompt = f"""Sei un tutor esperto di {language_label} per studenti e docenti.
Stai aiutando con il notebook intitolato: "{nb.title}".
Tipo progetto: {project_type}
{strudel_extra}
{game2d_extra}
{p5js_extra}
{microbit_extra}
{circuitplayground_extra}
Codice completo del notebook (tutte le celle):
```{code_fence}
{all_code[:3000]}
```

Contesto notebook recuperato in base alla richiesta e alla cella attiva:
```text
{relevant_context[:4000]}
```

Cella corrente su cui sta lavorando l'utente:
```{code_fence}
{current_cell[:1000]}
```

{"Ultimo output/errore ricevuto:" if last_output else ""}
{f"```{chr(10)}{last_output[:500]}{chr(10)}```" if last_output else ""}
{proposals_context}

Il tuo obiettivo:
1. Aiuta l'utente a capire i concetti, NON scrivere il codice al suo posto
2. Se l'utente è bloccato, scomponi il problema in esercizi più semplici
3. Suggerisci approcci e funzioni utili, ma lascia che l'utente scriva il codice
4. Se l'utente chiede esplicitamente del codice di esempio, puoi mostrarne uno breve
5. Se il progetto è p5js, considera setup(), draw(), preload(), canvas, coordinate, frame rate e ciclo di rendering
6. Se il progetto è strudel, guida con domande sulla mini notation, i ritmi, i parametri sonori e la struttura del pattern
7. Se il progetto è game2d, ragiona sullo schema JSON e non proporre codice libero se non richiesto esplicitamente
8. Se il progetto è microbit, collega sempre intenzione creativa, sensori/attuatori e dati seriali verso il browser
9. Per microbit, ogni blocco di codice deve includere commenti in italiano che spieghino cosa fa e a cosa serve
10. Se il progetto è circuitplayground, collega sempre intenzione creativa, sensori onboard, NeoPixel/audio e dati seriali verso il browser
11. Per circuitplayground, ogni blocco di codice deve includere commenti in italiano che spieghino cosa fa e a cosa serve
12. Non usare emoji, emoticon o toni giocosi
13. Rispondi in modo compatto, chiaro e operativo: paragrafi brevi, pochi punti, niente preamboli inutili
14. Mantieni uno stile socratico: fai al massimo una domanda guida per volta quando serve
15. Rispondi sempre in italiano a meno che l'utente scriva in un'altra lingua"""

    messages = [{"role": m["role"], "content": m["content"]} for m in history[-10:]]
    messages.append({"role": "user", "content": str(message).strip()})

    provider = "anthropic"
    model = "claude-haiku-4-5-20251001"

    try:
        response = await llm_service.generate(
            messages=messages,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            temperature=0.5,
            max_tokens=1500,
            allow_web_search=False,
        )
        updated_history = _sanitize_tutor_history([
            *history,
            {"role": "user", "content": str(message).strip()},
            {"role": "assistant", "content": response.content},
        ])
        nb.tutor_messages = updated_history
        nb.updated_at = datetime.utcnow()
        await db.commit()
        return {"response": response.content, "history": updated_history}
    except Exception as e:
        logger.error(f"Tutor chat error: {e}")
        raise HTTPException(status_code=500, detail="Errore del tutor AI")


@router.post("/notebooks/{notebook_id}/assist", response_model=dict)
async def notebook_assist(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    nb = await _get_owned_notebook(db, notebook_id, actor)

    active_source = request.get("current_cell_source", "") or ""
    last_output = request.get("last_output", "") or ""
    user_prompt = request.get("message", "") or "Analizza il codice e suggerisci correzioni mirate."
    project_type = nb.project_type or "python"
    provider, model, prompt_tokens, completion_tokens = _notebook_agent_usage_estimate(
        project_type, active_source, last_output, user_prompt
    )
    credit_scope = await _notebook_credit_scope(db, actor)
    await _require_notebook_agent_credits(
        db, credit_scope, provider, model, prompt_tokens, completion_tokens
    )

    all_code = "\n\n# --- next cell ---\n".join(
        cell.get("source", "") for cell in (nb.cells or []) if cell.get("type") == "code"
    )
    relevant_context = _build_notebook_context(nb, user_prompt, active_source, last_output)

    try:
        staged_messages: list[dict] = []
        if project_type in {"python", "p5js"}:
            # Stessa architettura E STESSA UI di Coding Lab (generazione sul file completo +
            # revisione indipendente, bolle Prompt Analyst/Architetto/File Writer/Reviewer/
            # Coding Builder) e stesso model-routing (Sonnet docenti / DeepSeek studenti).
            # Un fallimento qui (es. il provider torna un JSON non valido anche dopo i
            # retry) non deve far esplodere l'intera richiesta con un 500 senza feedback:
            # meglio un messaggio d'errore chiaro in chat, come farebbe Coding Builder.
            try:
                normalized, summary_text, staged_messages = await _run_agent_pipeline(
                    project_type, active_source, last_output, user_prompt, actor.is_student
                )
            except Exception as exc:
                logger.error(f"Notebook agent pipeline error: {exc}")
                normalized = []
                summary_text = "Non sono riuscito a generare una modifica valida questa volta. Riprova, oppure semplifica la richiesta in più passaggi più piccoli."
                staged_messages = [{
                    "role": "assistant", "agent_name": "Coding Builder",
                    "content": summary_text,
                    "metadata": {"kind": "codegen_result"},
                }]
        else:
            # Percorso legacy invariato per microbit/circuitplayground/game2d: una sola
            # chiamata LLM, con l'autofix reale via compilatore PXT per Circuit Playground.
            normalized, summary_text = await _run_legacy_single_pass(
                project_type, nb.title, all_code, relevant_context, active_source, last_output, user_prompt
            )

        response_payload = {
            "summary": summary_text,
            "proposals": normalized,
        }
        if project_type in {"microbit", "circuitplayground", "python", "p5js"}:
            new_entries = staged_messages or [{"role": "assistant", "content": response_payload["summary"]}]
            updated_history = _sanitize_tutor_history([
                *(nb.tutor_messages or []),
                {"role": "user", "content": str(user_prompt).strip()},
                *new_entries,
            ])
            nb.tutor_messages = updated_history
            nb.updated_at = datetime.utcnow()
            await db.commit()
            response_payload["history"] = updated_history

        await _track_notebook_agent_usage(
            db,
            credit_scope,
            provider,
            model,
            prompt_tokens,
            completion_tokens,
            project_type,
        )

        return response_payload
    except Exception as e:
        logger.error(f"Notebook assist error: {e}")
        raise HTTPException(status_code=500, detail="Errore dell'assistente AI")


@router.post("/notebooks/{notebook_id}/assist-stream")
async def notebook_assist_stream(
    notebook_id: UUID,
    request: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    """Variante SSE di /assist per python/p5js. La pipeline fa due chiamate Sonnet in serie
    su tutto il file (~70s ciascuna): in JSON sincrono superano il timeout ~100s di
    Cloudflare (errore 524). Con lo streaming il primo byte parte subito, un heartbeat ogni
    ~15s tiene viva la connessione, e ogni bolla d'agente compare dal vivo nella chat."""
    nb = await _get_owned_notebook(db, notebook_id, actor)
    active_source = request.get("current_cell_source", "") or ""
    last_output = request.get("last_output", "") or ""
    user_prompt = request.get("message", "") or "Analizza il codice e suggerisci correzioni mirate."
    project_type = nb.project_type or "python"
    is_student = actor.is_student
    provider, model, prompt_tokens, completion_tokens = _notebook_agent_usage_estimate(
        project_type, active_source, last_output, user_prompt
    )
    credit_scope = await _notebook_credit_scope(db, actor)
    await _require_notebook_agent_credits(
        db, credit_scope, provider, model, prompt_tokens, completion_tokens
    )

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        staged: list[dict] = []
        result: dict = {"proposals": [], "summary": "Analisi completata."}

        async def run_pipeline():
            try:
                async for kind, payload in _run_agent_pipeline_stream(
                    project_type, active_source, last_output, user_prompt, is_student
                ):
                    if kind == "stage":
                        staged.append(payload)
                        await queue.put({"type": "stage", "message": payload})
                    else:
                        result["proposals"], result["summary"] = payload
            except Exception as exc:
                logger.error(f"Notebook agent pipeline stream error: {exc}")
                result["summary"] = "Non sono riuscito a generare una modifica valida questa volta. Riprova, oppure semplifica la richiesta in più passaggi più piccoli."
                result["proposals"] = []
                fallback = {
                    "role": "assistant", "agent_name": "Coding Builder",
                    "content": result["summary"], "metadata": {"kind": "codegen_result"},
                }
                staged.append(fallback)
                await queue.put({"type": "stage", "message": fallback})
            finally:
                # Persiste la history (bolle a stadi comprese) come fa /assist.
                try:
                    updated_history = _sanitize_tutor_history([
                        *(nb.tutor_messages or []),
                        {"role": "user", "content": str(user_prompt).strip()},
                        *staged,
                    ])
                    nb.tutor_messages = updated_history
                    nb.updated_at = datetime.utcnow()
                    await db.commit()
                except Exception as exc:
                    logger.error(f"Notebook assist-stream history commit failed: {exc}")
                    updated_history = _sanitize_tutor_history(nb.tutor_messages or [])
                try:
                    await _track_notebook_agent_usage(
                        db,
                        credit_scope,
                        provider,
                        model,
                        prompt_tokens,
                        completion_tokens,
                        project_type,
                    )
                except Exception as exc:
                    logger.exception("Notebook assist-stream credit tracking failed: %s", exc)
                await queue.put({
                    "type": "done",
                    "summary": result["summary"],
                    "proposals": result["proposals"],
                    "history": updated_history,
                })
                await queue.put(None)

        task = asyncio.create_task(run_pipeline())
        try:
            while True:
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    # Heartbeat: byte periodico così Cloudflare/nginx non chiudono per idle
                    # mentre una chiamata Sonnet lunga è ancora in corso.
                    yield _sse({"type": "ping"})
                    continue
                if frame is None:
                    break
                yield _sse(frame)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_owned_notebook(db: AsyncSession, notebook_id: UUID, actor: StudentOrTeacher) -> Notebook:
    owner_id, tenant_id = _owner_id_and_tenant(actor)
    result = await db.execute(
        select(Notebook).where(
            Notebook.id == notebook_id,
            Notebook.owner_id == owner_id,
            Notebook.tenant_id == tenant_id,
        )
    )
    nb = result.scalar_one_or_none()
    if not nb:
        raise HTTPException(status_code=404, detail="Notebook non trovato")
    return nb


def _notebook_detail(nb: Notebook) -> dict:
    return {
        "id": str(nb.id),
        "title": nb.title,
        "project_type": nb.project_type or "python",
        "cells": nb.cells or [],
        "editor_settings": _default_editor_settings(nb.project_type or "python") | (nb.editor_settings or {}),
        "tutor_messages": _sanitize_tutor_history(nb.tutor_messages or []),
        "created_at": nb.created_at.isoformat(),
        "updated_at": nb.updated_at.isoformat(),
    }


def _normalize_project_type(value: Optional[str]) -> str:
    project_type = (value or "python").strip().lower()
    if project_type not in SUPPORTED_PROJECT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo progetto non supportato")
    return project_type


def _default_editor_settings(project_type: str) -> dict:
    return {
        "theme": "dracula" if project_type in ("p5js", "strudel", "game2d", "microbit", "circuitplayground") else "dark",
        "font_size": 14,
        "font_family": "jetbrains",
        "live_preview": project_type in ("p5js", "game2d"),
        "microbit_language": "python" if project_type == "microbit" else None,
        "device_language": "typescript" if project_type == "circuitplayground" else "python" if project_type == "microbit" else None,
    }


def _code_cell(source: str, name: str | None = None) -> dict:
    cell = {
        "id": str(uuid.uuid4()),
        "type": "code",
        "source": source,
        "outputs": [],
        "execution_count": None,
    }
    if name:
        cell["name"] = name
    return cell


def _template_cells(project_type: str, template_key: str | None) -> list[dict] | None:
    if not template_key:
        return None

    key = template_key.strip().lower()

    if project_type == "python" and key == "python-data-detective":
        return [_code_cell("""# Detective dei dati: città, energia e una piccola previsione
# Esegui la cella: il codice crea dati, li analizza e stampa una dashboard testuale.

import math
import random
from statistics import mean

random.seed(7)

citta = ["Bologna", "Milano", "Napoli", "Torino", "Palermo", "Firenze"]
dati = []

for mese in range(1, 13):
    stagione = math.sin((mese - 1) / 12 * 2 * math.pi)
    for nome in citta:
        base = 95 + citta.index(nome) * 7
        temperatura = 17 + 11 * stagione + random.uniform(-2.5, 2.5)
        energia = base + temperatura * 2.8 + random.uniform(-12, 12)
        dati.append({
            "mese": mese,
            "citta": nome,
            "temperatura": round(temperatura, 1),
            "energia": round(energia, 1),
        })

def barra(valore, massimo, larghezza=28):
    pieni = round(valore / massimo * larghezza)
    return "█" * pieni + "░" * (larghezza - pieni)

print("DASHBOARD ENERGIA URBANA")
print("=" * 72)

totali = {}
for riga in dati:
    totali[riga["citta"]] = totali.get(riga["citta"], 0) + riga["energia"]

massimo = max(totali.values())
for nome, totale in sorted(totali.items(), key=lambda item: item[1], reverse=True):
    print("{:<9} {} {:>7.0f} kWh".format(nome, barra(totale, massimo), totale))

print("\\nCORRELAZIONE TEMPERATURA -> ENERGIA")
media_temp = mean(r["temperatura"] for r in dati)
media_energia = mean(r["energia"] for r in dati)
cov = sum((r["temperatura"] - media_temp) * (r["energia"] - media_energia) for r in dati)
var_temp = sum((r["temperatura"] - media_temp) ** 2 for r in dati)
pendenza = cov / var_temp
intercetta = media_energia - pendenza * media_temp

for temp in [8, 16, 24, 32]:
    previsione = intercetta + pendenza * temp
    print("Se la temperatura media e {:>2} C, consumo previsto: {:>6.1f} kWh".format(temp, previsione))

print("\\nIDEA WOW")
print("Cambia random.seed(), aggiungi una città o modifica la formula: la dashboard cambia subito.")
""")]

    if project_type == "p5js" and key == "p5js-galaxy":
        return [_code_cell("""let stelle = []
let pianeti = []

function setup() {
  createCanvas(760, 460)
  colorMode(HSB, 360, 100, 100, 100)
  noStroke()

  for (let i = 0; i < 260; i++) {
    stelle.push({
      x: random(width),
      y: random(height),
      z: random(1, 4),
      hue: random(190, 260)
    })
  }

  for (let i = 0; i < 7; i++) {
    pianeti.push({
      r: 42 + i * 28,
      size: 8 + i * 2,
      speed: 0.006 + i * 0.002,
      hue: 20 + i * 38
    })
  }
}

function draw() {
  background(232, 48, 8)
  translate(width / 2, height / 2)

  let energiaMouse = map(mouseX, 0, width, 0.4, 2.2)
  let impulso = map(mouseY, 0, height, 1.8, 0.5)

  push()
  translate(-width / 2, -height / 2)
  for (let s of stelle) {
    s.x += s.z * 0.12 * energiaMouse
    if (s.x > width) s.x = 0
    fill(s.hue, 45, 90, 35 + s.z * 14)
    circle(s.x, s.y, s.z)
  }
  pop()

  for (let alone = 0; alone < 4; alone++) {
    fill(45, 90, 100, 6)
    circle(0, 0, 90 + alone * 38 + sin(frameCount * 0.02) * 12)
  }

  fill(48, 95, 100)
  circle(0, 0, 54)
  fill(12, 95, 100, 35)
  circle(0, 0, 88)

  for (let p of pianeti) {
    noFill()
    stroke(210, 22, 90, 18)
    circle(0, 0, p.r * 2)
    noStroke()

    let a = frameCount * p.speed * energiaMouse + p.r
    let x = cos(a) * p.r
    let y = sin(a * impulso) * p.r * 0.56
    fill(p.hue, 75, 95)
    circle(x, y, p.size)
    fill(0, 0, 100, 35)
    circle(x - p.size * 0.25, y - p.size * 0.25, p.size * 0.35)
  }

  resetMatrix()
  fill(0, 0, 100, 86)
  textSize(14)
  text("Muovi il mouse: velocita orbitale e inclinazione cambiano in tempo reale", 22, height - 24)
}
""")]

    if project_type == "microbit" and key == "microbit-mission-control":
        return [_code_cell("""from microbit import *
import music

# Mission Control micro:bit
# Sensori usati: luce, temperatura, accelerometro, bussola, pulsanti.
# Output usati: display LED, musica, seriale per il cruscotto del browser.

compass.calibrate()
display.scroll("MISSION")

while True:
    temp = temperature()
    light = display.read_light_level()
    accx = accelerometer.get_x()
    accy = accelerometer.get_y()
    accz = accelerometer.get_z()
    heading = compass.heading()
    gesture = accelerometer.current_gesture()

    if button_a.was_pressed():
        music.play(["C4:1", "E4:1", "G4:1", "C5:2"])

    if button_b.was_pressed():
        display.scroll("GO")

    if gesture == "shake":
        display.show(Image.SURPRISED)
        music.pitch(880, 120)
    elif light < 35:
        display.show(Image.GHOST)
    elif temp > 28:
        display.show(Image.HAPPY)
    elif accx > 350:
        display.show(Image.ARROW_E)
    elif accx < -350:
        display.show(Image.ARROW_W)
    else:
        display.show(Image.DIAMOND)

    print("temp={} light={} compass={} accx={} accy={} accz={} a={} b={}".format(
        temp, light, heading, accx, accy, accz,
        button_a.is_pressed(), button_b.is_pressed()
    ))

    sleep(250)
""", "main.py")]

    if project_type == "circuitplayground" and key == "circuitplayground-sensor-party":
        return [_code_cell("""// Sensor Party per Circuit Playground Express
// Sensori: temperatura, luce, suono, accelerazione e gesture shake.
// Output: NeoPixel, toni audio e righe seriali key=value per il cruscotto.

let temp = 0
let luce = 0
let suono = 0
let accx = 0
let step = 0

input.onGesture(Gesture.Shake, function () {
  music.playTone(Note.C, music.beat(BeatFraction.Quarter))
  music.playTone(Note.G, music.beat(BeatFraction.Quarter))
  light.setAll(0xffffff)
})

input.buttonA.onEvent(ButtonEvent.Click, function () {
  music.playTone(Note.E, music.beat(BeatFraction.Half))
})

forever(function () {
  temp = input.temperature(TemperatureUnit.Celsius)
  luce = input.lightLevel()
  suono = input.soundLevel()
  accx = input.acceleration(Dimension.X)

  serial.writeLine("temp=" + temp + " luce=" + luce + " sound=" + suono + " accx=" + accx)

  for (let i = 0; i < 10; i++) {
    if (i <= Math.map(luce, 0, 255, 0, 9)) {
      light.setPixelColor(i, 0x00ccff)
    } else {
      light.setPixelColor(i, 0x160033)
    }
  }

  step = Math.constrain(Math.map(Math.abs(accx), 0, 1024, 0, 9), 0, 9)
  light.setPixelColor(step, 0xffcc00)

  if (suono > 120) {
    light.setAll(0xff0066)
  } else if (temp > 28) {
    light.setAll(0xff3300)
  }

  pause(180)
})
""", "main.ts")]

    return None


def _starter_cells(project_type: str, template_key: str | None = None) -> list[dict]:
    template = _template_cells(project_type, template_key)
    if template:
        return template

    if project_type == "p5js":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "source": (
                "function setup() {\n"
                "  createCanvas(640, 360)\n"
                "  noStroke()\n"
                "}\n\n"
                "function draw() {\n"
                "  background(248, 250, 252)\n"
                "  fill(59, 130, 246)\n"
                "  circle(mouseX, mouseY, 48)\n"
                "}\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "strudel":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "source": (
                "// Benvenuto nel live coding musicale con Strudel!\n"
                "// Scrivi un pattern e premi Play (o Shift+Enter)\n\n"
                'note("c3 e3 g3 b3")\n'
                '  .sound("triangle")\n'
                "  .slow(2)\n"
                "  .gain(0.6)\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "game2d":
        starter_spec = {
            "version": 1,
            "metadata": {
                "title": "Primo prototipo 2D",
                "description": "Un runner Phaser legge questo JSON e costruisce il livello.",
            },
            "world": {
                "width": 960,
                "height": 540,
                "background": "#0f172a",
                "gravity": 900,
            },
            "player": {
                "x": 80,
                "y": 420,
                "width": 32,
                "height": 42,
                "color": "#38bdf8",
                "speed": 260,
                "jump": 470,
            },
            "goal": {
                "x": 880,
                "y": 382,
                "width": 36,
                "height": 72,
                "color": "#facc15",
                "label": "Portale",
            },
            "entities": [
                {"id": "ground", "type": "platform", "x": 480, "y": 520, "width": 960, "height": 40, "color": "#334155"},
                {"id": "step-1", "type": "platform", "x": 250, "y": 420, "width": 180, "height": 24, "color": "#475569"},
                {"id": "step-2", "type": "platform", "x": 515, "y": 335, "width": 190, "height": 24, "color": "#475569"},
                {"id": "enemy-1", "type": "enemy", "x": 570, "y": 480, "width": 34, "height": 34, "color": "#fb7185", "behavior": {"kind": "patrol", "axis": "x", "distance": 120, "speed": 90}},
                {"id": "spikes", "type": "hazard", "x": 735, "y": 502, "width": 120, "height": 24, "color": "#ef4444"},
            ],
            "collectibles": [
                {"id": "star-1", "x": 250, "y": 370, "radius": 11, "color": "#fde047"},
                {"id": "star-2", "x": 515, "y": 285, "radius": 11, "color": "#fde047"},
                {"id": "star-3", "x": 820, "y": 455, "radius": 11, "color": "#fde047"},
            ],
            "ui": {
                "objective": "Raccogli le stelle e raggiungi il portale.",
            },
        }
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "name": "game.json",
            "source": json.dumps(starter_spec, ensure_ascii=False, indent=2),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "microbit":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "name": "main.py",
            "source": (
                "from microbit import *\n\n"
                "# Questo programma legge temperatura, luce e inclinazione della micro:bit.\n"
                "# Serve per far arrivare dati reali al cruscotto seriale del browser.\n"
                "while True:\n"
                "    temp = temperature()\n"
                "    luce = display.read_light_level()\n"
                "    x = accelerometer.get_x()\n\n"
                "    # Scriviamo una riga key=value: il browser la trasforma in valori nel cruscotto.\n"
                "    print('temp=' + str(temp) + ' luce=' + str(luce) + ' x=' + str(x))\n\n"
                "    # Un feedback semplice sulla matrice LED mostra se la scheda e inclinata.\n"
                "    if x > 300:\n"
                "        display.show(Image.ARROW_E)\n"
                "    elif x < -300:\n"
                "        display.show(Image.ARROW_W)\n"
                "    else:\n"
                "        display.show(Image.HAPPY)\n\n"
                "    sleep(500)\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    if project_type == "circuitplayground":
        return [{
            "id": str(uuid.uuid4()),
            "type": "code",
            "name": "main.ts",
            "source": (
                "// Questo programma legge sensori onboard della Circuit Playground Express.\n"
                "// Serve per inviare dati reali al cruscotto seriale del browser.\n"
                "let temp = 0\n"
                "let luce = 0\n\n"
                "forever(function () {\n"
                "  // Leggiamo temperatura e luce: sono valori fisici rilevati dalla scheda.\n"
                "  temp = input.temperature(TemperatureUnit.Celsius)\n"
                "  luce = input.lightLevel()\n\n"
                "  // Scriviamo una riga key=value: il browser la trasforma in valori nel cruscotto.\n"
                "  serial.writeLine(\"temp=\" + temp + \" luce=\" + luce)\n\n"
                "  // I NeoPixel danno un feedback visivo: blu se fa fresco, rosso se fa caldo.\n"
                "  if (temp > 28) {\n"
                "    light.setAll(0xff0040)\n"
                "  } else {\n"
                "    light.setAll(0x0066ff)\n"
                "  }\n\n"
                "  pause(500)\n"
                "})\n"
            ),
            "outputs": [],
            "execution_count": None,
        }]
    return [{
        "id": str(uuid.uuid4()),
        "type": "code",
        "source": "# Benvenuto nel tuo notebook Python!\nprint('Hello, world!')\n",
        "outputs": [],
        "execution_count": None,
    }]


def _extract_json_object(raw_text: str) -> dict:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))
