# Catalogo API di piattaforma

Generato dal registro `backend/app/services/platform_actions.py` (non modificare a mano: rigenerare).

Tutte le azioni girano come **docente autenticato**, con gli stessi permessi e lo stesso conteggio crediti della funzione in UI.

| Endpoint | Cosa fa |
|---|---|
| `GET /api/v1/platform-api/catalog` | catalogo completo (domini → azioni, con parametri e porte) |
| `GET /api/v1/platform-api/catalog/{action_id}` | scheda di una azione |
| `POST /api/v1/platform-api/actions/{action_id}` | esegue; body `{"params": {...}}` → `{"action", "result"}` |

Ogni azione ha anche un `id` nodo `platform.<action_id>` e usa lo stesso vocabolario `param`/`port` del Data Flow Studio: sarà trasformata in nodo senza adattamenti. Le tabelle hanno la forma dataflow `{columns, rows, rowCount}`.

## Files (drive)

### `files.list` — Elenca file e cartelle

Elenca il contenuto di una cartella del drive (o cerca per nome).

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |
| `query` | STRING | `''` | Cerca per nome · opzionale |

**Output:** `items` (ANY), `table` (TABLE)

### `files.read_text` — Leggi file di testo

Restituisce il contenuto testuale (UTF-8, max 1 MB) di un file del drive: txt, md, csv, json…

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `item_id` | STRING | `''` | ID elemento del drive |

**Output:** `text` (ANY), `item` (ANY)

### `files.write` — Crea o scrivi file

Crea un nuovo file nel drive, oppure — indicando l'ID di un file esistente — ne sovrascrive il contenuto. Il contenuto è testo, oppure base64 con «Codifica = base64».

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `name` | STRING | `'nota.txt'` | Nome file (es. nota.md) |
| `content` | CODE | `''` | Contenuto |
| `encoding` | SELECT | `'text'` | Codifica · valori: text, base64 |
| `mime_type` | STRING | `''` | Tipo MIME (opzionale) · opzionale |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |
| `overwrite_item_id` | STRING | `''` | ID file da sovrascrivere (opzionale) · opzionale |

**Output:** `item_id` (ANY), `item` (ANY)

### `files.mkdir` — Crea cartella

Crea una cartella nel drive.

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `name` | STRING | `'Nuova cartella'` | Nome cartella |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |

**Output:** `item_id` (ANY), `item` (ANY)

### `files.move` — Sposta elementi

Sposta file/cartelle in un'altra cartella (vuoto = radice).

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `item_ids` | STRING | `''` | ID elementi (separati da virgola) |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |

**Output:** `moved` (ANY)

### `files.rename` — Rinomina elemento

Rinomina un file, una cartella o un documento (anche sulla piattaforma).

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `item_id` | STRING | `''` | ID elemento del drive |
| `name` | STRING | `''` | Nuovo nome |

**Output:** `item_id` (ANY), `item` (ANY)

### `files.trash` — Sposta nel cestino

Sposta elementi nel cestino (recuperabili).

_Effetti: deletes_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `item_ids` | STRING | `''` | ID elementi (separati da virgola) |

**Output:** `trashed` (ANY)

### `files.restore` — Ripristina dal cestino

Ripristina elementi dal cestino.

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `item_ids` | STRING | `''` | ID elementi (separati da virgola) |

**Output:** `restored` (ANY)

### `files.delete` — Elimina definitivamente

Elimina per sempre elementi già nel cestino. Irreversibile.

_Effetti: deletes_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `item_ids` | STRING | `''` | ID elementi (separati da virgola) |

**Output:** `deleted` (ANY)

## Documenti, presentazioni e tabelle

### `documents.list` — Elenca documenti

Elenca documenti, presentazioni e tabelle del docente.

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `doc_type` | SELECT | `''` | Tipo · valori: , document, presentation, sheet · opzionale |
| `session_id` | STRING | `''` | Sessione collegata (opzionale) · opzionale |

**Output:** `table` (TABLE)

### `documents.create_document` — Crea documento di testo

Crea un documento (word processor). Il contenuto può essere HTML oppure testo semplice (paragrafi separati da riga vuota).

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `title` | STRING | `''` | Titolo |
| `content` | CODE | `''` | Contenuto |
| `format` | SELECT | `'text'` | Formato contenuto · valori: text, html |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |
| `session_id` | STRING | `''` | Sessione collegata (opzionale) · opzionale |

**Output:** `document_id` (ANY), `drive_item_id` (ANY)

### `documents.create_presentation` — Crea presentazione

Crea una presentazione 16:9. «slides» è una lista JSON di {"title", "body" | "bullets": [...], "notes"?, "image"?: "data:image/png;base64,…"}.

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `title` | STRING | `''` | Titolo |
| `slides` | CODE | `'[{"title": "Titolo", "bullets": ["Punto 1", "Punto 2"]}]'` | Slide (JSON) |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |
| `session_id` | STRING | `''` | Sessione collegata (opzionale) · opzionale |

**Output:** `document_id` (ANY), `drive_item_id` (ANY)

### `documents.create_sheet` — Crea tabella (foglio di calcolo)

Crea un foglio di calcolo da una tabella collegata, oppure da «rows» (JSON: lista di liste o di oggetti; con oggetti la prima riga è l'intestazione).

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `title` | STRING | `''` | Titolo |
| `sheet_name` | STRING | `'Foglio 1'` | Nome foglio |
| `rows` | CODE | `''` | Righe (JSON, opzionale) · opzionale |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |
| `session_id` | STRING | `''` | Sessione collegata (opzionale) · opzionale |

**Output:** `document_id` (ANY), `drive_item_id` (ANY)

### `documents.read` — Leggi documento

Legge un documento, una presentazione o una tabella. Restituisce testo/HTML, slide o tabella a seconda del tipo.

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |

**Output:** `title` (ANY), `doc_type` (ANY), `text` (ANY), `html` (ANY), `slides` (ANY), `table` (TABLE)

### `documents.update_document` — Scrivi nel documento

Sostituisce o aggiunge in coda contenuto a un documento di testo.

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |
| `content` | CODE | `''` | Contenuto |
| `format` | SELECT | `'text'` | Formato contenuto · valori: text, html |
| `mode` | SELECT | `'append'` | Modalità · valori: append, replace |

**Output:** `document_id` (ANY)

### `documents.add_slides` — Aggiungi slide

Aggiunge slide in coda (o alla posizione indicata) a una presentazione.

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |
| `slides` | CODE | `'[{"title": "Nuova slide", "body": "Testo"}]'` | Slide (JSON) |
| `position` | INTEGER | `None` | Posizione (0 = in testa, vuoto = in coda) · opzionale |

**Output:** `document_id` (ANY), `slide_count` (ANY)

### `documents.sheet_append_rows` — Aggiungi righe alla tabella

Accoda righe a un foglio di calcolo, da una tabella collegata o da «rows». Con «Salta intestazione» la prima riga non viene scritta (utile per tabelle che hanno già l'intestazione).

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |
| `rows` | CODE | `''` | Righe (JSON, opzionale) · opzionale |
| `skip_header` | BOOLEAN | `True` | Salta intestazione della tabella collegata |

**Output:** `document_id` (ANY), `row_count` (ANY)

### `documents.sheet_write_cells` — Scrivi celle

Scrive singole celle di un foglio. «cells» è JSON: [{"row": 0, "col": 0, "value": "x"}] (indici da 0) oppure [{"ref": "B3", "value": "x"}].

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |
| `cells` | CODE | `'[{"ref": "A1", "value": "Ciao"}]'` | Celle (JSON) |

**Output:** `document_id` (ANY), `written` (ANY)

### `documents.rename` — Rinomina documento

Cambia il titolo di un documento, presentazione o tabella.

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |
| `title` | STRING | `''` | Nuovo titolo |

**Output:** `document_id` (ANY)

### `documents.trash` — Cestina documento

Sposta un documento nel cestino del drive (recuperabile).

_Effetti: deletes_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `document_id` | STRING | `''` | ID documento |

**Output:** `trashed` (ANY)

## Immagini

### `images.generate` — Genera immagine

Genera un'immagine con il generatore di piattaforma (stesso provider, crediti e limiti del generatore immagini). Opzionalmente la salva nel drive.

_Effetti: spends_credits_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `prompt` | CODE | `''` | Descrizione |
| `size` | SELECT | `'1024x1024'` | Dimensione · valori: 1024x1024, 1536x1024, 1024x1536 |
| `quality` | SELECT | `'standard'` | Qualità · valori: standard, high |
| `style` | SELECT | `'natural'` | Stile · valori: natural, vivid |
| `save_to_drive` | BOOLEAN | `False` | Salva nel drive |
| `filename` | STRING | `'immagine.png'` | Nome file (se salvata) · opzionale |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |

**Output:** `image_data` (ANY), `image_mime` (ANY), `data_uri` (ANY), `revised_prompt` (ANY), `item_id` (ANY)

## Modelli 3D

### `models3d.generate_from_text` — Genera modello 3D da testo

Avvia la generazione di un modello 3D con Meshy (stesso provider e crediti del 3D Lab). Asincrona: restituisce un task_id da interrogare con «models3d.status»; il progresso compare anche nell'indicatore job della navbar.

_Effetti: spends_credits, asincrona_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `prompt` | CODE | `''` | Descrizione (max 800 caratteri) |
| `ai_model` | SELECT | `'meshy-7.1'` | Modello Meshy · valori: meshy-6-lite, meshy-6, meshy-7.1, latest |
| `model_type` | SELECT | `'standard'` | Topologia · valori: standard, smart-topology |
| `target_polycount` | INTEGER | `30000` | Poligoni obiettivo |

**Output:** `task_id` (ANY), `job_id` (ANY), `task_type` (ANY)

### `models3d.generate_from_image` — Genera modello 3D da immagine

Come «da testo», partendo da un'immagine di riferimento (base64, oppure l'ID di un file immagine del drive).

_Effetti: spends_credits, asincrona_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `image_data` | CODE | `''` | Immagine base64 (opzionale se indichi un file) · opzionale |
| `image_item_id` | STRING | `''` | ID file immagine nel drive · opzionale |
| `image_mime` | STRING | `'image/png'` | Tipo MIME · opzionale |
| `prompt` | CODE | `''` | Prompt texture (opzionale) · opzionale |
| `ai_model` | SELECT | `'meshy-7.1'` | Modello Meshy · valori: meshy-6-lite, meshy-6, meshy-7.1, latest |
| `model_type` | SELECT | `'standard'` | Topologia · valori: standard, smart-topology |
| `target_polycount` | INTEGER | `30000` | Poligoni obiettivo |

**Output:** `task_id` (ANY), `job_id` (ANY), `task_type` (ANY)

### `models3d.status` — Stato generazione 3D

Interroga un task Meshy. «status» vale PENDING, IN_PROGRESS, SUCCEEDED, FAILED…; a successo «model_urls» contiene i link ai formati (glb, obj, stl…).

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `task_id` | STRING | `''` | ID task Meshy |
| `task_type` | SELECT | `'text'` | Tipo · valori: text, image |

**Output:** `status` (ANY), `progress` (ANY), `model_urls` (ANY), `raw` (ANY)

### `models3d.wait` — Attendi risultato 3D

Attende (polling ogni 5 s) che un task Meshy termini: utile in un flusso per usare il modello subito dopo la generazione. Errore se il task fallisce o scade il tempo.

_Effetti: none, asincrona_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `task_id` | STRING | `''` | ID task Meshy |
| `task_type` | SELECT | `'text'` | Tipo · valori: text, image |
| `timeout_seconds` | INTEGER | `300` | Attesa massima (secondi) |

**Output:** `status` (ANY), `model_urls` (ANY), `raw` (ANY)

### `models3d.save_to_drive` — Salva modello 3D nel drive

Scarica il modello generato da Meshy nel formato scelto e lo salva come file nel drive.

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `task_id` | STRING | `''` | ID task Meshy |
| `task_type` | SELECT | `'text'` | Tipo · valori: text, image |
| `format` | SELECT | `'glb'` | Formato · valori: glb, obj, stl, fbx, usdz |
| `filename` | STRING | `'modello'` | Nome file · opzionale |
| `parent_id` | STRING | `''` | Cartella (ID, vuoto = radice del drive) · opzionale |

**Output:** `item_id` (ANY), `item` (ANY)

### `models3d.list_projects` — Elenca progetti 3D

Elenca i progetti dell'editor solido (Tinkercad-like) del docente.

_Effetti: none_

**Output:** `table` (TABLE)

### `models3d.create_project` — Crea progetto 3D

Crea un progetto nell'editor solido. «scene» è la lista JSON di oggetti della scena (vuota = progetto vuoto).

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `name` | STRING | `'Nuovo progetto'` | Nome progetto |
| `scene` | CODE | `'[]'` | Scena (JSON) · opzionale |

**Output:** `model_id` (ANY), `project` (ANY)

## Sessioni live

### `live.list` — Elenca sessioni live

Elenca le sessioni live di una sessione di lavoro.

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `session_id` | STRING | `''` | ID sessione di lavoro |

**Output:** `table` (TABLE), `items` (ANY)

### `live.create` — Crea sessione live

Crea una sessione live interattiva. «slides» è JSON: lista di {"type": "mcq", "question", "options": [..], "correct_option": 0} | {"type": "wordwall"|"opinion"|"feedback", "prompt"}.

_Effetti: creates_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `session_id` | STRING | `''` | ID sessione di lavoro |
| `title` | STRING | `''` | Titolo |
| `slides` | CODE | `'[{"type": "mcq", "question": "Domanda?", "options": ["A", "B"], "correct_option": 0}]'` | Slide (JSON) |

**Output:** `interaction_id` (ANY), `status` (ANY)

### `live.start` — Avvia sessione live

Avvia la sessione live: gli studenti collegati la vedono subito sulla prima slide.

_Effetti: realtime_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `interaction_id` | STRING | `''` | ID sessione live |

**Output:** `result` (ANY)

### `live.next` — Slide successiva

Passa alla slide successiva; dopo l'ultima la sessione si chiude.

_Effetti: realtime_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `interaction_id` | STRING | `''` | ID sessione live |

**Output:** `result` (ANY)

### `live.end` — Termina sessione live

Chiude la sessione live per tutti i partecipanti.

_Effetti: realtime_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `interaction_id` | STRING | `''` | ID sessione live |

**Output:** `result` (ANY)

### `live.results` — Risultati sessione live

Restituisce i risultati aggregati e per studente della sessione live.

_Effetti: none_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `interaction_id` | STRING | `''` | ID sessione live |

**Output:** `result` (ANY)

### `live.public_link` — Abilita link pubblico

Abilita l'accesso pubblico (codice/QR) alla sessione live e restituisce il codice.

_Effetti: modifies_

| Parametro | Tipo | Default | Note |
|---|---|---|---|
| `interaction_id` | STRING | `''` | ID sessione live |

**Output:** `token` (ANY), `access_code` (ANY)

