# Golinelli AI Playground

## Inventario funzionale della piattaforma

Versione: 5 giugno 2026

Nota: questo documento descrive le funzionalita` presenti nella piattaforma guardando il repository applicativo, in particolare le pagine docente e studente del frontend e le API collegate. Il taglio e` pratico: cosa si trova nelle pagine, cosa puo` fare l'utente, e come i pezzi si collegano tra loro.

---

## 1. Struttura generale

La piattaforma ha tre ambienti principali:

- area docente;
- area studente;
- area amministratore.

L'area docente e l'area studente sono quelle operative per la didattica. Il docente lavora su classi, sessioni, materiali, chatbot, teacherbot, compiti, report, live interaction, notebook, ML Lab e desktop. Lo studente entra in una sessione tramite codice, vede i moduli abilitati e lavora dentro un ambiente controllato: desktop, chatbot, documenti, compiti, notebook, ML Lab, wiki e chat di classe.

La logica importante e` questa: molte funzioni non sono isolate. Un quiz generato nella chat docente puo` diventare un compito. Un dataset generato puo` essere scaricato, pubblicato o riusato in un laboratorio ML. Un teacherbot creato dal docente puo` comparire nel chatbot studente. Una notifica puo` portare direttamente lo studente al compito o al documento giusto.

---

## 2. Accesso e navigazione

### 2.1 Login docente

Il docente accede dall'area login standard. Dopo il login entra nella dashboard docente, che di fatto usa la pagina di supporto AI come home principale.

Funzioni presenti:

- autenticazione docente;
- redirect automatico in base al ruolo;
- gestione profilo docente;
- avatar;
- lingua dell'interfaccia;
- scelta dell'accent color dell'interfaccia;
- cambio password;
- accesso ai termini e condizioni;
- accesso amministratore se l'utente ha ruolo admin;
- indicatore dei crediti disponibili.

### 2.2 Accesso studente

Lo studente non entra come utente tradizionale con email. Entra da `/join` usando:

- codice sessione/classe;
- nickname;
- password studente.

La sessione studente viene mantenuta con token dedicato. Nel flusso sono previsti anche casi di anteprima studente aperta dal docente.

Funzioni presenti:

- verifica accesso alla sessione;
- ingresso con nickname;
- sessione studente separata dall'autenticazione docente;
- uscita dalla sessione;
- gestione profilo minimo dello studente;
- avatar/accent color studente;
- banner di preview quando il docente sta provando la vista studente.

---

## 3. Barra docente

La navbar docente e` un punto operativo importante, non solo un menu.

Pagine raggiungibili:

- Supporto;
- Classi;
- Studentbot;
- Documenti;
- Wiki;
- ML Lab;
- Notebook;
- Desktop.

Funzioni nella barra:

- selezione rapida della sessione attiva;
- visualizzazione del codice sessione se la sessione e` attiva;
- numero studenti nelle sessioni attive;
- apertura/chiusura della chat laterale di classe;
- stato della stanza voce se attiva;
- notifiche docente in tempo reale;
- calendario/orologio;
- crediti disponibili;
- impostazioni profilo;
- cambio lingua;
- changelog/novita`;
- logout.

Le notifiche docente possono arrivare da messaggi, consegne, eventi sessione, alert e attivita` degli studenti. Cliccandole, il docente viene portato alla sessione, ai compiti o alla cronologia collegata.

---

## 4. Area docente: pagina Supporto

Questa e` la pagina principale del docente. Contiene due aree: chat di supporto docente e gestione teacherbot.

### 4.1 Chat di supporto docente

La chat docente e` un assistente AI persistente con cronologia conversazioni, modelli selezionabili e modalita` operative diverse.

Funzioni generali:

- creazione conversazioni;
- caricamento cronologia dal backend;
- cancellazione conversazioni singole o di tutte le conversazioni;
- titolo conversazione;
- salvataggio messaggi lato server;
- caricamento progressivo dei messaggi vecchi;
- scelta del modello AI;
- scelta del modello predefinito;
- indicazione provider/modello nelle risposte;
- indicatore di impatto/consumo ambientale collegato all'uso LLM;
- sfondo chat personalizzabile;
- allegati;
- registrazione vocale tramite componente dedicato;
- link YouTube con recupero transcript;
- drag and drop di file, immagini e dataset;
- anteprima file dati;
- suggerimenti automatici se viene caricato un dataset;
- rendering markdown, tabelle, formule matematiche e blocchi codice;
- gestione di output strutturati dentro la conversazione.

### 4.2 Modalita` della chat docente

La chat docente ha queste modalita` visibili:

- Chat;
- Report;
- Quiz;
- Esercizio;
- Immagine;
- Dataset;
- Analisi;
- Brochure;
- Dispensa;
- Pagina Interattiva.

Esiste anche una modalita` web search nel tipo interno, ma risulta nascosta perche` non considerata ancora matura.

#### Chat

Uso libero dell'assistente. Serve per domande, bozze, spiegazioni, riformulazioni, preparazione di materiali o ragionamenti didattici.

Funzioni:

- conversazione libera;
- uso della cronologia;
- allegati;
- scelta modello;
- salvataggio della conversazione;
- output testuale o strutturato.

#### Report

Modalita` pensata per generare report su sessioni, studenti, attivita` o andamento della classe.

Funzioni osservabili:

- selezione sessione;
- selezione studenti quando proposta dall'assistente;
- scelta tipo report;
- tipi previsti: dashboard classe, apprendimenti, partecipazione, classifiche, criticita` e rischi;
- generazione report avanzato;
- uso dei dati della sessione come contesto.

#### Quiz

Modalita` per creare quiz strutturati.

Funzioni:

- generazione quiz in formato strutturato;
- anteprima interattiva del quiz dentro la chat;
- verifica risposte in anteprima;
- visualizzazione punteggio;
- modifica del quiz prima della pubblicazione;
- pubblicazione in una sessione come compito;
- salvataggio come bozza.

Il formato gestito prevede titolo, descrizione, domande, opzioni, risposta corretta, spiegazione, punti e limite di tempo se presente.

#### Esercizio

Modalita` per creare esercizi o consegne.

Funzioni:

- generazione di istruzioni;
- esempi;
- difficolta`;
- suggerimento/hint;
- modifica prima della pubblicazione;
- pubblicazione in sessione;
- salvataggio come bozza.

#### Immagine

Modalita` per generare immagini.

Funzioni:

- provider immagine selezionabile;
- dimensione immagine selezionabile;
- progress di generazione;
- fase di miglioramento prompt;
- anteprima del prompt migliorato;
- visualizzazione immagine in chat;
- download immagine;
- drag dell'immagine verso altri spazi della piattaforma;
- riuso dell'immagine in documenti o chat.

#### Dataset

Modalita` per creare dataset sintetici o tabelle esportabili.

Funzioni:

- generazione dataset;
- riconoscimento output CSV;
- anteprima tabellare;
- download CSV;
- drag del dataset;
- pubblicazione del dataset in sessione;
- salvataggio come bozza;
- uso come materiale di partenza per ML Lab o notebook.

#### Analisi

Modalita` dedicata all'analisi di compiti o lavori gia` presenti in sessione.

Funzioni:

- scelta sessione;
- caricamento dei compiti della sessione selezionata;
- scelta di task pubblicati o chiusi;
- domanda di analisi libera sul task;
- uso delle consegne e submission come contesto.

#### Brochure

Modalita` per produrre un contenuto impaginabile, piu` vicino a un materiale di comunicazione o scheda visuale.

Funzioni:

- generazione payload brochure;
- apertura nel canvas/document editor;
- modifica successiva tramite AI;
- riuso come materiale documento;
- pubblicazione se trasformata in contenuto di sessione.

#### Dispensa

Modalita` per costruire una dispensa piu` articolata.

Funzioni:

- generazione piano dispensa;
- titolo, sottotitolo, obiettivi, sezioni;
- generazione progressiva di metadati, sezioni e appendici;
- esercizi e riferimenti;
- apertura nel canvas documento;
- salvataggio documento collegato alla conversazione.

#### Pagina Interattiva

Modalita` per produrre pagine HTML o contenuti web interattivi.

Funzioni:

- generazione pagina;
- modifica pagina via endpoint AI dedicato;
- apertura/preview come documento web;
- possibile riuso dentro il modulo documenti.

### 4.3 Allegati nella chat docente

La chat accetta piu` tipi di allegato:

- immagini;
- PDF;
- documenti Word;
- PowerPoint;
- TXT;
- CSV;
- Excel;
- JSON;
- link YouTube.

Per i file dati viene generata una preview con suggerimenti di prompt. Le immagini possono essere usate come input o come oggetti trascinabili. I link YouTube possono diventare transcript da usare come contesto.

### 4.4 Pubblicazione da chat docente

Quando la chat produce contenuti adatti alla classe, il docente puo` pubblicarli.

Tipi pubblicabili:

- quiz;
- esercizio;
- lezione/documento;
- dataset.

Modalita`:

- pubblica subito;
- salva bozza.

Il docente sceglie la sessione di destinazione. Se pubblica subito, il contenuto diventa un task/materiale visibile agli studenti e puo` generare notifiche.

### 4.5 Canvas documento collegato alla chat

La chat docente puo` aprire un canvas laterale per lavorare sui materiali generati.

Funzioni:

- creazione documento da output AI;
- salvataggio documento associato alla conversazione;
- eliminazione documento associato;
- modifica e iterazione del contenuto;
- passaggio dalla chat alla produzione del materiale.

---

## 5. Area docente: Teacherbot

Il pannello Teacherbot vive dentro la pagina Supporto. E` il sistema per creare assistenti specializzati da pubblicare agli studenti.

### 5.1 Lista teacherbot

Funzioni:

- elenco dei teacherbot del docente;
- stato del bot;
- colore/identita` visuale;
- synopsis;
- conteggio conversazioni;
- indicatore report disponibili;
- crea nuovo;
- modifica;
- test;
- report;
- cancellazione.

### 5.2 Creazione e modifica teacherbot

Campi e funzioni:

- nome;
- synopsis;
- colore;
- system prompt;
- temperatura;
- scelta provider/model LLM;
- comportamento proattivo;
- messaggio iniziale proattivo;
- reporting abilitabile;
- prompt personalizzato per il report;
- salvataggio;
- annullamento.

Il system prompt e` il centro del teacherbot: definisce identita`, comportamento, limiti e stile. Nel form e` presente anche un ottimizzatore prompt: selezionando una parte del testo, l'AI puo` trasformare istruzioni vaghe in regole operative piu` concrete.

### 5.3 Knowledge base del teacherbot

Ogni teacherbot puo` avere documenti dedicati.

Funzioni:

- caricamento documenti nella knowledge base;
- gestione file in creazione o modifica;
- processo con step visibili: lettura, chunking, embedding, indicizzazione;
- rimozione documenti;
- elenco documenti collegati;
- spiegazione in UI di come funziona il recupero vettoriale;
- uso di embedding e ricerca semantica;
- passaggio dei blocchi piu` rilevanti al modello.

Questa e` la parte che rende un teacherbot diverso da un chatbot generico: puo` rispondere usando materiali dati dal docente.

### 5.4 Pubblicazione teacherbot

Funzioni:

- pubblicazione su una o piu` classi;
- elenco classi disponibili;
- elenco pubblicazioni attive;
- rimozione pubblicazione;
- distinzione tra classi proprie e classi condivise.

Dopo la pubblicazione, gli studenti della classe possono trovare il teacherbot nell'area Chatbot.

### 5.5 Test teacherbot

Il docente puo` provare il teacherbot prima di pubblicarlo.

Funzioni:

- conversazione di test;
- messaggio proattivo se configurato;
- invio messaggi;
- visualizzazione provider/modello;
- reset conversazione di test;
- nota esplicita che le conversazioni di test non vengono salvate e non generano report.

### 5.6 Report teacherbot

Se il reporting e` attivo, il docente puo` vedere report delle conversazioni studente-teacherbot.

Funzioni:

- elenco conversazioni;
- studente/nickname;
- sessione;
- conteggio messaggi;
- stato report;
- apertura report;
- apertura transcript;
- riepilogo;
- topic;
- osservazioni;
- suggerimenti;
- data generazione report;
- lettura messaggi della conversazione.

### 5.7 Uso teacherbot lato studente

Lo studente trova i teacherbot pubblicati nella sezione Chatbot. Puo` aprire conversazioni, inviare messaggi, allegare file quando previsto e chiudere la conversazione. La chiusura puo` generare report se il bot e` configurato per farlo.

---

## 6. Area docente: Classi

La pagina Classi serve a organizzare il lavoro didattico.

Funzioni:

- creare classi;
- modificare nome classe;
- indicare grado scolastico;
- vedere classi proprie e condivise;
- entrare nelle sessioni collegate;
- gestire docenti invitati sulla classe;
- invitare altri docenti;
- rimuovere docenti dalla classe;
- accedere alla creazione UDA della classe.

La classe e` il contenitore organizzativo. La sessione e` il contesto operativo dove entrano gli studenti.

---

## 7. Area docente: Sessioni

Le sessioni sono lezioni/laboratori/ambienti attivi dentro una classe.

Funzioni:

- creare sessione;
- modificare titolo;
- sessione persistente o non persistente;
- stato sessione: bozza, attiva, in pausa, conclusa;
- join code visibile solo quando utilizzabile;
- selezione della sessione attiva dalla navbar;
- eliminazione sessione;
- esportazione sessione;
- audit degli eventi;
- gestione docenti invitati sulla sessione;
- creazione anteprima studente.

---

## 8. Area docente: Pagina live della sessione

La pagina live di una sessione e` il pannello di regia.

### 8.1 Header sessione

Funzioni:

- titolo sessione;
- classe;
- grado scolastico;
- stato sessione;
- join code;
- comandi per avviare, mettere in pausa, riattivare o chiudere la sessione;
- ritorno alle classi;
- accesso veloce alla gestione contenuti della sessione.

### 8.2 Studenti connessi

Funzioni:

- elenco studenti;
- stato online/offline;
- avatar/nickname;
- ultimo modulo o step noto;
- filtro per mostrare offline;
- freeze studente;
- unfreeze studente;
- rimozione studente dalla sessione;
- invio/push di un teacherbot a uno studente specifico.

Il freeze e` una funzione di controllo: blocca lo studente nella sessione con una motivazione opzionale.

### 8.3 Moduli attivi

Tab "Moduli".

Funzioni:

- abilitare/disabilitare Chatbot AI;
- abilitare/disabilitare Classificazione ML;
- abilitare/disabilitare Autovalutazione/Compiti;
- abilitare/disabilitare chat privata;
- aggiornamento realtime via socket;
- scelta del modello AI di default della sessione.

La navbar studente mostra sempre Desktop, Documenti, Notebook e Wiki; gli altri moduli dipendono dalle abilitazioni della sessione.

### 8.4 Compiti

Tab "Compiti".

Funzioni:

- creare nuovo compito;
- usare TaskBuilder;
- tipi task come quiz, esercizio, discussione, lezione/presentazione/documento;
- ricerca compiti;
- vista griglia o lista;
- stato bozza/pubblicato;
- modifica bozze;
- pubblicazione bozze;
- cancellazione;
- apertura dettagli;
- visualizzazione submission;
- correzione/feedback;
- analisi risposte quiz, incluse risposte errate;
- accesso UDA della classe.

### 8.5 Storico e analytics

Tab "Storico".

Funzioni:

- pannello analytics della sessione;
- cronologia chatbot studenti;
- cronologia teacherbot;
- learning history;
- selezione conversazioni;
- apertura transcript;
- copia contenuti;
- dati aggiornati via socket dove previsto.

---

## 9. Area docente: Chat laterale di classe

La chat laterale puo` essere aperta dalla navbar docente.

Funzioni:

- chat di sessione;
- messaggi realtime;
- allegati;
- reply a messaggi;
- lista utenti online;
- messaggi privati/docente-studente se abilitati;
- upload file;
- libreria file di sessione;
- filtri file per tipo: immagini, PDF, documenti, CSV, audio, video, altri;
- cartelle;
- drag and drop di allegati;
- preview immagini;
- gestione notifiche nella chat;
- registrazione vocale.

---

## 10. Area docente: Documenti

La pagina Documenti e` un editor materiali.

Tipi gestiti:

- documento testuale;
- presentazione/slide;
- foglio/spreadsheet;
- canvas/lavagna;
- pagina web.

Funzioni:

- creare nuovo documento;
- creare nuova presentazione;
- creare nuova lavagna/canvas;
- aprire bozze;
- cercare tra bozze e documenti pubblicati;
- salvataggio automatico bozza;
- cancellazione bozza;
- caricamento contenuti gia` pubblicati;
- cancellazione contenuti pubblicati;
- rich text editor per documenti;
- slide editor per presentazioni;
- spreadsheet editor per fogli;
- canvas collaborativo/lavagna;
- preview pagina web;
- assistenza AI sul testo selezionato;
- pubblicazione in sessione;
- pubblicazione immediata o salvataggio come bozza;
- notifica agli studenti quando il contenuto viene pubblicato.

La pagina e` simile a quella studente, ma lato docente aggiunge il flusso di pubblicazione verso sessioni e compiti.

---

## 11. Area docente: Studentbot

La pagina Studentbot e` una preview dell'esperienza studente.

Funzioni:

- creare/entrare in anteprima studente;
- visualizzare la UI come la vedrebbe uno studente;
- verificare moduli disponibili;
- provare flussi prima della lezione;
- uscire dalla preview e tornare al docente.

E` utile per controllare che una sessione sia configurata correttamente prima di dare il codice agli studenti.

---

## 12. Area docente: Wiki

La Wiki e` una guida interna alle funzioni.

Funzioni:

- sezioni per supporto AI, classi/sessioni, teacherbot, documenti, notebook, ML Lab, desktop;
- descrizione dei flussi standard;
- esempi d'uso;
- indicazione se una funzione e` condivisibile con la classe;
- formato di output atteso.

---

## 13. Area docente: ML Lab

La pagina ML Lab docente e` prevista come laboratorio per dati, esperimenti e interpretazione. Le API disponibili indicano:

- creazione dataset;
- creazione dataset sintetico;
- elenco dataset;
- dettaglio dataset;
- creazione esperimento;
- elenco esperimenti;
- risultati esperimento;
- spiegazione esperimento via AI.

Nel flusso didattico e` collegabile ai dataset generati nella chat o caricati come file.

---

## 14. Area docente: 3D Lab

La piattaforma include anche una pagina docente 3D Lab, anche se non e` esposta nella navbar principale nel punto analizzato.

Funzioni:

- generazione immagine da testo;
- uso dell'immagine generata come base per 3D;
- text-to-3D;
- image-to-3D;
- prompt negativo;
- opzioni avanzate: PBR, topologia, polycount;
- polling dello stato task;
- download GLB/FBX;
- preview asset 3D;
- libreria locale di asset;
- eliminazione asset;
- condivisione asset nella sessione se presente.

---

## 15. Area docente: Notebook

Il notebook e` un ambiente tecnico comune a docente e studente.

Tipi progetto:

- Python;
- p5.js;
- Game 2D;
- Strudel.

Funzioni lista:

- elenco notebook;
- ricerca;
- raggruppamento per tipo;
- creazione notebook;
- cancellazione;
- conteggio celle;
- data ultimo aggiornamento.

Funzioni editor:

- celle di codice;
- esecuzione celle Python via Pyodide;
- run singola cella;
- run di tutte le celle;
- output per cella;
- gestione input durante esecuzione;
- preview live p5.js;
- preview Game 2D;
- preview Strudel/audio;
- stop/play preview;
- console;
- spiegazione errori con AI;
- tutor chat del notebook;
- proposte di codice applicabili;
- rinomina celle;
- impostazioni editor: tema, font, dimensione, librerie;
- library manager;
- autosalvataggio.

---

## 16. Area docente: Live Interaction

La piattaforma ha una funzione separata per interazioni live tipo slide/domande.

### 16.1 Builder

Funzioni:

- elenco live interaction per sessione;
- creazione nuova interazione;
- modifica interazione esistente;
- titolo;
- slide JSON;
- salvataggio;
- cancellazione;
- apertura controllo live.

### 16.2 Control

Funzioni:

- avvio interazione;
- avanzamento slide;
- chiusura interazione;
- visualizzazione stato corrente;
- raccolta risposte studenti;
- risultati per slide;
- numero risposte rispetto al totale studenti;
- aggiornamento in tempo reale.

### 16.3 Lato studente

Lo studente riceve un overlay quando c'e` un'interazione live attiva.

Funzioni:

- vedere la slide/domanda corrente;
- rispondere;
- invio risposta;
- blocco su indice slide per evitare risposte fuori tempo se il docente e` gia` avanzato.

---

## 17. Area docente: UDA

Le UDA sono un flusso di costruzione didattica piu` strutturato dentro una classe.

### 17.1 Lista UDA

Funzioni:

- elenco UDA della classe;
- creazione UDA;
- stato bozza/pubblicata;
- apertura UDA;
- cancellazione.

### 17.2 Creator UDA

Fasi principali:

- briefing;
- knowledge base;
- piano;
- generazione;
- revisione;
- pubblicazione.

Funzioni:

- prompt di briefing;
- caricamento file;
- lingua;
- grado/livello scolastico;
- generazione knowledge base;
- modifica knowledge base;
- generazione piano;
- modifica piano;
- generazione contenuti via stream;
- chat di supporto sull'UDA;
- preview contenuti figli;
- task figli con tipo lesson/quiz/exercise;
- modifica o cancellazione contenuti figli;
- pubblicazione UDA.

---

## 18. Area docente: Desktop

Il desktop e` un workspace personale a widget.

Funzioni:

- elenco desktop;
- creazione desktop;
- rinomina;
- sfondo/wallpaper;
- riordino desktop;
- cancellazione;
- aggiunta widget;
- spostamento e ridimensionamento widget;
- aggiornamento configurazione widget;
- cancellazione widget;
- assistente desktop che riceve contesto su widget, calendario, sessione e ruolo.

Widget disponibili dal codice:

- orologio;
- tasklist;
- note;
- calendario;
- calendario settimanale;
- Oggi imparo;
- riferimento immagine;
- riferimento file.

---

## 19. Area studente: Dashboard

La dashboard studente e` il contenitore dei moduli.

Funzioni:

- recupero dati sessione;
- verifica se lo studente e` congelato;
- heartbeat;
- gestione socket;
- reazione a notifiche;
- apertura automatica di compiti o documenti da notifica;
- badge/pending count dei compiti;
- navigazione mobile e desktop;
- swipe back su mobile;
- helper flottante;
- overlay live interaction;
- uscita sessione.

Moduli disponibili:

- Desktop;
- Chatbot;
- Wiki;
- ML Lab / Classificazione;
- Documenti;
- Compiti / Autovalutazione;
- Notebook;
- Classe/chat.

Desktop, Documenti, Notebook e Wiki sono sempre mostrati nella navbar studente. Chatbot, ML Lab, Compiti e chat privata/classe dipendono dalle impostazioni della sessione.

---

## 20. Area studente: Desktop

Il Desktop studente e` simile a quello docente, ma orientato al lavoro personale.

Funzioni:

- desktop personalizzabile;
- widget;
- scorciatoie ai moduli;
- note;
- calendario;
- tasklist;
- widget "Oggi imparo";
- riferimenti a immagini/file;
- assistente desktop con contesto del workspace.

---

## 21. Area studente: Chatbot

La pagina Chatbot studente e` una delle piu` ricche. Raccoglie assistenti generali, teacherbot pubblicati dal docente, RAG personale e percorsi "Oggi imparo".

### 21.1 Assistenti AI

Funzioni:

- elenco profili chatbot;
- selezione profilo;
- suggerimenti di prompt;
- conversazioni salvate;
- conteggio uso per profilo;
- nuova conversazione;
- cronologia per profilo;
- cancellazione conversazioni;
- scelta modello;
- uso modello predefinito della sessione;
- invio messaggi;
- streaming/risposta AI;
- rendering markdown;
- output strutturati;
- indicazione provider/modello e impatto/consumo.

I profili arrivano dal backend e possono rappresentare tutor, quiz coach, orale, matematica, dataset generator o altri profili configurati.

### 21.2 Allegati e drag and drop

Funzioni:

- allegare immagini e file;
- usare file trascinati da chat/documenti;
- accettare immagini generate;
- accettare dataset CSV trascinati;
- preview allegati;
- invio messaggi con file quando supportato.

### 21.3 Output interattivi

La chat studente riconosce e rende alcuni blocchi speciali:

- quiz;
- esercizi;
- CSV/dataset;
- immagini base64 o URL;
- learning units;
- menu azioni;
- selettori sessione;
- selettori studenti se generati dal modello.

Funzioni:

- quiz interattivo con scelta risposte;
- verifica risposte;
- punteggio;
- spiegazioni;
- esercizi con hint;
- download dataset CSV;
- download immagini;
- drag di immagini e CSV verso altri moduli;
- generazione immagini;
- generazione quiz da learning units.

### 21.4 Teacherbot lato studente

Funzioni:

- elenco teacherbot disponibili;
- badge "Dal docente";
- apertura conversazione con un teacherbot;
- messaggio proattivo se configurato;
- conversazioni persistenti;
- invio messaggi;
- invio messaggi con file;
- chiusura conversazione;
- possibile generazione report lato docente se il bot lo prevede.

### 21.5 RAG personale

Il RAG personale e` un workspace dentro il Chatbot.

Funzioni:

- upload multiplo di documenti;
- tipi riconosciuti: PDF, DOC/DOCX, CSV, XLS/XLSX, TXT;
- step di elaborazione: lettura, chunking, embedding, indicizzazione;
- riepilogo documento;
- concetti chiave;
- numero blocchi indicizzati;
- elenco documenti;
- selezione documenti da usare;
- selezione tutti/nessuno;
- cancellazione documenti;
- apertura passaggi/chunks;
- domanda sui documenti;
- risposta vincolata alle fonti;
- citazioni nel formato `[[n]]`;
- click sulla citazione per evidenziare la fonte;
- pannello laterale delle fonti;
- score di rilevanza;
- pagina del documento se disponibile;
- sessioni RAG salvate;
- nuova sessione RAG;
- cronologia messaggi RAG;
- filtri documenti per sessione.

La UI spiega esplicitamente il funzionamento: il documento viene diviso in blocchi, trasformato in embedding, cercato semanticamente e usato come fonte per rispondere.

### 21.6 Oggi imparo

La chat contiene un'area "Oggi Imparo" o learning sessions.

Funzioni:

- lezioni/argomenti salvati;
- sessioni con stato "solo lezione" o "chat attiva";
- espansione di una lezione in conversazione;
- generazione quiz;
- generazione immagini;
- collegamento con widget desktop "Oggi imparo".

---

## 22. Area studente: Documenti

La pagina Documenti studente permette di aprire materiali, completare consegne e creare documenti personali.

Tipi gestiti:

- documento;
- presentazione;
- foglio;
- canvas/lavagna;
- PDF;
- pagina web.

Funzioni:

- elenco bozze;
- elenco contenuti pubblicati dal docente;
- apertura documento da notifica task;
- apertura lezione o presentazione pubblicata;
- documenti read-only quando sono materiali del docente;
- nuovo documento;
- nuova presentazione;
- salvataggio automatico bozza;
- cancellazione bozza;
- rich text editor;
- slide editor;
- spreadsheet editor;
- canvas collaborativo;
- viewer PDF;
- preview pagina web;
- AI assist sul testo selezionato;
- invio/submission del documento;
- gestione margini nel documento;
- modal di invio con tipo e titolo.

---

## 23. Area studente: Compiti / Autovalutazione

Il modulo Tasks raccoglie compiti, quiz ed esercizi assegnati.

Funzioni:

- elenco compiti disponibili;
- apertura diretta da notifica;
- filtro/stato dei compiti;
- task pending;
- quiz strutturati;
- esercizi;
- discussioni o consegne testuali;
- submit risposta;
- submit JSON per quiz;
- visualizzazione task gia` completati;
- integrazione con Documenti per task di tipo lezione/presentazione/documento;
- aggiornamento conteggio compiti nella dashboard.

Lato docente, le submission sono visibili nella pagina live sessione e possono essere analizzate o valutate.

---

## 24. Area studente: Classe / Chat

Il modulo Classe usa lo stesso sottosistema chat della sidebar.

Funzioni:

- chat di classe;
- messaggi realtime;
- thread/reply;
- allegati;
- upload file;
- libreria file;
- filtri file;
- messaggi privati se abilitati;
- blocco chat privata se il docente la disabilita;
- notifiche;
- lista utenti online;
- drag and drop file;
- registrazione vocale.

---

## 25. Area studente: ML Lab / Classificazione

Il modulo Classificazione e` un laboratorio ML lato studente.

Funzioni principali ricostruite dalle API e dalla pagina:

- caricamento o scelta dataset;
- creazione dataset sintetico;
- gestione dataset di sessione;
- creazione esperimento;
- scelta task type;
- configurazione esperimento;
- esecuzione esperimento;
- risultati;
- metriche;
- grafici/visualizzazioni;
- spiegazione esperimento via AI;
- download/esportazione dove previsto dalla UI;
- uso di dataset generati nel chatbot.

Il file e` strutturalmente un'app autonoma: combina form, dati, training flow e visualizzazione.

---

## 26. Area studente: Notebook

Lo studente usa lo stesso ambiente notebook, inserito nella dashboard senza routing separato.

Funzioni:

- lista notebook;
- creazione notebook Python, p5.js, Game 2D, Strudel;
- apertura notebook;
- celle codice;
- esecuzione;
- preview live;
- tutor AI;
- assistenza sugli errori;
- salvataggio;
- librerie;
- output;
- progetti personali.

---

## 27. Area studente: Wiki

La Wiki studente spiega i moduli dal punto di vista operativo.

Sezioni:

- Chatbot;
- Documenti;
- Notebook;
- ML Lab;
- Compiti, Classe e Desktop.

Per ogni funzione mostra:

- descrizione;
- esempi;
- flusso standard;
- opzioni extra;
- se e` condivisa con la classe;
- output atteso.

---

## 28. Funzioni trasversali

### 28.1 Realtime

La piattaforma usa socket per:

- presenza studenti;
- stato online/offline;
- aggiornamento moduli;
- stato freeze;
- notifiche;
- messaggi chat;
- submission task;
- revoca accesso sessione;
- eventi live interaction;
- attivita` studente.

### 28.2 File

Funzioni file:

- upload via URL;
- completamento upload;
- download URL;
- file di sessione;
- ownership docente/studente;
- scope user/session;
- allegati chat;
- documenti RAG;
- file in teacherbot KB.

### 28.3 Crediti

Funzioni visibili e API:

- balance docente/studente;
- storico crediti;
- limiti;
- statistiche;
- conteggio costo per provider/modello;
- consumo per chat, teacherbot, immagini, report e altre generazioni.

### 28.4 Profili e personalizzazione

Funzioni:

- avatar docente;
- avatar studente;
- accent color docente;
- accent color studente;
- lingua UI;
- sfondo chat docente;
- desktop personalizzati;
- widget personalizzati.

### 28.5 Trasparenza tecnica nelle risposte AI

In piu` punti l'interfaccia mostra:

- provider;
- modello;
- uso token quando disponibile;
- footprint/impatti stimati;
- fonti e citazioni nei flussi RAG;
- stato di elaborazione dei documenti.

---

## 29. Mappa sintetica pagina per pagina

### Docente

- `/teacher`: chat supporto docente e teacherbot.
- `/teacher/classes`: classi, sessioni collegate, inviti docenti.
- `/teacher/sessions`: elenco/gestione sessioni.
- `/teacher/sessions/:sessionId`: regia live, studenti, moduli, modello default, compiti, storico.
- `/teacher/demo`: anteprima studente.
- `/teacher/documents`: editor documenti, slide, fogli, canvas e pagine web; pubblicazione in sessione.
- `/teacher/wiki`: guida funzionale docente.
- `/teacher/ml-lab`: laboratorio ML docente.
- `/teacher/3d-lab`: generazione immagini e modelli 3D.
- `/teacher/notebooks`: lista notebook.
- `/teacher/notebooks/notebook/:notebookId`: editor notebook.
- `/teacher/live-interaction`: builder interazioni live.
- `/teacher/live-interaction/:interactionId/control`: controllo live e risultati.
- `/teacher/classes/:classId/uda`: lista UDA.
- `/teacher/classes/:classId/uda/:udaId`: creator UDA.
- `/teacher/desktop`: desktop a widget.

### Studente

- `/join`: ingresso con codice, nickname e password.
- `/student`: dashboard modulare della sessione.
- Modulo Desktop: workspace personale a widget.
- Modulo Chatbot: assistenti AI, teacherbot, RAG personale, Oggi imparo.
- Modulo Documenti: materiali, editor, consegne, PDF/web.
- Modulo Compiti: quiz, esercizi e submission.
- Modulo Classe/Chat: chat sessione, allegati, privato se abilitato.
- Modulo ML Lab/Classificazione: dataset, esperimenti, risultati.
- Modulo Notebook: coding notebook e tutor AI.
- Modulo Wiki: guida studente.

---

## 30. Cosa rende la piattaforma "funzionale" nel lavoro quotidiano

In termini pratici, la piattaforma copre questi bisogni:

- preparare materiali;
- creare quiz ed esercizi;
- pubblicare consegne;
- gestire sessioni live;
- far entrare studenti con codice;
- osservare attivita` e cronologie;
- comunicare con la classe;
- dare assistenti AI controllati agli studenti;
- usare documenti come fonti interrogabili;
- far lavorare gli studenti su documenti e notebook;
- fare laboratori ML;
- gestire interazioni live;
- costruire UDA;
- mantenere una traccia di conversazioni, consegne, report e materiali.

Il punto da tenere presente e` che molte funzioni sono gia` collegate fra loro: il valore operativo non e` nella singola chat o nel singolo editor, ma nel passaggio da generazione, revisione, pubblicazione, lavoro studente e lettura dei risultati.
