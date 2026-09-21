# GOLIAI Agentic Workflow Studio

## Analisi tecnica, architettura e concept di prodotto

**Versione:** Concept / Technical Analysis
**Data:** Settembre 2026
**Progetto:** GOLIAI

---

## 1. Visione

L'obiettivo è introdurre in GOLIAI un ambiente visuale per la progettazione, esecuzione e osservazione di **workflow agentici a nodi**, concettualmente vicino a strumenti come n8n, ma progettato specificamente per l'orchestrazione di sistemi AI e per un utilizzo educativo.

L'utente deve poter costruire graficamente workflow collegando nodi che rappresentano:

- modelli AI;
- agenti;
- strumenti;
- servizi esterni;
- elaborazioni di documenti;
- ricerche online;
- esecuzione di codice;
- condizioni;
- loop;
- interventi umani;
- altri workflow.

Il sistema non deve limitarsi all'automazione lineare di task. L'elemento caratterizzante è la possibilità di creare **sistemi realmente agentici**, nei quali uno o più agenti possano ricevere un obiettivo, analizzare lo stato corrente, scegliere gli strumenti, eseguire azioni, osservare i risultati, valutarli e iterare fino al raggiungimento dell'obiettivo o di un limite imposto.

L'intero processo deve rimanere **visualizzabile, modificabile, verificabile e controllabile dall'utente**.

---

## 2. Principio fondamentale: Node ≠ Agent

È importante distinguere tra **nodo**, **tool** e **agente**.

| Categoria | Funzione | Esempio |
|---|---|---|
| Function | Esegue una trasformazione deterministica | Convert PDF |
| Connector | Comunica con un servizio | Gmail |
| AI | Esegue una singola inferenza | Summarize |
| Agent | Decide autonomamente quali azioni compiere | Research Agent |
| Control | Governa il flusso | IF, Loop, Approval |

Un workflow `START → Web Search → LLM Summarizer → PDF Generator → END` è un AI workflow, ma non necessariamente un workflow agentico.

Un sistema realmente agentico potrebbe invece essere:

```text
START
  ↓
RESEARCH AGENT
  ├── Web Search
  ├── Web Reader
  ├── Knowledge Base
  └── PDF Reader
  ↓
WRITER AGENT
  ↓
FACT CHECKER
  ↓
PDF GENERATOR
```

Il Research Agent decide autonomamente quando e come utilizzare i tool messi a sua disposizione.

---

## 3. Agent Node

Il nodo `Agent` costituisce una delle primitive principali del sistema.

Ogni Agent Node dovrebbe poter configurare:

- Goal
- Model
- System instructions
- Tools disponibili
- Memory
- Max iterations
- Timeout
- Token budget
- Cost budget
- Stop condition
- Output schema

L'agente riceve concettualmente:

```text
GOAL
+
CONTEXT
+
AVAILABLE TOOLS
+
CONSTRAINTS
```

e produce una sequenza di azioni.

---

## 4. Agent + Tools

È preferibile separare l'**AGENT** dai **TOOLS**, invece di creare necessariamente un "Google Agent", "Gmail Agent", "PDF Agent", ecc.

```text
              ┌── Web Search
              ├── Web Reader
RESEARCH ─────┼── Google Drive
AGENT         ├── PDF Reader
              └── Python
```

Il collegamento significa: **questo agente è autorizzato a utilizzare questi strumenti**.

Questa separazione permette di creare agenti molto diversi utilizzando la stessa infrastruttura.

---

## 5. Tool Registry

GOLIAI dovrebbe disporre di un **Tool Registry centralizzato**.

```text
GOLIAI TOOL REGISTRY

├── Native Tools
├── GOLIAI Tools
├── REST APIs
├── MCP Servers
├── External Services
└── Custom Tools
```

Ogni tool dovrebbe dichiarare almeno:

```text
id
name
description
category
input_schema
output_schema
permissions
authentication
execution_endpoint
timeout
retry_policy
cost_information
```

L'Agent Runtime può interrogare il registry per determinare quali strumenti sono disponibili.

---

## 6. MCP e servizi esterni

Il Model Context Protocol può rappresentare uno dei principali sistemi di estensione dell'ecosistema.

```text
GOLIAI
   │
   ▼
TOOL REGISTRY
   │
   ├── Native Tools
   ├── REST Tools
   └── MCP
        ├── Google services
        ├── GitHub
        ├── Databases
        ├── Filesystem
        └── Custom services
```

L'obiettivo è poter collegare progressivamente nuovi servizi senza modificare il motore dei workflow.

---

## 7. Catalogo dei nodi

### AI

- LLM
- Agent
- Planner Agent
- Evaluator
- Critic
- Classifier
- Structured Extraction
- Summarizer
- Translator
- Embedding
- Vision
- Image Understanding
- Image Generation
- Speech-to-Text
- Text-to-Speech

### Research

- Web Search
- Google Search
- Web Reader
- URL Extractor
- Academic Search
- News Search
- Wikipedia
- Knowledge Base Search
- Fact Checker
- Source Validator
- Citation Generator
- Deep Research

### Documents

- PDF Reader / Generator / Editor
- DOCX Reader / Generator / Editor
- PowerPoint Reader / Generator / Editor
- Spreadsheet Reader / Generator / Editor
- Markdown
- HTML
- CSV
- JSON

Questi nodi possono essere integrati direttamente con gli editor documentali presenti in GOLIAI.

### Google ecosystem

- Gmail
- Google Drive
- Google Docs
- Google Sheets
- Google Slides
- Google Calendar
- Google Classroom
- YouTube
- Google Search

### Microsoft ecosystem

- Outlook
- OneDrive
- Word
- Excel
- PowerPoint
- Teams
- SharePoint
- Calendar

### Developer tools

- Code Agent
- Python
- JavaScript
- HTTP Request
- REST API
- GraphQL
- Webhook
- GitHub
- GitLab
- Database Query
- SQL
- Docker
- SSH
- JSON Transformer
- Regex

### Media

- Image Generator
- Image Editor
- OCR
- Computer Vision
- Text-to-Speech
- Speech-to-Text
- Video Generator
- FFmpeg
- ElevenLabs
- YouTube
- 3D Generator

### Control Flow

- START / END
- IF / ELSE
- SWITCH
- ROUTER
- LOOP
- FOR EACH
- WAIT / DELAY
- MERGE / SPLIT
- RETRY
- ERROR HANDLER
- HUMAN APPROVAL
- VARIABLE
- MEMORY
- SUBWORKFLOW
- SCHEDULE
- WEBHOOK

---

## 8. Typed Data Flow

I nodi non dovrebbero scambiarsi esclusivamente testo. Ogni collegamento dovrebbe trasportare un oggetto tipizzato.

```json
{
  "type": "research_result",
  "content": "...",
  "sources": [],
  "metadata": {},
  "files": [],
  "confidence": 0.82
}
```

Possibili tipi:

```text
text
number
boolean
json
structured_data
file
document
pdf
presentation
spreadsheet
image
audio
video
dataset
email
message
search_results
research_result
code
```

Ogni nodo dichiara `INPUT TYPES` e `OUTPUT TYPES`. L'editor può quindi verificare automaticamente la compatibilità tra nodi e suggerire eventuali trasformazioni intermedie.

---

## 9. Planner Agent e generazione dei workflow

Una delle funzioni più interessanti può essere il **Planner Agent**.

L'utente può scrivere:

> Preparami un report sulle applicazioni dell'AI nella scuola italiana, verifica le informazioni e mandamelo via email.

Il Planner interpreta l'obiettivo e genera:

```text
START
 ↓
Web Search
 ↓
Academic Search
 ↓
Compare Sources
 ↓
Generate Outline
 ↓
Write Report
 ↓
Fact Check
 ↓
Generate PDF
 ↓
Human Approval
 ↓
Gmail
 ↓
END
```

Il piano generato viene trasformato in un **graph reale e modificabile**.

Il paradigma diventa:

```text
PROMPT
  ↓
PLANNER
  ↓
WORKFLOW GENERATION
  ↓
USER INSPECTION
  ↓
EXECUTION
```

---

## 10. Workflow dinamico

Un livello successivo consiste nel permettere agli agenti di modificare il graph durante l'esecuzione.

Se un verificatore determina che le informazioni non sono sufficienti, può richiedere l'aggiunta di una nuova ricerca o di un diverso strumento.

La modalità dovrebbe essere esplicitamente autorizzata:

```text
Workflow mutation

( ) Disabled
( ) Suggest changes
( ) Allowed within limits
```

La modalità **Suggest changes** è particolarmente interessante in ambito educativo perché permette di osservare le modifiche proposte prima di applicarle.

---

## 11. Agent Loop

Una primitive importante può essere `AGENT LOOP`.

Configurazione possibile:

```text
GOAL
"Trova almeno cinque fonti affidabili sull'argomento."

TOOLS
Web Search
Academic Search
Web Reader

SUCCESS CONDITION
>= 5 reliable sources
AND
>= 3 independent domains

MAX ITERATIONS
10

MAX TOKENS
50,000

MAX COST
€0.50

TIMEOUT
5 minutes
```

Runtime:

```text
PLAN
 ↓
SELECT ACTION
 ↓
EXECUTE TOOL
 ↓
OBSERVE
 ↓
EVALUATE
 ↓
SUCCESS?
 ├── YES → END
 └── NO → LOOP
```

Ogni agente deve avere limiti espliciti: iterazioni, token, costo, timeout, tool autorizzati, azioni autorizzate e condizioni di arresto.

---

## 12. Human-in-the-loop

L'intervento umano dovrebbe essere una primitive centrale.

```text
Research
 ↓
Write Email
 ↓
HUMAN APPROVAL
 ↓
Send Gmail
```

L'utente può:

- APPROVE
- EDIT
- REJECT

Questo meccanismo è particolarmente importante per comunicazioni esterne, pubblicazione, cancellazione, modifica di dati e altre operazioni sensibili.

### Action Risk Levels

Ogni tool potrebbe dichiarare un livello di rischio:

| Livello | Significato |
|---|---|
| 0 | Read only |
| 1 | Generate content |
| 2 | Modify internal data |
| 3 | External communication |
| 4 | Destructive / sensitive action |

Il sistema può richiedere automaticamente approvazione sopra una determinata soglia.

---

## 13. Workflow Definition vs Workflow Execution

Un workflow è una **definizione**. Una Run è una **istanza esecutiva**.

```text
ResearchReport

v1  Search → Write
v2  Search → Verify → Write
v3  Search → Verify → Write → PDF
```

Una run partita utilizzando `v2` deve continuare a utilizzare quella versione. Una nuova run potrà utilizzare `v3`.

Ogni modifica significativa può creare una nuova versione con funzioni come:

- View diff
- Restore version
- Duplicate
- Fork
- Publish
- Draft

---

## 14. Checkpoint, Replay e Fork

Durante l'esecuzione il sistema salva periodicamente:

```text
workflow_version
node_state
variables
agent_memory
tool_results
artifacts
execution_history
```

Questo permette recovery, pause/resume, debugging, replay, fork e human approval.

Una run dovrebbe essere osservabile come timeline:

```text
RUN #1432

00:00 START
00:02 Planner
00:07 Search
00:11 Search
00:16 Reader
00:21 Agent decision
00:24 Search
00:31 Verify
00:40 Writer
00:58 PPT
01:03 Human Approval
01:42 Gmail
```

Da un checkpoint deve essere possibile eseguire **FORK FROM HERE**, ad esempio per confrontare due modelli o due strategie diverse.

---

## 15. Subworkflow e Workflow Library

Un gruppo di nodi:

```text
Search
 ↓
Read
 ↓
Validate
 ↓
Summarize
```

può essere trasformato in un componente riutilizzabile:

```text
DEEP RESEARCH
```

con input `topic` e output `research_result`.

GOLIAI potrebbe quindi avere una libreria di workflow e subworkflow:

- Deep Research
- Scientific Review
- Fact Checker
- Presentation Generator
- Lesson Generator
- Quiz Generator
- Student Assessment
- Podcast Generator
- Video Lesson Generator
- Data Analysis
- Literature Review

Gli utenti possono usare, duplicare e personalizzare questi workflow.

---

## 16. Observability

Una caratteristica centrale dovrebbe essere la possibilità di osservare l'esecuzione in tempo reale.

```text
✓ Search
   ↓
✓ Read Sources
   ↓
● Research Agent
   ↓
○ Fact Checker
   ↓
○ PPT Generator
```

Legenda:

```text
✓ completed
● running
○ waiting
⚠ warning
✕ error
```

Cliccando su un agente durante l'esecuzione si possono mostrare:

```text
STATUS
Running

ITERATION
4 / 10

GOAL
Find reliable information about...

LAST ACTION
Web Search

ACTION RATIONALE
Only two independent sources are currently available.

NEXT ACTION
Search academic sources.

TOKENS
12,420

COST
€0.07

ELAPSED
00:43
```

È importante mostrare **decisioni operative e motivazioni sintetiche**, non il chain-of-thought interno del modello.

---

## 17. Execution Log ed Error Handling

Ogni evento dovrebbe produrre un log strutturato:

```json
{
  "timestamp": "...",
  "workflow": "...",
  "run": "...",
  "node": "...",
  "event": "tool_call",
  "tool": "web_search",
  "duration": 1.24,
  "status": "success"
}
```

Ogni nodo può definire una strategia `ON ERROR`:

- Stop workflow
- Retry
- Retry N times
- Ignore
- Fallback node
- Alternative route
- Ask user
- Ask agent

---

## 18. Memory e Variables

È utile distinguere:

- **Node Memory** — esclusiva del nodo;
- **Agent Memory** — persistente durante il loop;
- **Workflow Memory** — condivisa dalla run;
- **Persistent Memory** — disponibile tra esecuzioni;
- **User Memory** — utilizzabile secondo permessi espliciti.

Il workflow deve inoltre poter utilizzare variabili:

```text
{{user.name}}
{{workflow.topic}}
{{research.sources}}
{{previous_node.output}}
{{current_date}}
```

---

## 19. Secrets e Permission System

API key e credenziali non devono essere memorizzate direttamente nei nodi. Serve un **Secrets Manager**.

Esempi:

```text
OPENAI_API_KEY
GOOGLE_OAUTH
ELEVENLABS_API
GITHUB_TOKEN
```

Un workflow dovrebbe inoltre dichiarare chiaramente le proprie capacità:

```text
THIS WORKFLOW CAN:

[x] Search the web
[x] Read Google Drive
[x] Generate documents
[x] Execute Python

[ ] Send email
[ ] Delete files
[ ] Publish online
```

---

## 20. Trigger e Scheduler

I workflow possono essere eseguiti:

- manualmente;
- su schedule;
- su evento;
- tramite webhook;
- da un altro workflow.

Possibili trigger:

- Manual
- Schedule
- Webhook
- Email received
- File uploaded
- Drive file modified
- Calendar event
- Form submission
- API call
- GOLIAI event
- Classroom event

---

## 21. Architettura logica

```text
                    GOLIAI
                       │
          ┌────────────┴────────────┐
          │                         │
   WORKFLOW EDITOR             RUN MONITOR
          │                         │
          └────────────┬────────────┘
                       │
                  GRAPH ENGINE
                       │
        ┌──────────────┼──────────────┐
        │              │              │
     AGENTS          TOOLS         CONTROL
        │              │              │
     LLM Runtime    Tool Registry    HITL
                       │
          ┌────────────┼────────────┐
          │            │            │
       Native         MCP          API
```

### Tre layer fondamentali

**Graph Engine**

Gestisce nodes, edges, routing, conditions, loops, state, checkpoints ed execution.

**Agent Runtime**

Gestisce models, goals, planning, tool selection, memory, iterations ed evaluation.

**Tool Registry**

Gestisce tools, connectors, MCP, API, permissions, schemas e credentials.

Questa separazione è fondamentale per l'estendibilità del sistema.

---

## 22. Execution Infrastructure

Sotto il Graph Engine servono componenti dedicati:

```text
Execution Engine

├── Queue
├── Worker
├── State Store
├── Checkpoint Store
├── Scheduler
├── Retry Manager
├── Secrets Manager
├── Artifact Store
├── Logs
└── Tracing
```

---

## 23. Artifact Store

I workflow produrranno artifact come PDF, DOCX, PPTX, immagini, audio, video, dataset, codice e JSON.

Questi non dovrebbero necessariamente transitare integralmente tra i nodi. Il workflow può passare riferimenti:

```json
{
  "artifact_id": "art_28372",
  "type": "presentation",
  "url": "...",
  "metadata": {}
}
```

L'Artifact Store gestisce i file effettivi.

---

## 24. UI principale

```text
┌────────────────────────────────────────────────────────────┐
│ Agentic Workflow                         ▶ RUN    SAVE     │
├────────────┬───────────────────────────────────┬───────────┤
│ NODES      │          CANVAS                   │ INSPECTOR │
│            │                                   │           │
│ AI         │     ┌────────┐                    │ Agent     │
│ Agent      │     │Planner │                    │ Model     │
│ LLM        │     └───┬────┘                    │ Tools     │
│ Vision     │         │                         │ Memory    │
│            │    ┌────┴────┐                    │ Limits    │
│ Research   │    ↓         ↓                    │ Output    │
│ Search     │ [Web]     [Drive]                 │           │
│ Reader     │    ↓         ↓                    │           │
│            │    └────┬────┘                    │           │
│ Documents  │         ↓                         │           │
│ PDF        │      [Writer]                     │           │
│ PPT        │         ↓                         │           │
│            │       [PPT]                       │           │
│ Control    │         ↓                         │           │
│ IF         │     [Approval]                    │           │
│ Loop       │         ↓                         │           │
│ Approval   │      [Gmail]                      │           │
└────────────┴───────────────────────────────────┴───────────┘
```

---

## 25. Build Mode e Learn Mode

### Build Mode

Focus su:

- nodes;
- connections;
- configuration;
- debugging;
- execution;
- deployment.

### Learn Mode

La modalità educativa rende osservabile il comportamento dell'agente:

```text
INPUT
↓
GOAL
↓
PLAN
↓
ACTION
↓
OBSERVATION
↓
EVALUATION
↓
NEXT ACTION
```

L'obiettivo non è soltanto **usare un agente**, ma comprendere come un sistema agentico scompone un problema, utilizza strumenti, osserva risultati e modifica la propria strategia.

Lo studente può osservare, modificare, interrompere, confrontare, fare fork, cambiare modello, rimuovere strumenti e modificare limiti.

---

## 26. Experiment Mode

Una possibile evoluzione consiste nell'introdurre una modalità sperimentale:

```text
                    Research
                       │
             ┌─────────┴─────────┐
             │                   │
          Agent A             Agent B
             │                   │
             └─────────┬─────────┘
                       │
                   Evaluator
```

L'utente può confrontare:

- qualità;
- numero di iterazioni;
- fonti;
- execution time;
- token usage;
- costo;
- tool calls.

Questo trasforma il workflow editor anche in un laboratorio per studiare sistemi AI.

---

## 27. Workflow Templates

### Deep Research

```text
Topic
 ↓
Research Agent
 ↓
Fact Checker
 ↓
Report
```

### Presentation Generator

```text
Topic
 ↓
Research
 ↓
Outline
 ↓
Slide Writer
 ↓
Image Generator
 ↓
PPT Generator
```

### Lesson Generator

```text
Learning Goal
 ↓
Research
 ↓
Lesson Planner
 ↓
Content Generator
 ↓
Quiz Generator
 ↓
Teacher Approval
```

### Automated Briefing

```text
Schedule
 ↓
News Search
 ↓
Filter
 ↓
Summarizer
 ↓
PDF
 ↓
Email
```

---

## 28. Natural Language Workflow Creation

L'utente dovrebbe poter creare workflow anche senza trascinare manualmente i nodi.

Esempio:

> Ogni venerdì cerca le principali novità sull'AI nella scuola, seleziona cinque notizie, crea un briefing e mandamelo.

Il sistema genera il graph corrispondente, che rimane completamente modificabile.

---

## 29. Workflow Copilot

Un AI assistant può accompagnare l'utente nell'editor.

Esempio:

> Aggiungi una verifica delle fonti prima della generazione del PDF.

Il sistema propone:

```text
BEFORE
Research → PDF

AFTER
Research → Fact Checker → PDF
```

e chiede conferma della modifica.

Si combinano così:

```text
Visual Programming
+
Natural Language Programming
```

---

## 30. MVP

Il primo MVP dovrebbe validare il modello concettuale, senza partire da decine di connector.

Primitive suggerite:

```text
START
LLM
AGENT
TOOL
WEB SEARCH
HTTP / API
KNOWLEDGE BASE
PYTHON / CODE
IF
LOOP
HUMAN APPROVAL
DOCUMENT OUTPUT
SUBWORKFLOW
END
```

### Editor

- drag & drop;
- connessione tra nodi;
- inspector;
- salvataggio graph;
- duplicazione nodi;
- gruppi;
- zoom;
- minimap.

### Runtime

- esecuzione graph;
- stato condiviso;
- tool calling;
- loop;
- condizioni;
- retry;
- timeout.

### Agent

- goal;
- model;
- tool selection;
- iteration;
- stop condition;
- budget.

### Observability

- stato dei nodi;
- execution log;
- tool calls;
- token usage;
- errori;
- timeline.

### Safety

- permissions;
- approval;
- iteration limit;
- cost limit;
- timeout.

---

## 31. Roadmap successiva

### Fase 2

- Planner Agent
- Workflow generation
- Workflow Copilot
- Dynamic workflow mutation
- Checkpoint
- Replay
- Fork
- Versioning
- Scheduler
- Webhook
- MCP
- External connectors

### Fase 3

- Workflow Library
- Custom Nodes
- Workflow Marketplace
- Community Templates
- Collaborative Editing
- Agent Teams
- Persistent Agents
- Event-driven Agents
- Educational Experiment Mode
- Analytics
- Workflow Evaluation

---

## 32. Stack concettuale

Senza vincolare ancora l'implementazione a una tecnologia specifica:

```text
Visual Graph Editor
        ↓
Graph Definition
        ↓
Graph Runtime
        ↓
Durable Execution
        ↓
Agent Runtime
        ↓
Tool Registry
        ↓
MCP / API / Native Tools
```

Tecnologie da valutare in prototipazione:

- **React Flow / XYFlow** per la Graph UI;
- **LangGraph o runtime custom** per l'orchestrazione agentica;
- **Temporal o soluzione equivalente** per durable execution e workflow lunghi;
- **MCP** per interoperabilità dei tool.

La scelta definitiva deve dipendere dall'architettura backend già presente in GOLIAI.

---

## 33. Principio architetturale finale

L'architettura dovrebbe mantenere indipendenti:

```text
GRAPH
AGENTS
TOOLS
```

In altre parole:

> Il graph decide **dove può andare l'esecuzione**.

> L'Agent Runtime decide **cosa fare per raggiungere un obiettivo**.

> Il Tool Registry determina **quali azioni sono concretamente disponibili**.

Questa separazione permette di aggiungere nuovi modelli, agenti, strumenti e servizi senza riprogettare il sistema.

---

## 34. Posizionamento

GOLIAI Agentic Workflow Studio non dovrebbe essere concepito semplicemente come **un n8n integrato in GOLIAI**.

Il posizionamento più interessante è:

> **Un ambiente visuale per costruire, osservare, modificare e comprendere sistemi agentici.**

La combinazione distintiva diventa:

```text
VISUAL PROGRAMMING
+
AGENT ORCHESTRATION
+
TOOL ECOSYSTEM
+
HUMAN CONTROL
+
OBSERVABILITY
+
EDUCATIONAL EXPLAINABILITY
```

---

## 35. Principio guida

L'elemento centrale non è semplicemente permettere all'AI di svolgere più task.

È rendere esplicito il passaggio da:

```text
PROMPT
  ↓
ANSWER
```

a:

```text
GOAL
  ↓
PLAN
  ↓
ACTION
  ↓
OBSERVATION
  ↓
EVALUATION
  ↓
ADAPTATION
  ↓
RESULT
```

Il workflow visuale diventa una rappresentazione osservabile dell'**agency**.

L'utente non vede soltanto ciò che l'AI produce: può vedere **come il sistema organizza il lavoro, quali strumenti utilizza, quando incontra un problema, quando cambia strategia e quando richiede l'intervento umano**.

Questa caratteristica può rendere l'Agentic Workflow Studio contemporaneamente:

- uno strumento produttivo;
- un ambiente di prototipazione;
- un laboratorio AI;
- uno strumento didattico;
- un sistema per comprendere concretamente orchestrazione, tool use, autonomia e collaborazione uomo–AI.
