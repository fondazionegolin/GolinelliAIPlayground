# Golinelli AI Playground

## Documento di sintesi per la stampa

Versione: 8 maggio 2026

Nota: questo documento e` una sintesi comunicativa basata sul repository applicativo, sulla documentazione interna disponibile e su fonti normative ufficiali UE e italiane. Non sostituisce una valutazione legale formale, una DPIA GDPR o una FRIA AI Act.

---

## 1. Che cos'e`

Golinelli AI Playground e` una piattaforma digitale per la scuola progettata per integrare l'intelligenza artificiale dentro il lavoro reale di docenti e studenti, non accanto ad esso. Non nasce come semplice chatbot generalista, ma come ambiente didattico strutturato in cui l'AI supporta lezioni, materiali, esercitazioni, spiegazioni, attivita` laboratoriali e interazioni in classe.

L'idea centrale e` semplice: l'AI deve essere utile, comprensibile e governabile. Per questo la piattaforma e` costruita attorno a ruoli distinti, flussi scolastici riconoscibili e una supervisione adulta esplicita.

---

## 2. Come funziona

La piattaforma opera in un ambiente separato per istituto o tenant, con accessi differenziati per amministratori, docenti e studenti.

Il docente crea classi e sessioni, abilita i moduli didattici necessari e puo` pubblicare strumenti o attivita` per il gruppo. Lo studente entra nella sessione con credenziali dedicate, usa i moduli disponibili e interagisce con assistenti AI, contenuti, documenti e attivita` assegnate.

L'AI e` presente in piu` forme:

- come assistente conversazionale di supporto allo studio;
- come generatore guidato di quiz, materiali, immagini e dataset;
- come motore RAG per interrogare documenti caricati;
- come supporto a notebook, workspace documentali e laboratori pratici;
- come assistente specializzato pubblicato dal docente per una classe o per un'attivita` specifica.

La piattaforma combina quindi AI generativa, gestione della classe, contenuti didattici e collaborazione in tempo reale in un unico ambiente.

---

## 3. Caratteristiche di punta

### 3.1 AI nativa nel flusso didattico

L'AI non e` un'aggiunta esterna: e` inserita dentro lezioni, compiti, materiali, chat di classe, studio individuale e attivita` laboratoriali. Questo riduce la frammentazione tipica delle scuole che oggi usano una piattaforma per la classe, una per i documenti e strumenti AI separati e non governati.

### 3.2 Teacherbot e assistenti specializzati

Il docente puo` configurare, testare e pubblicare assistenti dedicati con identita`, prompt, stile, ambito disciplinare e regole operative specifiche. Gli assistenti possono essere proattivi, avviare interazioni guidate e, se abilitato, generare report delle conversazioni.

### 3.3 RAG con fonti esplicite

La piattaforma puo` trasformare documenti caricati in una knowledge base interrogabile. Lo studente non riceve solo una risposta: puo` vedere i passaggi usati, le fonti richiamate e il legame fra domanda e documento. Questo aumenta trasparenza, verificabilita` e qualita` didattica.

### 3.4 Ambiente multimodale

Chat, documenti, immagini, quiz, dataset, file e workspace convivono nello stesso ecosistema. E` un punto distintivo rispetto a molte piattaforme scolastiche che gestiscono i materiali ma non l'interazione generativa, oppure usano chatbot scollegati dalle attivita` reali.

### 3.5 Notebook e laboratori

La presenza di notebook, assistenza contestuale e moduli ML no-code consente di usare l'AI non solo per chiedere risposte, ma per esplorare dati, programmare, costruire ragionamenti e svolgere attivita` operative.

### 3.6 Chat live e regia della classe

La piattaforma supporta sessioni vive di lezione, con canali di comunicazione, notifiche, attivita` pubblicate e interazioni osservabili dal docente. Questo rende l'AI parte di una regia didattica, non di un uso individuale opaco.

### 3.7 Architettura governabile

L'infrastruttura supporta multi-tenancy, controllo per ruoli, audit log, storage dedicato, piu` provider LLM e anche scenari con inferenza locale. Questo e` importante per scuole e fondazioni che vogliono mantenere controllo tecnico e organizzativo sul servizio.

---

## 4. Privacy e tutela dei minori: impostazione GDPR e AI Act

### 4.1 Impostazione generale

Nel contesto scolastico la soglia di attenzione deve essere piu` alta della media, perche' la piattaforma tratta dati di minori, dati educativi e interazioni che possono avere impatto sul percorso di apprendimento. Per questo la postura corretta non e` "AI libera", ma "AI consentita entro regole chiare, minimizzazione dei dati e supervisione umana".

Dal punto di vista del design applicativo, Golinelli AI Playground presenta elementi coerenti con questa impostazione:

- segregazione dei dati per tenant, classe e sessione;
- ruoli distinti e controllo degli accessi;
- uso di nickname studente nel flusso sessione, con pseudonimizzazione operativa;
- audit trail degli eventi;
- supervisione docente sui flussi didattici;
- assenza, nel posizionamento previsto, di scoring sociale o decisioni disciplinari automatiche;
- possibilita` di usare anche modelli locali, riducendo l'esposizione verso provider esterni.

### 4.2 Inquadramento AI Act al 8 maggio 2026

Alla data dell'8 maggio 2026 il Regolamento (UE) 2024/1689 e` gia` in vigore, ma la piena applicabilita` generale decorre dal 2 agosto 2026. Sono gia` applicabili dal 2 febbraio 2025 le norme sulle pratiche vietate e gli obblighi di AI literacy.

Per una piattaforma scolastica come questa il punto chiave e` il seguente:

- se l'AI e` usata come supporto didattico, assistenza, generazione contenuti o consultazione di fonti, il caso d'uso e` normalmente da presidiare soprattutto sul piano della trasparenza e della governance;
- se invece l'AI viene usata per ammissione, assegnazione a percorsi, valutazione dei risultati di apprendimento che incidono sul percorso, determinazione del livello educativo o sorveglianza di comportamenti vietati durante test, si entra in aree che l'AI Act considera high-risk in ambito education.

Per questo la piattaforma e` piu` solida quando resta chiaramente posizionata come strumento di supporto all'insegnamento e all'apprendimento, con decisione finale sempre umana.

### 4.3 Tutela dei minori secondo AI Act

L'AI Act dedica particolare attenzione ai soggetti vulnerabili, inclusi i minori. In un contesto scolastico sono particolarmente rilevanti questi principi:

- divieto di pratiche manipolative o ingannevoli che alterino in modo significativo il comportamento;
- divieto di sfruttamento delle vulnerabilita` legate all'eta`;
- divieto, salvo eccezioni mediche o di sicurezza, di sistemi di emotion recognition nelle istituzioni educative;
- obbligo di rendere comprensibile quando si interagisce con un sistema AI;
- obbligo di formare il personale che usa o gestisce il sistema.

Tradotto in pratica: una piattaforma scolastica responsabile deve essere leggibile, non persuasiva in modo occulto, non invasiva sul piano emotivo e non deve sostituire il giudizio adulto.

### 4.4 Tutela dei minori secondo GDPR

Nel GDPR, applicato al contesto scolastico, i principi piu` rilevanti sono:

- liceita`, correttezza e trasparenza;
- limitazione delle finalita`;
- minimizzazione dei dati;
- esattezza e aggiornamento;
- limitazione della conservazione;
- integrita` e riservatezza;
- protezione dei dati fin dalla progettazione e per impostazione predefinita;
- misure di sicurezza adeguate;
- valutazione d'impatto quando il rischio e` elevato.

Per una piattaforma educativa con minori questo significa, in concreto:

- raccogliere solo i dati necessari;
- spiegare bene a scuole, docenti, famiglie e studenti come funziona l'AI;
- separare i dati scolastici dagli usi impropri o eccedenti;
- ridurre il piu` possibile la diffusione di dati identificativi;
- prevedere policy chiare su conservazione, cancellazione e accesso;
- governare in modo rigoroso i trasferimenti extra-SEE se si usano provider AI esterni.

### 4.5 Punti forti gia` valorizzabili

Sul piano della comunicazione istituzionale, i punti piu` forti sono:

- controllo per ruoli e responsabilita` differenziate;
- pseudonimizzazione operativa degli studenti nelle sessioni;
- supervisione docente integrata nel flusso;
- tracciabilita` delle attivita`;
- possibilita` di architetture con maggiore sovranita` tecnologica, inclusa inferenza locale;
- orientamento dichiarato a uso didattico e non a decisioni automatiche sugli studenti.

### 4.6 Punti da presidiare con attenzione

Per correttezza verso scuole, famiglie e stakeholder, e` importante non sovradichiarare la compliance. Alcuni aspetti richiedono infatti presidio organizzativo e, in alcuni casi, ulteriore implementazione:

- formalizzazione di una retention policy per chat, log, allegati e contenuti;
- chiarimento contrattuale dei ruoli GDPR tra provider, deployer e fornitori;
- verifica documentata di DPA, SCC e politiche no-training o zero-retention dei provider esterni;
- informativa AI ancora piu` esplicita in interfaccia e nella documentazione;
- DPIA GDPR per i trattamenti a rischio elevato;
- FRIA AI Act se la piattaforma venisse impiegata in use case education high-risk;
- procedure scritte che escludano decisioni rilevanti sugli studenti senza revisione umana.

In altri termini: la piattaforma ha una base tecnica seria, ma la conformita` piena dipende sempre anche da contratti, configurazione di deployment, policy e governance dell'ente che la adotta.

---

## 5. Innovazione rispetto ad altre piattaforme scolastiche

Golinelli AI Playground si differenzia da molte piattaforme scolastiche tradizionali non solo perche' "ha l'AI", ma per il modo in cui la colloca nel processo educativo.

### 5.1 Dalla piattaforma contenitore alla piattaforma orchestratrice

Molti ambienti scolastici digitali archiviano compiti, file e comunicazioni. Qui invece la piattaforma orchestra attivita`, conversazioni, materiali, fonti, laboratori e assistenti in un unico spazio didattico.

### 5.2 Dall'AI generica all'AI contestualizzata

Invece di lasciare studenti e docenti da soli davanti a un chatbot generalista, la piattaforma offre profili, assistant specializzati, prompt guidati, moduli disciplinari e pubblicazione controllata da parte del docente.

### 5.3 Dalla risposta opaca alla risposta verificabile

Con il RAG e con la logica delle fonti esplicite, l'AI puo` motivare meglio quello che dice. Questo e` un salto importante in ambito scuola, dove l'affidabilita` deve poter essere discussa e verificata.

### 5.4 Dall'uso individuale all'uso di classe

Molti strumenti AI sono pensati per un uso solitario. Qui l'AI entra in una dinamica di gruppo: sessioni, materiali condivisi, pubblicazioni docente, chat di classe, attivita` assegnate e monitoraggio adulto.

### 5.5 Dalla semplice generazione alla produzione didattica

La piattaforma non si limita a "scrivere testi": aiuta a costruire quiz, documenti, dataset, immagini, notebook, report e percorsi didattici. L'innovazione sta nella filiera completa, non nel singolo output.

### 5.6 Dalla dipendenza da un unico fornitore alla governance del modello

Il supporto multi-provider e l'opzione di modelli locali aprono una strada piu` matura per la scuola: non solo scegliere il modello piu` performante, ma scegliere il perimetro di rischio, il livello di controllo e la politica dati piu` adeguata.

---

## 6. La visione "Teacher in the Loop"

Il principio piu` distintivo della piattaforma e` la visione teacher in the loop.

Qui il docente non e` aggirato dall'automazione e non viene ridotto a semplice validatore finale. Al contrario, e` il soggetto che:

- decide quali strumenti rendere disponibili;
- imposta il contesto didattico;
- pubblica assistenti e materiali;
- controlla il perimetro di uso dell'AI;
- interpreta gli output nel contesto della relazione educativa;
- mantiene la responsabilita` sulle decisioni che riguardano gli studenti.

Questa impostazione e` importante per tre ragioni.

La prima e` pedagogica: l'apprendimento non e` solo risposta corretta, ma guida, interpretazione, relazione e gradualita`.

La seconda e` etica: studenti, specialmente se minorenni, non dovrebbero interagire con sistemi opachi e autonomi senza mediazione adulta consapevole.

La terza e` regolatoria: AI Act e GDPR spingono entrambi verso trasparenza, accountability, supervisione umana e riduzione del rischio.

In questa prospettiva, la piattaforma propone una scuola in cui l'AI e` visibile, dichiarata, osservabile e contestabile. Non una "scatola nera" che decide, ma uno strumento che aiuta sotto il controllo di adulti responsabili.

---

## 7. Formula sintetica per presentazioni e materiali stampa

Golinelli AI Playground e` una piattaforma educativa AI-native pensata per portare l'intelligenza artificiale nella scuola in modo utile, trasparente e governabile. Unisce assistenti specializzati, documenti, fonti verificabili, attivita` laboratoriali e regia della classe in un unico ambiente, mantenendo il docente al centro del processo e adottando un'impostazione orientata a privacy, tutela dei minori e supervisione umana.

---

## 8. Messaggi chiave finali

1. Non e` un chatbot generico travestito da piattaforma scolastica: e` un ambiente didattico strutturato.
2. L'innovazione non e` solo nell'AI, ma nella sua integrazione governata nei flussi reali della scuola.
3. Il docente resta centrale: l'AI supporta, non sostituisce.
4. Trasparenza, fonti, audit e ruoli distinti rendono l'uso dell'AI piu` leggibile e controllabile.
5. Privacy e tutela dei minori non sono accessori reputazionali, ma criteri di progetto e di governance.
6. La piena conformita` richiede sempre anche contratti, policy, formazione e scelte di deployment coerenti con il quadro AI Act e GDPR.

---

## 9. Riferimenti essenziali

- Regolamento (UE) 2024/1689 - AI Act
- Regolamento (UE) 2016/679 - GDPR
- Commissione europea, timeline applicativa AI Act
- Garante per la protezione dei dati personali, area Scuola e FAQ Scuola e privacy
- Ministero dell'Istruzione e del Merito, Linee guida per l'introduzione dell'Intelligenza Artificiale nelle istituzioni scolastiche (DM n. 166 del 9 agosto 2025)
