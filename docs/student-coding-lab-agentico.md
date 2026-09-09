# Student Coding Lab agentico

## Obiettivo

Creare in piattaforma un ambiente di "vibe coding" educativo in cui studenti, docenti o utenti esperti possono generare mini-app e pagine web a partire da prompt, vedere e modificare codice, usare una preview interattiva sandboxata, ricevere revisioni automatiche da agenti e condividere il risultato nella chat di sessione.

Il codice generato non entra mai nel repository principale della piattaforma. Ogni progetto studente e` un artifact esterno, versionato e servito in isolamento.

## Decisioni fissate

- Runtime sandbox: runner dedicato con job queue.
- Preview publishing iniziale: path-based su `https://dev.golinelli.ai/paginastudente/...`.
- UI studente: chat + codice + anteprima.
- Modalita` agentica: pipeline automatica con agenti specializzati.
- Supervisione docente: visibilita` completa su prompt, messaggi, file, build, log agenti, screenshot, revisioni e valutazioni.
- Persistenza: tutto salvato lato server e recuperabile da lista sessioni.
- Export: download della codebase e, dove applicabile, di un pacchetto Docker replicabile.

## Architettura ad alto livello

```txt
frontend piattaforma
  -> backend FastAPI
    -> PostgreSQL
    -> MinIO / storage artifact
    -> Redis / Celery
      -> coding-runner
        -> workspace temporaneo
        -> container sandbox effimero
        -> install/build/test/screenshot/review
        -> artifact statici
    -> preview endpoint
      -> /paginastudente/:publication_slug/:version_id/
```

Il backend resta il punto di autorizzazione, persistenza e orchestrazione. Il runner esegue job controllati e non espone direttamente codice, file system o container agli utenti.

## Esperienza studente

Il modulo studente "Coding Lab" mostra tre aree:

- chat inline per descrivere, iterare e chiedere modifiche;
- editor codice con file tree e file aperto;
- preview interattiva in iframe sandboxato.

Flusso base:

1. Lo studente apre un brief assegnato dal docente oppure crea un progetto libero.
2. Scrive un prompt iniziale.
3. La pipeline agentica genera la codebase e avvia una build.
4. La preview viene aggiornata quando una versione e` pronta.
5. Gli agenti revisionano UI, funzionalita`, sicurezza e qualita` del prompting.
6. Lo studente puo` chiedere modifiche, confrontare versioni e condividere una versione in chat.

Per utenti giovani la UI puo` nascondere dettagli avanzati. Per docenti e utenti esperti si possono abilitare file tree completo, log build, console, dipendenze e export.

## Esperienza docente

Il docente puo`:

- creare brief con vincoli, obiettivi e rubrica;
- abilitare o disabilitare il Coding Lab per una sessione;
- vedere lista progetti per sessione e studente;
- aprire ogni progetto con timeline completa;
- leggere prompt, risposte, revisioni agentiche e log build;
- ispezionare codice, preview, screenshot e versioni;
- commentare, bloccare, approvare o pubblicare;
- vedere valutazioni su prodotto e prompting.

Il modello di osservabilita` deve essere simile a quello delle chiamate chatbot: auditabile, persistente e collegato a sessione, studente, docente e tenant.

## Brief docente

Un brief e` il contratto didattico usato dagli agenti. Campi consigliati:

- titolo;
- descrizione;
- obiettivi di apprendimento;
- stack consentiti: `html-css-js`, `vite-react`, in futuro `threejs`, `p5`, ecc.;
- librerie consentite o vietate;
- funzionalita` richieste;
- vincoli UI;
- vincoli accessibilita`;
- limiti di tempo o iterazioni;
- criteri di valutazione;
- pubblicazione consentita: si/no;
- download consentito: si/no.

## Pipeline agentica

La pipeline e` automatica, ma ogni step produce log e artifact ispezionabili.

1. `Prompt Analyst`
   Analizza intenzione, ambiguita`, vincoli, livello di dettaglio e qualita` del prompt.

2. `Project Planner`
   Sceglie template, stack, struttura file, dipendenze e piano di implementazione.

3. `Scaffolder Agent`
   Crea o aggiorna la codebase nel workspace isolato.

4. `Builder Agent`
   Implementa la mini-app seguendo prompt, brief e stato corrente del progetto.

5. `Dependency Agent`
   Valuta e installa librerie solo entro policy, timeout e limiti di dimensione.

6. `UI Reviewer Agent`
   Usa Playwright per screenshot desktop/mobile e analisi di layout, responsive, leggibilita`, overflow, contrasto e coerenza.

7. `Functionality Tester Agent`
   Esegue build, smoke test, click test, input test e verifica errori console.

8. `Security Auditor`
   Controlla codice e bundle per API vietate, script remoti, fetch sospetti, storage non consentito e tentativi di fuga sandbox.

9. `Pedagogical Evaluator`
   Valuta precisione, analiticita`, profondita`, creativita`, iterazione e maturita` di prompt engineering.

10. `Publisher Agent`
    Produce artifact statici, URL preview, export zip e card condivisibile in chat.

## Runner dedicato

Servizio proposto: `coding-runner`.

Responsabilita`:

- consumare job da Redis/Celery o coda dedicata;
- creare workspace temporanei;
- materializzare i file della versione sorgente;
- installare dipendenze con policy controllata;
- eseguire build/test/review;
- generare screenshot e report;
- caricare artifact su MinIO/storage;
- aggiornare lo stato job via backend API interna o DB service account;
- distruggere workspace e container al termine.

Il runner deve essere separato dal container API. Il container API non deve montare Docker socket e non deve eseguire codice studente.

## Tipi di job

- `coding.generate`: crea prima versione da prompt.
- `coding.iterate`: modifica una versione esistente.
- `coding.review`: esegue revisione UI/funzionale/sicurezza.
- `coding.build`: produce artifact statico.
- `coding.publish`: pubblica una versione.
- `coding.export_zip`: genera archivio codebase.
- `coding.export_docker`: genera pacchetto replicabile.

Ogni job salva input, output, stato, log, tempi, errori e artifact.

## Sandbox

Livelli di isolamento richiesti:

- container effimero per build e test;
- workspace temporaneo non condiviso;
- utente non-root;
- CPU, memoria, processi e timeout limitati;
- network disabilitato durante esecuzione preview/test, salvo install dipendenze con policy;
- nessun accesso a cookie, localStorage o API interne della piattaforma;
- CSP stretta per preview pubblica;
- iframe con `sandbox` e permessi minimi;
- dominio/path separato per artifact.

Per install dipendenze:

- timeout rigido;
- limite dimensione `node_modules`;
- denylist pacchetti noti rischiosi;
- log completo di `package.json` e lockfile;
- cache controllata dal runner, non condivisa con workspace in scrittura.

## Preview publishing

URL iniziale:

```txt
https://dev.golinelli.ai/paginastudente/:publication_slug/:version_id/
```

Esempio:

```txt
https://dev.golinelli.ai/paginastudente/calcolatrice-frazioni/8b4e.../
```

Per build Vite/React il runner deve impostare:

```ts
base: '/paginastudente/:publication_slug/:version_id/'
```

Le versioni pubblicate devono essere immutabili. Uno slug leggibile puo` puntare alla versione corrente, ma la condivisione in chat dovrebbe salvare sempre `version_id`.

## Nginx e artifact statici

Opzioni:

1. Backend proxy:
   `GET /paginastudente/...` passa dal backend, che valida permessi e serve artifact da storage.

2. Nginx static + signed manifest:
   il runner deposita artifact in una directory o bucket sincronizzato, Nginx serve statici, il backend gestisce metadati e permessi.

Per MVP e dev e` piu` semplice partire con backend proxy o volume statico controllato. In produzione conviene passare a storage object con CDN o reverse proxy dedicato.

## Condivisione in chat

La condivisione genera un messaggio chat con artifact strutturato:

```json
{
  "type": "student_coding_project",
  "project_id": "...",
  "version_id": "...",
  "publication_id": "...",
  "title": "Calcolatrice di frazioni",
  "preview_url": "/paginastudente/calcolatrice-frazioni/8b4e.../",
  "screenshot_url": "/api/v1/coding/projects/.../versions/.../screenshot",
  "student_id": "...",
  "requires_teacher_approval": false
}
```

In chat:

- gli studenti vedono card con screenshot e preview interattiva se permessa;
- il docente vede anche "ispeziona progetto";
- la card punta a una versione immutabile;
- eventuali commenti/approvazioni docente sono eventi separati.

## Modello dati proposto

### `coding_briefs`

- `id`
- `tenant_id`
- `teacher_id`
- `session_id`
- `title`
- `description`
- `constraints_json`
- `rubric_json`
- `allowed_templates_json`
- `publication_policy`
- `created_at`
- `updated_at`

### `coding_projects`

- `id`
- `tenant_id`
- `session_id`
- `brief_id`
- `owner_student_id`
- `owner_user_id`
- `title`
- `slug`
- `template_key`
- `status`
- `current_version_id`
- `visibility`
- `created_at`
- `updated_at`

### `coding_messages`

- `id`
- `project_id`
- `actor_type`: `student`, `teacher`, `agent`, `system`
- `actor_id`
- `agent_name`
- `role`
- `content`
- `metadata_json`
- `created_at`

### `coding_versions`

- `id`
- `project_id`
- `parent_version_id`
- `version_number`
- `source_manifest_json`
- `artifact_manifest_json`
- `prompt_message_id`
- `build_status`
- `review_status`
- `created_by_actor_type`
- `created_at`

`source_manifest_json` contiene path, hash, dimensione e storage key dei file sorgente. Non conviene salvare file grandi direttamente in JSONB.

### `coding_files`

- `id`
- `project_id`
- `version_id`
- `path`
- `mime_type`
- `content_hash`
- `storage_key`
- `size_bytes`
- `created_at`

### `coding_agent_runs`

- `id`
- `project_id`
- `version_id`
- `job_id`
- `agent_name`
- `status`
- `input_json`
- `output_json`
- `logs_storage_key`
- `started_at`
- `completed_at`
- `error_message`

### `coding_builds`

- `id`
- `project_id`
- `version_id`
- `status`
- `runner_job_id`
- `template_key`
- `install_log_key`
- `build_log_key`
- `test_log_key`
- `artifact_root_key`
- `screenshot_keys_json`
- `console_errors_json`
- `started_at`
- `completed_at`
- `error_message`

### `coding_reviews`

- `id`
- `project_id`
- `version_id`
- `review_type`: `ui`, `functionality`, `security`, `pedagogy`
- `score_json`
- `findings_json`
- `summary`
- `created_at`

### `coding_publications`

- `id`
- `project_id`
- `version_id`
- `tenant_id`
- `session_id`
- `publication_slug`
- `url_path`
- `status`
- `chat_message_id`
- `approved_by_user_id`
- `created_at`

## API backend proposte

Student:

- `GET /api/v1/coding/briefs?session_id=...`
- `POST /api/v1/coding/projects`
- `GET /api/v1/coding/projects`
- `GET /api/v1/coding/projects/{project_id}`
- `POST /api/v1/coding/projects/{project_id}/messages`
- `POST /api/v1/coding/projects/{project_id}/iterate`
- `POST /api/v1/coding/projects/{project_id}/versions/{version_id}/publish`
- `POST /api/v1/coding/projects/{project_id}/versions/{version_id}/share`
- `GET /api/v1/coding/projects/{project_id}/versions/{version_id}/export.zip`
- `GET /api/v1/coding/projects/{project_id}/versions/{version_id}/docker-export.zip`

Teacher:

- `POST /api/v1/teacher/sessions/{session_id}/coding-briefs`
- `GET /api/v1/teacher/sessions/{session_id}/coding-projects`
- `GET /api/v1/teacher/coding-projects/{project_id}/audit`
- `POST /api/v1/teacher/coding-publications/{publication_id}/approve`
- `POST /api/v1/teacher/coding-publications/{publication_id}/block`
- `POST /api/v1/teacher/coding-projects/{project_id}/comment`

Runner/internal:

- `POST /api/v1/internal/coding/jobs/{job_id}/events`
- `POST /api/v1/internal/coding/jobs/{job_id}/artifacts`
- `PATCH /api/v1/internal/coding/jobs/{job_id}`

## Frontend proposto

Nuove pagine/componenti:

- `StudentCodingLabModule`
- `CodingChatPanel`
- `CodingFileTree`
- `CodingEditor`
- `CodingPreviewFrame`
- `CodingAgentTimeline`
- `CodingVersionHistory`
- `TeacherCodingBriefBuilder`
- `TeacherCodingProjectsPage`
- `TeacherCodingProjectInspector`
- `CodingProjectChatCard`

Nel modulo studente desktop:

```txt
+----------------+----------------------+---------------------+
| Chat           | Codice               | Preview             |
| prompt/agenti  | file tree + editor   | iframe sandbox      |
+----------------+----------------------+---------------------+
| timeline agenti / versioni / valutazione                  |
+-----------------------------------------------------------+
```

Mobile:

- tabs `Chat`, `Codice`, `Preview`, `Revisioni`;
- preview full-screen apribile dalla card.

## Valutazione del prompting

La valutazione deve misurare processo e risultato, non solo la qualita` estetica.

Dimensioni:

- chiarezza dell'obiettivo;
- specificita` dei requisiti;
- capacita` di imporre vincoli utili;
- profondita` analitica;
- iterazione e miglioramento;
- creativita`;
- consapevolezza utente/interfaccia;
- capacita` di debugging tramite prompt;
- coerenza con brief docente.

Output consigliato:

```json
{
  "overall_score": 0.82,
  "dimensions": {
    "precision": 0.8,
    "analysis_depth": 0.75,
    "creativity": 0.9,
    "iteration_quality": 0.7,
    "brief_alignment": 0.85
  },
  "strengths": [],
  "improvement_suggestions": []
}
```

## Sicurezza e policy minime

Bloccare o segnalare:

- script remoti non autorizzati;
- fetch verso host non consentiti;
- accesso a `document.cookie`;
- uso non necessario di `localStorage`/`sessionStorage`;
- `eval`, `new Function`, import dinamici remoti;
- tentativi di aprire popup o navigare il parent;
- pacchetti con binari nativi non consentiti;
- progetti oltre dimensione massima;
- build oltre timeout.

La preview in iframe dovrebbe usare permessi minimi:

```html
<iframe
  sandbox="allow-scripts allow-forms"
  referrerpolicy="no-referrer"
/>
```

`allow-same-origin` va evitato finche` non c'e` un dominio separato o isolamento verificato.

## Export replicabile

Export codebase:

- sorgenti;
- `package.json`;
- lockfile se presente;
- `README.md` generato;
- `BUILD_INFO.json`;
- `prompt_history.json`;
- `reviews.json`.

Export Docker:

- sorgenti;
- `Dockerfile`;
- `docker-compose.yml`;
- `.env.example`;
- README con comandi;
- nessun segreto.

Per mini-app statiche basta un container Nginx che serve `dist/`. Per progetti con dev server si mantiene comunque export controllato, non runtime arbitrario pubblico.

## Roadmap completa

### Fase 1 - Fondamenta dati e UI statica

- Tabelle Alembic e modelli SQLAlchemy.
- API CRUD per brief, progetti, messaggi, versioni.
- Modulo studente con chat/editor/preview placeholder.
- Pagina docente lista progetti e inspector base.

### Fase 2 - Runner dedicato

- Servizio `coding-runner`.
- Job queue.
- Template `html-css-js` e `vite-react`.
- Build artifact su storage.
- Preview path-based su `/paginastudente/...`.

### Fase 3 - Pipeline agentica automatica

- Planner/scaffolder/builder.
- Persistenza agent run.
- Streaming eventi in UI.
- Versioning automatico.

### Fase 4 - Review automatica

- Playwright screenshot desktop/mobile.
- UI review.
- Functionality smoke test.
- Security auditor.
- Report leggibile lato docente.

### Fase 5 - Chat sharing e approvazione docente

- Card progetto in chat.
- Preview interattiva autorizzata.
- Workflow approve/block/comment.
- Collegamento a `chat_messages`.

### Fase 6 - Valutazione pedagogica avanzata

- Rubrica prompting.
- Report per studente.
- Dashboard docente per classe/sessione.
- Export completo del percorso.

## Primo slice implementativo consigliato

Il primo incremento utile deve dimostrare il flusso end-to-end senza ancora tutta l'intelligenza agentica:

1. Tabella progetto/versione/messaggi.
2. UI studente chat + editor + preview.
3. Runner con template Vite React.
4. Job `coding.generate` che crea una mini-app semplice.
5. Build statica pubblicata su `/paginastudente/:slug/:version_id/`.
6. Card condivisibile in chat.
7. Inspector docente con timeline e file.

Da li` si innestano gli agenti di review e valutazione.
