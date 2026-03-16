# Scheda Tecnica Privacy & Sicurezza — Piattaforma GolinelliAI

> Documento ricavato dall'analisi del codice sorgente (branch `staging`).
> Distingue tra **comportamento implementato nel codice** e **configurazione dipendente dal deployment**.
> Non sostituisce una DPIA formale né una valutazione legale.

---

## 1. Provider AI e Trasmissione dei Prompt

### I prompt vengono inviati ai provider AI?
**Sì.** Ogni volta che un utente (docente o studente) invia un messaggio all'assistente AI, il testo viene trasmesso al provider configurato (OpenAI, Anthropic, DeepSeek — quest'ultimo attualmente nascosto dall'interfaccia — oppure a un'istanza Ollama locale). Il provider elabora il messaggio e restituisce la risposta. Il testo transita quindi fuori dai server della piattaforma verso API esterne, salvo nel caso di Ollama (locale).

**Riferimento:** `backend/app/services/llm_service.py`

---

### Quanto tempo vengono conservati i dati (dalla piattaforma)?
Le conversazioni AI (messaggi dell'utente + risposte del modello) vengono **salvate nel database PostgreSQL** senza scadenza automatica. Non esiste al momento un job di pulizia automatica né un TTL configurato nel codice. La conservazione è quindi **indefinita** fino a cancellazione manuale da parte del docente o dell'amministratore.

**Riferimento:** `backend/app/models/llm.py` (tabella `conversation_messages`)

---

## 2. Infrastruttura e Cloud

### Qual è il cloud provider utilizzato?
La piattaforma è distribuita tramite **Docker Compose** su un singolo host. Il cloud provider dipende interamente da dove viene eseguito quel host: **non c'è un provider cloud predefinito nel codice**. La scelta (AWS, Azure, GCP, OVH, server on-premise, ecc.) è responsabilità di chi esegue il deployment.

**Riferimento:** `docker-compose.yml`

---

### In quale regione geografica sono ospitati i server?
**Non determinabile dal codice.** Dipende dalla scelta del deployer. Per la conformità GDPR, la Fondazione dovrebbe documentare esplicitamente la regione di hosting.

---

### I dati sono replicati fuori dallo Spazio Economico Europeo (SEE)?
I **dati della piattaforma** (database, file, log) rimangono sul server di hosting scelto. Non vi è replicazione automatica fuori dal SEE implementata nel codice.

I **prompt inviati ai provider AI** transitano invece verso:
| Provider | Sede | Trasferimento extra-SEE |
|---|---|---|
| OpenAI | USA | **Sì** (salvo DPA con clausole SCCv2) |
| Anthropic | USA | **Sì** (salvo DPA) |
| DeepSeek | Cina/USA | **Sì** — attualmente nascosto dall'UI |
| Ollama | Locale | **No** |

---

### È presente un Content Delivery Network (CDN)?
**No.** Il traffico passa direttamente attraverso nginx in reverse proxy. Non è configurato alcun CDN (Cloudflare, Fastly, ecc.) nel setup attuale.

**Riferimento:** `docker-compose.yml`, `infrastructure/nginx/nginx.conf`

---

## 3. Archiviazione delle Chat

### Le chat degli utenti vengono salvate nel database?
**Sì, entrambi i tipi di chat:**

- **Chat di classe** (messaggi tra docente e studenti nella sessione): tabella `chat_messages` in PostgreSQL. Ogni messaggio contiene testo completo, timestamp, identificativo mittente, tipo mittente (docente/studente).
- **Conversazioni AI** (studente/docente con l'assistente): tabella `conversation_messages` in PostgreSQL. Vengono salvati: testo del messaggio, ruolo (user/assistant), provider AI, modello usato, token consumati.

**Riferimento:** `backend/app/models/chat.py`, `backend/app/models/llm.py`

---

### I prompt vengono memorizzati integralmente o solo temporaneamente?
**Integralmente e in modo persistente.** Ogni messaggio inviato all'AI viene salvato nella tabella `conversation_messages` con il testo completo (`content: Text`). Non esistono meccanismi di cancellazione automatica o anonimizzazione post-salvataggio.

---

### Esiste anonimizzazione o pseudonimizzazione dei prompt?
**No**, nel senso stretto. I messaggi vengono salvati così come inviati dall'utente. Il sistema usa **pseudonimizzazione parziale** per gli studenti (identificati da UUID e nickname scelto al momento dell'ingresso in sessione, non da nome reale), ma il testo dei prompt non viene alterato prima del salvataggio né prima dell'invio al provider AI.

---

## 4. Provider AI: DPA, Logging e Opt-out

### I provider AI conservano i prompt per training o logging?
Dipende dal contratto attivo con ciascun provider. Stato attuale per i provider usati dalla piattaforma:

| Provider | Default (senza DPA) | Con DPA/Zero Data Retention |
|---|---|---|
| OpenAI | Fino a 30 gg per abuse monitoring | Zero Data Retention disponibile (Enterprise/API) |
| Anthropic | Non usa i dati per training tramite API | Confermato da policy API |
| DeepSeek | Policy meno trasparente | DPA non pubblicamente disponibile al 2025 |
| Ollama (locale) | **Nessun dato inviato fuori** | N/A |

Il codice dell'applicazione **non imposta esplicitamente parametri di zero-retention nelle richieste API** (es. il campo `user` di OpenAI non è valorizzato). La policy dipende quindi dall'accordo contrattuale sottoscritto dalla Fondazione.

**Riferimento:** `backend/app/services/llm_service.py`

---

### L'accesso ai modelli avviene tramite API dirette o gateway intermedio?
**API dirette.** La piattaforma chiama direttamente gli endpoint dei provider (api.openai.com, api.anthropic.com, api.deepseek.com) senza gateway intermedi proprietari.

---

### Esistono Data Processing Agreement (DPA) con i provider AI?
Il documento `privacy.md` riconosce la **necessità** di DPA e clausole contrattuali standard (SCC) per i provider extra-SEE, ma **non è incorporato nel codice** alcun meccanismo di verifica o enforcement. La stipula dei DPA è responsabilità della Fondazione al di fuori della piattaforma.

---

### I prompt vengono inviati con identificativi utente o in forma anonima?
**In forma anonima rispetto al provider.** Nelle chiamate API ai provider (OpenAI, Anthropic, ecc.) non viene incluso alcun campo che identifichi l'utente finale (niente `user_id`, email, nome). Il provider riceve solo il testo della conversazione e i parametri del modello.

**Attenzione:** il testo del prompt potrebbe contenere informazioni identificative inserite direttamente dall'utente (es. "io mi chiamo Mario e...").

---

### È attivo il data retention opt-out previsto da alcuni provider?
**Non configurato nel codice.** Alcuni provider (es. OpenAI) permettono di richiedere zero data retention tramite impostazioni account o parametri API. La piattaforma non attiva questa opzione esplicitamente nel codice. Va configurato a livello di account API della Fondazione.

---

## 5. Log di Sistema

### Quali log vengono registrati?
| Tipo | Dove | Contenuto |
|---|---|---|
| Log applicazione (FastAPI) | stdout del container → `docker logs` | Errori, warning, info operazionali |
| Log accesso nginx | stdout del container nginx | URL richiesto, status HTTP, dimensione risposta |
| Metriche Prometheus | `http://api:8000/metrics` | Contatore richieste per endpoint/metodo/status, latenza |
| Audit eventi (DB) | Tabella `audit_events` in PostgreSQL | Tipo evento, attore (docente/studente), timestamp |

**Non sono configurati** sistemi di log centralizzati (ELK, Loki, Datadog, ecc.) nel setup standard.

---

### Per quanto tempo vengono conservati i log?
- **Log container** (nginx, API): conservati finché i container girano o fino al limite di dimensione del driver Docker (default: nessun limite, crescita illimitata).
- **Tabella `audit_events`**: persistente in PostgreSQL, senza TTL automatico.
- **Metriche Prometheus**: conservate nella finestra configurata (default Prometheus: 15 giorni).

---

### I log contengono indirizzo IP o identificativi utente?
- **nginx access log**: sì, contiene IP del client (`$remote_addr`), user agent, URL.
- **Log applicazione FastAPI**: non contengono IP esplicitamente (nessuna estrazione di `X-Forwarded-For` trovata nel codice).
- **Audit events DB**: contengono `actor_user_id` (UUID del docente) o `actor_student_id` (UUID studente), **non** l'IP.

**Riferimento:** `infrastructure/nginx/nginx.conf`, `backend/app/models/audit.py` (se presente)

---

## 6. Webcam

### Le immagini catturate dalla webcam vengono salvate sul server?
**No.** La webcam viene acceduta esclusivamente nel modulo di classificazione ML (`ClassificationModule.tsx`) per elaborazione **lato browser (client-side)**. Il flusso video non viene mai trasmesso al backend né salvato.

Il microfono viene usato in `VoiceRecorder.tsx` per la trascrizione audio (`audio: true, video: false`): l'audio viene inviato all'API di trascrizione (OpenAI Whisper), ma non salvato nel database della piattaforma.

**Riferimento:** `frontend/src/pages/student/ClassificationModule.tsx`, `frontend/src/components/VoiceRecorder.tsx`

---

### Se salvate, per quanto tempo rimangono?
Non applicabile — le immagini webcam non vengono salvate.

---

## 7. Autenticazione

### Come avviene l'autenticazione docenti?
**JWT (JSON Web Token) con firma HS256.** Al login, il server genera un token con:
- Payload: `sub` (UUID utente), `role`, `tenant_id`, `exp` (scadenza 24h), `iat`
- Trasmissione: sia via cookie HTTP (`HttpOnly=true`, `Secure=true`, `SameSite=lax`) sia via header `Authorization: Bearer`

**Riferimento:** `backend/app/core/security.py`, `backend/app/api/v1/endpoints/auth.py`

---

### Le password sono hashate?
**Sì, con bcrypt** (salt automatico, work factor default ~12 round). È uno degli algoritmi più sicuri per l'archiviazione password.

```python
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
```

**Riferimento:** `backend/app/core/security.py`

---

### È presente autenticazione a due fattori (2FA)?
**No.** Non è implementato alcun meccanismo 2FA (TOTP, SMS, FIDO2). L'accesso docenti avviene con solo email + password.

---

## 8. Dati degli Studenti

### Il nickname viene salvato nel database?
**Sì.** Il nickname scelto dallo studente all'ingresso in sessione viene salvato nella tabella `session_students` (campo `nickname: String`). È persistente fino alla cancellazione della sessione.

**Riferimento:** `backend/app/models/session.py`

---

### Il sistema memorizza l'indirizzo IP dello studente?
**No esplicitamente nel database applicativo.** L'IP appare nei log nginx (access log) ma non viene estratto né salvato nelle tabelle dell'applicazione.

---

### I dati della sessione vengono cancellati automaticamente alla fine della lezione?
**No.** La chiusura della sessione (stato `CLOSED`) non attiva cancellazione automatica dei dati. I dati rimangono nel database. La cancellazione è manuale.

---

## 9. Conservazione dei Dati

### Per quanto tempo vengono conservati:

| Tipo dato | Conservazione attuale | Note |
|---|---|---|
| **Chat di classe** | Indefinita (no TTL) | Cancellabile manualmente dal docente |
| **Conversazioni AI** | Indefinita (no TTL) | Nessun meccanismo automatico |
| **Documenti studenti** | Indefinita | Salvati in MinIO + riferimenti in DB |
| **Dataset** | Indefinita | Oggetti in MinIO |
| **Log applicazione** | Fino a restart/pulizia container | Non strutturati, no retention policy |
| **Log nginx** | Fino a restart/pulizia container | Contengono IP |
| **Metriche Prometheus** | ~15 giorni (default) | Solo metriche aggregate, no contenuto |
| **Audit events** | Indefinita (no TTL nel DB) | |

---

### Esiste un sistema automatico di cancellazione dati?
**No.** Nel codice non è presente alcun job schedulato (Celery beat, cron) per la cancellazione automatica di dati scaduti. Tutto è manuale o tramite cancellazione a cascata quando un docente elimina una sessione o un elemento.

---

## 10. Sicurezza Tecnica

### I dati sono criptati a riposo (encryption at rest)?
**Non nel codice applicativo.** I dati in PostgreSQL e MinIO sono salvati in chiaro a livello di applicazione. La cifratura a riposo dipende da:
- Cifratura del filesystem del server host (es. LUKS, BitLocker)
- Cifratura a livello di cloud provider (es. AWS EBS encrypted volumes)

Nessuna di queste è configurabile dalla piattaforma stessa: va attivata a livello di infrastruttura.

---

### È utilizzata HTTPS/TLS per tutte le comunicazioni?
**Dipende dal deployment.** La configurazione nginx nel codice **ascolta solo sulla porta 80 (HTTP)**. Non è inclusa una configurazione TLS/HTTPS nel file `nginx.conf` di default.

In produzione, TLS **deve essere configurato** dal deployer (es. certificato Let's Encrypt, reverse proxy esterno con TLS termination). I cookie di autenticazione sono impostati con flag `Secure=True`, quindi funzionano correttamente solo se il deployment usa HTTPS.

**Riferimento:** `infrastructure/nginx/nginx.conf`

---

### Sono effettuati backup automatici?
**No.** Non sono configurati nel codice né in `docker-compose.yml` backup automatici per:
- PostgreSQL (nessun `pg_dump` schedulato)
- MinIO (nessuna replica o bucket di backup)
- Redis (appendonly attivo, ma nessuna copia esterna)

I dati sono salvati in volumi bind-mount locali (`./data/`). I backup sono responsabilità del deployer a livello di infrastruttura (snapshot VM, backup filesystem, ecc.).

---

## Riepilogo — Stato Attuale vs. Da Configurare

| Aspetto | Implementato nel codice | Da configurare/contrattualizzare |
|---|---|---|
| Hash password (bcrypt) | ✅ | — |
| JWT + cookie sicuri | ✅ | — |
| Nessun user ID inviato ai provider AI | ✅ | — |
| Webcam solo client-side | ✅ | — |
| Pseudonimizzazione studenti via nickname | ✅ (parziale) | — |
| HTTPS/TLS | ⚠️ Non nel default | Certificato TLS in produzione |
| Cifratura dati a riposo | ❌ Non nell'app | Cifratura filesystem/cloud |
| Backup automatici | ❌ Non configurati | Policy backup infrastruttura |
| Retention automatica dati | ❌ Non implementata | Job di pulizia da sviluppare |
| 2FA docenti | ❌ Non presente | Da valutare per implementazione |
| DPA con provider AI | ⚠️ Riconosciuto in privacy.md | Da sottoscrivere per ogni provider |
| Zero data retention OpenAI | ⚠️ Non attivato nel codice | Configurazione account API |
| Log centralizzati | ❌ Solo stdout container | ELK/Loki da aggiungere se necessario |

---

*Documento generato da analisi del codice sorgente — branch `staging` — marzo 2026.*
*Per aggiornamenti: rieseguire analisi dopo ogni rilascio significativo.*
