"""Testi legali dell'onboarding istituti (BOZZE in attesa di revisione DPO/legale).

I testi sono volutamente centralizzati qui: quando il responsabile privacy
consegna la versione definitiva basta aggiornare questo file e le `version`
in `legal_documents.py` (gli utenti verranno richiamati ad accettare di nuovo).
"""
from html import escape

DRAFT_BANNER = (
    '<p style="padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;border-radius:8px">'
    "<strong>Bozza operativa.</strong> Testo in aggiornamento con il Responsabile della protezione dei dati "
    "della Fondazione. Le parti tra [parentesi quadre] vanno completate o verificate prima dell'invio.</p>"
)

PLATFORM_SUMMARY = (
    "Golinelli.ai è la piattaforma di intelligenza artificiale per la didattica della Fondazione Golinelli: "
    "permette ai docenti di creare attività con assistenti AI, laboratori di coding, modelli e materiali, "
    "e di coinvolgere gli studenti in sessioni di classe sempre supervisionate dal docente (Teacher in the Loop). "
    "Nessuna valutazione o decisione sugli studenti è presa automaticamente dall'AI."
)


def deployer_agreement_html(school_name: str = "[Istituto]", code: str | None = None) -> str:
    s = escape(school_name)
    c = f" (codice meccanografico <strong>{escape(code)}</strong>)" if code else ""
    return f"""{DRAFT_BANNER}
<h2>Accordo di adozione e responsabilità del Dirigente</h2>
<p>Tra <strong>Fondazione Golinelli</strong> (di seguito «Fornitore») e l'istituzione scolastica
<strong>{s}</strong>{c}, rappresentata dal Dirigente scolastico (di seguito «Istituto»).</p>
<h3>1. Oggetto e sperimentazione</h3>
<p>Il Fornitore mette a disposizione dell'Istituto, a titolo di sperimentazione, la piattaforma Golinelli.ai per un
massimo di <strong>5 docenti</strong> individuati dal Dirigente tramite il pannello dell'Istituto.</p>
<h3>2. Ruolo di deployer</h3>
<p>L'Istituto utilizza il sistema di IA sotto la propria autorità ed è <em>deployer</em> ai sensi del Regolamento (UE)
2024/1689 (AI Act). Si impegna ad assicurare supervisione umana effettiva, a usare la piattaforma conformemente
alle istruzioni d'uso, a garantire un adeguato livello di alfabetizzazione in materia di IA dei docenti coinvolti
e a non impiegare il sistema per valutazioni automatiche, profilazione o decisioni sugli studenti.</p>
<h3>3. Protezione dei dati</h3>
<p>L'Istituto è Titolare del trattamento dei dati personali di docenti e studenti; il Fornitore agisce come
Responsabile del trattamento ai sensi dell'art. 28 GDPR secondo l'accordo/DPA allegato. L'Istituto si impegna a
fornire alle famiglie l'informativa (bozza disponibile nel pannello) prima dell'uso con studenti minorenni e a
raccogliere, ove necessario, le relative basi giuridiche.</p>
<h3>4. Responsabilità dell'Istituto</h3>
<ul>
<li>nominare/invitare solo docenti in servizio presso l'Istituto e vigilare sul corretto utilizzo;</li>
<li>non inserire categorie particolari di dati (art. 9 GDPR) né dati non necessari alla didattica;</li>
<li>segnalare tempestivamente al Fornitore incidenti, usi impropri e violazioni di dati;</li>
<li>custodire le credenziali e revocare l'accesso ai docenti che cessano l'incarico.</li>
</ul>
<h3>5. Durata e recesso</h3>
<p>La sperimentazione ha la durata concordata con il Fornitore ed è rinnovabile; ciascuna parte può recedere con
comunicazione scritta. Alla cessazione i dati sono cancellati o restituiti secondo il DPA.</p>
<h3>6. Documenti collegati</h3>
<p>Fanno parte dell'accordo i Termini e licenza della piattaforma, la valutazione AI Act/DPIA e l'informativa
privacy e DPA, accettati nei passaggi precedenti.</p>
<p><em>Il Dirigente dichiara di avere i poteri di rappresentanza dell'Istituto e accetta in tale qualità.</em></p>"""


def teacher_declaration_html(school_name: str = "[Istituto]") -> str:
    s = escape(school_name)
    return f"""{DRAFT_BANNER}
<h2>Dichiarazione d'uso del docente</h2>
<p>Il/la docente, invitato/a dal Dirigente di <strong>{s}</strong> a partecipare alla sperimentazione di
Golinelli.ai, dichiara di:</p>
<ul>
<li>usare la piattaforma esclusivamente per attività didattiche, mantenendo sempre la supervisione sugli output dell'IA
e sulle attività degli studenti;</li>
<li>non inserire dati personali non necessari, categorie particolari di dati o informazioni riservate;</li>
<li>verificare che le famiglie degli studenti minorenni abbiano ricevuto l'informativa predisposta dall'Istituto;</li>
<li>non usare la piattaforma per valutazioni automatiche o decisioni che producano effetti sugli studenti;</li>
<li>custodire le proprie credenziali, non cederle ad altri e segnalare usi impropri o incidenti al Dirigente;</li>
<li>aver compreso che gli output dell'IA possono essere inesatti o parziali e vanno controllati prima dell'uso.</li>
</ul>
<p>L'accettazione si aggiunge ai Termini e licenza, alla valutazione AI Act/DPIA e all'informativa privacy
accettati per l'accesso alla piattaforma.</p>"""


def family_notice_html(
    school_name: str = "[Istituto]",
    code: str | None = None,
    comune: str | None = None,
    principal_name: str | None = None,
) -> str:
    s = escape(school_name)
    c = escape(code) if code else "[codice meccanografico]"
    where = escape(comune) if comune else "[Comune]"
    who = escape(principal_name) if principal_name else "[Nome e cognome del Dirigente]"
    return f"""{DRAFT_BANNER}
<h2>Informativa alle famiglie sull'uso di strumenti di intelligenza artificiale</h2>
<p><em>(artt. 13 e 14 del Regolamento UE 2016/679 – GDPR)</em></p>
<p>Gentili genitori/tutori, l'Istituto <strong>{s}</strong> ({c}, {where}) ha aderito alla sperimentazione della
piattaforma <strong>Golinelli.ai</strong>, realizzata dalla Fondazione Golinelli, per attività didattiche con
strumenti di intelligenza artificiale (IA) svolte in classe sotto la guida e la supervisione dei docenti.</p>
<h3>Titolare e responsabile del trattamento</h3>
<p><strong>Titolare:</strong> {s}, nella persona del Dirigente scolastico {who}. Contatti e recapito del
Responsabile della protezione dei dati (RPD/DPO) dell'Istituto: [da inserire].<br>
<strong>Responsabile del trattamento (art. 28 GDPR):</strong> Fondazione Golinelli, Bologna, che fornisce la
piattaforma. Contatti per la privacy: [da inserire dal DPO della Fondazione].</p>
<h3>Che cosa fa la piattaforma</h3>
<p>Gli studenti accedono a sessioni di classe create dal docente, nelle quali possono dialogare con assistenti IA,
svolgere esercizi, costruire piccoli progetti (codice, modelli, documenti) e partecipare ad attività interattive.
Il docente può consultare le attività svolte. L'IA non valuta né classifica gli studenti e non assume decisioni che li riguardano.</p>
<h3>Dati trattati</h3>
<ul>
<li>nome o pseudonimo scelto per la sessione e classe di appartenenza;</li>
<li>contenuti inseriti dagli studenti (domande, testi, risposte, progetti) e risposte generate dall'IA;</li>
<li>dati tecnici di utilizzo (log, orari, consumo di crediti), per sicurezza e funzionamento del servizio.</li>
</ul>
<p>Non sono richiesti né devono essere inseriti dati particolari (salute, convinzioni religiose, origine, ecc.).
Invitiamo a ricordare ai ragazzi di non scrivere dati personali propri o altrui nei messaggi all'IA.</p>
<h3>Finalità e base giuridica</h3>
<p>Svolgimento di attività didattiche e di sperimentazione, nell'ambito dei compiti di interesse pubblico
dell'Istituto (art. 6, par. 1, lett. e) GDPR). [Il DPO valuti se, per gli studenti sotto i 14 anni o per specifiche
funzioni, sia opportuno raccogliere anche il consenso ex art. 6, par. 1, lett. a) e art. 8 GDPR.]</p>
<h3>Destinatari e trasferimenti</h3>
<p>I dati sono trattati dalla Fondazione Golinelli come responsabile e, per generare le risposte, dai fornitori di
modelli di IA da essa selezionati, vincolati da accordi di trattamento dei dati. [Elenco aggiornato dei fornitori,
sede e garanzie per eventuali trasferimenti extra-UE (clausole contrattuali standard): da completare a cura del DPO.]
I dati non sono ceduti a terzi per finalità commerciali né usati per addestrare modelli.</p>
<h3>Rischi e misure</h3>
<ul>
<li><strong>Risposte inesatte o inappropriate</strong>: l'IA può sbagliare o produrre contenuti non adatti; il
docente supervisiona e gli studenti sono educati a verificare le informazioni.</li>
<li><strong>Privacy</strong>: minimizzazione dei dati, accesso riservato a docenti autorizzati, cifratura in transito,
filtri sui contenuti, nessuna profilazione.</li>
<li><strong>Dipendenza e uso eccessivo</strong>: l'uso è limitato alle attività proposte dal docente e a crediti
mensili predefiniti.</li>
</ul>
<h3>Conservazione</h3>
<p>I dati sono conservati per la durata della sperimentazione/dell'anno scolastico, salvo diversa indicazione
dell'Istituto, e poi cancellati o anonimizzati. [Periodo da confermare.]</p>
<h3>Diritti</h3>
<p>Potete esercitare i diritti di accesso, rettifica, cancellazione, limitazione, opposizione (artt. 15-21 GDPR)
scrivendo all'Istituto ai recapiti sopra indicati, e proporre reclamo al Garante per la protezione dei dati personali
(www.garanteprivacy.it).</p>
<p>{where}, [data]<br>Il Dirigente scolastico<br>{who}</p>"""


def legal_doc_html(key: str, **ctx) -> tuple[str, str] | None:
    """Ritorna (titolo, html) per un documento dell'onboarding."""
    if key == "deployer-agreement":
        return "Accordo di adozione e responsabilità del Dirigente", deployer_agreement_html(**ctx)
    if key == "teacher-declaration":
        return "Dichiarazione d'uso del docente", teacher_declaration_html(ctx.get("school_name", "[Istituto]"))
    return None
