# Brief UI/UX per revisione di Golinelli.ai

Data: 26 giugno 2026

Questo documento serve a coinvolgere due studenti di UI/UX in un progetto di revisione dell'interfaccia di Golinelli.ai. Non è una specifica tecnica e non richiede di conoscere il codice. Riassume lo stato attuale del prodotto, le scelte di design system già presenti, i flussi principali e le aree che meritano una valutazione critica.

## 1. Contesto del prodotto

Golinelli.ai è una piattaforma didattica per l'uso guidato dell'intelligenza artificiale in aula. Ha tre pubblici principali:

- studenti, che accedono a una sessione didattica tramite codice o link;
- docenti, che creano classi, sessioni, attività, documenti e strumenti AI per la lezione;
- amministratori, che gestiscono utenti, scuole, licenze, crediti e monitoraggio.

Il prodotto non è solo una chat AI. È un ambiente operativo per lezioni, esercizi, documenti, notebook, coding, machine learning, live interaction e gestione classe. La revisione UI/UX deve quindi considerare sia l'esperienza di primo accesso sia l'uso ripetuto durante una lezione reale.

## 2. Principi visivi attuali

Il design system attuale cerca di tenere insieme tre esigenze:

- identità di brand riconoscibile;
- interfacce operative dense, adatte a docenti e studenti;
- superfici morbide, chiare e poco aggressive per il contesto scolastico.

La palette principale deriva dal logo:

- rosa: colore più distintivo del brand e usato spesso per azioni o accenti;
- azzurro: usato per aree informative, studenti, chat e contenuti AI;
- viola: usato per sezioni creative, sovrapposizioni e alcune aree docente;
- nero/ink: usato come tono neutro forte, soprattutto per testo e controlli compatti.

Il sistema usa molte superfici bianche o semi-trasparenti, con bordi sottili, blur, ombre leggere e accenti colorati. L'effetto ricorrente è una "glass UI" molto chiara: navbar, pillole, pannelli laterali, modali e card tendono a sembrare appoggiati sopra uno sfondo bianco o leggermente colorato.

La tipografia principale usa Lufga/Lexend per l'interfaccia, con JetBrains Mono e altri font mono per codice, ID, join code, notebook e contenuti tecnici. La gerarchia tipografica è spesso molto compatta: molti testi sono in 11-14 px, con pesi forti per titoli brevi, label, badge e pulsanti.

## 3. Componenti e pattern gia presenti

La base del design system vive in `frontend/src/design` e nei token globali di `frontend/src/index.css`. Le regole attuali indicano di usare primitive condivise per pulsanti, card, input, badge, dialog, tab e spinner, evitando stili copiati dentro singole feature.

Pattern principali:

- Pulsanti: forma arrotondata, bordo colorato tenue, sfondo leggermente colorato dal tono corrente, peso tipografico alto. I pulsanti primari non sono quasi mai pieni in modo pesante; il sistema preferisce un "chrome" chiaro e colorato.
- Tab e selezioni: pillole compatte con icona e label, stato attivo colorato, stati hover morbidi.
- Navbar desktop: barra fissa in alto, logo a sinistra, navigazione centrale, cluster di controlli a destra. Docente e studente stanno convergendo verso lo stesso stile.
- Navbar mobile: esperienza separata e più compatta, spesso con menu espandibile o bottom/overlay navigation.
- Card: usate per moduli, riepiloghi, tile e contenuti ripetuti. Molte card hanno bordi leggeri, background bianco o gradienti pastello.
- Modali: usate per impostazioni, pubblicazione, creazione documenti, consenso legale, editor e pannelli contestuali.
- Sidebar: la chat di classe è una sidebar ridimensionabile su desktop e diventa esperienza più immersiva o separata su mobile.
- Badge e pillole: indicano ruolo, crediti, stato live, join code, notifiche, moduli attivi, conteggi e filtri.

Una scelta importante è il tema per ruolo: docente, studente e admin condividono lo stesso sistema, ma impostano variabili di accento diverse. Questo permette di cambiare il colore dominante senza riscrivere i componenti.

## 4. Architettura UX generale

L'app si divide in quattro grandi aree:

- sito pubblico e accesso;
- esperienza docente;
- esperienza studente;
- esperienza admin.

Il sito pubblico introduce il prodotto, mostra sezioni per docenti e studenti, include accesso, documenti privacy/AI Act e lingua. L'esperienza è più editoriale rispetto al resto dell'app.

L'area docente è un cockpit. Il docente deve creare e gestire contenuti, seguire la classe in tempo reale, pubblicare attività, vedere notifiche, usare strumenti AI e passare rapidamente da una sessione all'altra. La densità informativa è alta.

L'area studente è un ambiente di lavoro per una sessione. Lo studente entra, vede i moduli disponibili, usa chatbot, documenti, notebook, coding, ML lab, compiti, chat classe e strumenti live. L'interfaccia deve essere chiara anche per utenti giovani e con basso training.

L'area admin è più gestionale: utenti, scuole, licenze, crediti, uso e configurazioni. Qui contano chiarezza, scansione veloce delle tabelle, stati e azioni amministrative.

## 5. Flusso pubblico e accesso

Flussi da osservare:

1. Visitatore arriva sulla landing.
2. Sceglie tra esplorazione, docenti o studenti.
3. Docente può accedere o richiedere/attivare account.
4. Studente entra tramite codice sessione.
5. Utente vede privacy, termini e AI Act.
6. In caso di account docente, può passare da login, attivazione e reset password.

Punti da rivedere:

- La landing comunica chiaramente cosa fa il prodotto in meno di 30 secondi?
- La differenza tra area docente e area studente è immediata?
- Lo studente capisce dove inserire il codice e cosa succede dopo?
- Privacy, consenso e termini sono visibili senza bloccare inutilmente l'accesso?
- Il tono visivo pubblico è coerente con quello operativo dentro l'app?

## 6. Flusso docente

Il docente entra in una dashboard con navbar desktop fissa. La navigazione principale include support chat, classi, documenti, ML lab, notebook, coding, live interaction, 3D lab e Toy LM. La navbar contiene anche:

- selettore sessione attiva;
- calendario/orologio;
- notifiche;
- chat classe;
- crediti AI;
- avatar e impostazioni.

Flussi principali da osservare:

1. Creare o selezionare una classe.
2. Creare o aprire una sessione.
3. Invitare studenti o condividere codice.
4. Monitorare studenti online.
5. Usare chat pubblica o privata.
6. Creare attività, quiz, documenti o materiali.
7. Pubblicare contenuti a una sessione.
8. Gestire notifiche e segnalazioni.
9. Usare strumenti speciali: notebook, coding, ML lab, live interaction, 3D lab, Toy LM.

Punti da rivedere:

- La navbar docente è potente ma molto densa. Va verificato se le priorità sono corrette: cosa deve essere sempre visibile e cosa può stare in menu?
- Il selettore sessione è centrale nel lavoro docente. Va valutato se comunica abbastanza bene sessione, classe, stato live e codice.
- La presenza contemporanea di navigazione globale, rail sessione, sidebar chat e contenuto principale può generare carico cognitivo.
- I flussi di pubblicazione attività/documenti devono essere leggibili: cosa sto creando, dove verrà pubblicato, chi lo vedrà, quando?
- Notifiche e alert devono distinguere bene urgenza, informazione, chat e consegne.
- La chat docente di supporto AI è una funzione centrale ma rischia di confondersi con chat classe e teacherbot.

## 7. Flusso studente

Lo studente entra in una sessione e vede una home con moduli disponibili. I moduli possono includere:

- chatbot;
- chat di classe;
- documenti;
- notebook;
- coding lab;
- ML lab;
- compiti/autovalutazione;
- desktop;
- wiki;
- live interaction overlay.

Su desktop la navbar studente usa un modello simile a quella docente: logo, tab di navigazione, cluster con orologio, sessione, chat, crediti e profilo. Su mobile l'esperienza è più autonoma: top bar compatta, menu a griglia e tile di accesso ai moduli.

Flussi principali da osservare:

1. Entrare con codice sessione.
2. Capire quale lezione/sessione è attiva.
3. Scegliere un modulo dalla home.
4. Tornare alla home o cambiare modulo.
5. Usare chatbot o teacherbot.
6. Rispondere a compiti o live interaction.
7. Aprire documenti o notebook.
8. Usare chat classe o privata, se abilitata.
9. Gestire profilo, lingua, avatar e colore accento.

Punti da rivedere:

- La home studente aiuta davvero a scegliere il modulo giusto o sembra un elenco di strumenti?
- Le label dei moduli sono comprensibili per studenti non tecnici?
- La differenza tra chatbot, teacherbot, chat classe e supporti AI deve essere chiarita.
- Il passaggio desktop/mobile non deve cambiare troppo il modello mentale.
- Gli stati di attività assegnata, attività completata, contenuto nuovo e notifica vanno resi più leggibili.
- Le interfacce specialistiche come notebook, coding e ML lab devono avere un onboarding leggero ma non invadente.

## 8. Chat, AI e comunicazione in tempo reale

La piattaforma ha più forme di conversazione:

- chat classe;
- chat privata docente-studente;
- chatbot studente;
- support chat docente;
- teacherbot pubblicati dal docente;
- helper flottante;
- notifiche real time;
- voice room o interazione live.

Questa è probabilmente una delle aree UX più delicate. L'utente può non capire se sta parlando con:

- un compagno o docente;
- un assistente AI generico;
- un assistente creato dal docente;
- un supporto tecnico/didattico;
- un canale pubblico o privato.

Punti da rivedere:

- Nomi, icone e colori dei diversi canali conversazionali.
- Indicatori di pubblico/privato.
- Indicatori "AI" vs "persona".
- Notifiche e unread count.
- Invio allegati, file, immagini e messaggi vocali.
- Stato online, live, typing/loading e messaggi in errore.
- Coerenza tra chat su desktop e mobile.

## 9. Documenti, notebook, coding e laboratori

L'app contiene moduli molto diversi tra loro. Alcuni sono ambienti di scrittura, altri ambienti tecnici o creativi.

Documenti:

- editor documenti, presentazioni e canvas;
- pubblicazione alla classe/sessione;
- gestione consegne o materiali.

Notebook:

- lista notebook;
- editor notebook;
- celle, output, tutor, strumenti hardware e microbit/Circuit Playground.

Coding:

- editor/progetto web;
- preview;
- pubblicazione sito;
- condivisione con studenti.

ML lab, 3D lab, Toy LM:

- laboratori specialistici;
- molta complessità funzionale;
- necessità di spiegare stato, input richiesti, output e prossima azione.

Punti da rivedere:

- Ogni modulo ha una struttura visiva coerente con gli altri?
- Gli strumenti tecnici sono riconoscibili senza sovraccaricare lo schermo?
- La gerarchia tra area di lavoro, toolbar, anteprima, output e chat AI è chiara?
- Ci sono stati vuoti utili o solo schermate tecniche?
- I moduli avanzati hanno percorsi "primo utilizzo" e "uso esperto" distinguibili?

## 10. Admin e gestione

L'area admin ha obiettivi diversi rispetto a docente e studente: deve aiutare a controllare il sistema, non a vivere la lezione.

Flussi da osservare:

- gestione utenti e ruoli;
- scuole/classi/tenant;
- crediti e limiti;
- inviti docenti;
- usage e monitoraggio;
- licenze;
- feedback e richieste.

Punti da rivedere:

- Tabelle, filtri e metriche sono leggibili?
- Le azioni distruttive o amministrative hanno conferme adeguate?
- Le informazioni economiche/crediti/licenze sono comprensibili?
- Gli stati degli utenti sono chiari: attivo, invitato, verificato, sospeso, ecc.
- L'admin dovrebbe avere un linguaggio visivo più sobrio e meno didattico?

## 11. Problemi trasversali da indagare

### Coerenza

Il prodotto è cresciuto molto e alcune aree sembrano nate in momenti diversi. Va verificata la coerenza tra:

- navbar docente e studente;
- desktop e mobile;
- landing pubblica e app operativa;
- componenti nuovi e componenti legacy;
- modali, dropdown, card e pulsanti;
- label in italiano e inglese.

### Densità

Molte schermate sono operative e ricche di strumenti. La domanda non è solo "è bello?", ma "riesco a trovare l'azione giusta durante una lezione?". La revisione deve distinguere tra:

- utenti alle prime armi;
- docenti esperti;
- studenti piccoli o poco autonomi;
- amministratori.

### Accessibilità

Da rivedere:

- contrasto dei colori del logo usati come testo;
- focus da tastiera;
- dimensione target touch;
- leggibilità dei testi piccoli;
- uso di icone senza label;
- stati disabled e loading;
- modali e dropdown con chiusura chiara;
- compatibilità mobile reale.

### Linguaggio

Molte funzioni hanno nomi tecnici o misti: ML lab, Toy LM, notebook, teacherbot, desktop, wiki, live. Va valutato se il naming è comprensibile per studenti, docenti e amministratori.

### Stato e feedback

Il sistema deve comunicare meglio:

- cosa è stato salvato;
- cosa è in pubblicazione;
- cosa è visibile agli studenti;
- cosa è in errore;
- cosa è in attesa;
- cosa consuma crediti AI;
- quando la sessione è live;
- chi è online.

## 12. Cosa chiedere agli studenti UI/UX

Si propone di dividere il lavoro tra due studenti, con momenti di confronto comuni.

### Studente A: mappa UX e flussi

Obiettivo: capire se i percorsi principali sono chiari, completi e coerenti.

Attività:

- mappare i flussi docente più importanti;
- mappare i flussi studente più importanti;
- identificare punti di attrito, doppioni e passaggi poco chiari;
- proporre una nuova architettura informativa se necessario;
- definire priorità: cosa sistemare subito, cosa può aspettare.

Output attesi:

- flow map docente;
- flow map studente;
- elenco problemi ordinati per gravità;
- proposta di navigazione globale e contestuale;
- raccomandazioni su naming e microcopy.

### Studente B: UI system e componenti

Obiettivo: rendere l'interfaccia più coerente, scalabile e leggibile.

Attività:

- analizzare palette, tipografia, spaziature, radius, ombre e superfici;
- creare inventario dei componenti ricorrenti;
- individuare varianti duplicate o incoerenti;
- proporre linee guida per card, toolbar, navbar, pillole, modali, form e tabelle;
- verificare accessibilità visiva e responsive.

Output attesi:

- audit visivo del design system;
- proposta di component library o mini style guide;
- esempi di redesign per 3-5 schermate chiave;
- regole di utilizzo dei colori e degli stati;
- checklist accessibilità.

## 13. Schermate consigliate per la revisione

Priorità alta:

- Landing e accesso studente.
- Navbar docente e selettore sessione.
- Home studente desktop e mobile.
- Chat classe e chatbot studente.
- Dashboard/sessione live docente.
- Creazione e pubblicazione di un'attività.
- Documenti docente e documenti studente.
- Notebook/coding come ambienti complessi.
- Admin utenti/crediti.

Priorità media:

- Impostazioni profilo e cambio accento.
- Modali di pubblicazione.
- Notifiche docente.
- Live interaction.
- Wiki e pagine informative.
- Privacy/termini/consenso legale.

## 14. Domande guida per la revisione

- Qual è l'azione primaria in ogni schermata?
- L'utente capisce sempre dove si trova?
- L'utente capisce se sta lavorando come docente, studente o admin?
- La sessione attiva è sempre visibile quando serve?
- I moduli sono organizzati per logica didattica o per tecnologia?
- Le icone aiutano o creano ambiguità?
- Cosa succede quando non ci sono dati?
- Cosa succede quando qualcosa va in errore?
- Il consumo dei crediti AI è sufficientemente trasparente?
- Le notifiche sono utili o rumorose?
- Mobile e desktop raccontano lo stesso prodotto?
- Quali elementi si possono semplificare senza perdere potenza?

## 15. Deliverable finali suggeriti

Alla fine del progetto, gli studenti dovrebbero consegnare:

- un audit UX con problemi, evidenze e priorità;
- una mappa dei flussi principali docente/studente;
- una proposta di architettura di navigazione;
- una style guide aggiornata o integrazione al design system;
- wireframe o mockup di schermate chiave;
- prototipo cliccabile per almeno un flusso docente e uno studente;
- checklist per futura implementazione;
- elenco di quick wins applicabili subito.

## 16. Vincoli da rispettare

La revisione non deve ignorare il prodotto esistente. Le proposte devono partire da questi vincoli:

- mantenere riconoscibile il brand Golinelli.ai;
- supportare italiano e inglese;
- funzionare su desktop e mobile;
- non semplificare eliminando funzioni essenziali per la lezione;
- distinguere chiaramente docente, studente e admin;
- prevedere stati vuoti, loading, errore, offline e permessi limitati;
- considerare accessibilità e contesto scolastico;
- proporre miglioramenti implementabili progressivamente.

## 17. Riferimenti tecnici utili per orientarsi

Per chi dovrà confrontarsi anche con il team tecnico, questi sono i punti principali del codice:

- Design system: `frontend/src/design/README.md`
- Token globali: `frontend/src/index.css`
- Palette: `frontend/src/design/tokens/color.ts`
- Temi per ruolo: `frontend/src/design/themes/roleThemes.ts`
- Routing principale: `frontend/src/App.tsx`
- Navbar docente: `frontend/src/components/TeacherNavbar.tsx`
- Navbar studente: `frontend/src/components/StudentNavbar.tsx`
- Chat/sidebar classe: `frontend/src/components/ChatSidebar.tsx`
- Dashboard docente: `frontend/src/pages/teacher/TeacherDashboard.tsx`
- Dashboard studente: `frontend/src/pages/student/StudentDashboard.tsx`
- Landing/accesso: `frontend/src/pages/LandingPage.tsx`

Questi riferimenti non sono richiesti per disegnare le proposte, ma aiutano a capire quali pattern sono già consolidati e quali aree sono ancora in transizione.

## 18. Esito desiderato

L'obiettivo della revisione non è cambiare "look" in modo superficiale. L'obiettivo è rendere Golinelli.ai più chiaro, coerente e affidabile durante l'uso reale in classe.

Una buona proposta dovrebbe:

- ridurre il carico cognitivo;
- chiarire i ruoli e i canali di comunicazione;
- rendere più leggibili gli stati;
- far emergere le azioni importanti;
- mantenere la ricchezza funzionale;
- creare un design system più disciplinato e facile da estendere.
