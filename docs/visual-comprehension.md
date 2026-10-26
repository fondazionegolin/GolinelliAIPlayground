# Comprensione visuale — Beta

Accesso: pannello docente, **Beta → Comprensione visuale**, percorso
`/teacher/visual-comprehension`. Voce, pagina e API restano riservate agli admin.
Le sessioni sono private: ogni richiesta verifica anche il proprietario.

## Spazio di lavoro

Canvas a sinistra e una sola conversazione a destra, con ingresso libero:
risposte, dubbi, richieste di spiegazione e nuovi approfondimenti usano lo
stesso campo. Non ci sono verifiche bloccanti, gallerie sotto l'immagine,
schede quiz o timeline obbligatorie.

L'immagine occupa tutto lo spazio del canvas disponibile. Zoom, trascinamento,
adattamento e schermo intero sono controlli manuali. I disegni SVG restano
allineati alla sorgente oppure occupano una lavagna affiancata nello stesso
canvas. Un comando permette di inquadrare solo la lavagna. Il disegno di una
risposta precedente può essere richiamato dal relativo messaggio.

## Disegni alla lavagna

Il tutor prepara una consegna grafica per una seconda fase di composizione
visuale (`visual_blackboard.py`). Non basta restituire rettangoli colorati:
la scena deve contenere strumenti esplicativi. Il catalogo comprende linee,
frecce, tracciati, forme, parentesi, numeri, testo, formule LaTeX e collegamenti
fra una regione dell'immagine e un disegno. Gli strumenti specializzati
costruiscono grafici con assi e curve, diagrammi a nodi collegati, diagrammi
di chitarra con corde/tasti/diteggiatura e sequenze ritmiche con durate.

Le scene hanno fino a otto fasi di costruzione. I comandi nel canvas permettono
di riprodurle, fermarle, avanzare una fase o mostrare tutto. Disegni e fasi sono
salvati con il messaggio e con lo stato della sessione; non servono pannelli
aggiuntivi sotto l'immagine. Le sessioni precedenti senza disegni sono compatibili.

Il modello produce dati tipizzati, non SVG o JavaScript eseguibili. Coordinate,
dimensioni, collegamenti e strumenti sono validati. Le curve sono calcolate
dal renderer con funzioni prestabilite o serie di punti, senza `eval`;
le formule sono rese da KaTeX con `trust: false`.

## Disegno ancorato e animazione (v2)

Le scene definiscono `points` con nome (angoli/centro di una regione, punto medio, piede della
perpendicolare, intersezione, interpolazione, bordo di un altro segno): le coordinate derivate le calcola
`sceneGeometry.ts`, non il modello. Strumenti aggiunti: `polygon`, `arc`, `right_angle`, `circle`, `tick`,
`dimension`, `callout`, `highlight`, `lens` (zoom dei pixel reali), `numberline` e `plot` calibrato sugli
assi della sorgente (`anchors=[origine, tacca x(, tacca y)]`; il numero letto sulla tacca prevale su `x_ref`,
senza tacca y vale la griglia quadrata). Il layout predefinito è sopra l'immagine.

Prima del disegno `sceneLint.ts` fa da revisore deterministico: alza il testo sotto 11 px, piazza le
etichette dei richiami fuori dalla sorgente (testi e piccole regioni come vertici e tacche), sposta le
scritte che coprono contenuti, allinea i quasi-allineamenti e segnala widget sopra la sorgente e fasi troppo dense.

Le risposte nuove si disegnano da sole come alla lavagna (`drawingTimeline.ts`): un segno dopo l'altro,
tratti a velocità proporzionale alla lunghezza, scritte riga per riga, gesso che segue il tratto, pausa fra le
fasi. Le sessioni riaperte mostrano il disegno completo; "Rivedi" lo riproduce.

## Canvas infinito, grafica e revisore (v3)

La sorgente è una card su un canvas infinito (pan con trascinamento, zoom con rotella/pinch sul cursore,
doppio clic = adatta tutto). La regia può aprire fino a 3 lavagne (`boards`: side right/left/below/above,
dimensioni in multipli dell'immagine) e indicare per fase cosa inquadrare (`focus`); senza `focus` la camera
segue i segni della fase. Durante la riproduzione la camera vola da una zona all'altra, alla fine inquadra tutto.

Strumenti grafici: tratti morbidi (Catmull-Rom → Bézier, `sharp` per spezzate vere), frecce e connettori ad arco
(`bend`) con punte allineate alla tangente, richiami a pillola con filo curvo e "pin" sul punto, graffe vere con
etichetta (annotazione di termini), spotlight sfumato durante la sua fase, curva `gaussian`. Palette armonica con
colori di testo più scuri per il contrasto. Le etichette delle graffe passano dal posizionatore anti-collisione.

Revisore estetico (`visual_review.py`, ruolo `vision.critic`): dopo una nuova risposta il browser rende il disegno
finale (`snapshot.tsx`: card + disegno, formule in testo semplice), il server lo fa valutare 1–5 su leggibilità,
allineamento, chiarezza, sobrietà e applica operazioni tipizzate (move, resize, delete, restyle, bend, relabel,
retime, to_board) rivalidando la scena. Con un voto ≤2 o verdetto `redo` il disegno torna una volta al regista
con le note del revisore. Una sola revisione per messaggio (`focus.review`), poi parte l'animazione.
`POST /sessions/{id}/messages/{message_id}/review`.

## Percorso guidato e domande su una zona (v4)

Ogni disegno è un percorso: un passo per elemento (`steps` = nome dell'elemento, `notes` = 1–3 frasi, `focus` = la
sua regione). Un passo che indica più elementi viene diviso automaticamente (`one_element_per_step`); le lavagne vuote
vengono tolte. Sul canvas si vedono solo i segni del passo corrente (i risultati scritti dei passi precedenti restano
sbiaditi); una nuova risposta apre il passo 1 e si ferma. La scheda del passo ha Indietro/Avanti, pallini, "Chiedi su
questo" (marca l'elemento e prepara la domanda), "Vedi tutto" e una guida automatica facoltativa; ← → da tastiera.
Le evidenziazioni sono anelli di fuoco; le etichette si dimensionano sulla tipografia della sorgente.

Allineamento: dopo l'inventario e dopo ogni correzione, le regioni con testo letto vengono agganciate ai pixel reali
(`visual_snap.py`: sfondo locale, componenti connesse dentro la stima, esclusione di ciò che prosegue fuori).

Marcature dello studente (`visual_selection.py`): rettangolo, lazo, scarabocchio o pennello sulla card della sorgente;
il messaggio porta `selection` (forma, riquadro e tracciato in percentuali). Il modello riceve l'immagine, la stessa
immagine con la marcatura in magenta e il ritaglio ingrandito; la zona diventa la regione `selezione-N` (ultime 6
conservate) a cui il percorso si aggancia. Il revisore giudica un foglio con un riquadro per passo.

## Grafici esplorabili e ancoraggio all'inchiostro (v5)

Un `plot` può avere `sliders` (fino a 4: indice della curva, campo a|b|c|d o cN, nome, min/max/step) e `formula`.
Quando il passo lo mostra compare il pannello "Esplora i parametri": i cursori cambiano la curva in tempo reale, senza
eseguire espressioni (solo le famiglie previste: polinomio, sin, cos, sqrt, gaussiana, exp, log, |x|).

I pin dei richiami sulla sorgente vengono spostati sull'inchiostro più vicino (`snap_pins`), del colore nominato
nell'etichetta o nella regione ("curva blu") o del colore dominante della regione; i punti condivisi con altri segni
non vengono toccati. Un `highlight` su una regione con un colore nel nome (o con `ink: true`) illumina solo il tratto
di quel colore, estratto nel browser (`inkMask.ts`), invece del riquadro.

## Domande una volta, poi azione (v6)

Il tutor dichiara un'`action`: `explain` (percorso sull'immagine), `explorer` (grafico interattivo da costruire),
`side` (spiegazione alternativa su una lavagna). Se gli manca un'informazione indispensabile può porre fino a 4
`questions`, tutte insieme, con opzioni cliccabili (come l'intervista di Vibe Lab): il turno risponde subito senza
disegno; lo studente sceglie e invia ("Costruiscilo"). Al turno successivo le domande vengono scartate dal server e il
tutor deve agire. Con `action=explorer` un disegno senza grafico con cursori viene rifiutato e rifatto; con `side`
serve una lavagna. I cursori stanno sul canvas, sotto il grafico (che su una lavagna occupa tutta la lavagna), con la
formula a parametri e quella con i valori correnti; trascinarli non sposta il canvas. Nel composer: "Grafico
interattivo" e "Fammelo vedere di lato". Verifica a due turni: `python -m scripts.visual_eval.run_dialogue`.

## Laboratorio: grafici esplorabili ed esercizi sulla lavagna (v7)

Il tutor mette nella stessa risposta del messaggio gli oggetti interattivi (`widgets`): `explorer` (equazione con
parametri e cursori) ed `exercise` (curva da trovare, consegna, schema con caselle `[nome]` o formula libera,
suggerimenti, spiegazione). Il server li verifica con il linguaggio matematico sicuro (`visual_math.py`, gemello di
`mathExpr.ts`; nessun eval): ogni lettera è un parametro, la curva attraversa la finestra, la famiglia (retta,
parabola, circonferenza, ellisse, iperbole) è quella richiesta. Un'azione `explorer`/`exercise` senza il suo widget,
o un widget sull'argomento sbagliato, fa rifare il turno; un riconoscitore di intenzioni sul messaggio dello studente
("esercitarmi", "grafico interattivo", "di lato") impone l'azione anche quando l'immagine mostra altro.

I widget restano nella sessione (ultimi 4) e stanno nel Laboratorio, a destra della sorgente, indipendenti dal
percorso a passi (che si riduce a una pillola quando si va al Laboratorio). Nell'esercizio la curva scritta dallo
studente è disegnata in tempo reale sopra quella da trovare; il motore dice cosa sta disegnando ("stai disegnando una
retta, non un'iperbole", "vertici in ±4, quella da trovare ±3") e riconosce le forme equivalenti. Un disegno del
percorso fallito è segnalato nel messaggio con "Rigenera il disegno" (`POST …/messages/{id}/redraw`).

## Modelli e robustezza

Ruoli (Admin → modelli): `vision.grounding` (inventario, con thinking), `vision.tutor` (dialogo e regia,
senza thinking), `vision.critic` (riservato al revisore grafico); predefinito `claude-haiku-5-5`.
Inventario e dialogo usano gli structured outputs Anthropic; lo schema della scena è troppo grande per la
grammatica e ricade su schema nel prompt + riparazione del JSON (LaTeX non escapato) + salvataggio parziale
dei segni validi. Overlay in eccesso o rotti, unità del piano inesistenti o mancanti vengono corretti invece
di far fallire il turno; se il disegno fallisce due volte resta la spiegazione.

Valutazione: `backend/scripts/visual_eval` (immagini sintetiche: addizione, triangolo, parabola, TAB, Schrödinger, UI, UI con zona marcata) →
`python -m scripts.visual_eval.run_eval /tmp/out` nel container, poi
`VC_EVAL_DIR=/tmp/out npx vitest run evalDumps` per SVG e problemi di impaginazione; `run_critic` applica il revisore
ai render. `VC_TUTOR=anthropic:claude-sonnet-5-5` confronta un altro regista. Ogni chiamata registra
`visual_stage` (latenza, token) e `visual_stage_invalid` nei log.

## Sessioni salvate

Il pulsante **Sessioni** apre l'elenco recente con ricerca per titolo,
riapertura, rinomina ed eliminazione. Caricare una nuova immagine crea una
sessione; cambiare obiettivo o approfondire un accordo nella chat non ne
crea un'altra.

La migrazione `106_visual_sessions` crea `visual_comprehension_sessions`.
Il database conserva messaggi, bozza, inventario dell'immagine, obiettivo,
parti affrontate e rimanenti, memoria del tutor e obiettivi precedenti.
La sorgente è un oggetto privato MinIO, servito da un endpoint autenticato
con `Cache-Control: private, no-store`. Le liste non includono i byte immagine.

La bozza viene salvata automaticamente dopo una breve pausa nella digitazione;
una copia locale, distinta per account e sessione, permette di recuperarla
anche prima dell'aggiornamento del server. Si riapre l'ultima sessione usata.

Ogni invio ha un identificatore idempotente e una revisione. Il messaggio
utente viene registrato prima della chiamata AI. Due invii concorrenti sulla
stessa sessione non sovrascrivono il lavoro. Ritentare una richiesta già
completata non genera una nuova chiamata AI; una richiesta fallita può essere
ritentata riusando il messaggio. Una richiesta pendente viene ripresa dal
browser mediante polling e diventa ritentabile se interrotta oltre 180 secondi.

## Tutor conversazionale

Il nuovo motore è `app/services/visual_dialogue.py`:

1. La prima analisi costruisce un inventario dell'intera immagine. Per una
   TAB/spartito censisce battute o frasi, eventi leggibili, durate e incertezze,
   senza ridurre il lavoro a chiave o accordatura.
2. Ogni risposta interpreta l'ultima richiesta e aggiorna il piano dell'obiettivo
   completo. Una richiesta sull'intero contenuto deve includere nell'agenda
   tutte le unità dell'inventario, anche quelle ancora da affrontare.
3. La conclusione richiede che ogni parte dell'agenda abbia un'evidenza del
   lavoro svolto e nessuna parte resti pending. Un semplice check preliminare
   non basta a completare un brano.
4. Il tutor spiega come fare, usa tabelle o sequenze quando utili, può proporre
   una domanda pertinente ma accetta anche “continuiamo”, spiegazioni dirette
   e cambi di obiettivo. La chat non applica soglie di promozione.
5. I nuovi obiettivi mantengono immagine e cronologia, archiviando il contesto
   precedente nella memoria della sessione. Il motore usa gli ultimi 28 messaggi
   insieme all'inventario e al riepilogo persistente, non solo la domanda corrente.

Le risposte sono dati validati, mai codice eseguito. I consumi di ogni chiamata
sono registrati e vengono applicati i limiti di credito esistenti. L'intera
elaborazione ha un timeout di 150 secondi.

## API e verifica

- `GET/POST /api/v1/admin/visual-comprehension/sessions`
- `GET/PATCH/DELETE /api/v1/admin/visual-comprehension/sessions/{id}`
- `GET /api/v1/admin/visual-comprehension/sessions/{id}/image`
- `POST /api/v1/admin/visual-comprehension/sessions/{id}/messages`

Gli endpoint precedenti `/analyze` e `/interact` restano compatibili con il
primo prototipo; la nuova interfaccia usa esclusivamente le sessioni salvate.

Test: `python -m pytest tests/test_visual_comprehension.py tests/test_visual_dialogue.py tests/test_visual_blackboard.py -q`;
frontend `npm test` (resolver, linter, timeline, render).
L'integrazione PostgreSQL/MinIO si abilita con `RUN_VISUAL_SESSION_INTEGRATION=1`
nel container di sviluppo; usa account e oggetti di test isolati e li elimina.

La copertura strutturale del compito non garantisce letture musicali o risposte
corrette. Le informazioni non leggibili devono essere dichiarate, e una TAB
senza indicazioni ritmiche non consente di dedurre con certezza le durate.
I byte dell'immagine vengono inviati al provider AI Vision configurato.
