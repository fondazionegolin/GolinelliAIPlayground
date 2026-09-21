# Analisi Tecnica dei Nodi Dataflow — Guida all'Importazione

> Documento funzionale/analitico per la migrazione delle funzionalità di analisi numerica, machine learning, chatbot e chatbot ad albero verso un'altra piattaforma.
> **Esclusi volutamente**: generazione immagini locale (Stable Diffusion/FLUX), chat Ollama locale, generazione musica AI locale, e relative varianti/backup.

---

## 1. Architettura generale

### 1.1 Modello dei tipi (`backend/core/types.py`)

- **`PortType`** (types.py:10-18): tipo di dato che transita su una porta — `TABLE` (DataFrame pandas), `SERIES`, `ARRAY_3D`, `MODEL` (oggetto sklearn), `METRICS` (dict), `PARAMS` (dict), `ANY`.
- **`ParamType`** (types.py:21-34): tipo di parametro configurabile da UI — STRING, NUMBER, INTEGER, BOOLEAN, SELECT, MULTI_SELECT, SLIDER, COLOR, FILE, CODE, COLUMN, COLUMNS.
- **`CachePolicy`** (types.py:37-41): `AUTO` (hash di input+parametri), `NEVER`, `MANUAL`.
- **`PortSpec`** (types.py:53-59): nome, tipo, label, required, descrizione di una porta.
- **`ParamSpec`** (types.py:62-76): specifica di un parametro (min/max/step/options/accept/language).
- **`NodeResult`** (types.py:79-85): output standard di un nodo — `outputs: Dict[str, Any]`, `metadata`, `preview`, `error`, `execution_time`.
- **`NodeContext`** (types.py:88-116): passato a `run()` — `node_id`, `inputs`, `params`, `cache_dir`, `global_seed`; espone `update_progress()`/`update_preview()` (eventi WebSocket).
- **`NodeSpec`** (types.py:119-133): definizione completa di un tipo di nodo (type id, label, categoria, inputs/outputs, params, cache_policy, icona/colore).
- **`NodeInstance`** (types.py:136-149): istanza concreta dentro un workflow.
- **`Edge`** (types.py:152-158): connessione `source_node/source_port → target_node/target_port`.
- **`Workflow`** (types.py:161-172): nodes + edges + seed globale + metadata.

Ogni nodo è una classe Python che estende `NodeExecutor` (`core/registry.py`), costruisce un `NodeSpec` nel costruttore, implementa `async def run(self, context: NodeContext) -> NodeResult`, e si registra globalmente con `@register_node`.

**Per un'importazione su altra piattaforma**: questo è il contratto minimo da replicare — uno schema dichiarativo per tipo-nodo (porte tipizzate + parametri tipizzati) e un'interfaccia di esecuzione asincrona uniforme che riceve input risolti e parametri e ritorna output + metadata + preview.

### 1.2 Motore di esecuzione (`backend/core/executor.py`)

- **Costruzione DAG**: `build_dag()` (executor.py:49-73) crea `{node_id: [next_node_ids]}` da nodes/edges.
- **Ordinamento topologico**: `topological_sort()` (executor.py:75-117) — algoritmo di Kahn (BFS su in-degree). Se il grafo contiene cicli, questi sono ammessi **solo** se il workflow include nodi di loop conversazionale (`chatbot.loop_until`, `llm_chatbot`, `chatbot.ask`); altrimenti viene sollevato `ValueError("Workflow contains cycles")`. È quindi un DAG con eccezione esplicita per i loop di dialogo.
- **Risoluzione input**: `get_node_inputs()` (executor.py:119-128) mappa ogni porta di input alla coppia (nodo sorgente, porta sorgente) via edge.
- **Esecuzione di un nodo** (`execute_node()`, executor.py:262-410):
  1. controllo dati bloccati/editati manualmente dall'utente (bypass esecuzione);
  2. risoluzione dell'executor dal registry;
  3. costruzione `inputs` leggendo risultati già calcolati dei nodi sorgente, creazione `NodeContext`;
  4. validazione input/parametri;
  5. se `cache_policy == AUTO`, hash (node_id + type + params + hash input) e lookup in `CacheManager`;
  6. esecuzione: nodi GPU-intensive in `ThreadPoolExecutor` dedicato con event loop separato; altri nodi con `await executor.run(context)` diretto;
  7. salvataggio cache + aggiornamento stato (`IDLE/RUNNING/CACHED/SUCCESS/ERROR`).
- **Esecuzione workflow completo** (`execute_workflow()`, executor.py:412-539): pulizia stato conversazionale, migrazione tipi legacy, calcolo ordine topologico, esecuzione sequenziale. Supporta **esecuzione incrementale**: dato un insieme `changed_nodes`, ricalcola `changed_nodes ∪ downstream(changed_nodes)` (BFS) e invalida cache solo per quei nodi.
- **Branching condizionale** (executor.py:502-516): se un edge entrante proviene da un output "inattivo" (`None`/`False` — tipico degli output booleani `yes`/`no` di `chatbot.if_contains`, `chatbot.yes_no`, `chatbot.multi_choice`), il nodo target viene permanentemente saltato. **Questo è il meccanismo che implementa l'albero decisionale del chatbot**: non è una libreria a grafo dedicata (niente `networkx`), è puro branching sul valore di output booleano propagato dal DAG stesso.
- **Comunicazione realtime**: broadcast WebSocket prima/dopo ogni nodo (`node_executing`/`node_completed`, `broadcast_chat_message`).
- **Passaggio di stato tra nodi**: per-riferimento in-process, nel dizionario `_execution_results` dell'engine (vive solo per la durata dell'esecuzione del workflow) — non tramite file/DB (eccetto la cache su disco). I nodi chatbot hanno inoltre **stato globale a livello di modulo** (`_variables`, `_conversations`, `_loop_counters` in `chatbot.py`), condiviso per session_id per tutta la vita del processo backend.
- **Stop/cancellazione**: cancella task asyncio attivi, future GPU, e sblocca eventuali attese di input utente inviando "STOP".
- **Esecuzione isolata**: `execute_node_isolated()` esegue un singolo nodo senza connessioni (per test da UI).

**Per l'importazione**: il punto critico da riprodurre è (a) il topological sort con eccezione per cicli di loop conversazionale, (b) il branching su output booleano per disattivare rami, (c) lo stato per-sessione condiviso lato server per variabili/conversazioni/contatori di loop.

### 1.3 Validazione tipi/porte

Due livelli:
1. **Statico**: l'endpoint `/api/workflow/validate` controlla che ogni tipo di nodo sia noto al registry e che il grafo non abbia cicli non ammessi.
2. **Runtime**: `validate_inputs`/`validate_params` controllano solo la presenza dei campi richiesti — **non** c'è un controllo stretto di compatibilità `PortType` tra output e input connessi. Il tipo `ANY` è usato pesantemente nei nodi chatbot per bypassare il type-check. La coerenza dei tipi è quindi largamente "by convention", non strettamente enforced.

### 1.4 API REST esposta (`backend/api/routes/workflow.py`)

| Endpoint | Funzione |
|---|---|
| `POST /api/workflow/execute` | esegue un Workflow completo (o incrementale con `changed_nodes`) |
| `POST /api/workflow/validate` | validazione statica senza esecuzione |
| `GET /api/workflow/result/{node_id}` | recupero risultato cache di un nodo |
| `POST /api/workflow/execute-node` | esecuzione isolata di un nodo singolo |
| `POST /api/workflow/stop` | stop immediato, cancella task GPU/asyncio |

---

## 2. Catalogo nodi per categoria

### 2.1 Chatbot ad albero / decision-tree (`backend/nodes/chatbot.py`)

Categoria `"chatbot"`, cache `MANUAL` (stato conversazionale non cacheabile). Stato modulo: `_conversations`, `_variables` (per session_id), `_loop_counters`. Supporto interpolazione variabili `{var}` nei testi (`replace_variables`).

| Nodo | Input | Output | Parametri | Comportamento |
|---|---|---|---|---|
| `chatbot.say` | `trigger` (opz.) | `next` | `message` | Sostituisce variabili, broadcast WS con effetto "typing", attesa 1s, propaga messaggio. |
| `chatbot.ask` | `trigger` (opz.) | `response` | `question`, `test_response` | Chiede input utente via WS, crea `asyncio.Future` in `chat_pending_input[session_id]`, attende max 60s (fallback `test_response` a timeout), gestisce comando STOP. |
| `chatbot.if_contains` | `text` | `yes`, `no` (booleani) | `keywords` (CSV), `case_sensitive` | Verifica presenza di keyword nel testo; attiva un ramo — l'output booleano disattivato viene usato dall'executor per potare il ramo non scelto. |
| `chatbot.multi_choice` | `trigger` (opz.) | `choice_1..4` (booleani) | `question`, `option_1..4`, `test_choice` | Menu a 4 opzioni via WS, input numerico 1-4 (regex fallback), attiva un solo output → nodo classico a più rami dell'albero decisionale. |
| `chatbot.end` | `trigger` (opz.) | – | `message` | Messaggio finale + evento `chat_end`, termina il flusso. |
| `chatbot.yes_no` | `trigger` (opz.) | `yes`, `no` | `question`, `test_answer` | Domanda binaria, riconoscimento tramite lista keyword (sì/si/yes/y/ok/certo…). |
| `chatbot.save_variable` | `value` | `next` | `variable_name`, `session_id` | Converte tipi numpy→nativi, salva in `_variables[session_id][name]` — variabile riusabile via `{nome}`. |
| `chatbot.show_variables` | `trigger` (opz.) | `variables` | `session_id` | Debug: espone il dict variabili di sessione. |
| `chatbot.loop_until` | `value` | `continue_loop`, `exit_loop` | `condition_type` (contains/equals/not_contains/not_equals), `condition_value`, `max_iterations`, `loop_id` | Loop controllato: contatore per `loop_id`, verifica condizione, continua o esce; crea ciclo intenzionale nel DAG con limite anti-loop-infinito. |

Estensioni (`chatbot_extensions.py`): `chatbot.text_output` (output testo formattato), `chatbot.voice_input` (input vocale).

**Chatbot LLM via API cloud** (`backend/nodes/llm_chatbot.py:31-459`), nodo `llm_chatbot`, categoria `"chatbot"`, cache `NEVER`:

- Input: `message`, `trigger`, `docs` (per RAG), `loop` (tutti opzionali, ANY).
- Output: `response` (dict: message/provider/model/tokens_used), `next` (per concatenare a `chatbot.say`).
- Parametri: `llm_provider` (openai/anthropic), `model` (gpt-4o-mini/gpt-4o/gpt-3.5-turbo/claude-haiku-4-5), `system_prompt`, `temperature`, `max_tokens`, `max_length`, `typing_effect`, `user_message` (placeholder `{var}`, `{var.key}`, `{var[0]}`), `session_id`, `rag_enabled`, `rag_top_k`.
- Logica: risoluzione messaggio con priorità parametro > input `message` > input `trigger` > default; sostituzione variabili sessione; se `rag_enabled` e `docs` presente → `find_relevant_chunks` (rag.py) per iniettare chunk rilevanti nel system prompt; chiamata API OpenAI/Anthropic; troncamento a `max_length`; broadcast con effetto typewriter (delay calcolato su n. parole).
- Librerie: `openai`, `anthropic`.

### 2.2 RAG (`backend/nodes/rag.py`)

- `DocumentChunker.chunk_text` (rag.py:32-59): chunking a finestra fissa con overlap, che tenta di interrompere su fine frase/newline.
- `DocumentProcessor` (rag.py:62-116): estrazione testo da PDF (PyPDF2/pypdf), DOCX (python-docx), TXT; hash MD5 per deduplica.
- `rag.upload_docs` (rag.py:119-297), categoria `"chatbot"`, cache `MANUAL`:
  - Output: `docs` (document store con chunk+embedding), `metadata`.
  - Parametri: `files` (upload multiplo .pdf/.docx/.txt), `chunk_size`, `chunk_overlap`, `embedding_model` (text-embedding-3-small/large, ada-002).
  - Logica: per ogni file → estrazione, chunking, `OpenAI().embeddings.create()` per chunk, costruzione doc_store (`chunks`, `embeddings`, `metadata`).
- `find_relevant_chunks` (rag.py:300-330, funzione helper non nodo): embedding della query, normalizzazione vettori, similarità coseno (dot product, numpy) contro tutti i chunk, ritorna top-k con score.
- Librerie: `openai`, `PyPDF2`/`pypdf`, `python-docx`, `numpy`.

### 2.3 NLP (`backend/nodes/nlp.py`)

- `nlp.sentiment` (nlp.py:15-142), categoria `"transform"`: `TextBlob` per `polarity` (-1..1) per riga; soglia di neutralità configurabile → positive/negative/neutral; statistiche di distribuzione.
- `nlp.clean_text` (nlp.py:145-379): pulizia configurabile (lowercase, punteggiatura, numeri, spazi extra) + funzione `_extract_number` (righe 291-378): rimozione simboli valuta (regex Unicode multi-valuta), codici valuta, unità di misura, normalizzazione separatori decimali/migliaia con auto-detect formato europeo/US/svizzero.

### 2.4 Machine Learning (`ml.py`, `clustering.py`, `encoding.py`, `smart_encoding.py`)

Categoria `"machine_learning"`, dipendenza principale `scikit-learn` + `plotly` per grafici.

| Nodo | I/O | Algoritmi | Note |
|---|---|---|---|
| `ml.regression` (ml.py:30-283) | `train`(TABLE) → `model`, `metrics`, `predictions` | linear, ridge, lasso, random_forest, gradient_boosting, svr, knn | MAE/MSE/RMSE/R², cross-validation (`cross_val_score`, r2), gestione NaN (drop righe), residual plot plotly. Parametri: `target_column`, `feature_columns` (auto-numeriche), `alpha`, `n_estimators`/`max_depth`, `cv_folds`. |
| `ml.classification` (ml.py:287-485) | `train` → `model`, `metrics`, `predictions` | logistic, random_forest, gradient_boosting, svc, knn, naive_bayes | accuracy/precision/recall/f1 (binaria/weighted), confusion matrix, cross-validation, ROC-AUC (caso binario), heatmap plotly. |
| `ml.predict` (ml.py:489-575) | `model`+`data` → dati con predizione | — | Verifica feature via `model.feature_names_in_`, aggiunge colonna `prediction` + probabilità per classe se disponibili. |
| `ml.text_predict` (ml.py:802-883) | train+predict testuali → predizioni | TF-IDF + MultinomialNB | Colonna `predicted_class` + probabilità. |
| `ml.text_classification` (ml.py:578-799) | — | TF-IDF/CountVectorizer + naive_bayes/logistic/random_forest/svm | **Attualmente disattivato** nel registry (decorator commentato), sostituito da `ml.classification`. |
| `ml.kmeans_clustering` (clustering.py:18-465) | table → table con `cluster`, plot | `KMeans` | Normalizzazione opzionale (`StandardScaler`), auto-detect K (test K=2..max_k_search, inertia + `silhouette_score`, metodo del gomito su derivata seconda), `davies_bouldin_score`, scatter 2D/3D con centroidi. |
| `encoding.auto_encode` | — | `LabelEncoder`/`OrdinalEncoder` + `KMeans` per raggruppamento valori simili | Encoding automatico colonne categoriali. |
| `ml.smart_encoding` (smart_encoding.py) | — | suggerimento strategia (LabelEncoder/StandardScaler/MinMaxScaler) via API Anthropic | Usa API cloud, non generazione locale. |

### 2.5 Analisi numerica (`math.py`, `math_equation.py`)

Categoria `"mathematics"`.

| Nodo | Funzione |
|---|---|
| `math.operation` (math.py:33-289) | Calcolatrice generica a 2 input (numero/DataFrame/Series/array): binarie (add/subtract/multiply/divide/power/root/modulo/percentage), unarie (absolute/negate/reciprocal/square/cube/sqrt/exp/log/log10/sin/cos/tan/floor/ceil/round). Gestione robusta inf/NaN, conversione automatica tipo (`to_numeric`). Libreria `numpy`. |
| `math.numeric_input` (math.py:293-365) | Nodo sorgente: inietta valore numerico costante, con validazione inf/nan. |
| `math.result` (math.py:369-513) | Estrae aggregazione (first/last/mean/sum/min/max/median/std/all) da input tabellare/numerico. |
| `math.aggregate` (math.py:516-621) | Combina fino a 3 input (concat verticale o affiancamento colonne), statistiche (mean/sum/min/max/std). |
| `math.equation` (math_equation.py:18-110) | Parsing espressione simbolica testuale (`sympy.parse_expr`/`sympify`, moltiplicazione implicita), genera funzione numerica con `lambdify` (backend numpy), rappresentazione LaTeX. |
| `math.plot_equation` (math_equation.py:113-233) | Valuta funzione su range (`np.linspace`), grafico 2D plotly. |
| `math.evaluate` (math_equation.py:236-323) | Valuta f(x) su lista di x (CSV param o input tabellare/array). |
| `math.function_analysis` (math_equation.py:326-451) | Analisi simbolica completa: derivata (`sympy.diff`), integrale (`sympy.integrate`), punti critici (`solve(derivata=0)`), zeri (`solve(expr, x)`). |
| `math.regression_to_equation` (math_equation.py:454-546) | Converte coefficienti di regressione (lineare/polinomiale/esponenziale) in espressione sympy con LaTeX — un modello ML diventa formula esplicita leggibile. |

Librerie: `sympy`, `numpy`, `plotly`.

### 2.6 Trasformazione dati (`backend/nodes/transform.py`)

Categoria `"transform"`, cache `AUTO`. Librerie: `pandas`, `numpy`, `sklearn.preprocessing`, `sklearn.model_selection.train_test_split`.

| Nodo | I/O | Parametri chiave | Comportamento |
|---|---|---|---|
| `data.select` | table→table | mode (include/exclude), columns | Selezione/esclusione colonne. |
| `data.filter` | table→table | expression (CODE python) | `df.query()`. |
| `data.transform` | table→table | operation (standardize/minmax/robust/log/sqrt/fillna), columns, fill_value | Scaling (`StandardScaler/MinMaxScaler/RobustScaler`), log1p/sqrt, imputazione NA (mean/median/mode/valore fisso). |
| `data.split` | table→train,test | test_size, stratify_column, seed | Wrapper `train_test_split` con stratificazione opzionale e seed globale. |
| `data.dropna` | table→table | axis, how, threshold | `df.dropna()` con soglia. |
| `data.slice` | table→table | start, end, step | `iloc[start:end:step]`. |
| `data.merge_columns` | table_1..4→table | merge_mode (horizontal/vertical), handle_duplicates, align_rows | Combina fino a 4 tabelle, orizzontale (concat colonne, padding NaN) o verticale (stack righe). |
| `data.sort_columns` | table→table | column_order | Riordina colonne (drag&drop), append colonne non specificate. |
| `data.convert_to_number` | table→table | columns, target_type, errors, decimal_separator, thousands_separator | Parsing numerico avanzato con auto-detect formato europeo/US, conversione Int64/float64, statistiche di conversione. |

### 2.7 Nodi di supporto

- **`sources.py`**: `csv.load` (caricamento CSV), `csv.synthetic` (dataset sintetici via `sklearn.datasets.make_classification/make_regression/make_blobs/make_moons/make_circles`), `data.custom_input` (input manuale).
- **`control_flow.py`**: `control.repeat`, `control.if_else`, `control.counter` — primitive generiche di controllo flusso, utilizzabili anche fuori dal contesto chatbot.
- **`comparison.py`**: `control.compare_numbers` — confronto numerico per branching.
- **`visualization.py`**: `plot.2d`, `plot.3d`, `plot.histogram`, `plot.row_histogram` (`plotly.express`/`graph_objects`).
- **`ai_sources.py`** (incluso, API cloud non locali): `ai.generate_dataset` (genera dataset sintetici via prompt a GPT/Claude, cache su disco con hash MD5); `ai.load_dataset` (carica dataset AI generati salvati in precedenza).

---

## 3. Esempi di workflow tipici

### 3.1 Analisi numerica + regressione (numeric analysis / ML training)

```
csv.load → data.dropna → data.transform (standardize) → data.split (80/20, seed fisso)
        → ml.regression (algorithm=random_forest, target_column=prezzo)
        → metrics (MAE/R²) + predictions
        → ml.predict (applica model al set test per validazione out-of-sample)
```
Opzionale: `math.regression_to_equation` trasforma i coefficienti di un modello lineare in formula sympy, visualizzabile con `math.plot_equation`.

### 3.2 Clustering + visualizzazione (unsupervised ML)

```
csv.load → data.select (feature numeriche) → ml.kmeans_clustering (auto_k=true, normalize=true)
        → tabella con colonna cluster + scatter 2D/3D con centroidi
        → metriche di qualità (silhouette, Davies-Bouldin) nel preview del nodo
```

### 3.3 Chatbot ad albero decisionale

```
chatbot.say ("Benvenuto, cosa vuoi fare?")
  → chatbot.multi_choice (4 opzioni: Informazioni/Supporto/Ordine/Esci)
      choice_1 → chatbot.say (info) → chatbot.save_variable → chatbot.end
      choice_2 → chatbot.ask ("Descrivi il problema")
               → chatbot.if_contains (keyword "urgente")
                    yes → llm_chatbot (system_prompt dedicato) → chatbot.say
                    no  → chatbot.save_variable → chatbot.end
      choice_4 → chatbot.end
```
L'executor disattiva automaticamente i rami non selezionati (propagazione output booleano `False`/`None`), realizzando la navigazione ad albero. `chatbot.loop_until` può richiudere il flusso su `chatbot.ask` per menu ripetuti, con limite anti-loop-infinito.

### 3.4 RAG conversazionale

```
rag.upload_docs (PDF/DOCX, chunk_size=1000, embedding_model=text-embedding-3-small)
  → docs (document store con embedding)
chatbot.ask (domanda utente) → llm_chatbot (docs collegato, rag_enabled=true, rag_top_k=3)
  → recupero chunk più simili via cosine similarity, iniezione nel system prompt
  → chatbot.say (risposta)
  → eventuale loop con chatbot.loop_until per conversazione multi-turno
```

---

## 4. Considerazioni per l'importazione su altra piattaforma

1. **Schema dichiarativo minimo da portare**: `PortSpec`/`ParamSpec`/`NodeSpec` — porte tipizzate (anche se il type-check è debole/by-convention, va comunque dichiarato) + parametri tipizzati con vincoli UI.
2. **Motore DAG**: topological sort (Kahn) + eccezione esplicita per cicli quando il workflow contiene nodi di loop conversazionale — non serve una libreria a grafo dedicata, basta gestire l'eccezione sui tipi di nodo noti.
3. **Branching ad albero**: nessuna struttura ad albero dedicata — è puro side-effect del DAG, dove un output booleano `False`/`None` fa saltare permanentemente il nodo a valle collegato a quella porta. Semplice da riportare: basta che l'engine target supporti "skip nodo se input arriva da porta disattivata".
4. **Stato conversazionale**: va replicato uno stato server-side per session_id (variabili, storicizzazione conversazione, contatori di loop) — nel progetto originale è stato di modulo Python in-process; su altra piattaforma conviene esternalizzarlo (Redis/DB) se si vuole scalare oltre singolo processo.
5. **Cache**: hash di (node_id + type + params + hash input) → riuso risultato. Utile per nodi costosi (regressione, clustering, embedding) ma non per nodi chatbot (cache `MANUAL`/`NEVER`).
6. **Dipendenze da portare**: `pandas`, `numpy`, `scikit-learn`, `sympy`, `plotly`, `TextBlob`, `openai`, `anthropic`, `PyPDF2`/`pypdf`, `python-docx`.
7. **Esecuzione incrementale**: ricalcolo di `changed_nodes ∪ downstream(changed_nodes)` — utile in editor interattivo per non rieseguire tutto il grafo a ogni modifica.
