# Debug Fix Plan

Questa checklist raccoglie tutte le fix critiche individuate nell’analisi.  
Procederemo un fix alla volta; dopo ogni fix, ti chiederò conferma per passare al successivo.

## Fix 1: Autorizzazioni LLM (bug runtime + ownership)
- Problema: `StudentOrTeacher` non ha `role`/`user`, causando eccezioni e controlli errati.
- File: `backend/app/api/v1/endpoints/llm.py`
- Target:
  - Sostituire `auth.role` con `auth.is_student`.
  - Sostituire `auth.user` con `auth.student`/`auth.teacher`.
  - Verificare ownership su conversazioni e cancellazioni.
- Criteri di verifica:
  - Nessuna eccezione per attributi mancanti.
  - Studenti possono operare solo sulle proprie conversazioni.
  - Docenti mantengono accesso previsto.

## Fix 2: Upload chat (validazioni + sicurezza + memoria)
- Problema: upload non verifica membership della sessione, non valida size/mime e legge interamente in memoria.
- File: `backend/app/api/v1/endpoints/chat.py`
- Target:
  - Verifica che lo studente appartenga alla sessione o che il docente possieda la sessione.
  - Validare MIME e size con `settings.ALLOWED_MIME_TYPES` e `MAX_UPLOAD_SIZE_MB`.
  - Scrittura streaming a disco per ridurre RAM.
- Criteri di verifica:
  - Upload rifiutato se sessione non autorizzata.
  - File troppo grandi o MIME non consentiti bloccati.
  - Upload non carica tutto in memoria.

## Fix 3: URL file sessione (path errato)
- Problema: URL generato senza cartella sessione.
- File: `backend/app/api/v1/endpoints/files.py`
- Target:
  - Correggere la costruzione URL usando `storage_key` completo o includendo `session_id`.
- Criteri di verifica:
  - URL restituito punta al file reale.

## Fix 4: Teacherbots prefisso duplicato
- Problema: path effettivi sono `/api/v1/teacherbots/teacherbots/*`.
- File: `backend/app/api/v1/router.py`, `backend/app/api/v1/endpoints/teacherbots.py`
- Target:
  - Rimuovere il doppio prefisso o riallineare i path per REST standard.
- Criteri di verifica:
  - Endpoint accessibili come `/api/v1/teacherbots/*`.

## Fix 5: Web search non bloccante
- Problema: `DDGS` sincrono usato in async.
- File: `backend/app/services/web_search_service.py`
- Target:
  - Eseguire `DDGS` in executor o alternativa async.
- Criteri di verifica:
  - Nessun blocco del loop in carico.

## Fix 6: Realtime state in memoria
- Problema: stato Socket.IO solo in memoria non funziona multi‑istanza.
- File: `backend/app/realtime/gateway.py`
- Target:
  - Spostare presenza/cache su Redis (o altro store condiviso).
  - Aggiungere TTL per stati.
- Criteri di verifica:
  - Coerenza presenza su più worker.

## Fix 7: Metrics middleware (Prometheus)
- Problema: contatori definiti ma non incrementati.
- File: `backend/app/main.py`
- Target:
  - Middleware per incrementare `REQUEST_COUNT` e `REQUEST_DURATION`.
- Criteri di verifica:
  - `/metrics` mostra dati aggiornati.
