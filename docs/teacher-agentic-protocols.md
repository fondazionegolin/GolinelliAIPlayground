# Protocolli didattici nella chat di supporto

Il docente può selezionare **Modalità agentica** nella chat di supporto oppure scrivere «Vai in modalità agentica e produci i materiali del protocollo». Può allegare fino a cinque documenti (20 MB ciascuno, complessivamente 90.000 caratteri estratti), incollare un protocollo o riutilizzare il documento già generato nella stessa conversazione.

Il coordinatore propone un piano di massimo dodici attività: quiz/modulo, teacherbot, documento, foglio di calcolo, presentazione, dispensa, pagina interattiva, immagine. Il piano espone obiettivo, ipotesi, motivazione, fonti e dipendenze. Il docente può cambiare istruzioni, tipo, fonti e dipendenze, aggiungere attività o rimuoverle insieme ai loro dipendenti. Il piano è mostrato come elenco sintetico con un’unica azione «Conferma e genera»; la modifica dettagliata (istruzioni, tipo, fonti, dipendenze) è dietro «Modifica il piano». L’avvio richiede l’approvazione del piano.

Gli agenti eseguono le attività indipendenti con una concorrenza massima di tre. I risultati delle dipendenze vengono passati agli agenti successivi. Una generazione fallita blocca solo i suoi discendenti. La rigenerazione di un singolo blocco aggiorna anche i discendenti ancora non salvati, preservando gli altri risultati. Se un discendente è già salvato, occorre un nuovo piano per creare varianti. Modificare un risultato invalida i discendenti non ancora salvati, che vanno rigenerati.

Piani e risultati sono memorizzati nei messaggi della conversazione. L’esecuzione usa i job in background esistenti: continua cambiando pagina, può essere interrotta e si recupera dalla cronologia. Dopo un riavvio del server i blocchi interrotti diventano riprovabili; i risultati completati restano disponibili. Le chiamate AI usano il ruolo configurato `chat.default`; le immagini usano il generatore di piattaforma, con contabilizzazione dei crediti. Le stime iniziali non sono un preventivo del costo finale.

I materiali sono proposti uno alla volta, ciascuno in un blocco separato della chat, nell’ordine del piano: il primo non ancora approvato è in primo piano con anteprima e una sola azione colorata («Conferma e crea il teacherbot», «Conferma e pubblica il quiz», «Conferma e salva»), che salva le eventuali modifiche e approva in un unico passaggio. «Modifica» e «Rigenera» restano azioni secondarie. Per il quiz la conferma salva il JSON e apre subito la scelta della sessione. Ogni prodotto è revisionabile prima del salvataggio:

- Documenti, dispense, fogli e presentazioni diventano documenti nativi privati nei Files, apribili nell’editor.
- I teacherbot vengono creati in bozza. La knowledge revisionata viene incorporata nel prompt come materiale di riferimento; ulteriori documenti RAG possono essere aggiunti dalla scheda del bot. Questo percorso non crea un indice RAG autonomo.
- I quiz possono essere salvati come JSON nei Files o passati al flusso esistente di revisione/pubblicazione in una sessione, inizialmente impostato su bozza.
- Immagini e pagine HTML vengono salvate come file privati. Le anteprime delle immagini richiedono il docente proprietario; quelle HTML usano un iframe isolato con rete e accesso alla pagina principale disabilitati.

Le operazioni verificano docente e tenant proprietari della conversazione. Una revisione impedisce modifiche concorrenti obsolete; risorse e stato di approvazione vengono salvati nella stessa transazione per evitare duplicati. Le fonti originali e le chiavi di archiviazione non vengono restituite al client. Non vengono pubblicati automaticamente materiali agli studenti.

Endpoint: `/api/v1/llm/teacher/protocol/plan`, `/{message_id}`, `/{message_id}/run`, `/{message_id}/stop`, `/{message_id}/tasks/{task_id}` e `/{message_id}/tasks/{task_id}/image`.
