# Dataflow Studio — Riferimento tecnico

**Stato del documento:** 8 ottobre 2026 · branch `feature/iconstyle` · generato a partire dal catalogo reale dei nodi (`NODE_REGISTRY` + azioni di piattaforma), quindi porte, tipi, parametri e default delle tabelle sono quelli del codice, non una descrizione a memoria.

**Cosa è questo documento.** Il riferimento di ciò che il Dataflow Studio (la sezione «Agentic Beta», `/teacher/agentic`, riservata agli amministratori) *fa oggi*: modello dati, regole di validazione, i tre modi di esecuzione, la scheda tecnica di tutti i 56 nodi e una proposta di progetto per l'assistente agentico che costruisce i workflow (§8).

**Rapporto con `GOLIAI_Agentic_Workflow_Studio_Analisi_Tecnica.md`.** Quello è un documento di *visione e prodotto* (Agent Node, MCP, checkpoint/fork, trigger, ecc.) e in gran parte descrive funzionalità **non implementate**. Questo documento descrive solo ciò che esiste nel codice, più il progetto dell'assistente. Dove i due divergono, vale questo.

**File di riferimento**

| Area | File |
|---|---|
| Catalogo nodi, esecutori dei nodi dati/ML/chat | `backend/app/services/dataflow_nodes.py` |
| Validazione, esecuzione batch, cicli, conversazione | `backend/app/services/agentic_runtime.py` |
| Nodi «Piattaforma» (drive, documenti, immagini, 3D, live) | `backend/app/services/platform_actions.py` |
| API REST | `backend/app/api/v1/endpoints/agentic.py` |
| Modelli DB | `backend/app/models/agentic.py` (migrazioni 074, 075, 082) |
| Editor (Canvas, inspector, run, chat) | `frontend/src/pages/teacher/AgenticWorkflowStudioPage.tsx` |
| Anteprime di immagini/file nel Canvas, explorer | `frontend/src/components/agentic/{NodeArtifacts,OutputExplorer}.tsx` |

---

## 1. Panoramica e vocabolario

Lo Studio è un editor a grafo in cui ogni **nodo** è una funzione tipizzata e ogni **arco** collega una porta di uscita a una porta di ingresso. Un workflow è salvato come JSON nella tabella `agentic_workflows` e può essere eseguito in tre modi (§4).

| Termine | Significato |
|---|---|
| **Nodo** (`node`) | Istanza di un tipo del catalogo (`id`, es. `data.filter`) con un `instanceId` univoco nel grafo e una `config`. |
| **Porta** (`port`) | Punto di ingresso/uscita di un nodo, con `name`, `type`, `label`, `required`. |
| **Arco** (`edge`) | `{id, from, sourcePort, to, targetPort}`. |
| **Nodo dati** | Qualunque nodo che non sia di flusso: sorgenti, trasformazioni, testo, matematica, ML, grafici, `ai.*`, `loop.*`, `platform.*`. |
| **Nodo di flusso** | `chatbot.*`, `control.*` e `llm_chatbot`: formano il *dialogo* e hanno regole più rigide (§3). `loop.*` **non** è di flusso. |
| **Ramo attivo** | Un valore diverso da `null` e da `false` su una porta di uscita. I rami con valore `null` non vengono eseguiti. |
| **Run** | Una esecuzione (`agentic_workflow_runs`); ogni esecuzione di un nodo è una riga di `agentic_node_runs`. |
| **Visita** (`visit`) | Indice della ripetizione di un nodo nello stesso run (cicli e «Ripeti finché»). Il primo passaggio è 0. |

---

## 2. Modello dati

### 2.1 Grafo

```json
{
  "nodes": [
    { "id": "ai.transform", "instanceId": "ai.transform-1760000000000",
      "x": 420, "y": 180, "status": "idle",
      "label": "Prompt immagini",                 // opzionale: sovrascrive l'etichetta
      "config": { "task": "prompt_table", "instruction": "20 prompt su ..." } }
  ],
  "edges": [
    { "id": "edge-1760000000001",
      "from": "csv.synthetic-1", "sourcePort": "table",
      "to": "ai.transform-1760000000000", "targetPort": "input" }
  ]
}
```

* `id` deve esistere in `NODE_REGISTRY`; `instanceId` è non vuoto e univoco. `x`, `y`, `status` sono dati di presentazione e non influenzano l'esecuzione.
* `config` è un dizionario libero: i nomi dei parametri sono quelli del catalogo; il backend non rifiuta chiavi sconosciute (le ignora) e usa i default nel codice quando una chiave manca. Chiavi riservate: `_tableEditor` (stato dell'editor tabella).
* Il salvataggio (`POST/PUT /agentic/workflows`) esegue `validate_graph`; un grafo non valido viene rifiutato con `422` e un messaggio in italiano.
* Il front-end considera come *arco di ritorno* solo quello che parte dalla porta `repeat` di `control.repeat_until` (`isLoopEdge`).

### 2.2 Tipi di porta e compatibilità

| Tipo | Contenuto | Esempi di nodi che lo producono |
|---|---|---|
| `TABLE` | tabella (§2.4) | sorgenti, trasformazioni, `ml.*` (predizioni), `loop.collect.table` |
| `MODEL` | descrittore di modello addestrato | `ml.regression`, `ml.classification` |
| `METRICS` | dizionario di numeri/testi | `ml.*`, `nlp.sentiment`, `math.result`, `math.function_analysis` |
| `PARAMS` | dizionario di parametri | `chatbot.show_variables` |
| `ANY` | qualsiasi valore | testo, numeri, risposte LLM, immagini, liste |
| `SERIES`, `ARRAY_3D` | previsti dal registro, **non usati da nessun nodo** | — |

Regola di connessione (identica in `validate_graph` e nel Canvas): `tipo_uscita == tipo_ingresso` oppure uno dei due è `ANY`. I colori delle porte nel Canvas dipendono dal tipo (`TYPE_COLOR`).

### 2.3 Tipi di parametro

`STRING`, `NUMBER`, `INTEGER` (con `min`/`max`), `BOOLEAN`, `SELECT` (con `options`; alcune hanno `optionLabels`), `MULTI_SELECT`, `SLIDER` (`min/max/step`), `COLOR`, `FILE`, `CODE` (testo multiriga), `COLUMN` / `COLUMNS` (menu delle colonne dedotte dalla tabella a monte), `DATASET` (selettore sulla libreria dataset). I parametri con `required: false` possono restare vuoti. I vincoli `min/max` sono vincoli dell'interfaccia: il backend ne applica solo alcuni (es. `rows`, `max_tokens`, `limit`).

### 2.4 Formati dei valori

* **Tabella** — `{"columns": ["a","b"], "rows": [{"a":1,"b":2}], "rowCount": 1}`. `NaN`/`±inf` diventano `null` (`json_value`). Anche una semplice lista di oggetti è accettata in ingresso (`table_frame`). La tabella è sempre serializzabile: i modelli ML sono l'unica eccezione per cui si passa un riferimento.
* **Modello ML** — `{"handle": "model:<uuid>", "algorithm": "...", "features": [...], "target": "..."}`. L'oggetto scikit-learn è in `MODEL_STORE`, un dizionario in memoria del processo API (§9).
* **Grafico** — `{"kind": "scatter"|"scatter3d"|"histogram", "x": [...], "y": [...], "z"?: [...], "color"?: [...], "labels": {...}, "title": "..."}`.
* **Risposta LLM** (`llm_chatbot.response`) — `{"message", "provider", "model", "tokens_used"}`. `llm_chatbot.next` è il solo testo.
* **Immagine** (`platform.images`, funzione `generate`) — `image_data` (base64), `image_mime`, `data_uri` (`data:image/png;base64,…`), `revised_prompt`, `item_id` (se salvata nel drive). Il Canvas mostra come miniatura ogni stringa `data:image/…` e, per gli array, fino a 40 immagini.
* **Equazione** — `{"expression": "x**2+1"}`; **analisi** — dizionario di stringhe.

### 2.5 Conversioni automatiche verso il testo

Non serve un nodo di conversione per usare qualunque output come testo:

| Dove | Regola |
|---|---|
| `value_to_text` (usata da `ai.transform`, `text.template`, `llm_chatbot`) | stringa → invariata; tabella → Markdown (max 50 righe); risposta LLM → il `message`; dizionari con `text`/`message`/`content`/`result` → quel campo; numeri interi float → `"3"`; altro → JSON indentato (≤ 20 000 caratteri). |
| Porte `STRING`/`CODE` dei nodi `platform.*` (`_coerce_input`) | qualunque valore non stringa è convertito con `value_to_text`; fanno eccezione `slides` e `rows`, che accettano liste/dizionari. Una busta `{message, provider}` è sempre ridotta al testo (`_plain_value`). |
| `llm_chatbot.context_1..3` (`_format_context`) | tabella → Markdown (15 righe), grafico → riassunto testuale, dizionario → coppie chiave: valore, lista → JSON (≤ 2000 caratteri). |

### 2.6 Variabili di conversazione

`chatbot.save_variable` scrive in `variables`; `$nome` viene sostituito (regex `\$([A-Za-z_]\w*)`) in `chatbot.start`, `chatbot.say`, `chatbot.ask` (solo nel valore restituito dall'esecutore, non nella domanda in attesa), `chatbot.end` e nel `system_prompt` di `llm_chatbot`. Una variabile inesistente lascia il testo `$nome` invariato.

---

## 3. Validazione (`validate_graph`)

Eseguita al salvataggio (`POST/PUT /agentic/workflows`) e da `POST /agentic/validate`; un run usa il grafo già salvato (e quindi già validato), ma `execute_run` ricalcola comunque i gruppi di ciclo. In ordine:

1. `nodes` ed `edges` devono essere liste; ogni nodo ha un `instanceId` non vuoto e univoco.
2. Ogni `id` nodo deve esistere nel catalogo («Tipi di nodo non supportati: …»).
3. Per ogni arco: i nodi esistono, la porta di uscita esiste nel nodo sorgente, la porta di ingresso nel nodo destinazione.
4. **Una sola connessione per porta di ingresso**, tranne sui nodi di flusso (che possono essere raggiunti da più punti, es. primo passaggio + «Ripeti»).
5. L'arco `repeat` di `control.repeat_until` può puntare solo a un nodo di flusso.
6. Compatibilità di tipo (§2.2).
7. **Ingressi obbligatori dei soli nodi di flusso**: ogni porta con `required: true` deve avere un arco («Il nodo '…' richiede un collegamento per: …»). I nodi dati possono restare scollegati mentre si disegna; se vengono eseguiti senza un ingresso obbligatorio falliscono in esecuzione.
8. **Fan-out del dialogo**: una porta di uscita di un nodo di flusso può proseguire verso **un solo** nodo di flusso (i consumatori di dati — immagini, documenti, tabelle — possono invece leggere tutti la stessa uscita).
9. Se esistono nodi `chatbot.*`/`llm_chatbot` serve un **nodo iniziale univoco**: l'eventuale `chatbot.start` legacy (uno solo) oppure l'unico nodo di chat senza predecessori di flusso (`_entry_node`).
10. **Cicli «Per ogni riga»** (`_loop_groups`): ogni `loop.for_each` deve avere esattamente un `loop.collect` a valle; un `loop.collect` chiude un solo `loop.for_each`; nessun `loop.collect` orfano; niente cicli annidati.
11. Il grafo *senza* gli archi `repeat` deve essere aciclico («Il workflow contiene un ciclo: per tornare indietro usa l'uscita «Ripeti»…»).

Il Canvas applica già in fase di trascinamento le regole 3, 6 e il divieto di creare cicli (`connectTo`).

---

## 4. Esecuzione

### 4.1 Quale modalità

| Modalità | Quando | Entry point |
|---|---|---|
| **Run batch** | il workflow **non** contiene nodi `chatbot.*` né `llm_chatbot` | `POST /agentic/workflows/{id}/runs` → `execute_run` |
| **Run conversazionale** | contiene almeno un nodo `chatbot.*` o `llm_chatbot` | stessa API → `advance_conversation`; poi `POST /agentic/runs/{id}/input` |
| **Singolo nodo** | pulsante «Esegui questo nodo» | `POST /agentic/execute-node` → `execute_node_isolated` |

La scelta si basa solo sulla presenza dei nodi chat (`_has_chatbot_nodes`). Tutti gli endpoint dello Studio richiedono un utente **ADMIN** (`get_current_admin`); gli unici accessibili anche a studenti e docenti sono i due endpoint della chat pubblicata in una sessione di classe (§4.7).

### 4.2 Run batch (`execute_run`)

1. Toglie gli archi `repeat` (`_forward_graph`) e calcola i **gruppi di ciclo** (§4.3).
2. Ordine di esecuzione: ordinamento topologico (Kahn) in cui ogni ciclo — nodo «Per ogni riga», corpo e «Fine ciclo» — è **compresso in un'unica unità** (`_plan_order`).
3. Per ogni nodo: controlla se il run è stato annullato (`cancelled`); risolve gli ingressi dagli output già calcolati (`_node_inputs`); **se nessun ingresso è attivo** il nodo è `skipped` con `output = {}`; altrimenti lo esegue.
4. Un nodo senza archi in ingresso riceve `run.input_json` come ingresso (e risulta attivo).
5. Ogni nodo scrive una riga `agentic_node_runs` con `status` (`running → completed|failed|skipped`), `input`, `output`, `provider`, `model`, `prompt_tokens`, `completion_tokens`, `duration_ms`, `sequence`, `visit`.
6. **Il primo errore interrompe il run**: `run.status = failed`, `error_message`, il nodo corrente `failed`. Non c'è retry.
7. Al termine `run.output_json` è l'output dell'ultimo nodo eseguito (con la chiave `variables`).

Ingressi con più archi sullo stesso nodo dati non sono permessi (regola 4), quindi `_node_inputs` ha un solo valore per porta; per i nodi di flusso con più archi vince l'ultimo valore non `null`.

Esecuzione: per default **sincrona dentro la richiesta HTTP** (la risposta arriva a run finito). Lo Studio usa invece `background: true` su `POST …/runs` e `POST …/input`: il server risponde subito con `status = running`, il run prosegue in un task con una propria sessione DB (`_run_in_background`) e il client interroga `GET /agentic/runs/{id}` ogni 600 ms. Lo stato dei nodi è committato un nodo alla volta (`running → completed|waiting|failed`), quindi il Canvas mostra il nodo che sta davvero lavorando, anche durante una risposta LLM lenta. Un nodo `llm_chatbot` in iterazione continua è `running` mentre il modello risponde e il messaggio dell'utente è già nella cronologia (`output.pending = true` fino a fine turno). Gli endpoint per studenti e docenti (`/sessions/{sid}/chatbot/…`) restano sincroni.

### 4.3 Cicli «Per ogni riga» / «Fine ciclo»

* **Gruppo** = `{origine: loop.for_each, collect: loop.collect, body: nodi raggiungibili dall'origine e da cui si raggiunge il collect}`.
* `_run_loop` legge la tabella in ingresso, ne ricava le righe (ordine `sequenziale|casuale`, `limit`, tetto `MAX_LOOP_ITERATIONS = 200`) e, **per ogni riga**, esegue i nodi del corpo in ordine topologico. Gli output del passaggio corrente sono tenuti in memoria (`local`) e hanno priorità su quelli salvati; gli ingressi dall'esterno del ciclo sono letti dall'ultimo `visit` salvato.
* Ogni nodo del corpo scrive una riga con `visit = ciclo − 1`; un `commit` per nodo, quindi un errore lascia nel DB tutto ciò che è già stato prodotto (utile con le immagini: i crediti sono già stati spesi).
* Il valore che arriva sulla porta `value` del «Fine ciclo» viene accumulato; a ciclo concluso nascono l'output del «Per ogni riga» (ultimo `value/row/index`, `cicli_eseguiti`, `cicli_totali`, `errori`) e quello del «Fine ciclo» (`results`, `table`, `count`, `errors`).
* Controllo di annullamento (`cancelled`) a ogni ciclo. `on_error = ferma` solleva «Ciclo i/N: …»; `salta` registra l'errore e continua.
* Non esiste né un «break» né una condizione di uscita: il ciclo è un *for-each* su dati finiti. Per un ciclo a condizione (tentativi fino a un esito) si usa «Ripeti finché» nel dialogo (§4.4).

### 4.4 Run conversazionale (`advance_conversation`)

Il run è una macchina a stati persistita in `run.input_json`: `current_node_id`, `variables`, `visits`, `loop_counts` (+ `_session_id` se pubblicato in una sessione).

* Ogni chiamata parte dal nodo corrente ed esegue in avanti finché non incontra un nodo che richiede una risposta reale (`chatbot.ask` senza `test_response`, `chatbot.multi_choice` senza `test_choice`, `llm_chatbot` continuo non concluso), un `chatbot.end`, un nodo senza archi attivi, o 200 passi (guardia anti-loop).
* **Dipendenze fuori dal percorso** (tabelle, grafici, qualunque nodo non di flusso collegato a un ingresso, per esempio il contesto di `llm_chatbot`) sono eseguite *a richiesta* (`_ensure_executed`), una volta per visita.
* I predecessori di flusso non ancora eseguiti **non** vengono eseguiti come dipendenze: contribuiscono con `null` (ingressi multipli = percorso alternativo, es. prima volta vs «Ripeti»).
* **Ripeti**: quando il passo seguente è un arco `repeat`, ogni nodo del corpo (`_loop_body`: dal bersaglio al nodo «Ripeti finché») riceve `visit + 1`, quindi viene rieseguito e mantiene lo storico.
* Stato del run: `running` → `waiting` (output: `{waiting_for, kind: "text"|"choice", question, options?}`) → `completed` / `failed` / `cancelled`. Una risposta quando il run non è `waiting` dà `409` con la ragione.
* Un errore qualunque porta il run a `failed` (altrimenti resterebbe `running` e rifiuterebbe i messaggi successivi).

### 4.5 Esecuzione di un singolo nodo

`execute_node_isolated(node, inputs)` esegue un solo nodo con gli ingressi risolti dal Canvas (`executeOne` risale ricorsivamente i nodi a monte non ancora calcolati, ignorando gli archi `repeat`). Verifica che gli ingressi obbligatori siano presenti («Input mancanti: …»). **Non salva un run**: serve a esplorare. Nodi con effetti (`ai.generate_dataset`, `platform.*`, `data.new_table` con salvataggio) eseguono davvero gli effetti. `loop.for_each` mostra la prima riga; `loop.collect` impacchetta il singolo valore.

### 4.6 Persistenza

| Tabella | Campi principali |
|---|---|
| `agentic_workflows` | `title`, `status`, `version` (incrementata a ogni PUT), `graph_json`, tenant, autore |
| `agentic_workflow_runs` | `status` (`queued/running/waiting/completed/failed/cancelled`), `input_json`, `output_json`, `artifacts_json`, `error_message`, tempi |
| `agentic_node_runs` | vincolo univoco `(run_id, node_instance_id, visit)` (migrazione 082), `sequence`, `status`, `input_json`, `output_json`, token, `duration_ms`, `error_message` |
| `agentic_datasets` | libreria di tabelle: `title`, `source` (`ai/upload/workflow`), `row_count`, `table_json` |

Gli `output_json` contengono i valori completi (anche le immagini base64): un ciclo da N immagini genera N righe di qualche MB.

### 4.7 API

| Metodo e percorso | Scopo |
|---|---|
| `GET /agentic/registry` | modelli configurati, tipi di porta/parametro, **tutti i nodi** con porte e parametri |
| `GET/POST /agentic/datasets`, `DELETE …/{id}` | libreria dataset (ultimi 100 del tenant) |
| `POST /agentic/validate` | valida un grafo senza salvarlo |
| `POST /agentic/execute-node` | esegue un nodo isolato `{node, inputs}` |
| `GET/POST /agentic/workflows`, `GET/PUT/DELETE …/{id}` | CRUD workflow (solo quelli dell'autore) |
| `POST /agentic/workflows/{id}/runs` | avvia un run `{inputs, session_id?}`; con `session_id` il workflow deve contenere nodi chat e la sessione appartenere al tenant |
| `GET …/runs`, `GET /agentic/runs/{id}` | elenco (ultimi 30) e dettaglio con le righe dei nodi |
| `POST /agentic/runs/{id}/input` | risposta dell'utente a un run `waiting` |
| `POST /agentic/runs/{id}/stop` | imposta `cancelled` (controllato tra un nodo e l'altro: non interrompe una chiamata LLM in corso) |
| `GET /agentic/sessions/{sid}/chatbot` | studente/docente: chatbot pubblicati in una sessione di classe (ultimi 20 run) |
| `POST /agentic/sessions/{sid}/chatbot/runs/{rid}/input` | studente/docente: risposta |

Il payload di un run: `{id, workflow_id, status, input, output, artifacts, error, started_at, completed_at, created_at, nodes: [{node_instance_id, node_type, label, sequence, visit, status, input, output, provider, model, prompt_tokens, completion_tokens, duration_ms, error, started_at, completed_at}]}`.

### 4.8 Modelli linguistici

`configured_models()` elenca i modelli disponibili in base alle chiavi API presenti e ai ruoli assegnati in *Admin → Modelli* (`model_roles`: `chat.default` per OpenAI, `chat.fast` per Anthropic; Gemini è fisso a `gemini-3.8-flash`). `_pick_model` sceglie:

* `ai.generate_dataset`: il primo modello configurato;
* tutti gli altri nodi LLM (`llm_chatbot`, `ai.transform`, verifica di «Ripeti finché»): priorità **anthropic → gemini → openai**;
* `provider`/`model` nella `config` hanno la precedenza, ma devono corrispondere a un modello attivo («Il modello … non è attivo in GOLIAI»).

I token sono registrati in `agentic_node_runs`. **I costi dei nodi LLM dello Studio non passano dal sistema crediti** (§9); i nodi `platform.images` e `platform.models3d` usano invece i crediti e i limiti dei rispettivi generatori.

### 4.9 Lato Canvas

* Salvataggio automatico (debounce) con stato «Salvato sul server / Modifiche non salvate».
* Auto-collegamento (doppio clic su un nodo della libreria): sceglie la coppia di porte migliore (`bestPortPair`) tra nodo selezionato e nuovo nodo.
* **Propagazione dello schema**: `inferOutputColumns` risale il grafo per dedurre le colonne disponibili a un ingresso; `recommendedConfig` compila i parametri `COLUMN/COLUMNS` mancanti; l'inspector mostra «Schema input rilevato» con «Auto-configura».
* Replay del run: i nodi si accendono nell'ordine di esecuzione, la camera li segue («Segui esecuzione»), ogni `visit`/turno è un passo distinto.
* Modifiche manuali alla tabella di un nodo (editor foglio di calcolo) invalidano gli output a valle.
* Pulsante **Tutta pagina** (`fixed inset-0`), preferenza in `localStorage` (`dataflow-fullscreen`).

---

## 5. Catalogo dei nodi

Il catalogo contiene **56 nodi** (54 nella palette, 2 legacy nascosti) in 10 categorie. Indice rapido:

| Categoria | Nodi |
|---|---|
| Sorgenti (6) | `ai.generate_dataset`, `data.saved_dataset`, `data.custom_input`, `csv.synthetic`, `math.numeric_input`, `data.new_table` |
| Trasformazioni (12) | `data.select`, `data.filter`, `data.rename_columns`, `data.sort`, `data.group_by`, `data.compute_column`, `data.dropna`, `data.transform`, `data.split`, `data.slice`, `data.merge_columns`, `data.convert_to_number` |
| Testo (5) | `nlp.clean_text`, `nlp.sentiment`, `ai.transform`, `text.from_table`, `text.template` |
| Matematica (6) | `math.operation`, `math.result`, `math.aggregate`, `math.equation`, `math.evaluate`, `math.function_analysis` |
| Machine Learning (4) | `ml.regression`, `ml.classification`, `ml.predict`, `ml.kmeans_clustering` |
| Visualizzazioni (2) | `plot.2d`, `plot.histogram` |
| Chatbot (10) | `chatbot.start`, `chatbot.say`, `chatbot.ask`, `chatbot.if_contains`, `chatbot.yes_no`, `chatbot.multi_choice`, `chatbot.save_variable`, `chatbot.show_variables`, `llm_chatbot`, `chatbot.end` |
| Cicli (2) | `loop.for_each`, `loop.collect` |
| Controllo (4) | `control.if_else`, `control.repeat_until`, `control.compare_numbers`, `control.counter` |
| Piattaforma (5) | `platform.files`, `platform.documents`, `platform.images`, `platform.models3d`, `platform.live` |

Legenda: «Obbl.» = porta obbligatoria (per i nodi dati è fatta rispettare solo in esecuzione, §3.7). Il campo `cachePolicy` del catalogo è informativo (§9 #4) e non è riportato.

### 5.1 Sorgenti

Nodi senza ingressi (o che materializzano dati): producono la prima tabella o il primo valore.

#### `ai.generate_dataset` — Genera dataset con AI

Genera una tabella coerente tramite un modello LLM configurato in GOLIAI; viene salvata automaticamente nella libreria dataset.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |
| `metadata` | `METRICS` | metadata |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `prompt` | `CODE` | `Dataset realistico sui consumi energetici mensili di edif…` | — | Descrizione dataset |
| `columns` | `STRING` | `mese,studenti,kwh,costo_euro` | — | Colonne richieste |
| `rows` | `INTEGER` | `30` | min 5; max 300 | Numero righe |
| `provider` | `STRING` | — | — | Provider (opzionale) |
| `model` | `STRING` | — | — | Modello (opzionale) |

**Comportamento**

* Chiede a un LLM un array JSON di oggetti con le colonne richieste; se il JSON non si legge prova il parsing CSV (`csv.DictReader`).
* Modello: `_pick_model` — per questo nodo vale il **primo** modello configurato (non la priorità «leggero»), a meno di `provider`/`model` espliciti. `max_tokens` fisso a 4096: tabelle molto larghe o molto lunghe possono essere troncate dal modello.
* Le righe sono limitate a `rows` (5–300). `metadata` contiene `generated_by`, `requested_rows`, `actual_rows`, `columns` e, se eseguito con un account, `saved_to_library: true`.
* **Effetto collaterale**: ogni esecuzione (anche quella del solo nodo dall'inspector) salva un `AgenticDataset` (`source = "ai"`, titolo = prime 170 lettere del prompt) nella libreria del tenant.

**Errori tipici**

* «Il modello non ha restituito un dataset tabellare valido» (risposta non JSON/CSV o lista vuota).

#### `data.saved_dataset` — Dataset salvato

Riusa un dataset già generato o caricato in precedenza, senza rigenerarlo.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `dataset_id` | `DATASET` | — | — | Dataset |

**Comportamento**

* Legge una riga di `agentic_datasets` per id e ne restituisce `table_json` senza rielaborarlo. Funziona solo eseguendo il workflow (serve la sessione DB).
* Il parametro `DATASET` è un selettore sulla libreria (`GET /agentic/datasets`, ultimi 100 del tenant).

**Errori tipici**

* «Seleziona un dataset dalla libreria»; «Il dataset selezionato non è più disponibile».
* Nota di sicurezza: la query filtra per `id` ma **non per tenant** (vedi §9).

#### `data.custom_input` — Tabella manuale

Crea una tabella da dati inseriti manualmente o da un file CSV/JSON caricato.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `data` | `CODE` | `[{"x": 1, "y": 2}]` | — | Dati JSON/CSV (o carica un file) |

**Comportamento**

* `data` è testo JSON (array di oggetti) **oppure** CSV; se `json.loads` fallisce viene riletto con `pandas.read_csv`. Se `config.data` è già una lista (editor tabella) viene usata direttamente.
* L'editor tabella del Canvas riscrive `data` (JSON) e salva lo stato dell'editor in `config._tableEditor` (grafico, stili, dimensioni): chiave riservata, non è un parametro del catalogo.
* `NaN`/`±inf` diventano `null`.

**Errori tipici**

* Errori pandas se CSV/JSON malformato.

#### `csv.synthetic` — Dataset sintetico

Genera dati riproducibili per esperimenti ML.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `kind` | `SELECT` | `regression` | opzioni: `regression`, `classification`, `blobs`, `moons`, `circles` | Tipo |
| `samples` | `INTEGER` | `100` | min 10; max 5000 | Righe |
| `features` | `INTEGER` | `3` | min 2; max 20 | Feature |
| `seed` | `INTEGER` | `42` | — | Seed |

**Comportamento**

* Usa i generatori scikit-learn: `regression` (rumore 8), `classification` (`n_informative = max(2, features-1)`, nessuna feature ridondante), `blobs`, `moons` (rumore 0,12) e `circles` (rumore 0,08, factor 0,5).
* Colonne: `feature_1…feature_n` + `target`. Per `moons` e `circles` `features` è ignorato (sempre 2 feature). Riproducibile con `seed`.

#### `math.numeric_input` — Valore numerico

Immette un numero nel flusso.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `value` | `ANY` | value |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `value` | `NUMBER` | `0` | — | Valore |

**Comportamento**

* Emette `{value: float}`. Utile come costante per `math.operation` / `control.compare_numbers`.

#### `data.new_table` — Nuova tabella da input

Materializza in una nuova tabella i dati arrivati da un altro nodo (es. dopo Seleziona colonne); può riordinare, rinominare e salvare in libreria.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | Dati in ingresso |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `columns` | `COLUMNS` | — | — | Colonne da copiare (vuoto = tutte, nell'ordine scelto) |
| `rename` | `STRING` | — | facoltativo | Rinomina (vecchio:nuovo, separati da virgola) |
| `title` | `STRING` | `Nuova tabella` | — | Nome della nuova tabella |
| `save_to_library` | `BOOLEAN` | no | — | Salva nella libreria dataset |

**Comportamento**

* Copia le colonne indicate (vuoto = tutte) **nell'ordine scelto**, applica l'eventuale rinomina `vecchio:nuovo` e azzera l'indice.
* Con `save_to_library` e un account, salva la tabella come `AgenticDataset` (`source = "workflow"`, titolo ≤180 caratteri).

**Errori tipici**

* «Colonne da copiare non presenti: …. Disponibili: …»; «La nuova tabella è vuota: niente da salvare in libreria».

---

### 5.2 Trasformazioni

Operano su tabelle `TABLE → TABLE`. Tutti accettano tabelle con righe `null`; gli errori citano sempre le colonne disponibili.

#### `data.select` — Seleziona colonne

Include o esclude colonne.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `mode` | `SELECT` | `include` | opzioni: `include`, `exclude` | Modalità |
| `columns` | `COLUMNS` | — | — | Colonne |

**Comportamento**

* `include`: tiene solo le colonne elencate (vuoto = tutte). `exclude`: le rimuove (vuoto = nessuna).

**Errori tipici**

* «Colonne selezionate non presenti: …».

#### `data.filter` — Filtra righe

Filtra una tabella con una query, es. eta > 18 and citta == 'Bologna'.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `expression` | `CODE` | — | — | Espressione pandas (vuota = nessun filtro) |

**Comportamento**

* `expression` è passata a `DataFrame.query` (sintassi pandas, es. `eta > 18 and citta == 'Bologna'`). Vuota = nessun filtro. Può restituire zero righe senza errore.

**Errori tipici**

* «Espressione di filtro non valida (…). Colonne disponibili: …».

#### `data.rename_columns` — Rinomina colonne

Cambia il nome di una o più colonne.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `rename` | `STRING` | — | — | Rinomina (vecchio:nuovo, separati da virgola) |

**Comportamento**

* Formato `vecchio:nuovo, altro:nome`. Le colonne sorgente devono esistere.

**Errori tipici**

* «Rinomina non valida: 'x'. Usa il formato vecchio:nuovo».

#### `data.sort` — Ordina righe

Ordina la tabella per una colonna, opzionalmente tenendo le prime N righe.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `column` | `COLUMN` | — | — | Colonna |
| `order` | `SELECT` | `ascending` | opzioni: `ascending`, `descending` | Ordine |
| `limit` | `INTEGER` | `0` | min 0 | Tieni prime N righe (0 = tutte) |

**Comportamento**

* Ordinamento stabile. Se `column` è vuota o inesistente usa la **prima colonna**. `limit > 0` tiene le prime N righe dopo l'ordinamento (utile per «top N»).

#### `data.group_by` — Raggruppa e aggrega

Crea una tabella riassuntiva per gruppo (media, somma, conteggio…).

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `group_column` | `COLUMN` | — | — | Raggruppa per |
| `value_columns` | `COLUMNS` | — | — | Colonne da aggregare (vuoto = numeriche) |
| `aggregation` | `SELECT` | `mean` | opzioni: `mean`, `sum`, `count`, `min`, `max`, `median` | Aggregazione |

**Comportamento**

* Raggruppa per `group_column` (fallback: prima colonna). Senza `value_columns` aggrega tutte le numeriche (esclusa la colonna di gruppo).
* Con `aggregation = count` (o se non ci sono colonne da aggregare) restituisce `[gruppo, conteggio]`.

**Errori tipici**

* «Aggregazione 'x' richiede colonne numeriche: …».

#### `data.compute_column` — Colonna calcolata

Aggiunge una colonna calcolata a partire dalle altre.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `name` | `STRING` | `nuova_colonna` | — | Nome nuova colonna |
| `expression` | `CODE` | — | — | Formula (es. costo_euro / kwh) |

**Comportamento**

* `DataFrame.eval(expression)` → nuova colonna `name` (sovrascrive se esiste). Es. `costo_euro / kwh`.

**Errori tipici**

* «Scrivi una formula…»; «Formula non valida (…). Colonne disponibili: …».

#### `data.dropna` — Rimuovi mancanti

Rimuove righe con valori mancanti.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `how` | `SELECT` | `any` | opzioni: `any`, `all` | Regola |

**Comportamento**

* `any`: scarta le righe con almeno un mancante; `all`: solo quelle tutte vuote.

#### `data.transform` — Trasforma dati

Scala, trasforma o completa colonne.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `operation` | `SELECT` | `standardize` | opzioni: `standardize`, `minmax`, `robust`, `log`, `sqrt`, `fillna` | Operazione |
| `columns` | `COLUMNS` | — | — | Colonne |
| `fill_value` | `NUMBER` | `0` | — | Valore sostitutivo |

**Comportamento**

* `standardize` (z-score), `minmax`, `robust`: scikit-learn `fit_transform` sulle colonne scelte (vuoto = tutte le numeriche).
* `log` = `log1p(clip(≥0))`; `sqrt` = `sqrt(clip(≥0))`; `fillna` riempie i mancanti con `fill_value` (colonne: tutte se vuoto).

**Errori tipici**

* «Standardizzazione, normalizzazione, log e radice richiedono colonne numeriche».

#### `data.split` — Train / test split

Divide il dataset in modo riproducibile.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `train` | `TABLE` | train |
| `test` | `TABLE` | test |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `test_size` | `SLIDER` | `0.2` | min 0.05; max 0.5; passo 0.05 | Quota test |
| `stratify_column` | `COLUMN` | — | facoltativo | Stratifica |
| `seed` | `INTEGER` | `42` | — | Seed |

**Comportamento**

* `train_test_split` con `test_size` (0,05–0,5) e `seed`. `stratify_column` è usata solo se esiste nella tabella. Due uscite: `train`, `test`.

**Errori tipici**

* Errori scikit-learn se la stratificazione è impossibile (classi con una sola riga).

#### `data.slice` — Affetta righe

Seleziona un intervallo di righe.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `start` | `INTEGER` | `0` | — | Inizio |
| `end` | `INTEGER` | `100` | — | Fine |
| `step` | `INTEGER` | `1` | — | Passo |

**Comportamento**

* `iloc[start:end:step]`; `step` minimo 1. Non modifica le colonne.

#### `data.merge_columns` — Combina tabelle

Unisce tabelle per righe o colonne.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table_1` | `TABLE` | sì | table_1 |
| `table_2` | `TABLE` | no | table_2 |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `merge_mode` | `SELECT` | `horizontal` | opzioni: `horizontal`, `vertical` | Modalità |

**Comportamento**

* `horizontal`: affianca per **posizione** (concat asse 1); le colonne con lo stesso nome nella seconda tabella diventano `nome_2`. Tabelle di lunghezza diversa producono `null`.
* `vertical`: accoda le righe (indice azzerato). Senza `table_2` la prima tabella passa invariata.

#### `data.convert_to_number` — Converti in numero

Converte stringhe numeriche europee o internazionali.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `columns` | `COLUMNS` | — | — | Colonne |
| `decimal_separator` | `SELECT` | `auto` | opzioni: `auto`, `,`, `.` | Decimali |

**Comportamento**

* Per ogni colonna toglie ogni carattere diverso da cifre `, . -`, gestisce il separatore decimale (`auto` = virgola se presente: i punti sono migliaia) e converte con `to_numeric(errors="coerce")` → valori non numerici diventano `null`.

---

### 5.3 Testo

Conversioni tra tabelle, testo e LLM «one-shot».

#### `nlp.clean_text` — Pulisci testo

Normalizza una colonna testuale.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `column` | `COLUMN` | `text` | — | Colonna |
| `lowercase` | `BOOLEAN` | sì | — | Minuscolo |
| `remove_numbers` | `BOOLEAN` | no | — | Rimuovi numeri |

**Comportamento**

* Modifica la colonna **in place**: minuscolo (opzionale), punteggiatura → spazio (`[^\w\s]`), cifre rimosse (opzionale), spazi collassati.

#### `nlp.sentiment` — Analisi del sentiment

Calcola polarità e classe positive/negative/neutral.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |
| `metrics` | `METRICS` | metrics |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `column` | `COLUMN` | `text` | — | Colonna |
| `neutral_threshold` | `SLIDER` | `0.1` | min 0; max 0.5; passo 0.05 | Soglia neutra |

**Comportamento**

* Usa **TextBlob** (`polarity` ∈ [-1, 1]); aggiunge le colonne `polarity` e `sentiment` (`positive` se > soglia, `negative` se < −soglia, altrimenti `neutral`).
* `metrics = {distribution: {classe: n}, mean_polarity}`.
* Limite: il lessico predefinito di TextBlob è **inglese**; su testo italiano la polarità tende a 0 (quasi tutto `neutral`). Per l'italiano usare `ai.transform` con un compito personalizzato.

#### `ai.transform` — Elabora con AI

Elaborazione AI one-shot: ottimizza un prompt per immagini, riassumi, traduci, estrai una tabella da un testo, crea slide o un quiz live. Collega l'uscita giusta (testo, tabella, slide) al nodo successivo.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `input` | `ANY` | no | Input (testo, tabella, risposta…) |
| `extra` | `ANY` | no | Contesto aggiuntivo |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `text` | `ANY` | Testo |
| `table` | `TABLE` | Tabella |
| `slides` | `ANY` | Slide / quiz (JSON) |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `task` | `SELECT` | `custom` | opzioni: `custom`, `image_prompt`, `summarize`, `translate`, `extract_table`, `prompt_table`, `make_slides`, `make_quiz` | Compito |
| `instruction` | `CODE` | — | — | Istruzioni (obbligatorie per «custom», opzionali per gli altri) |
| `language` | `STRING` | `italiano` | — | Lingua di output |
| `provider` | `STRING` | — | — | Provider (opzionale) |
| `model` | `STRING` | — | — | Modello (opzionale) |
| `max_tokens` | `INTEGER` | `2048` | — | Token massimi |

**Comportamento**

* Elaborazione LLM one-shot. Il prompt di sistema è `AI_TRANSFORM_TASKS[task] + «Rispondi in <lingua>.»` (+ «Indicazioni aggiuntive» se `task ≠ custom`); il messaggio utente è `instruction` (solo `custom`) + `INPUT:` (porta `input`) + `CONTESTO AGGIUNTIVO:` (porta `extra`). Gli ingressi sono convertiti in testo con `value_to_text` (tabelle → Markdown, max 50 righe).
* Compiti: `custom`, `image_prompt` (un solo prompt ottimizzato), `summarize`, `translate`, `extract_table`, `prompt_table` (tabella con colonna `prompt`, uno per riga; 5 di default), `make_slides` (`[{title, bullets[]}]`), `make_quiz` (`[{type:"mcq", question, options[4], correct_option}]`).
* Uscite: `text` sempre; `table` per `extract_table`/`prompt_table`; `slides` per `make_slides`/`make_quiz`. Per i compiti JSON la risposta viene ripulita dai fence ``` e interpretata; deve essere una lista non vuota di oggetti.
* Modello: priorità «leggero» (anthropic → gemini → openai) se non specificato. `max_tokens` limitato a 256–8192.

**Errori tipici**

* «Con il compito «custom» scrivi le istruzioni per l'AI»; «Collega un input o scrivi delle istruzioni»; «Il modello non ha restituito un JSON valido: riprova o semplifica l'input»; «Il modello non ha restituito una lista di oggetti».

**Esempio.** `ai.transform(task=prompt_table, instruction="20 prompt su paesaggi fantasy")` → `table` con colonna `prompt` → `loop.for_each(column=prompt)`.

#### `text.from_table` — Tabella → testo

Converte una tabella in testo (Markdown, CSV o JSON) per darla a un chatbot, a un prompt o a un documento.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `text` | `ANY` | text |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `format` | `SELECT` | `markdown` | opzioni: `markdown`, `csv`, `json` | Formato |
| `max_rows` | `INTEGER` | `50` | min 1; max 1000 | Righe massime |

**Comportamento**

* `markdown` (tabella con intestazione, righe oltre il massimo sostituite da «… e altre N righe»), `csv` o `json` (array di oggetti). `max_rows` 1–1000.

#### `text.template` — Componi testo

Costruisce un testo unendo più valori collegati (anche tabelle o risposte AI) in un modello, ad esempio per comporre un prompt.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `a` | `ANY` | no | a |
| `b` | `ANY` | no | b |
| `c` | `ANY` | no | c |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `text` | `ANY` | text |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `template` | `CODE` | `Disegna in modo dettagliato: {a}` | — | Modello ({a}, {b}, {c}) |

**Comportamento**

* Sostituisce **solo** `{a}`, `{b}`, `{c}` (regex `\{([abc])\}`); altri testi tra graffe restano letterali. Gli ingressi passano da `value_to_text` (porta non collegata = stringa vuota).

---

### 5.4 Matematica

Calcolo scalare/vettoriale e analisi simbolica (sympy).

#### `math.operation` — Operazione

Calcolo scalare o vettoriale.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `a` | `ANY` | sì | a |
| `b` | `ANY` | no | b |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | result |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `operation` | `SELECT` | `add` | opzioni: `add`, `subtract`, `multiply`, `divide`, `power`, `modulo`, `sqrt`, `log`, `sin`, `cos`, `round` | Operazione |

**Comportamento**

* Scalari o vettori: liste/tabelle diventano array numpy (prima colonna numerica) e l'operazione è **elemento per elemento**.
* `sqrt`, `log`, `sin`, `cos`, `round` sono unarie (ignorano `b`). Se `b` manca: 0 per add/subtract, 1 per multiply/divide/power/modulo.

**Errori tipici**

* Errori Python (`ZeroDivisionError`, dominio di `log`/`sqrt` su scalari).

#### `math.result` — Risultato numerico

Riduce o riassume un risultato.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `value` | `ANY` | sì | value |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | result |
| `metrics` | `METRICS` | metrics |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `aggregation` | `SELECT` | `mean` | opzioni: `first`, `last`, `mean`, `sum`, `min`, `max`, `median`, `std`, `all` | Aggregazione |

**Comportamento**

* Riduce un valore/lista/tabella (prima colonna numerica) con `first/last/mean/sum/min/max/median/std/all`. `metrics = {count, mean, std}`.

**Errori tipici**

* «Nessun valore numerico da riassumere».

#### `math.aggregate` — Aggrega valori

Combina fino a tre input numerici.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `a` | `ANY` | sì | a |
| `b` | `ANY` | no | b |
| `c` | `ANY` | no | c |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | result |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `aggregation` | `SELECT` | `mean` | opzioni: `mean`, `sum`, `min`, `max`, `std` | Aggregazione |

**Comportamento**

* Concatena i valori numerici di `a`, `b`, `c` (quelli collegati) in un unico array e applica `mean/sum/min/max/std`.

**Errori tipici**

* «Collega almeno un valore numerico».

#### `math.equation` — Equazione

Interpreta una formula simbolica e produce LaTeX.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `equation` | `ANY` | equation |
| `latex` | `ANY` | latex |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `expression` | `CODE` | `x**2 + 2*x + 1` | — | Espressione |

**Comportamento**

* `sympy.sympify(expression)` con simbolo `x`. Uscite: `equation = {expression}` (da collegare a `math.evaluate` / `math.function_analysis`) e `latex`.

**Errori tipici**

* Errori di parsing sympy.

#### `math.evaluate` — Valuta equazione

Valuta f(x) su una lista di punti.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `equation` | `ANY` | sì | equation |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `x_values` | `STRING` | `-2,-1,0,1,2` | — | Valori X |

**Comportamento**

* `lambdify` su numpy; calcola f(x) per i valori `x_values` (CSV) → tabella `[x, y]`.

#### `math.function_analysis` — Analizza funzione

Calcola derivata, integrale, zeri e punti critici.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `equation` | `ANY` | sì | equation |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `analysis` | `METRICS` | analysis |

_Parametri: nessuno._

**Comportamento**

* Restituisce `analysis = {expression, derivative, integral, zeros[], critical_points[], latex}` come **stringhe** (le soluzioni sympy non sono numeri).

---

### 5.5 Machine Learning

Modelli scikit-learn eseguiti nel processo API (vedi limite #2 e #3 in §9).

#### `ml.regression` — Regressione

Addestra un regressore e calcola MAE, RMSE e R².

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `train` | `TABLE` | sì | train |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `model` | `MODEL` | model |
| `metrics` | `METRICS` | metrics |
| `predictions` | `TABLE` | predictions |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `target_column` | `COLUMN` | `target` | — | Target |
| `feature_columns` | `COLUMNS` | — | — | Feature |
| `algorithm` | `SELECT` | `linear` | opzioni: `linear`, `ridge`, `lasso`, `random_forest`, `gradient_boosting`, `svr`, `knn` | Algoritmo |
| `cv_folds` | `INTEGER` | `5` | min 2; max 10 | Cross validation |

**Comportamento**

* Scarta le righe con mancanti (`dropna`). Target: `target_column` se esiste, altrimenti `target`, altrimenti l'**ultima colonna**. Feature: `feature_columns` o tutte le numeriche tranne il target; devono essere numeriche.
* Addestra su **tutte** le righe (nessun hold-out): `mae/rmse/r2` sono calcolati sul training set; `cv_mean` (R², `cv_folds` ≤ righe) è l'unica stima fuori campione. Per valutare onestamente collegare `data.split` e `ml.predict`.
* `model` è un descrittore `{handle, algorithm, features, target}`: l'oggetto sklearn vive in `MODEL_STORE`, **memoria del processo API** (si perde al riavvio o con più worker → `ml.predict` fallisce con «riesegui il nodo di training»).
* `predictions` = tabella di input + colonna `prediction`.

**Errori tipici**

* «Le feature devono essere numeriche: …»; «Seleziona almeno una feature numerica».

#### `ml.classification` — Classificazione

Addestra un classificatore e calcola accuracy, precision, recall e F1.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `train` | `TABLE` | sì | train |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `model` | `MODEL` | model |
| `metrics` | `METRICS` | metrics |
| `predictions` | `TABLE` | predictions |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `target_column` | `COLUMN` | `target` | — | Target |
| `feature_columns` | `COLUMNS` | — | — | Feature |
| `algorithm` | `SELECT` | `logistic` | opzioni: `logistic`, `random_forest`, `gradient_boosting`, `svc`, `knn`, `naive_bayes` | Algoritmo |
| `cv_folds` | `INTEGER` | `5` | min 2; max 10 | Cross validation |

**Comportamento**

* Come `ml.regression`, con metriche `accuracy/precision/recall/f1` (media pesata) sul training set e `cv_mean` = accuracy in cross-validation (`folds ≤ conteggio della classe più piccola`; se < 2 → `null`).
* `logistic` (max_iter 1000), `random_forest`, `gradient_boosting`, `svc` (probability), `knn`, `naive_bayes`.

**Errori tipici**

* Come `ml.regression`.

#### `ml.predict` — Applica modello

Applica un modello addestrato a nuovi dati.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `model` | `MODEL` | sì | model |
| `data` | `TABLE` | sì | data |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `predictions` | `TABLE` | predictions |

_Parametri: nessuno._

**Comportamento**

* Recupera il modello dall'handle e applica `predict` alle colonne usate in training; aggiunge `prediction`.

**Errori tipici**

* «Il modello non è più disponibile: riesegui il nodo di training»; «Feature richieste dal modello non presenti: …».

#### `ml.kmeans_clustering` — Clustering K-Means

Segmenta i dati e misura silhouette e Davies-Bouldin.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | table |
| `metrics` | `METRICS` | metrics |
| `plot` | `ANY` | plot |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `columns` | `COLUMNS` | — | — | Feature |
| `clusters` | `INTEGER` | `3` | min 2; max 12 | Cluster |
| `normalize` | `BOOLEAN` | sì | — | Normalizza |

**Comportamento**

* `KMeans(random_state=42, n_init=10)` sulle colonne scelte (default: tutte le numeriche), con standardizzazione opzionale. Richiede più righe complete che cluster.
* Aggiunge la colonna `cluster` (le righe con mancanti restano `null`). `metrics = {clusters, rows, inertia, silhouette, davies_bouldin}`. `plot` (scatter 2D sulle prime due feature, colore «Cluster n») solo se le feature sono ≥ 2.

**Errori tipici**

* «Il clustering richiede almeno una colonna numerica»; «Servono più di K righe complete per creare K cluster».

---

### 5.6 Visualizzazioni

Producono un oggetto grafico (`plot`) che il Canvas disegna con Recharts / vista 3D.

#### `plot.2d` — Grafico

Scatter 2D; imposta anche l'asse Z per una vista 3D orientabile.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `plot` | `ANY` | plot |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `x` | `COLUMN` | `x` | — | Asse X |
| `y` | `COLUMN` | `y` | — | Asse Y |
| `z` | `COLUMN` | — | facoltativo | Asse Z (opzionale, per 3D) |
| `color` | `COLUMN` | — | facoltativo | Colore |

**Comportamento**

* Con `z` numerica valida produce `{kind: "scatter3d", x, y, z, color, labels, title}`, altrimenti `{kind: "scatter", …}`. Gli assi non validi ripiegano sulla prima/seconda colonna numerica disponibile. `color` è usato solo se è una colonna esistente.
* Il titolo si legge da `config.title` (non esposto come parametro nell'inspector).

**Errori tipici**

* «Nessuna asse X numeriche disponibile…» se non ci sono colonne numeriche.

#### `plot.histogram` — Istogramma

Mostra la distribuzione di una colonna.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | table |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `plot` | `ANY` | plot |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `column` | `COLUMN` | `x` | — | Colonna |
| `bins` | `INTEGER` | `20` | — | Intervalli |

**Comportamento**

* `numpy.histogram` con `bins` intervalli → `{kind: "histogram", x (bordi sinistri), xEnd, y (conteggi), labels, title}`. Ignora i mancanti.

---

### 5.7 Chatbot

Nodi del dialogo: formano un flusso lineare (un solo arco in uscita per porta) e si eseguono in una conversazione reale (§4.4). Includono `llm_chatbot`.

#### `chatbot.start` — Inizio conversazione _(legacy, nascosto)_

Punto di ingresso del flusso: ogni chatbot deve iniziare da qui.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `next` | `ANY` | Avvio |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `welcome_message` | `STRING` | — | — | Messaggio di benvenuto (opzionale) |

**Comportamento**

* **Legacy, nascosto dalla palette.** Punto d'ingresso esplicito: emette `next = true` e `message` (benvenuto con variabili interpolate). I workflow salvati che lo contengono continuano a funzionare; senza di lui il primo nodo del dialogo è quello senza predecessori di flusso.

#### `chatbot.say` — Messaggio

Invia un messaggio; richiama una variabile salvata con $nome.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `trigger` | `ANY` | no | In |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `next` | `ANY` | Continua |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `message` | `STRING` | `Ciao!` | — | Messaggio |

**Comportamento**

* Emette `next` = `message` con `$variabili` interpolate (variabile sconosciuta: resta il testo `$nome`). Non attende input: il flusso prosegue subito.

#### `chatbot.ask` — Domanda

Pone una domanda e sospende il flusso in attesa della risposta reale. Può essere il primo nodo di un dialogo.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `trigger` | `ANY` | no | In |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `response` | `ANY` | Risposta |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `question` | `STRING` | `Come posso aiutarti?` | — | Domanda |
| `test_response` | `STRING` | — | — | Risposta test (solo anteprima) |

**Comportamento**

* Nella conversazione reale il nodo passa a `waiting`: `run.status = "waiting"`, `run.output = {waiting_for, kind: "text", question}` e la risposta dell'utente (`POST …/input`) diventa `output.response`.
* Se `test_response` è valorizzato **non attende**: usa quel testo (modalità anteprima, anche nel run batch). In pratica una risposta di test «incollata» rende il nodo non interattivo.
* La domanda mostrata in attesa è quella grezza della configurazione: le `$variabili` **non** vengono interpolate (a differenza di `chatbot.say`).

#### `chatbot.if_contains` — Contiene parole

Dirama il dialogo in base alle parole trovate.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `text` | `ANY` | sì | Testo |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `yes` | `ANY` | Sì |
| `no` | `ANY` | No |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `keywords` | `STRING` | `urgente` | — | Parole (CSV) |
| `case_sensitive` | `BOOLEAN` | no | — | Maiuscole |

**Comportamento**

* Cerca una qualsiasi delle parole CSV come **sottostringa** del testo (maiuscole opzionali). Instrada il testo originale su `yes` o `no` (l'altra uscita è `null`, cioè il ramo non attivo).

#### `chatbot.yes_no` — Sì / No

Interpreta una risposta binaria.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `text` | `ANY` | sì | Testo |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `yes` | `ANY` | Sì |
| `no` | `ANY` | No |

_Parametri: nessuno._

**Comportamento**

* `yes` se il testo (trim, minuscolo) è esattamente uno tra `sì, si, yes, y, ok, certo`; altrimenti `no`. Non riconosce frasi («sì grazie»).

#### `chatbot.multi_choice` — Scelta multipla

Sospende il flusso finché lo studente non sceglie un'opzione reale; attiva un solo ramo.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `trigger` | `ANY` | no | In |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `choice_1` | `ANY` | choice_1 |
| `choice_2` | `ANY` | choice_2 |
| `choice_3` | `ANY` | choice_3 |
| `choice_4` | `ANY` | choice_4 |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `question` | `STRING` | `Scegli` | — | Domanda |
| `option_1` | `STRING` | `Opzione 1` | — | Opzione 1 |
| `option_2` | `STRING` | `Opzione 2` | — | Opzione 2 |
| `option_3` | `STRING` | `Opzione 3` | — | Opzione 3 |
| `option_4` | `STRING` | `Opzione 4` | — | Opzione 4 |
| `test_choice` | `INTEGER` | `0` | min 0; max 4 | Scelta test (0 = nessuna, attende risposta reale) |

**Comportamento**

* Senza `test_choice` sospende il flusso mostrando `{question, options[]}` (solo opzioni non vuote). La risposta è accettata come numero 1–4 o testo identico a un'opzione (senza maiuscole); **se non corrisponde a nulla viene scelta la 1**.
* Attiva una sola uscita `choice_n` (le altre `null`).

#### `chatbot.save_variable` — Salva variabile

Memorizza un valore per la sessione.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `value` | `ANY` | sì | value |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `next` | `ANY` | next |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `variable_name` | `STRING` | `risposta` | — | Nome |

**Comportamento**

* Scrive `variables[variable_name] = value` e lo lascia passare su `next`. Le variabili sono persistite in `run.input_json.variables` e si richiamano con `$nome` in `chatbot.say` e nel `system_prompt` di `llm_chatbot` (non nella domanda di `chatbot.ask`).

#### `chatbot.show_variables` — Mostra variabili

Espone lo stato della conversazione.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `trigger` | `ANY` | no | In |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `variables` | `PARAMS` | variables |

_Parametri: nessuno._

**Comportamento**

* Espone l'intero dizionario variabili su `variables` (tipo `PARAMS`).

#### `llm_chatbot` — Chatbot LLM

Risponde con un modello cloud; può leggere fino a 3 nodi di contesto. Con l'iterazione continua dialoga a più turni finché lo studente non chiude (es. "grazie", "ok basta").

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `message` | `ANY` | no | Domanda / messaggio |
| `context_1` | `ANY` | no | Contesto 1 |
| `context_2` | `ANY` | no | Contesto 2 |
| `context_3` | `ANY` | no | Contesto 3 |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `response` | `ANY` | Risposta |
| `next` | `ANY` | Continua |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `system_prompt` | `CODE` | `Sei un assistente utile. Usa il contesto collegato (tabel…` | — | Condizionamento di sistema |
| `continuous` | `BOOLEAN` | no | — | Iterazione continua |
| `exit_phrases` | `STRING` | `grazie, ok basta, basta così, sono soddisfatto, ho capito…` | — | Frasi di chiusura (esempi per il modello) |
| `max_turns` | `INTEGER` | `20` | min 1; max 100 | Turni massimi in iterazione continua |
| `max_tokens` | `INTEGER` | `1024` | — | Token massimi |

**Comportamento**

* Risponde con il modello «leggero» configurato (override con `provider`/`model` non esposti nel catalogo ma letti dal config). Il prompt di sistema è `system_prompt` (con `$variabili`) + «Contesto fornito dai nodi collegati» costruito da `context_1..3` con `_format_context` (tabelle: prime 15 righe in Markdown; grafici: riassunto testuale; metriche/dizionari: coppie chiave: valore ≤ 2000 caratteri).
* Uscite: `response` = `{message, provider, model, tokens_used}` e `next` = testo semplice.
* **Iterazione continua** (`continuous`): il nodo resta `waiting` tra un turno e l'altro; la cronologia è in `output.history` (`seed` = messaggio iniziale). Termina quando l'LLM aggiunge il marcatore `[[FINE_CONVERSAZIONE]]` (rimosso dal testo), quando l'utente scrive esattamente una delle `exit_phrases` o a `max_turns`. Solo allora `next` prosegue il flusso.

#### `chatbot.end` — Fine conversazione _(legacy, nascosto)_

Chiude il ramo conversazionale: ogni percorso del flusso deve terminare qui.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `trigger` | `ANY` | no | In |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | Esito |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `message` | `STRING` | `Conversazione conclusa.` | — | Messaggio finale |

**Comportamento**

* **Legacy, nascosto.** Emette `result` = messaggio finale interpolato. Nella conversazione, raggiunto questo nodo il run passa a `completed`; senza di esso il run termina comunque quando il nodo corrente non ha archi in uscita attivi.

---

### 5.8 Cicli

Iterazione sui dati (batch). Vedi §4.3.

#### `loop.for_each` — Per ogni riga

Ripete i nodi collegati a valle una volta per ogni riga della tabella; il ciclo finisce quando le righe sono esaurite. Chiudilo con «Fine ciclo» per raccogliere i risultati.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | sì | Tabella |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `value` | `ANY` | Valore (colonna) |
| `row` | `ANY` | Riga intera |
| `index` | `ANY` | N° ciclo |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `column` | `COLUMN` | — | facoltativo | Colonna da leggere (vuoto = prima) |
| `order` | `SELECT` | `sequenziale` | opzioni: `sequenziale`, `casuale` | Ordine delle righe |
| `limit` | `INTEGER` | `0` | min 0; max 200 | Massimo cicli (0 = tutte le righe) |
| `on_error` | `SELECT` | `ferma` | opzioni: `ferma`, `salta` | Se un ciclo fallisce |

**Comportamento**

* Ripete **una volta per ogni riga della tabella** tutti i nodi a valle fino al «Fine ciclo» collegato. Il ciclo finisce quando le righe sono esaurite (o al massimo di `limit`, tetto assoluto 200).
* Uscite per ciclo: `value` (cella della colonna `column`, default prima colonna), `row` (oggetto con l'intera riga), `index` (n° del ciclo, da 1).
* `order = casuale` mescola le righe (senza ripetizioni); `limit` taglia dopo il mescolamento. `on_error = salta` registra l'errore del ciclo (`errori[]` nell'uscita del nodo) e passa al successivo; `ferma` interrompe il run.
* Corpo del ciclo = nodi raggiungibili da questo nodo **e** da cui si raggiunge il «Fine ciclo». Gli ingressi del corpo che provengono da fuori (costanti, stili, altre tabelle) sono calcolati una volta prima del ciclo. Ogni passaggio crea una riga `agentic_node_runs` con `visit = ciclo − 1`.
* Un nodo del corpo senza ingressi attivi in quel ciclo viene `skipped`; se il valore verso «Fine ciclo» è `null` quel ciclo non contribuisce ai risultati.
* Solo workflow a dati (esecuzione batch). I cicli annidati non sono supportati (validazione). Nei workflow con nodi chatbot il nodo si comporta come anteprima (prima riga) — vedi §9.

**Errori tipici**

* «La tabella è vuota: non c'è nessuna riga da ripetere»; «La colonna «x» non esiste nella tabella (colonne: …)»; «Ciclo i/N: <errore del nodo>» (con `ferma`).

**Esempio.** Tabella di prompt → `loop.for_each` → `platform.images(generate)` (`value → prompt`) → `loop.collect` → galleria in `results`.

#### `loop.collect` — Fine ciclo

Chiude un «Per ogni riga»: raccoglie il valore prodotto a ogni ciclo (testi, immagini…). I nodi collegati a valle partono quando il ciclo è finito.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `value` | `ANY` | sì | Risultato del ciclo |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `results` | `ANY` | Tutti i risultati |
| `table` | `TABLE` | Tabella risultati |

_Parametri: nessuno._

**Comportamento**

* Chiude un «Per ogni riga». Dopo l'ultimo ciclo pubblica `results` (lista dei valori ricevuti, uno per ciclo riuscito) e `table` (`ciclo`, `input`, `risultato`; le immagini compaiono come «[immagine]», il contenuto resta solo in `results`). `count` = n° risultati; `errors` = cicli saltati.
* I nodi a valle del «Fine ciclo» partono solo a ciclo concluso. Il Canvas mostra come galleria le liste di `data:image/…` presenti in `results` (max 40 miniature).
* Il run salva un'unica riga del nodo (`visit 0`); ciascun ciclo, invece, lascia le righe dei nodi del corpo (`visit` 0…N−1).

**Errori tipici**

* «Fine ciclo deve essere collegato a valle di un Per ogni riga» (validazione).

---

### 5.9 Controllo

Instradamento e ripetizione nel dialogo.

#### `control.if_else` — IF / ELSE

Attiva un ramo booleano.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `condition` | `ANY` | sì | condition |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `yes` | `ANY` | yes |
| `no` | `ANY` | no |

_Parametri: nessuno._

**Comportamento**

* `bool(condition)`; `yes = True|null`, `no = True|null`. Un ramo con valore `null` o `false` è considerato **non attivo**.

#### `control.repeat_until` — Ripeti finché

Verifica un valore (es. la risposta a una Domanda): se la condizione è soddisfatta prosegue da «Condizione ok», altrimenti «Ripeti» può tornare a un nodo precedente; dopo i tentativi massimi esce da «Tentativi finiti».

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `value` | `ANY` | sì | Valore da verificare |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `ok` | `ANY` | Condizione ok |
| `repeat` | `ANY` | Ripeti ↺ |
| `exhausted` | `ANY` | Tentativi finiti |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `mode` | `SELECT` | `contiene` | opzioni: `contiene`, `uguale`, `verifica_ai`, `vero_falso` | Condizione |
| `expected` | `STRING` | `56` | — | Valore atteso / criterio |
| `max_attempts` | `INTEGER` | `3` | min 1; max 20 | Tentativi massimi |

**Comportamento**

* Verifica un valore (risposta di una domanda, di un LLM…) con una condizione: `contiene` (una delle parole CSV è sottostringa), `uguale` (il testo, senza `.!?` ai bordi, coincide con uno dei valori), `verifica_ai` (un LLM risponde SI/NO al criterio; le formulazioni diverse e i refusi sono tollerati), `vero_falso` (il valore è truthy e non «false/falso/no/0/none»).
* Instrada su **una** sola uscita: `ok` (condizione vera), `repeat` (falsa e tentativi < massimi) oppure `exhausted` (falsa e tentativi esauriti). L'uscita attiva porta il testo verificato (o `true`); le altre sono `null`. Output extra: `attempts`, `max_attempts`, `passed`.
* `repeat` è l'**unico arco che può puntare all'indietro** (verso un nodo di flusso). I nodi sul percorso `target → ripeti finché` vengono rieseguiti con una nuova *visita*. Il contatore tentativi è per nodo (`loop_counts`) e si azzera a `ok`/`exhausted`.
* Solo nel dialogo chatbot. Nel run batch non esiste un ritorno: il nodo viene eseguito una volta (`attempts = 1`).

**Errori tipici**

* «Scrivi il criterio da verificare…» (modo `verifica_ai` senza criterio).

#### `control.compare_numbers` — Confronta numeri

Confronta due valori per il branching.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `a` | `ANY` | sì | a |
| `b` | `ANY` | sì | b |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `yes` | `ANY` | yes |
| `no` | `ANY` | no |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `operator` | `SELECT` | `>` | opzioni: `>`, `>=`, `<`, `<=`, `==`, `!=` | Operatore |

**Comportamento**

* Confronta `a` e `b` con l'operatore scelto (anche tra stringhe, ordine lessicografico). Stesso schema `yes/no` di `control.if_else`.

**Errori tipici**

* `TypeError` se uno dei due è `null`.

#### `control.counter` — Contatore

Incrementa un contatore di sessione.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `trigger` | `ANY` | no | trigger |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `value` | `ANY` | value |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `start` | `INTEGER` | `0` | — | Inizio |
| `step` | `INTEGER` | `1` | — | Passo |

**Comportamento**

* Incrementa un contatore `start + step` per esecuzione. Il contatore vive nello `state` della singola chiamata: **non è persistito** tra i turni di una chat (riparte ad ogni messaggio). La chiave `counter_id` esiste nel codice ma non nel catalogo (sempre `default`).

---

### 5.10 Piattaforma

Un nodo per dominio; la funzione si sceglie nel parametro `function` e porte/parametri visibili dipendono dalla funzione (§6).

#### `platform.files` — Files

Lavora sul drive: elenca, leggi, scrivi file, crea cartelle, sposta, rinomina, cestina.

Funzioni: `list`, `read_text`, `write`, `mkdir`, `move`, `rename`, `trash`, `restore`, `delete`. Le porte e i parametri di ciascuna funzione sono nel §6.1.

Generico: porta di ingresso/uscita **uniche per dominio** (unione delle funzioni, ciascuna con `showFor`); ingressi tutti facoltativi; i valori collegati sovrascrivono i parametri omonimi non vuoti. `cachePolicy = never`.

#### `platform.documents` — Documenti

Crea e modifica documenti di testo, presentazioni e tabelle (foglio di calcolo) della piattaforma.

Funzioni: `list`, `create_document`, `create_presentation`, `create_sheet`, `read`, `update_document`, `add_slides`, `sheet_append_rows`, `sheet_write_cells`, `rename`, `trash`. Le porte e i parametri di ciascuna funzione sono nel §6.2.

Generico: porta di ingresso/uscita **uniche per dominio** (unione delle funzioni, ciascuna con `showFor`); ingressi tutti facoltativi; i valori collegati sovrascrivono i parametri omonimi non vuoti. `cachePolicy = never`.

#### `platform.images` — Immagini AI

Genera immagini con il generatore di piattaforma (stessi crediti) e salvale nel drive.

Funzioni: `generate`. Le porte e i parametri di ciascuna funzione sono nel §6.3.

Generico: porta di ingresso/uscita **uniche per dominio** (unione delle funzioni, ciascuna con `showFor`); ingressi tutti facoltativi; i valori collegati sovrascrivono i parametri omonimi non vuoti. `cachePolicy = never`.

#### `platform.models3d` — Modelli 3D

Genera modelli 3D con Meshy da testo o immagine, attendi il risultato, salvalo; gestisci i progetti 3D.

Funzioni: `generate_from_text`, `generate_from_image`, `status`, `wait`, `save_to_drive`, `list_projects`, `create_project`. Le porte e i parametri di ciascuna funzione sono nel §6.4.

Generico: porta di ingresso/uscita **uniche per dominio** (unione delle funzioni, ciascuna con `showFor`); ingressi tutti facoltativi; i valori collegati sovrascrivono i parametri omonimi non vuoti. `cachePolicy = never`.

#### `platform.live` — Sessioni live

Crea e conduci sessioni live interattive: quiz, word wall, opinioni, feedback.

Funzioni: `list`, `create`, `start`, `next`, `end`, `results`, `public_link`. Le porte e i parametri di ciascuna funzione sono nel §6.5.

Generico: porta di ingresso/uscita **uniche per dominio** (unione delle funzioni, ciascuna con `showFor`); ingressi tutti facoltativi; i valori collegati sovrascrivono i parametri omonimi non vuoti. `cachePolicy = never`.

---

## 6. Nodi «Piattaforma»: funzioni

Ogni nodo `platform.<dominio>` è un *adattatore* sottile sulle stesse funzioni usate dall'interfaccia (drive, editor documenti, generatore immagini, Meshy, sessioni live), eseguite con l'account dell'utente. Esecuzione: `run_platform_node` risolve `domain.function`, fonde `config` e ingressi collegati (gli ingressi non vuoti vincono sui parametri), valida i parametri (`_validate_params`: opzioni ammesse, interi, booleani da testo) e converte gli errori HTTP in errori di nodo («Dominio · funzione: messaggio»).

**Effetti collaterali** (`sideEffects`): `none` = nessun effetto; `creates` = crea elementi; `modifies` = modifica elementi; `deletes` = **cancella** (irreversibile o quasi); `spends_credits` = **spende crediti**; `realtime` = agisce in tempo reale sugli studenti. Le funzioni `longRunning` (attese di generazione 3D) bloccano il run per tutta la durata (§9 #1).

### 6.1 `platform.files` — Files (drive)

#### `files.list` — Elenca file e cartelle

Elenca il contenuto di una cartella del drive (o cerca per nome).

Effetti: nessun effetto.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `items` | `ANY` | Elementi |
| `table` | `TABLE` | Tabella elementi |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |
| `query` | `STRING` | — | facoltativo | Cerca per nome |

#### `files.read_text` — Leggi file di testo

Restituisce il contenuto testuale (UTF-8, max 1 MB) di un file del drive: txt, md, csv, json…

Effetti: nessun effetto.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `item_id` | `ANY` | no | ID elemento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `text` | `ANY` | Testo |
| `item` | `ANY` | Elemento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `item_id` | `STRING` | — | — | ID elemento del drive |

#### `files.write` — Crea o scrivi file

Crea un nuovo file nel drive, oppure — indicando l'ID di un file esistente — ne sovrascrive il contenuto. Il contenuto è testo, oppure base64 con «Codifica = base64».

Effetti: crea elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `content` | `ANY` | no | Contenuto |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `item_id` | `ANY` | ID elemento |
| `item` | `ANY` | Elemento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `name` | `STRING` | `nota.txt` | — | Nome file (es. nota.md) |
| `content` | `CODE` | — | — | Contenuto |
| `encoding` | `SELECT` | `text` | opzioni: `text`, `base64` | Codifica |
| `mime_type` | `STRING` | — | facoltativo | Tipo MIME (opzionale) |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |
| `overwrite_item_id` | `STRING` | — | facoltativo | ID file da sovrascrivere (opzionale) |

#### `files.mkdir` — Crea cartella

Crea una cartella nel drive.

Effetti: crea elementi.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `item_id` | `ANY` | ID elemento |
| `item` | `ANY` | Elemento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `name` | `STRING` | `Nuova cartella` | — | Nome cartella |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |

#### `files.move` — Sposta elementi

Sposta file/cartelle in un'altra cartella (vuoto = radice).

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `item_id` | `ANY` | no | ID elemento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `moved` | `ANY` | Numero spostati |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `item_ids` | `STRING` | — | — | ID elementi (separati da virgola) |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |

#### `files.rename` — Rinomina elemento

Rinomina un file, una cartella o un documento (anche sulla piattaforma).

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `item_id` | `ANY` | no | ID elemento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `item_id` | `ANY` | ID elemento |
| `item` | `ANY` | Elemento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `item_id` | `STRING` | — | — | ID elemento del drive |
| `name` | `STRING` | — | — | Nuovo nome |

#### `files.trash` — Sposta nel cestino

Sposta elementi nel cestino (recuperabili).

Effetti: **cancella** (irreversibile o quasi).

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `item_id` | `ANY` | no | ID elemento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `trashed` | `ANY` | Numero eliminati |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `item_ids` | `STRING` | — | — | ID elementi (separati da virgola) |

#### `files.restore` — Ripristina dal cestino

Ripristina elementi dal cestino.

Effetti: modifica elementi.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `restored` | `ANY` | Numero ripristinati |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `item_ids` | `STRING` | — | — | ID elementi (separati da virgola) |

#### `files.delete` — Elimina definitivamente

Elimina per sempre elementi già nel cestino. Irreversibile.

Effetti: **cancella** (irreversibile o quasi).

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `deleted` | `ANY` | Numero eliminati |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `item_ids` | `STRING` | — | — | ID elementi (separati da virgola) |

---

### 6.2 `platform.documents` — Documenti, presentazioni e tabelle

#### `documents.list` — Elenca documenti

Elenca documenti, presentazioni e tabelle del docente.

Effetti: nessun effetto.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | Elenco |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `doc_type` | `SELECT` | — | opzioni: ``, `document`, `presentation`, `sheet`; facoltativo | Tipo |
| `session_id` | `STRING` | — | facoltativo | Sessione collegata (opzionale) |

#### `documents.create_document` — Crea documento di testo

Crea un documento (word processor). Il contenuto può essere HTML oppure testo semplice (paragrafi separati da riga vuota).

Effetti: crea elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `content` | `ANY` | no | Contenuto |
| `table` | `TABLE` | no | Tabella da inserire (opzionale) |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |
| `drive_item_id` | `ANY` | ID nel drive |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `title` | `STRING` | — | — | Titolo |
| `content` | `CODE` | — | — | Contenuto |
| `format` | `SELECT` | `text` | opzioni: `text`, `html` | Formato contenuto |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |
| `session_id` | `STRING` | — | facoltativo | Sessione collegata (opzionale) |

#### `documents.create_presentation` — Crea presentazione

Crea una presentazione 16:9. «slides» è una lista JSON di {"title", "body" \| "bullets": [...], "notes"?, "image"?: "data:image/png;base64,…"}.

Effetti: crea elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `slides` | `ANY` | no | Slide |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |
| `drive_item_id` | `ANY` | ID nel drive |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `title` | `STRING` | — | — | Titolo |
| `slides` | `CODE` | `[{"title": "Titolo", "bullets": ["Punto 1", "Punto 2"]}]` | — | Slide (JSON) |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |
| `session_id` | `STRING` | — | facoltativo | Sessione collegata (opzionale) |

#### `documents.create_sheet` — Crea tabella (foglio di calcolo)

Crea un foglio di calcolo da una tabella collegata, oppure da «rows» (JSON: lista di liste o di oggetti; con oggetti la prima riga è l'intestazione).

Effetti: crea elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `table` | `TABLE` | no | Tabella |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |
| `drive_item_id` | `ANY` | ID nel drive |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `title` | `STRING` | — | — | Titolo |
| `sheet_name` | `STRING` | `Foglio 1` | — | Nome foglio |
| `rows` | `CODE` | — | facoltativo | Righe (JSON, opzionale) |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |
| `session_id` | `STRING` | — | facoltativo | Sessione collegata (opzionale) |

#### `documents.read` — Leggi documento

Legge un documento, una presentazione o una tabella. Restituisce testo/HTML, slide o tabella a seconda del tipo.

Effetti: nessun effetto.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `title` | `ANY` | Titolo |
| `doc_type` | `ANY` | Tipo |
| `text` | `ANY` | Testo |
| `html` | `ANY` | HTML |
| `slides` | `ANY` | Slide |
| `table` | `TABLE` | Tabella |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |

#### `documents.update_document` — Scrivi nel documento

Sostituisce o aggiunge in coda contenuto a un documento di testo.

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |
| `content` | `ANY` | no | Contenuto |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |
| `content` | `CODE` | — | — | Contenuto |
| `format` | `SELECT` | `text` | opzioni: `text`, `html` | Formato contenuto |
| `mode` | `SELECT` | `append` | opzioni: `append`, `replace` | Modalità |

#### `documents.add_slides` — Aggiungi slide

Aggiunge slide in coda (o alla posizione indicata) a una presentazione.

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |
| `slides` | `ANY` | no | Slide |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |
| `slide_count` | `ANY` | Numero slide |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |
| `slides` | `CODE` | `[{"title": "Nuova slide", "body": "Testo"}]` | — | Slide (JSON) |
| `position` | `INTEGER` | — | facoltativo | Posizione (0 = in testa, vuoto = in coda) |

#### `documents.sheet_append_rows` — Aggiungi righe alla tabella

Accoda righe a un foglio di calcolo, da una tabella collegata o da «rows». Con «Salta intestazione» la prima riga non viene scritta (utile per tabelle che hanno già l'intestazione).

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |
| `table` | `TABLE` | no | Tabella |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |
| `row_count` | `ANY` | Righe totali |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |
| `rows` | `CODE` | — | facoltativo | Righe (JSON, opzionale) |
| `skip_header` | `BOOLEAN` | sì | — | Salta intestazione della tabella collegata |

#### `documents.sheet_write_cells` — Scrivi celle

Scrive singole celle di un foglio. «cells» è JSON: [{"row": 0, "col": 0, "value": "x"}] (indici da 0) oppure [{"ref": "B3", "value": "x"}].

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |
| `written` | `ANY` | Celle scritte |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |
| `cells` | `CODE` | `[{"ref": "A1", "value": "Ciao"}]` | — | Celle (JSON) |

#### `documents.rename` — Rinomina documento

Cambia il titolo di un documento, presentazione o tabella.

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `document_id` | `ANY` | ID documento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |
| `title` | `STRING` | — | — | Nuovo titolo |

#### `documents.trash` — Cestina documento

Sposta un documento nel cestino del drive (recuperabile).

Effetti: **cancella** (irreversibile o quasi).

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `document_id` | `ANY` | no | ID documento |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `trashed` | `ANY` | Numero eliminati |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `document_id` | `STRING` | — | — | ID documento |

---

### 6.3 `platform.images` — Immagini

#### `images.generate` — Genera immagine

Genera un'immagine con il generatore di piattaforma (stesso provider, crediti e limiti del generatore immagini). Opzionalmente la salva nel drive.

Effetti: **spende crediti**.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `prompt` | `ANY` | no | Descrizione |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `image_data` | `ANY` | Immagine (base64) |
| `image_mime` | `ANY` | Tipo MIME |
| `data_uri` | `ANY` | Data URI |
| `revised_prompt` | `ANY` | Prompt rivisto |
| `item_id` | `ANY` | ID nel drive |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `prompt` | `CODE` | — | — | Descrizione |
| `size` | `SELECT` | `1024x1024` | opzioni: `1024x1024`, `1536x1024`, `1024x1536` | Dimensione |
| `quality` | `SELECT` | `standard` | opzioni: `standard`, `high` | Qualità |
| `style` | `SELECT` | `natural` | opzioni: `natural`, `vivid` | Stile |
| `save_to_drive` | `BOOLEAN` | no | — | Salva nel drive |
| `filename` | `STRING` | `immagine.png` | facoltativo | Nome file (se salvata) |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |

---

### 6.4 `platform.models3d` — Modelli 3D

#### `models3d.generate_from_text` — Genera modello 3D da testo

Avvia la generazione di un modello 3D con Meshy (stesso provider e crediti del 3D Lab). Asincrona: restituisce un task_id da interrogare con «models3d.status»; il progresso compare anche nell'indicatore job della navbar.

Effetti: **spende crediti**; **lunga durata**.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `prompt` | `ANY` | no | Descrizione |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `task_id` | `ANY` | ID task Meshy |
| `job_id` | `ANY` | ID job in background |
| `task_type` | `ANY` | text \| image |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `prompt` | `CODE` | — | — | Descrizione (max 800 caratteri) |
| `ai_model` | `SELECT` | `meshy-7.1` | opzioni: `meshy-6-lite`, `meshy-6`, `meshy-7.1`, `latest` | Modello Meshy |
| `model_type` | `SELECT` | `standard` | opzioni: `standard`, `smart-topology` | Topologia |
| `target_polycount` | `INTEGER` | `30000` | min 100; max 300000 | Poligoni obiettivo |

#### `models3d.generate_from_image` — Genera modello 3D da immagine

Come «da testo», partendo da un'immagine di riferimento (base64, oppure l'ID di un file immagine del drive).

Effetti: **spende crediti**; **lunga durata**.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `image_data` | `ANY` | no | Immagine (base64) |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `task_id` | `ANY` | ID task Meshy |
| `job_id` | `ANY` | ID job in background |
| `task_type` | `ANY` | text \| image |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `image_data` | `CODE` | — | facoltativo | Immagine base64 (opzionale se indichi un file) |
| `image_item_id` | `STRING` | — | facoltativo | ID file immagine nel drive |
| `image_mime` | `STRING` | `image/png` | facoltativo | Tipo MIME |
| `prompt` | `CODE` | — | facoltativo | Prompt texture (opzionale) |
| `ai_model` | `SELECT` | `meshy-7.1` | opzioni: `meshy-6-lite`, `meshy-6`, `meshy-7.1`, `latest` | Modello Meshy |
| `model_type` | `SELECT` | `standard` | opzioni: `standard`, `smart-topology` | Topologia |
| `target_polycount` | `INTEGER` | `30000` | min 100; max 300000 | Poligoni obiettivo |

#### `models3d.status` — Stato generazione 3D

Interroga un task Meshy. «status» vale PENDING, IN_PROGRESS, SUCCEEDED, FAILED…; a successo «model_urls» contiene i link ai formati (glb, obj, stl…).

Effetti: nessun effetto.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `task_id` | `ANY` | no | ID task |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `status` | `ANY` | Stato |
| `progress` | `ANY` | Avanzamento % |
| `model_urls` | `ANY` | URL dei modelli |
| `raw` | `ANY` | Risposta completa |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `task_id` | `STRING` | — | — | ID task Meshy |
| `task_type` | `SELECT` | `text` | opzioni: `text`, `image` | Tipo |

#### `models3d.wait` — Attendi risultato 3D

Attende (polling ogni 5 s) che un task Meshy termini: utile in un flusso per usare il modello subito dopo la generazione. Errore se il task fallisce o scade il tempo.

Effetti: nessun effetto; **lunga durata**.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `task_id` | `ANY` | no | ID task |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `status` | `ANY` | Stato |
| `model_urls` | `ANY` | URL dei modelli |
| `raw` | `ANY` | Risposta completa |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `task_id` | `STRING` | — | — | ID task Meshy |
| `task_type` | `SELECT` | `text` | opzioni: `text`, `image` | Tipo |
| `timeout_seconds` | `INTEGER` | `300` | min 10; max 900 | Attesa massima (secondi) |

#### `models3d.save_to_drive` — Salva modello 3D nel drive

Scarica il modello generato da Meshy nel formato scelto e lo salva come file nel drive.

Effetti: crea elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `task_id` | `ANY` | no | ID task |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `item_id` | `ANY` | ID elemento |
| `item` | `ANY` | Elemento |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `task_id` | `STRING` | — | — | ID task Meshy |
| `task_type` | `SELECT` | `text` | opzioni: `text`, `image` | Tipo |
| `format` | `SELECT` | `glb` | opzioni: `glb`, `obj`, `stl`, `fbx`, `usdz` | Formato |
| `filename` | `STRING` | `modello` | facoltativo | Nome file |
| `parent_id` | `STRING` | — | facoltativo | Cartella (ID, vuoto = radice del drive) |

#### `models3d.list_projects` — Elenca progetti 3D

Elenca i progetti dell'editor solido (Tinkercad-like) del docente.

Effetti: nessun effetto.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | Progetti |

_Parametri: nessuno._

#### `models3d.create_project` — Crea progetto 3D

Crea un progetto nell'editor solido. «scene» è la lista JSON di oggetti della scena (vuota = progetto vuoto).

Effetti: crea elementi.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `model_id` | `ANY` | ID progetto |
| `project` | `ANY` | Progetto |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `name` | `STRING` | `Nuovo progetto` | — | Nome progetto |
| `scene` | `CODE` | `[]` | facoltativo | Scena (JSON) |

---

### 6.5 `platform.live` — Sessioni live

#### `live.list` — Elenca sessioni live

Elenca le sessioni live di una sessione di lavoro.

Effetti: nessun effetto.

_Ingressi: nessuna._

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `table` | `TABLE` | Elenco |
| `items` | `ANY` | Elementi |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `session_id` | `STRING` | — | — | ID sessione di lavoro |

#### `live.create` — Crea sessione live

Crea una sessione live interattiva. «slides» è JSON: lista di {"type": "mcq", "question", "options": [..], "correct_option": 0} \| {"type": "wordwall"\|"opinion"\|"feedback", "prompt"}.

Effetti: crea elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `slides` | `ANY` | no | Slide |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `interaction_id` | `ANY` | ID sessione live |
| `status` | `ANY` | Stato |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `session_id` | `STRING` | — | — | ID sessione di lavoro |
| `title` | `STRING` | — | — | Titolo |
| `slides` | `CODE` | `[{"type": "mcq", "question": "Domanda?", "options": ["A",…` | — | Slide (JSON) |

#### `live.start` — Avvia sessione live

Avvia la sessione live: gli studenti collegati la vedono subito sulla prima slide.

Effetti: agisce in tempo reale sugli studenti.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `interaction_id` | `ANY` | no | ID sessione live |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | Esito |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `interaction_id` | `STRING` | — | — | ID sessione live |

#### `live.next` — Slide successiva

Passa alla slide successiva; dopo l'ultima la sessione si chiude.

Effetti: agisce in tempo reale sugli studenti.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `interaction_id` | `ANY` | no | ID sessione live |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | Esito |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `interaction_id` | `STRING` | — | — | ID sessione live |

#### `live.end` — Termina sessione live

Chiude la sessione live per tutti i partecipanti.

Effetti: agisce in tempo reale sugli studenti.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `interaction_id` | `ANY` | no | ID sessione live |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | Esito |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `interaction_id` | `STRING` | — | — | ID sessione live |

#### `live.results` — Risultati sessione live

Restituisce i risultati aggregati e per studente della sessione live.

Effetti: nessun effetto.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `interaction_id` | `ANY` | no | ID sessione live |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `result` | `ANY` | Esito |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `interaction_id` | `STRING` | — | — | ID sessione live |

#### `live.public_link` — Abilita link pubblico

Abilita l'accesso pubblico (codice/QR) alla sessione live e restituisce il codice.

Effetti: modifica elementi.

**Ingressi**

| Porta | Tipo | Obbl. | Etichetta |
|---|---|---|---|
| `interaction_id` | `ANY` | no | ID sessione live |

**Uscite**

| Porta | Tipo | Etichetta |
|---|---|---|
| `token` | `ANY` | Codice di accesso |
| `access_code` | `ANY` | Codice di accesso |

**Parametri**

| Nome | Tipo | Default | Vincoli | Etichetta |
|---|---|---|---|---|
| `interaction_id` | `STRING` | — | — | ID sessione live |

---

## 7. Ricette di composizione

Schemi collaudati, utili sia agli utenti sia come esempi nel prompt dell'assistente (§8).

**R1 — Generare N immagini da una lista di prompt (ciclo)**
`ai.transform` (`task = prompt_table`, `instruction = "20 prompt su …"`) → `table` → `loop.for_each` (`column = prompt`, `order = casuale`, `limit = 0`, `on_error = salta`) → `value` → `platform.images` (`function = generate`, porta `prompt`) → `data_uri` → `loop.collect` → `results` (galleria) / `table`.
Opzionale: `save_to_drive = true` (con `parent_id` di una cartella) nel nodo immagini. Il `filename` è una costante della configurazione: tutte le immagini avrebbero lo stesso nome, quindi per un archivio ordinato conviene comporre il nome in un nodo `text.template` (`{a}` = `index`) e collegarlo alla porta `filename`, ammesso che la funzione la esponga come ingresso (oggi non lo fa: vedi §9).

**R2 — Pipeline ML con valutazione onesta**
`csv.synthetic` / `data.custom_input` → `data.dropna` → `data.split` → (`train`) `ml.classification` → `model`; (`test`) + `model` → `ml.predict` → `plot.2d`. Le metriche di `ml.classification` sono sul training set: la stima fuori campione è `cv_mean` o la valutazione sul `test`.

**R3 — Report in un documento**
Sorgente dati → `data.group_by` → `ai.transform` (`summarize`) → `platform.documents` (`create_document`, `content` ← `text`). Le tabelle possono essere inserite con `platform.documents.create_sheet` (porta `table`).

**R4 — Presentazione con immagini**
`ai.transform` (`make_slides`) → `slides` → `platform.documents` (`create_presentation`). Le immagini si aggiungono nella lista `slides` come `image: "data:image/…"`.

**R5 — Quiz live per la classe**
`ai.transform` (`make_quiz`) → `slides` → `platform.live` (`create`, richiede `session_id` della sessione di lavoro e `title`) → `interaction_id` → `platform.live` (`start`).

**R6 — Chatbot tutor con contesto**
`data.custom_input` (conoscenza) → `text.from_table` → `llm_chatbot.context_1`; `llm_chatbot` (`continuous`, `max_turns`, `exit_phrases`) come primo nodo del dialogo. Pubblicazione: avvio del run con `session_id`.

**R7 — Dialogo con verifica e nuovi tentativi**
`chatbot.say` → `chatbot.ask` → `control.repeat_until` (`mode = verifica_ai`, `expected = «risposta corretta: …»`, `max_attempts = 3`): `ok` → `chatbot.say` («Bravo»); `repeat` → *arco di ritorno* a `chatbot.ask`; `exhausted` → `chatbot.say` («La risposta era …»).

**R8 — Tabella di prompt scritta dall'LLM, poi un modello 3D per riga**
Come R1, ma nel corpo del ciclo ci sono tre nodi `platform.models3d`: `generate_from_text` (`prompt` ← `value`), `wait` (`task_id`) e `save_to_drive` (`task_id`, che va collegato anche dall'uscita di `generate_from_text`, perché `wait` non lo restituisce). Attenzione ai tempi: ogni modello richiede minuti e il run è sincrono (§9).

---

## 8. Assistente agentico per costruire i workflow — progetto

> **Stato: proposta, non implementata.** Questa sezione è il progetto tecnico dell'assistente descritto nella richiesta: l'utente dichiara un'*intenzione*, l'assistente conferma di averla capita, un *architetto* progetta il workflow, il sistema lo *costruisce sul Canvas* davanti all'utente e infine un *revisore* lo prova e dichiara «funziona, ora puoi personalizzarlo».

### 8.1 Obiettivi e non-obiettivi

**Obiettivi**

1. Da una frase («voglio generare 20 immagini diverse a partire da prompt scritti dall'AI») a un workflow valido, già cablato e configurato.
2. Nessuna sorpresa: l'utente conferma l'interpretazione *prima* che compaia qualunque nodo, e vede il costo atteso prima di avviare nodi che spendono crediti.
3. Il risultato **passa sempre `validate_graph`** e gli errori deterministici (colonne mancanti, porte scollegate) sono già stati trovati e corretti.
4. Dichiara con onestà *che cosa è stato provato e che cosa no*.
5. Riuso massimo di quanto esiste: pipeline a fasi e SSE del Coding Lab, registro nodi, `validate_graph`, `execute_node_isolated`, ruoli modello, replay con camera sul Canvas.

**Non-obiettivi (v1):** eseguire il workflow al posto dell'utente; modificare in silenzio un grafo già pieno; creare nodi nuovi; costruire dialoghi chatbot complessi con revisione conversazionale (vedi §8.9, fase 2).

### 8.2 Il modello di riferimento: la pipeline del Coding Lab

Il Coding Lab (`backend/app/api/v1/endpoints/coding.py`) ha già una pipeline multi-agente che l'assistente replica:

| Fase Coding Lab | Dove nel codice | Equivalente nell'assistente |
|---|---|---|
| Domande di chiarimento (3–4, con suggerimenti) | `POST /coding/ai/interview` (`INTERVIEW_SYSTEM_PROMPT`) | **Intake**: «Ho capito così… confermi?» |
| *Prompt Analyst* + piano (`PLAN_SYSTEM_PROMPT`: architetto + lead UX) | `generate` / `generate-stream` | **Architetto**: produce il *blueprint* |
| Generazione file per file in streaming SSE (`status`, `plan`, `file_start`, `file_done`), con heartbeat ogni 8 s | `generate-stream` | **Costruttore**: operazioni sul grafo in streaming |
| *Verificatore* (errori reali dell'esecuzione) e *Revisore visivo* → turno di fix con «modifiche mirate» | `visual-review`, `ui-review`, turni `agent_fix_request` | **Revisore**: validazione + prova dei nodi sicuri + revisione semantica, con riparazione |
| Messaggi con `actor_type = "agent"`, `agent_name`, `metadata.kind` | `CodingMessage` | Messaggi del pannello assistente |

Differenza sostanziale: lì l'output è codice libero; qui l'output deve rispettare un **catalogo chiuso e tipizzato**. Per questo l'architetto **non scrive il grafo**: scrive un *blueprint* astratto che un **compilatore deterministico** trasforma in nodi e archi. L'LLM sceglie *quali* nodi e *che cosa* configurare; non può inventare un `instanceId`, una porta o un tipo.

### 8.3 Flusso utente

```
 utente scrive l'intenzione
        │
        ▼
 1 INTAKE  ──► card «Ho capito: … Ipotesi: … [Conferma] [Correggi]»   (0–3 domande se ambiguo)
        │ conferma
        ▼
 2 ARCHITETTO ──► checklist del piano (passi, nodi, costo stimato, avvisi)   [Costruisci] [Modifica piano]
        │ costruisci
        ▼
 3 COSTRUTTORE ──► i nodi compaiono uno a uno sul Canvas, la camera li segue, gli archi si animano
        │          (Canvas bloccato in sola lettura)
        ▼
 4 REVISORE ──► Validazione ✔ · Prova nodi sicuri 7/9 ✔ · Revisione ✔   (max 2 giri di riparazione)
        │
        ▼
 5 CONSEGNA ──► «Il workflow funziona (non provati: 2 nodi che spendono crediti). Ora è tuo: personalizzalo.»
                [Annulla tutto] ripristina lo stato precedente
```

Regole di interfaccia: il pannello è agganciato al Canvas (laterale o inferiore, comprimibile come la libreria nodi); un solo assistente attivo per workflow; ogni fase è annullabile; a costruzione finita il Canvas torna editabile e un'unica azione **Annulla tutto** ripristina lo snapshot precedente (la versione del workflow è già incrementata a ogni PUT).

### 8.4 Contratto dei dati

**Intake — risposta**
```json
{ "understanding": "Generare 20 immagini fantasy: un LLM scrive i prompt, un ciclo li passa al generatore di immagini.",
  "assumptions": ["20 immagini", "formato 1024x1024, qualità standard", "nessun salvataggio nel drive"],
  "questions": [ { "question": "Vuoi salvarle nel drive?", "suggestions": ["Sì, in una cartella", "No, solo anteprima"] } ],
  "mode": "data" }
```
`mode` ∈ `data | chatbot`. In v1 `chatbot` costruisce la struttura del dialogo ma non lo prova (§8.9).

**Blueprint (output dell'architetto, validato con uno schema Pydantic)**
```json
{ "title": "Galleria fantasy",
  "mode": "data",
  "steps": [
    { "key": "prompts", "node": "ai.transform",
      "purpose": "Scrive 20 prompt diversi",
      "config": { "task": "prompt_table", "instruction": "20 prompt su paesaggi fantasy", "language": "inglese" } },
    { "key": "each", "node": "loop.for_each",
      "config": { "column": "prompt", "order": "casuale", "limit": 0, "on_error": "salta" },
      "inputs": { "table": "prompts.table" } },
    { "key": "img", "node": "platform.images",
      "config": { "function": "generate", "size": "1024x1024", "quality": "standard" },
      "inputs": { "prompt": "each.value" } },
    { "key": "end", "node": "loop.collect",
      "inputs": { "value": "img.data_uri" } }
  ],
  "estimate": { "credit_nodes": [ { "key": "img", "times": 20, "kind": "image" } ], "llm_calls": 1 },
  "warnings": ["Il ciclo genera 20 immagini: spendono crediti."] }
```
Regole: `node` ∈ catalogo; `inputs` mappa `portaDestinazione → chiave.portaSorgente`; i riferimenti devono esistere e rispettare i tipi; `config` contiene solo parametri esistenti (i nomi sconosciuti sono scartati con avviso). `estimate` è calcolato dal **compilatore**, non dall'LLM, moltiplicando i nodi con `sideEffects = spends_credits` e `longRunning` per le righe note (`limit`, righe delle tabelle statiche, «N» nell'istruzione del `prompt_table`).

**Operazioni di costruzione (output del compilatore, flusso SSE)**
```json
{ "type": "add_node",   "node": { "id": "loop.for_each", "instanceId": "loop.for_each-1760…", "x": 720, "y": 180, "config": {…} } }
{ "type": "connect",    "edge": { "from": "...", "sourcePort": "value", "to": "...", "targetPort": "prompt" } }
{ "type": "update_node","instanceId": "...", "config": { "column": "prompt" } }
{ "type": "remove_node","instanceId": "..." }                       // solo in modalità modifica, con conferma
{ "type": "note",       "message": "Aggiungo il ciclo…" }
{ "type": "done",       "graph": { "nodes": […], "edges": […] } }   // grafo finale, fonte di verità per il revisore
```
L'applicazione lato client riusa gli stessi `setNodes`/`setEdges` del Canvas e **gli stessi helper di inferenza** (`inferOutputColumns`, `recommendedConfig`), quindi i parametri `COLUMN/COLUMNS` si compilano come se l'utente avesse collegato a mano. Impaginazione: livelli topologici da sinistra a destra, distanza orizzontale = larghezza del nodo + 110 px (come l'auto-collegamento), corpo dei cicli su una riga unica.

### 8.5 Il «pacchetto di conoscenza» dell'architetto

Il prompt di sistema non contiene una descrizione scritta a mano dei nodi, ma una **vista compatta generata a runtime da `NODE_REGISTRY`** (stessa fonte di `GET /agentic/registry` e di questo documento), per non andare mai fuori sincrono:

* per ogni nodo non nascosto: `id`, etichetta, **quando usarlo** (una riga), porte con tipo e `required`, parametri con default/opzioni/min-max, `sideEffects`, `longRunning`;
* per i nodi `platform.*`: le funzioni con le rispettive porte (§6);
* **le regole di composizione** (§3) in forma di elenco: una connessione per ingresso dati, un solo arco in uscita per le porte di flusso, tipi compatibili, `loop.for_each` ↔ `loop.collect`, niente cicli annidati, «Ripeti» solo all'indietro;
* **le ricette** del §7 come esempi *few-shot* (blueprint completi);
* i **vincoli di sicurezza** (§8.7);
* nella modalità modifica, un *riassunto* del grafo corrente (nodi con id/tipo/config essenziale, archi) e lo schema colonne delle tabelle già calcolate.

Dimensione stimata: 6–9 mila token. Con prompt caching del provider il costo marginale per richiesta è basso.

### 8.6 Il revisore: tre livelli, in ordine di costo

| Livello | Che cosa fa | Costo | Su quali nodi |
|---|---|---|---|
| **L1 Validazione statica** | `validate_graph` + *lint* aggiuntivo: parametri `COLUMN/COLUMNS` che puntano a colonne non presenti nello schema dedotto; ingressi dati obbligatori scollegati; nodi senza consumatori (output sprecato); `loop.for_each` con tabella certamente vuota; nodi con più di una sorgente per lo stesso ruolo | nullo (deterministico) | tutti |
| **L2 Prova reale dei nodi sicuri** | esegue in ordine topologico, con `execute_node_isolated`, solo i nodi **senza effetti e senza costi**: sorgenti locali, trasformazioni, testo, matematica, ML, grafici. Verifica che non sollevino errori e che le uscite abbiano lo schema atteso. Per i cicli simula **un solo giro** (`limit = 1`) | basso (CPU) | `sideEffects = none` e non `ai.*`/`llm_chatbot`/`platform.*` con effetti |
| **L3 Revisione semantica (LLM)** | riceve intenzione, blueprint, grafo finale e referti L1/L2; risponde `{ok, issues:[{severity, node, message, fix}], summary}`: il flusso risponde davvero all'intenzione? ci sono passi mancanti o inutili? i parametri hanno senso (es. `limit` sul ciclo, lingua dei prompt)? | 1 chiamata | grafo intero |

**Riparazione.** Se L1 o L3 trovano problemi con `severity ≥ error`, il referto torna all'architetto che emette un *patch* (`update_node`/`connect`/`remove_node`/`add_node`); massimo **2 giri**. Se al terzo giro non converge, l'assistente lo dice e lascia il grafo con i punti aperti elencati, senza dichiarare successo.

**Nodi non provati.** Quelli con `spends_credits`, `creates`, `modifies`, `deletes`, `realtime` o `ai.*` (compreso `ai.transform`) **non vengono mai eseguiti dalla revisione**, a meno di un consenso esplicito per singolo nodo con tetto di spesa («Prova anche l'LLM con 1 riga?»). Per rendere comunque verificabili i passi a valle, L2 sostituisce l'uscita di un nodo non eseguito con un **valore sentinella tipizzato** generato dallo schema atteso (es. una tabella di 3 righe con le colonne dichiarate dall'istruzione, una stringa di prova). Il referto finale indica in modo esplicito *«provato con dati reali»*, *«provato con dati simulati»*, *«non provato»*.

**Dialoghi (modalità `chatbot`).** L2 esegue soltanto i nodi dati a monte del contesto; la prova conversazionale (un «utente simulato» che percorre il flusso con `test_response`/`test_choice`) è rimandata alla fase 2 perché richiede un run temporaneo cancellabile per ID (`agentic_workflow_runs` + `agentic_node_runs`) e chiama l'LLM.

### 8.7 Sicurezza e limiti operativi

* **Accesso:** come lo Studio, solo `ADMIN`. L'assistente agisce con i permessi dell'utente (stessi `actor` e tenant dei nodi).
* **Niente distruzione automatica:** l'architetto non può inserire funzioni che cancellano o cestinano (`files.delete`, `files.trash`, `documents.trash`) né avviare/terminare sessioni live (`live.start/next/end`) salvo richiesta *esplicita* dell'utente, e anche allora il piano le mostra evidenziate e richiede conferma separata. Il compilatore lo applica con una *deny-list*, non lo si affida al prompt.
* **Costi:** il piano mostra la stima (§8.4) e il Costruttore **non esegue** mai nulla. L'esecuzione del workflow resta un'azione dell'utente. Tetti: massimo 40 nodi per blueprint, 200 cicli (già nel runtime), 1 chiamata di architetto + fino a 2 di riparazione + 1 di revisione per richiesta.
* **Iniezione di prompt:** i contenuti di tabelle, dataset, file e risposte di nodi che finiscono nel prompt dell'assistente (riassunto del grafo, schema colonne) sono dati, mai istruzioni; il blueprint è validato contro uno schema chiuso, quindi un testo ostile non può produrre nodi fuori catalogo.
* **Modalità modifica:** se il Canvas non è vuoto, l'assistente lavora per *patch*; ogni `remove_node` e ogni modifica a nodi già configurati dall'utente richiede conferma, e il lavoro dell'utente non viene mai sovrascritto in silenzio.
* **Concorrenza:** durante la costruzione il Canvas è in sola lettura; se la scheda viene chiusa il lavoro riparte dal grafo salvato (il client invia il grafo finale con `POST /assistant/review`).

### 8.8 Integrazione tecnica

**Backend (nuovo)**

| Elemento | Descrizione |
|---|---|
| `app/services/agentic_assistant.py` | generatore del pacchetto di conoscenza, schemi Pydantic (`Intake`, `Blueprint`, `Op`, `ReviewReport`), compilatore blueprint → operazioni, impaginazione, lint L1, esecutore L2, prompt dei tre agenti |
| `POST /agentic/assistant/intake` | JSON; `{intent, graph?, attachments?}` → `{understanding, assumptions, questions, mode}` |
| `POST /agentic/assistant/plan` | **SSE**: `status`, `reasoning`, `blueprint`, `ops…`, `done` (con heartbeat come `generate-stream`) |
| `POST /agentic/assistant/review` | **SSE**: `check` (L1/L2/L3 con esito per nodo), `repair_ops`, `report` finale |
| `model_roles.ROLES` | due nuovi ruoli assegnabili in *Admin → Modelli*: `agentic.architect` (modello con ragionamento, es. il più capace tra quelli attivi) e `agentic.reviewer` (veloce); l'intake usa `chat.fast` |
| Costi | registrazione nel sistema crediti con un contesto dedicato (`agentic_assistant`), sul modello di `_record_coding_cost` del Coding Lab |
| Persistenza (opzionale, migrazione 099) | `agentic_assistant_turns(id, workflow_id, user_id, role, agent_name, kind, content, payload_json, created_at)` per ricaricare la conversazione e il referto di revisione |

**Frontend (nuovo)**

| Elemento | Descrizione |
|---|---|
| `components/agentic/AssistantPanel.tsx` | pannello a fasi (intake, piano, costruzione, revisione, consegna), cronologia messaggi per agente |
| `lib/agenticAssistant.ts` | client SSE (riuso del parser del Coding Lab), applicatore di operazioni con animazione e `focusCamera`, snapshot/annulla |
| `AgenticWorkflowStudioPage.tsx` | stato `assistantBusy` che blocca modifica e trascinamento; punto d'ingresso nella barra superiore («Assistente») e nello stato vuoto del Canvas |

**Test**

* *Contratto:* ogni blueprint dei ricettari §7 compila in un grafo che passa `validate_graph`.
* *Compilatore:* proprietà (qualunque blueprint valido → grafo valido; riferimenti rotti → errore chiaro; deny-list rispettata).
* *Golden set:* 15–20 intenzioni reali (ML, cicli, documenti, chatbot, ambigue) con asserzioni su nodi presenti e passaggio di L1/L2, eseguite con LLM simulato (risposte registrate) in CI e con l'LLM reale a mano.
* *Revisore:* grafi con difetti iniettati (colonna inesistente, porta scollegata, ciclo senza «Fine ciclo») devono essere riparati o segnalati.

### 8.9 Roadmap proposta

| Fase | Contenuto | Esito |
|---|---|---|
| **0** ✅ _(implementata 8 ott 2026)_ | Vista compatta del catalogo per LLM, compilatore blueprint → grafo, impaginazione, stima costi, lint L1, deny-list. Codice: `backend/app/services/agentic_assistant.py`; endpoint `GET /agentic/assistant/catalog`, `POST /agentic/assistant/compile`, `POST /agentic/assistant/lint`; test: `backend/tests/test_agentic_assistant.py` | si può generare un grafo valido da un blueprint scritto a mano |
| **1** ✅ _(implementata 8 ott 2026)_ | Intake + Architetto + Costruttore sul Canvas. Backend: `agentic_assistant_agents.py` (`POST /agentic/assistant/intake`, SSE `POST /agentic/assistant/plan`, ruoli `agentic.architect` / `agentic.reviewer`, costi nel sistema crediti, fino a 2 riparazioni del blueprint). Frontend: `AssistantPanel.tsx`, `lib/agenticAssistant.ts`, pulsante «Assistente» nello Studio, «Annulla tutto». La revisione è solo L1 (validazione statica); la prova dei nodi (L2/L3) arriva con la fase 2 | «descrivi → vedi i nodi comparire» |
| **2** | Revisore L2/L3 con riparazione; referto «provato / non provato»; ruoli modello e costi | «ora è tuo, personalizzalo» |
| **3** | Modalità modifica con patch e conferme; modalità `chatbot` con prova dell'utente simulato | assistente anche su workflow esistenti |
| **4** | Apprendimento dagli esiti (ricette frequenti → esempi few-shot), proposta di sotto-workflow riusabili | miglioramento continuo |

### 8.10 Decisioni

**Prese (8 ottobre 2026)**

1. **Due ruoli modello**: `agentic.architect` (modello capace, con ragionamento) e `agentic.reviewer` (veloce), assegnabili in *Admin → Modelli*; l'intake usa `chat.fast`.
2. **Prova dei nodi LLM nella revisione: opt-in per singolo nodo**, con tetto di spesa. Senza consenso, L2 usa valori sentinella tipizzati e il referto segna il nodo «non provato».

**Ancora aperte**

3. **SSE o job in background?** Raccomandato SSE con heartbeat (come il Coding Lab) per intake e piano; il revisore potrebbe usare i *background job* se L3 con prova LLM diventa lungo.
4. **Dove vive lo stato del piano?** Raccomandato: solo sul client + tabella `agentic_assistant_turns` per la cronologia; il grafo resta quello del workflow.
5. **Estensione del catalogo:** aggiungere ai `spec()` dei nodi un campo `when_to_use` (una riga) e, per i nodi più usati, un `example`; il documento e l'assistente ne trarrebbero entrambi beneficio.

---

## 9. Limiti noti e debito tecnico

Verificati sul codice al 8 ottobre 2026. Sono rilevanti sia per chi usa lo Studio sia per l'assistente (§8), che deve conoscerli.

| # | Limite | Effetto | Nota |
|---|---|---|---|
| 1 | **Run sincrono nella richiesta HTTP** (solo se non si usa `background`; lo Studio lo usa) | Un ciclo di molte immagini o un modello 3D può superare i timeout del proxy; se la richiesta cade, l'interfaccia non riceve il risultato | Lo stato del run si può rileggere con `GET /agentic/runs/{id}`. Soluzione: eseguire i run come *background job* (`/jobs`) |
| 2 | **`MODEL_STORE` in memoria di processo** | `ml.predict` fallisce dopo un riavvio o con più worker | Serializzare i modelli (joblib) in object storage |
| 3 | **Metriche ML sul training set** | `mae/rmse/r2`, `accuracy/precision/recall/f1` di `ml.regression/classification` sono ottimistiche; solo `cv_mean` è fuori campione | Usare `data.split` + `ml.predict` per una valutazione onesta |
| 4 | **`cachePolicy` è solo informativo** | Il campo (`auto`/`never`) è nel catalogo ma il runtime non memorizza né riusa risultati: ogni run riesegue tutto | |
| 5 | **Costi LLM dello Studio fuori dai crediti** | `ai.*`, `llm_chatbot`, verifica di «Ripeti finché» registrano solo i token in `agentic_node_runs` | `platform.images`/`models3d` sì, tramite i rispettivi servizi |
| 6 | **`data.saved_dataset` senza filtro tenant** | La lettura per `id` non verifica il tenant | Oggi mitigato dal fatto che lo Studio è solo ADMIN; da correggere |
| 7 | **`DataFrame.query/eval` e `sympy.sympify` su testo libero** | Espressioni arbitrarie valutate dal server (`data.filter`, `data.compute_column`, `math.*`) | Accettabile per un amministratore; da irrigidire prima di aprire lo Studio ad altri ruoli |
| 8 | **`nlp.sentiment` è inglese** | Su testo italiano la polarità è quasi sempre 0 | Usare `ai.transform` |
| 9 | **Cicli e chatbot non si combinano** | `loop.for_each`/`loop.collect` in un workflow con nodi chat, eseguiti dal percorso conversazionale, danno solo l'anteprima della prima riga; «Ripeti finché» nel run batch fa un solo passaggio | La validazione non lo vieta ancora |
| 10 | **Niente cicli annidati né `break`** | Un `for-each` dentro un `for-each` è rifiutato; non c'è uscita anticipata condizionata | Valutare un nodo «Interrompi se» |
| 11 | **Nome file costante nel ciclo** | `platform.images.filename` è un parametro, non una porta: tutte le immagini salvate avrebbero lo stesso nome | Rendere `filename` un ingresso opzionale |
| 12 | **`chatbot.multi_choice` ripiega sulla scelta 1** | Una risposta che non corrisponde a nessuna opzione viene interpretata come la prima | |
| 13 | **Domanda di `chatbot.ask` non interpolata** | Le `$variabili` nella domanda mostrata non sono sostituite (lo sono nell'esecutore e in `chatbot.say`) | |
| 14 | **`control.counter` non persiste** | Riparte da `start` a ogni messaggio della chat | |
| 15 | **`Stop` non interrompe le chiamate in corso** | Il controllo di annullamento avviene tra un nodo (o un ciclo) e il successivo | |
| 16 | **Output enormi nel DB** | Le immagini base64 sono salvate per intero in `agentic_node_runs.output_json` (e due volte se collegate a più nodi) | Spostare i binari in object storage e salvare solo un riferimento |
| 17 | **Test** | `test_every_local_node_executor_smoke` fallisce già prima delle ultime modifiche perché non copre diversi nodi (`data.sort`, `ai.transform`, `platform.*`, `control.repeat_until`, …) | Da aggiornare insieme alla scheda dei nodi |
| 18 | **Tipi `SERIES` e `ARRAY_3D` inutilizzati** | Sono nel registro ma nessun nodo li usa | Rimuoverli o usarli |

---

## 10. Manutenzione di questo documento

Le tabelle di porte e parametri (§5, §6) sono generate dal catalogo reale: `NODE_REGISTRY` (dopo l'import di `app.services.agentic_runtime`, che registra anche i nodi `platform.*`) e `platform_actions.ACTIONS`. Quando si aggiunge o si modifica un nodo:

1. aggiornare `spec()` in `dataflow_nodes.py` (o l'`@action` in `platform_actions.py`);
2. aggiungere l'esecutore in `execute_data_node` / `_execute`;
3. aggiornare la scheda «Comportamento» di questo documento e, se serve, §3 (validazione) e §7 (ricette);
4. aggiornare `test_every_local_node_executor_smoke` e, per i cicli, i test di `test_dataflow_nodes.py`.

Per rigenerare le tabelle: dumpare `list(NODE_REGISTRY.values())` e `[ACTIONS…]` come JSON nel container `api` e rieseguire lo script di generazione (non versionato; la sorgente dei dati è sempre il codice).
