# Player multimediali e podcast

I link YouTube e i file audio/video allegati alla chat mostrano un player o una scheda riproducibile. Il player video è condiviso con l’anteprima Files e rimane attivo durante la navigazione. Offre finestra flottante trascinabile, schermo intero e, per video HTML5 nei browser compatibili, PiP di sistema. YouTube usa un iframe ufficiale: finestra flottante interna e fullscreen; il proprietario del video può impedire l’incorporamento. I controlli audio comprendono play/pausa, avanzamento e volume, più un selettore di velocità di ascolto da 0,5× a 2×. La velocità è personale per ogni player e non richiede di rigenerare il file.

Nel chatbot docente, richieste come «crea un podcast sulla fotosintesi» o «fammi un riassunto audio del documento» aprono una scheda nella conversazione. La scheda permette di scegliere voce e relativo campione, durata indicativa (1/3/5/10 minuti), lingua, stile, pubblico, velocità, regolarità e istruzioni. Il testo generato è modificabile e richiede un’azione esplicita per la sintesi. Il formato attuale è una narrazione a voce singola, senza musica.

I documenti allegati vengono estratti sul backend. Se un documento non contiene testo leggibile, la scheda richiede una versione testuale anziché inventarne il contenuto. In assenza di documenti si usa l’argomento richiesto con il contesto recente della conversazione. Audio/video non sono trascritti automaticamente da questo flusso.

Il podcast completato è trascinabile nella chat di classe. Il rilascio carica una copia dell’MP3 tra gli allegati della sessione e invia subito il messaggio tramite il canale realtime già usato dalla chat. Docente e studenti vedono un player audio anche nella cronologia. Il file originale resta nel Drive privato del docente.

## Configurazione

- `ELEVENLABS_API_KEY`: chiave privata nel `.env` del backend.
- `ELEVENLABS_TTS_MODEL`: default `eleven_multilingual_v2`.
- `ELEVENLABS_COST_PER_1000_CHARS`: costo interno per 1.000 caratteri, da configurare secondo il proprio contratto ElevenLabs. Il default `0` registra i caratteri utilizzati senza addebitare un prezzo stimato alla piattaforma. La fatturazione ElevenLabs resta separata.
- Il modello del copione è assegnabile dal pannello amministrativo, ruolo `podcast.script`.

La chiave non viene inviata al browser. Le chiamate al provider e gli errori sono gestiti dal server. Nessun nuovo schema database è necessario: configurazione e testo sono persistiti nei metadati del messaggio docente; l’MP3 diventa un file privato nel Drive del docente. Il testo estratto dalle fonti rimane nel backend e non viene incluso nella risposta della cronologia. Un retry della generazione già completata restituisce il file esistente, senza un secondo addebito TTS. La sintesi serializza richieste concorrenti sullo stesso messaggio. I podcast lunghi vengono sintetizzati in segmenti e ricomposti con FFmpeg, preservando durata e ricerca temporale.

## API

Tutte le API podcast richiedono un docente autenticato e controllano proprietario e tenant:

- `GET /api/v1/podcasts/voices`
- `POST /api/v1/podcasts/configure` (multipart: conversation_id, prompt, files)
- `POST /api/v1/podcasts/{message_id}/draft` (opzioni)
- `POST /api/v1/podcasts/{message_id}/generate` (testo approvato)

Gli allegati audio/video della chat usano `POST /api/v1/files/media` e `GET /api/v1/files/media/{id}`, con permessi del proprietario anche per gli studenti. I file locali vengono inviati a blocchi senza caricare ogni video interamente in memoria per ogni avanzamento.

Gli MP3 generati usano l’endpoint autenticato `/api/v1/drive/items/{id}/content`. Le risposte supportano Range HTTP e `Cache-Control: private, no-store`. Anche il download applica i permessi del Drive. Gli studenti accedono ai file condivisi tramite il token di sessione, senza inviare credenziali a server esterni.

## Verifica

```sh
cd frontend && npx vitest run src/lib/media.test.ts
docker compose -p dev_golinelli_ai exec -T api python -m pytest -q tests/test_podcasts_media.py tests/test_chat_audio_upload.py
```
