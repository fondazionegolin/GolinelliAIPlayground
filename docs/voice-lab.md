# Audio Lab

Area docenti/amministratori, accessibile da Crea → Audio Lab. Usa i componenti `@/design`, le superfici `ds-*` e i token di controllo/selezione della piattaforma.

## Interfaccia

Tre sezioni principali: **Voce**, **Musica**, **Playlist**. La libreria è accessibile dal pulsante nell’intestazione. In Voce si parte da un testo o da una registrazione e si sceglie la voce; la creazione di una voce da descrizione o campioni audio è raccolta in una finestra dedicata, con ascolto delle anteprime e salvataggio. Per la sintesi da testo, Regolare/Naturale/Espressiva corrispondono a `stability` 1/0.5/0; velocità e fedeltà alla voce vengono trasmesse al generatore. Nella conversione audio si conserva l’espressione della registrazione. Lingua, modello, formato e titolo sono nelle opzioni audio. Musica richiede descrizione, durata e scelta strumentale; i risultati si possono ascoltare, scaricare, condividere o aggiungere a una playlist. Le API dei precedenti strumenti e gli elementi già salvati restano disponibili.

I campi seguono i token condivisi `--ds-field-*` per sfondo grigio leggermente freddo, angoli arrotondati e aspetto flat senza bordi o ombre a riposo; testo, placeholder e focus restano leggibili nei due temi. Il testo secondario del tema scuro usa viola rosato, anche per le classi legacy celesti. I colori dei documenti e gli editor di codice mantengono il proprio trattamento.

## Audio, Files e classi

Ogni risultato audio, musicale o di trascrizione genera un File e un elemento nel drive del docente. Il Audio Lab permette ascolto, download e condivisione con le proprie classi usando gli stessi permessi dei Files. Gli studenti accedono dai Files condivisi durante una sessione attiva.

Una playlist è una cartella nei Files (`source_type=voice_playlist`), con riferimenti ordinati agli audio originali. Non duplica i blob. Dal Audio Lab si possono creare, rinominare, riordinare e rimuovere tracce, scaricare lo ZIP e condividere con le classi. Nella cartella dei Files il comando **Apri player** è disponibile anche agli studenti autorizzati. Il player include riproduzione continua, precedente/successiva, posizione, velocità e ripetizione. Rimuovere una playlist non rimuove gli audio originali. L'eliminazione definitiva di un originale rende indisponibili anche i riferimenti nelle playlist.

Le autorizzazioni sono verificate a ogni caricamento. Aggiungere una traccia a una playlist già condivisa la rende disponibile ai destinatari della cartella. Il docente rimane il solo editor dal Audio Lab.

## Crediti

Tariffe API standard pubbliche, escluse imposte, consultate il 3 novembre 2026: <https://elevenlabs.io/pricing/api>. Non sono una riconciliazione della fattura o delle quote dell'abbonamento ElevenLabs.

Conversione: USD × `USD_TO_EUR` (attualmente 0,86) × 100 crediti per euro interno. Le tariffe sono centralizzate in `app/services/voice_lab_billing.py`.

| Servizio | Tariffa USD | Crediti Golinelli.ai |
| --- | --- | --- |
| Sintesi standard / dialoghi | 0,08 / 1.000 caratteri | 6,88 / 1.000 caratteri |
| Sintesi Flash / Turbo / Conversational | 0,04 / 1.000 caratteri | 3,44 / 1.000 caratteri |
| Musica | 0,15 / minuto | 12,90 / minuto |
| Cambio voce, isolamento, effetti | 0,12 / minuto | 10,32 / minuto |
| Trascrizione Scribe batch | 0,22 / ora | 18,92 / ora |
| Doppiaggio v1 senza watermark | 0,50 / minuto | 43,00 / minuto |

Per allineamento e Voice Design, non essendoci una tariffa unitaria pubblica esplicita verificata, si usa rispettivamente una **stima equivalente** alla trascrizione e alla sintesi delle anteprime. La UI distingue queste stime. Creare/salvare un clone non comporta un addebito di generazione; sintetizzare con una voce clonata segue la tariffa del modello.

Il preventivo precede ogni generazione. Per gli upload il backend misura la durata con ffprobe (massimo tre ore), senza fidarsi del valore del browser. I caratteri della sintesi sono quelli del testo, distinti dalle eventuali unità `character-cost` restituite dal provider. Anche i podcast usano le tariffe standard, eliminando il precedente costo nullo.

Il Audio Lab prenota la spesa sotto lock sui budget prima della richiesta a pagamento, poi aggiorna la stessa transazione: nessun secondo addebito per polling, download o salvataggio. I fallimenti certi sono rimborsati; un timeout di rete conserva la prenotazione perché l'esito e il consumo a monte non sono verificabili. Le transazioni con `usage_details.billing_status=reserved` vanno riconciliate dal gestore controllando ElevenLabs prima di ripetere la richiesta. Anche i doppiaggi mantengono la prenotazione fino alla verifica del risultato in libreria. La registrazione di una generazione completata precede il salvataggio del file: un errore di storage non cancella un consumo già sostenuto.

La vecchia variabile `ELEVENLABS_COST_PER_1000_CHARS` è deprecata e non determina più la tariffa: lasciarla a zero non rende gratuite le generazioni. Nessun consumo precedente viene ricalcolato retroattivamente.

## Verifica

Migrazione `116_voice_playlists`. Test unitari: `test_voice_lab.py`, `test_voice_lab_billing.py`, `test_podcasts_media.py`. Con PostgreSQL di sviluppo migrato, eseguire `VOICE_LAB_DB_TESTS=1 python -m pytest tests/test_voice_lab_database.py` per verificare permessi, ordine, revoca e contabilizzazione. I test DB usano una transazione esterna con rollback; non contattano ElevenLabs.

## Playlist e ascolto in sottofondo

Il player musicale vive a livello di applicazione, fuori dalle pagine: l'elemento audio, la coda e la posizione restano attivi durante la navigazione. È accessibile dalla nota musicale nella navbar di docenti e studenti, anche su mobile. Il popup è non modale per permettere il trascinamento dai Files mentre rimane aperto. Il docente può avviare una playlist per una classe; gli studenti possono spegnere il proprio audio o scegliere una playlist personale. Volume e silenziamento sono locali, non comandi inviati alla classe. Quando il browser richiede un gesto per l'audio, compare «Attiva audio».

Le playlist accettano tutti i file audio ai quali l'utente ha accesso, non solo i risultati di Audio Lab. Il caricamento da computer, anche tramite trascinamento sull'icona, salva prima il file nei Files. Gli studenti dispongono di un'area Files personale e possono condividere esplicitamente un proprio audio con la classe e i docenti; gli altri membri possono poi riutilizzarlo nelle playlist. I riferimenti nelle playlist conservano gli originali quando si rimuove una traccia dalla coda.

Lo stato di classe è persistito in PostgreSQL (`class_audio_playback`) e autorizzato sulla classe. Un clock del server, con durate lette e memorizzate tramite FFprobe, determina traccia e posizione anche se il docente si silenzia, cambia pagina o chiude la scheda. Il client aggiorna lo stato ogni 1,5 secondi e riallinea il punto di ascolto. I comandi hanno una revisione per impedire aggiornamenti concorrenti obsoleti. Lo streaming autenticato della classe concede accesso solo alle tracce della playlist in corso; interrompere la riproduzione revoca tale accesso.

I file nuovi e i risultati generati vengono ordinati per tipo (Documenti, Voci, Musica, PDF, Presentazioni, Fogli di calcolo, Immagini, Video, Modelli 3D, Codice, Archivi). La sincronizzazione ordina anche i file precedenti ancora nella radice o nelle posizioni automatiche. Le cartelle personalizzate e i file spostati dal docente mantengono la propria organizzazione.

Migrazione aggiuntiva: `117_background_audio`. Verifica con rollback sul solo database di sviluppo: `VOICE_LAB_DB_TESTS=1 python -m pytest tests/test_background_audio_database.py tests/test_voice_lab_database.py`.


### Player unico nella navbar

Il doppio clic su un audio nei Files avvia direttamente il widget della navbar, senza aprire un'anteprima o richiedere prima la creazione di una playlist. Anche gli ascolti da Audio Lab, podcast e allegati chat passano allo stesso elemento audio. Il popup contiene soltanto ascolto, selezione di un brano dai Files e caricamento di una playlist salvata; la selezione avvia subito il play. I moduli specifici di registrazione, chiamata vocale e montaggio video conservano il proprio audio operativo. La creazione, modifica e diffusione delle playlist di classe rimangono nella sezione playlist.

## Generazione in background

`POST /voice-lab/generate` controlla richiesta, quota Files e voci, poi avvia un job in background (`kind=audio_lab_<azione>`, route `/teacher/audio-lab`) e risponde subito `{job_id, status}`. Il job usa una propria sessione DB, prenota i crediti, chiama ElevenLabs e salva il risultato; l'elemento creato è in `result.item`. La pagina segue il job con `waitForJob` (barra di avanzamento, tempo trascorso, Annulla); se si cambia pagina la generazione continua e compare nell'indicatore della navbar, e al ritorno la pagina riprende il job attivo o apre l'ultimo risultato non ancora visto. Un annullamento restituisce la prenotazione dei crediti.
