# Privacy, AI Act e Scuola - Analisi di conformita` e bozza Privacy Policy

## 1) Obiettivo del documento

Questo documento fornisce:

1. una **valutazione preliminare di compliance** della piattaforma EduAI rispetto a:
   - Regolamento (UE) 2024/1689 (**AI Act**),
   - Regolamento (UE) 2016/679 (**GDPR**),
   - indicazioni pubblicate dal **Ministero dell'Istruzione e del Merito (MIM)** e dal **Garante Privacy** per il contesto scolastico;
2. una base operativa per predisporre una **FRIA** (Fundamental Rights Impact Assessment, art. 27 AI Act quando applicabile);
3. una **bozza di Privacy Policy** per la piattaforma.

Nota: il documento e` tecnico-operativo e non sostituisce consulenza legale qualificata.

---

## 2) Ruoli e perimetro (ipotesi di lavoro)

In base alla richiesta, **Fondazione Golinelli** e` qualificata come **provider** della piattaforma AI.

Nel modello tipico scuola:

- **Fondazione Golinelli**: provider AI (AI Act) e, in funzione dei contratti, titolare o responsabile ex GDPR.
- **Istituto scolastico**: normalmente deployer/utente professionale del sistema AI; nel GDPR spesso titolare del trattamento per i dati di studenti e docenti.
- **Fornitori esterni LLM** (OpenAI, Anthropic, Ollama self-hosted): subfornitori o autonomi titolari a seconda dei flussi contrattuali.

Da chiarire contrattualmente: catena ruoli GDPR (titolare/contitolare/responsabile), trasferimenti extra-UE, clausole DPA/SCC, istruzioni documentate.

---

## 3) Quadro normativo sintetico (date chiave)

### AI Act (UE 2024/1689)

- Entrata in vigore: **1 agosto 2024**.
- Piena applicabilita`: **2 agosto 2026** (con eccezioni progressive).
- Obblighi di **AI literacy (art. 4)** applicabili dal **2 febbraio 2025**.
- Regole su trasparenza (art. 50) e high-risk (in larga parte) applicabili da **agosto 2026**.

Riferimenti principali:
- AI Act timeline (Commissione UE): https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- Art. 4 (AI literacy): https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-4
- Art. 5 (pratiche vietate): https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-5
- Allegato III (high-risk, incl. education): https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3
- Art. 26 (obblighi deployer high-risk): https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26
- Art. 27 (FRIA): https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-27
- Art. 50 (trasparenza): https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50

### Contesto italiano scuola e privacy

- MIM - DM n. 166 del 09/08/2025 e Linee guida IA per le istituzioni scolastiche (pubblicazioni ministeriali):  
  https://www.mim.gov.it/-/decreto-ministeriale-n-166-del-9-agosto-2025  
  https://www.mim.gov.it/-/pubblicate-le-linee-guida-per-l-introduzione-dell-intelligenza-artificiale-nelle-istituzioni-scolastiche-allegato-al-dm-n-166-del-09-08-2025
- Garante Privacy - area Scuola e vademecum aggiornato:  
  https://www.garanteprivacy.it/temi/scuola
- Garante Privacy - via libera a schema MIM su servizio IA in Unica:  
  https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/print/10163470

---

## 4) Mappatura dei trattamenti nella piattaforma (dal codice)

Elementi osservati nel repository:

- utenti/docenti: email, nome, cognome, istituzione, preferenze (`backend/app/models/user.py`)
- studenti: nickname, token di sessione, stato freeze (`backend/app/models/session.py`)
- chat classe e AI: messaggi, allegati, metadati modello/provider (`backend/app/models/chat.py`, `backend/app/models/llm.py`)
- documenti e file: upload, storage key, checksum (`backend/app/models/file.py`)
- RAG: chunk testuali, embedding, citazioni (`backend/app/models/rag.py`)
- task/quiz/consegne e feedback (`backend/app/models/task.py`)
- audit trail eventi (`backend/app/models/llm.py`, classe `AuditEvent`)

Caratteristiche tecniche rilevanti:

- multi-tenant e controlli di accesso per ruolo (`backend/app/api/deps.py`, `backend/app/core/permissions.py`)
- integrazione provider LLM multipli (`backend/app/services/llm_service.py`)
- persistenza file su MinIO/S3 (`backend/app/services/storage_service.py`)

Implicazione: la piattaforma tratta dati relativi a minori/studenti in contesto scolastico, con potenziale elevato impatto sui diritti fondamentali (privacy, non discriminazione, diritto all'istruzione).

---

## 5) Classificazione AI Act per i moduli EduAI (preliminare)

### 5.1 Use case presumibilmente "limited-risk"/trasparenza

- chatbot di supporto didattico generale;
- generazione contenuti (testo/immagini) senza decisioni automatizzate su accesso, valutazione formale o esclusioni.

Obblighi chiave: trasparenza verso utenti (art. 50), AI literacy del personale (art. 4), governance rischio.

### 5.2 Use case potenzialmente "high-risk" (Allegato III, education)

Sono a rischio classificazione high-risk i casi in cui il sistema AI sia usato per:

- ammissione/assegnazione studenti;
- valutazione risultati di apprendimento quando incide su percorso scolastico;
- assessment del livello educativo accessibile;
- rilevazione comportamenti proibiti durante test.

Se alcuni moduli (es. quiz scoring automatico, analytics predittivo su performance) influenzano decisioni scolastiche, il perimetro puo` entrare in Allegato III(3).

### 5.3 Pratiche da evitare (art. 5)

In ambito scolastico sono critiche e da bloccare:

- emotion recognition su studenti/docenti per finalita` non mediche/sicurezza;
- pratiche manipolative o sfruttamento vulnerabilita` legate all'eta`.

---

## 6) Gap analysis preliminare (provider-centric)

### A. Governance e documentazione AI Act
- Stato: parziale.
- Gap: classificazione formale per ciascun use case; fascicolo tecnico per high-risk; policy post-market monitoring.

### B. Trasparenza verso interessati (AI + privacy)
- Stato: migliorabile.
- Gap: informativa esplicita "stai interagendo con AI", etichettatura output AI, disclosure modelli/provider in UI e documenti pubblici.

### C. Human oversight
- Stato: presente in parte (controllo docente), ma non formalizzato.
- Gap: procedure scritte su revisione umana obbligatoria prima di decisioni su studenti.

### D. Data governance e minimizzazione
- Stato: tecnico buono ma non pienamente formalizzato.
- Gap: retention policy per chat/log/allegati; policy dataset quality/bias; tracciamento basi giuridiche per ogni trattamento.

### E. Sicurezza
- Stato: buono (auth token, RBAC, segregazione tenant).
- Gap: cifratura end-to-end non evidenziata; piano gestione incidenti AI/privacy e SLA notifiche.

### F. FRIA + DPIA
- Stato: da avviare formalmente.
- Gap: template FRIA per casi high-risk; integrazione con DPIA art. 35 GDPR per scuole/deployer.

---

## 7) Piano operativo per ottenere evidenza di conformita` (FRIA-ready)

## Fase 1 (0-30 giorni) - Fondamenta

1. Registro trattamenti completo per modulo/funzionalita`.
2. Mappatura ruoli GDPR/AI Act nei contratti (provider/deployer).
3. Policy trasparenza AI (art. 50) in UI e documentazione.
4. Programma AI literacy (art. 4) per staff interno e scuole.

## Fase 2 (30-60 giorni) - Valutazioni d'impatto

1. Screening per classificare ciascun use case (minimal/limited/high-risk).
2. DPIA GDPR per trattamenti ad alto rischio.
3. FRIA (art. 27) per casi Annex III applicabili.
4. Misure di mitigazione: human-in-the-loop, controllo bias, contestabilita` decisioni.

## Fase 3 (60-90 giorni) - Evidenze e audit

1. Pacchetto evidenze: policy, log, audit trail, training, controlli tecnici.
2. Test di robustezza/sicurezza e red-team funzionale su use case scolastici.
3. Procedura incident response AI + privacy (segnalazioni scuole/famiglie).
4. Riesame legale finale e readiness per audit esterno/certificazione.

---

## 8) Bozza Privacy Policy (versione adattabile)

## 8.1 Titolare e contatti

Fondazione Golinelli, [indirizzo], [email privacy], [PEC], in qualita` di [Titolare/Responsabile] del trattamento per la piattaforma EduAI.

DPO (se nominato): [nome/contatto].

## 8.2 Dati trattati

Trattiamo, in base ai servizi attivati:

- dati anagrafici e account (docenti/amministratori);
- identificativi studente (nickname/token/sessione);
- contenuti didattici e messaggi (chat, compiti, quiz, allegati);
- metadati tecnici e di sicurezza (log accessi, audit eventi, modello AI utilizzato);
- eventuali dati contenuti nei documenti caricati da scuole/docenti/studenti.

Non e` richiesto il conferimento di categorie particolari di dati (art. 9 GDPR), salvo casi strettamente necessari e disciplinati da specifica base giuridica e misure rafforzate.

## 8.3 Finalita` e basi giuridiche

Le finalita` principali:

1. erogazione del servizio educativo digitale e gestione account;
2. supporto didattico tramite sistemi AI;
3. sicurezza, audit, prevenzione abusi e gestione incidenti;
4. adempimenti normativi e tutela legale.

Basi giuridiche (a seconda del ruolo/contesto): art. 6(1)(b), 6(1)(c), 6(1)(e), 6(1)(f) GDPR; per scuole pubbliche, prevale la base di interesse pubblico/compiti istituzionali definita dall'istituzione scolastica.

## 8.4 Uso dell'Intelligenza Artificiale

La piattaforma utilizza sistemi AI per generazione contenuti, supporto didattico e assistenza operativa.

- Gli utenti sono informati quando interagiscono con un sistema AI.
- Le risposte AI sono strumenti di supporto e non sostituiscono la valutazione professionale del docente.
- Le decisioni ad impatto rilevante sugli studenti non devono essere assunte in modo esclusivamente automatizzato senza supervisione umana.

## 8.5 Minori e contesto scolastico

Il trattamento avviene nel contesto delle attivita` scolastiche sotto la responsabilita` dell'istituzione competente. Sono adottate misure specifiche per tutela minori, minimizzazione dati e limitazione degli accessi.

## 8.6 Destinatari e fornitori

I dati possono essere trattati da fornitori tecnici necessari all'erogazione del servizio (hosting, storage, modelli AI, monitoraggio), nominati ove richiesto come responsabili/sub-responsabili del trattamento.

L'elenco aggiornato dei fornitori e` disponibile su richiesta a [contatto privacy].

## 8.7 Trasferimenti extra-UE

Qualora alcuni fornitori AI siano stabiliti fuori dallo SEE, i trasferimenti avvengono con garanzie adeguate ai sensi degli artt. 44 e ss. GDPR (es. SCC e misure supplementari).

## 8.8 Conservazione

I dati sono conservati per il tempo strettamente necessario alle finalita` dichiarate e secondo policy di retention definite con le istituzioni scolastiche.

Periodi indicativi (da finalizzare contrattualmente):

- log tecnici e sicurezza: [X mesi];
- chat e contenuti didattici: [X mesi/anni scolastici];
- allegati e documenti: [X mesi/anni], salvo obblighi normativi diversi.

## 8.9 Sicurezza

Applichiamo misure tecniche e organizzative adeguate, tra cui controllo accessi per ruolo, segregazione tenant, audit logging, protezioni infrastrutturali e procedure di gestione incidenti.

## 8.10 Diritti degli interessati

Gli interessati possono esercitare i diritti previsti dagli artt. 15-22 GDPR (accesso, rettifica, cancellazione, limitazione, opposizione, portabilita` ove applicabile) contattando [email privacy].

Resta fermo il diritto di reclamo al Garante per la protezione dei dati personali.

## 8.11 Aggiornamenti policy

La presente informativa puo` essere aggiornata periodicamente. La versione vigente e` pubblicata con data di ultimo aggiornamento.

---

## 9) Allegato FRIA - Traccia minima consigliata

Per ogni use case high-risk:

1. descrizione processo e finalita`;
2. categorie soggetti impattati (studenti, famiglie, docenti);
3. rischi su diritti fondamentali (istruzione, non discriminazione, privacy, autonomia);
4. misure di mitigazione (human oversight, fallback manuale, contestazione decisioni);
5. metriche di performance/fairness e monitoraggio continuo;
6. meccanismo reclami e remediation;
7. responsabilita` interne e riesame periodico.

---

## 10) Conclusione operativa

La piattaforma ha una base tecnica solida per la conformita`, ma per ottenere una **evidenza forte di compliance** utile a un audit FRIA/AI Act in ambito scuola servono:

1. classificazione formale dei casi d'uso (specialmente valutazione studenti);
2. FRIA + DPIA documentate e versionate;
3. policy trasparenza AI e governance ruoli formalizzate contrattualmente;
4. controlli periodici su bias, supervisione umana e sicurezza.

Con queste evidenze, Fondazione Golinelli puo` presentarsi come provider con presidio strutturato di compliance per l'adozione scolastica.

