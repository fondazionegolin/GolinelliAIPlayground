"""Testi legali dell'onboarding istituti (BOZZE in attesa di revisione DPO/legale).

I testi sono volutamente centralizzati qui: quando il responsabile privacy
consegna la versione definitiva basta aggiornare questo file e le `version`
in `legal_documents.py` (gli utenti verranno richiamati ad accettare di nuovo).
"""
from html import escape

PRIVACY_REF = "Informativa sul trattamento dei dati personali v2.0 del 26 ottobre 2026"
PRIVACY_URL = "/docs/informativa-privacy-v2.0.pdf"
PRIVACY_EMAIL = "privacy@fondazionegolinelli.it"

DRAFT_BANNER = (
    '<p style="padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;border-radius:8px">'
    f"<strong>Testo allineato alla {PRIVACY_REF}.</strong> In revisione finale con il Responsabile della protezione "
    "dei dati della Fondazione. Le parti tra [parentesi quadre] vanno completate dall'Istituto.</p>"
)

PLATFORM_SUMMARY = (
    "Golinelli.ai è la piattaforma di intelligenza artificiale per la didattica della Fondazione Golinelli: "
    "permette ai docenti di creare attività con assistenti AI, laboratori di coding, modelli e materiali, "
    "e di coinvolgere gli studenti in sessioni di classe sempre supervisionate dal docente (Teacher in the Loop). "
    "Nessuna valutazione o decisione sugli studenti è presa automaticamente dall'AI."
)

# Sub-responsabili e servizi elencati nella sez. 7 dell'informativa v2.0.
SUBPROCESSORS = (
    "<li><strong>Fondazione Golinelli</strong> – server applicativo, database e archivio presso Opificio Golinelli, Bologna (nessun trasferimento);</li>"
    "<li><strong>OpenAI</strong> – chat, visione, trascrizione, funzioni vocali in tempo reale e moderazione (USA, Data Privacy Framework e/o SCC);</li>"
    "<li><strong>Anthropic</strong> – chat e generazione strutturata (USA, Data Privacy Framework e/o SCC);</li>"
    "<li><strong>Google – Gemini API</strong> – chat, solo se abilitata (DPA Google);</li>"
    "<li><strong>DeepSeek</strong> – esclusivamente nella sandbox di vibe coding, previo avviso specifico (garanzie ex art. 46 GDPR);</li>"
    "<li><strong>Meshy</strong> – generazione di contenuti 3D (USA, DPA e SCC);</li>"
    "<li><strong>Cloudflare</strong> – instradamento e protezione del traffico (Data Privacy Framework/SCC);</li>"
    "<li><strong>LiveKit</strong> – comunicazioni vocali in tempo reale (Data Privacy Framework, SCC);</li>"
    "<li><strong>Google Workspace</strong> – e-mail di servizio (DPA Google Cloud, Data Privacy Framework/SCC).</li>"
)


def deployer_agreement_html(school_name: str = "[Istituto]", code: str | None = None) -> str:
    s = escape(school_name)
    c = f" (codice meccanografico <strong>{escape(code)}</strong>)" if code else ""
    return f"""{DRAFT_BANNER}
<h2>Accordo di adozione e responsabilità del Dirigente</h2>
<p>Tra <strong>Fondazione Golinelli</strong>, Via Paolo Nanni Costa 14, 40133 Bologna, C.F. 03823850374 (di seguito
«Fondazione») e l'istituzione scolastica o organizzazione <strong>{s}</strong>{c}, rappresentata dal Dirigente
scolastico o dal legale rappresentante (di seguito «Istituto»).</p>
<h3>1. Oggetto e sperimentazione</h3>
<p>La Fondazione mette a disposizione dell'Istituto, a titolo di sperimentazione, la piattaforma Golinelli.ai – AI
Playground per un massimo di <strong>5 docenti</strong> individuati dal Dirigente tramite il pannello dell'Istituto.</p>
<h3>2. Ruolo di deployer (AI Act)</h3>
<p>L'Istituto utilizza i sistemi di IA della piattaforma sotto la propria autorità ed è <em>deployer</em> ai sensi del
Regolamento (UE) 2024/1689. Si impegna ad assicurare una supervisione umana effettiva (principio «human-in-the-loop»),
a usare la piattaforma conformemente alle istruzioni, a garantire un adeguato livello di alfabetizzazione in materia di
IA dei docenti coinvolti e a non impiegarla per decisioni basate unicamente su un trattamento automatizzato che
incidano sul percorso scolastico degli studenti (art. 22 GDPR): ogni valutazione o feedback dell'IA è solo formativo.</p>
<h3>3. Protezione dei dati: ruoli</h3>
<p>Come descritto nella <a href="{PRIVACY_URL}" target="_blank" rel="noreferrer">{PRIVACY_REF}</a>:</p>
<ul>
<li>per i dati degli <strong>studenti</strong> l'Istituto è <strong>Titolare</strong> del trattamento e la Fondazione agisce
come <strong>Responsabile</strong> ai sensi dell'art. 28 GDPR, esclusivamente secondo le istruzioni documentate
dell'Istituto contenute nel presente accordo e nei Termini di servizio;</li>
<li>per i dati dei <strong>docenti</strong>, per la gestione degli account e per la sicurezza tecnica della piattaforma la
Fondazione opera come <strong>Titolare autonomo</strong>.</li>
</ul>
<p>La base giuridica del trattamento dei dati degli studenti è individuata dall'Istituto (di norma l'esecuzione di un
compito di interesse pubblico, art. 6, par. 1, lett. e GDPR). Ove una specifica attività richieda il consenso, per gli
studenti di età inferiore a 14 anni lo prestano i genitori (art. 8 GDPR e art. 2-quinquies D.Lgs. 196/2003): spetta
all'Istituto raccoglierlo e verificarlo.</p>
<h3>4. Istruzioni e garanzie del Responsabile</h3>
<ul>
<li>gli studenti non creano un account con e-mail: accedono con codice di sessione, nickname e password; non sono
richiesti dati anagrafici e l'eventuale associazione fra nickname e identità è gestita solo dall'Istituto;</li>
<li>i dati di sessione degli studenti sono cancellati automaticamente <strong>30 giorni dopo la chiusura della
sessione</strong>; l'Istituto può chiedere termini più brevi;</li>
<li>i dati non sono usati per marketing, per profilare gli studenti né, dalla Fondazione o dai fornitori, per addestrare
modelli di IA;</li>
<li>la Fondazione si avvale dei sub-responsabili elencati nell'informativa e qui riportati, e informa preventivamente
l'Istituto di ogni modifica (art. 28, par. 2 GDPR):<ul>{SUBPROCESSORS}</ul></li>
<li>i trasferimenti extra-UE avvengono sulla base del Data Privacy Framework UE-USA o di Clausole contrattuali standard
(Decisione (UE) 2021/914), con valutazione d'impatto del trasferimento;</li>
<li>la Fondazione adotta le misure di sicurezza dell'art. 32 GDPR descritte nell'informativa, comunica tempestivamente
all'Istituto le violazioni di dati (artt. 33-34 GDPR) e lo assiste nel dare seguito alle richieste degli interessati;</li>
<li>alla cessazione della sperimentazione i dati sono cancellati o resi anonimi in modo irreversibile.</li>
</ul>
<h3>5. Impegni dell'Istituto</h3>
<ul>
<li>fornire alle famiglie l'informativa (bozza disponibile nel pannello) prima dell'uso con studenti minorenni e
acquisire le autorizzazioni eventualmente richieste, anche per l'uso della webcam in ML Lab (elaborata solo nel browser);</li>
<li>invitare solo docenti in servizio presso l'Istituto, vigilare sul corretto uso della piattaforma e revocare
l'accesso a chi cessa l'incarico;</li>
<li>vigilare che i Teacherbot configurati dai docenti non siano destinati a supporto psicologico, sanitario o di
benessere, né sollecitino dati di categorie particolari (art. 9 GDPR) o della sfera personale e familiare;</li>
<li>non inserire categorie particolari di dati né dati non necessari alla didattica, e ricordare agli studenti di non farlo;</li>
<li>indirizzare all'Istituto le richieste degli interessati sui dati degli studenti e segnalare tempestivamente alla
Fondazione (<a href="mailto:{PRIVACY_EMAIL}">{PRIVACY_EMAIL}</a>) incidenti, usi impropri e violazioni di dati.</li>
</ul>
<h3>6. Durata e recesso</h3>
<p>La sperimentazione ha la durata concordata con la Fondazione ed è rinnovabile; ciascuna parte può recedere con
comunicazione scritta.</p>
<h3>7. Documenti collegati</h3>
<p>Fanno parte dell'accordo i Termini e licenza della piattaforma, la valutazione AI Act/DPIA e la
<a href="{PRIVACY_URL}" target="_blank" rel="noreferrer">{PRIVACY_REF}</a>, accettati nei passaggi precedenti.</p>
<p><em>Il Dirigente dichiara di avere i poteri di rappresentanza dell'Istituto e accetta in tale qualità.</em></p>"""


def teacher_declaration_html(school_name: str = "[Istituto]") -> str:
    s = escape(school_name)
    return f"""{DRAFT_BANNER}
<h2>Dichiarazione d'uso del docente</h2>
<p>Il/la docente, invitato/a dal Dirigente di <strong>{s}</strong> a partecipare alla sperimentazione di
Golinelli.ai, dichiara di aver letto la <a href="{PRIVACY_URL}" target="_blank" rel="noreferrer">{PRIVACY_REF}</a> e di:</p>
<ul>
<li>usare la piattaforma esclusivamente per attività didattiche, mantenendo sempre la supervisione sugli output dell'IA
e sulle attività degli studenti: valutazioni e feedback dell'IA sono solo formativi;</li>
<li>non configurare Teacherbot per supporto psicologico, sanitario o di benessere, valutazioni dello stato emotivo o di
salute, né che sollecitino dati di categorie particolari (art. 9 GDPR) o della sfera personale e familiare, di cui
risponde in quanto autore delle istruzioni;</li>
<li>non inserire dati personali non necessari, categorie particolari di dati o informazioni riservate, e informare gli
studenti di non inserirli nelle conversazioni;</li>
<li>verificare che le famiglie degli studenti minorenni abbiano ricevuto l'informativa predisposta dall'Istituto
(anche per l'uso della webcam in ML Lab) prima di coinvolgerli;</li>
<li>custodire le proprie credenziali, non cederle ad altri e segnalare usi impropri o incidenti al Dirigente e a
<a href="mailto:{PRIVACY_EMAIL}">{PRIVACY_EMAIL}</a>;</li>
<li>aver compreso che gli output dell'IA possono essere inesatti, parziali o contenere bias e vanno controllati prima dell'uso.</li>
</ul>
<p>Per i dati del proprio account la Fondazione Golinelli opera come titolare autonomo; per i dati degli studenti il
titolare è l'Istituto. L'accettazione si aggiunge ai Termini e licenza, alla valutazione AI Act/DPIA e all'informativa
privacy accettati per l'accesso alla piattaforma.</p>"""


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
<p><em>(artt. 13 e 14 del Regolamento UE 2016/679 – GDPR; art. 50 del Regolamento UE 2024/1689 – AI Act)</em></p>
<p>Gentili genitori/tutori, l'Istituto <strong>{s}</strong> ({c}, {where}) ha aderito alla sperimentazione della
piattaforma <strong>Golinelli.ai – AI Playground</strong>, realizzata dalla Fondazione Golinelli, per attività
didattiche con strumenti di intelligenza artificiale (IA) svolte sotto la guida e la supervisione dei docenti.</p>
<h3>Titolare e responsabile del trattamento</h3>
<p><strong>Titolare:</strong> {s}, nella persona del Dirigente scolastico {who}. Recapito del Responsabile della
protezione dei dati (RPD/DPO) dell'Istituto: [da inserire].<br>
<strong>Responsabile del trattamento (art. 28 GDPR):</strong> Fondazione Golinelli, Via Paolo Nanni Costa 14, 40133
Bologna, che fornisce la piattaforma e tratta i dati solo secondo le istruzioni dell'Istituto. Contatto privacy:
<a href="mailto:{PRIVACY_EMAIL}">{PRIVACY_EMAIL}</a>. L'informativa completa della piattaforma è la
<a href="{PRIVACY_URL}" target="_blank" rel="noreferrer">{PRIVACY_REF}</a>.</p>
<h3>Che cosa fa la piattaforma</h3>
<p>Gli studenti accedono a sessioni di classe create dal docente, nelle quali possono dialogare con assistenti IA,
svolgere esercizi, costruire piccoli progetti (codice, modelli, documenti) e partecipare ad attività interattive.
Tutti gli assistenti sono sistemi di IA, non persone, e i contenuti che producono sono generati artificialmente.
L'IA non valuta né classifica gli studenti e non assume decisioni che li riguardano: ogni feedback è formativo e
supervisionato dal docente.</p>
<h3>Dati trattati</h3>
<ul>
<li>per entrare in una sessione lo studente usa il codice fornito dal docente, un <strong>nickname</strong> e una
password: <strong>non sono richiesti nome, cognome, e-mail, data di nascita o altri dati anagrafici</strong>;
l'eventuale associazione fra nickname e studente è conosciuta solo dalla scuola;</li>
<li>contenuti inseriti dagli studenti (domande, messaggi, elaborati, file, codice, progetti, eventuali audio e
immagini) e risposte generate dall'IA;</li>
<li>dati tecnici di utilizzo (orari, log di accesso, indirizzo IP, consumo di crediti), per sicurezza e funzionamento.</li>
</ul>
<p>Se il docente usa ML Lab con la webcam, le immagini sono elaborate <strong>solo nel browser</strong>: non vengono
inviate né conservate e non c'è alcun riconoscimento biometrico o delle emozioni. Non sono richiesti né devono essere
inseriti dati particolari (salute, convinzioni religiose, origine, ecc.): invitiamo a ricordare ai ragazzi di non
scrivere dati personali propri o altrui nei messaggi all'IA.</p>
<h3>Finalità e base giuridica</h3>
<p>Svolgimento di attività didattiche, nell'ambito dei compiti di interesse pubblico dell'Istituto (art. 6, par. 1,
lett. e GDPR). Se una specifica attività richiede il consenso, per gli studenti sotto i 14 anni lo prestano i
genitori (art. 8 GDPR e art. 2-quinquies D.Lgs. 196/2003) e l'Istituto lo raccoglie separatamente. I dati non sono
usati per marketing né per profilare gli studenti.</p>
<h3>Destinatari e trasferimenti</h3>
<p>Per generare le risposte la piattaforma invia ai fornitori di IA solo i contenuti necessari alla singola richiesta,
senza dati anagrafici né l'identificativo dello studente. I fornitori sono vincolati da accordi che vietano di usare i
dati per addestrare i loro modelli:</p>
<ul>{SUBPROCESSORS}</ul>
<p>I trasferimenti verso gli Stati Uniti avvengono sulla base del Data Privacy Framework UE-USA o di Clausole
contrattuali standard.</p>
<h3>Rischi e misure</h3>
<ul>
<li><strong>Risposte inesatte o inappropriate</strong>: l'IA può sbagliare o produrre contenuti non adatti; il docente
supervisiona, la piattaforma usa filtri automatici di moderazione e gli studenti sono educati a verificare le informazioni.</li>
<li><strong>Privacy</strong>: nessun dato anagrafico degli studenti, dati separati per istituto e sessione, cifratura in
transito e a riposo, accesso riservato a docenti autorizzati, nessuna profilazione.</li>
<li><strong>Uso eccessivo</strong>: l'uso è limitato alle attività proposte dal docente e a crediti mensili predefiniti.</li>
</ul>
<h3>Conservazione</h3>
<p>I dati delle sessioni degli studenti sono cancellati automaticamente <strong>30 giorni dopo la chiusura della
sessione</strong>, salvo termini più brevi decisi dall'Istituto; log tecnici e di sicurezza fino a 12 mesi.</p>
<h3>Diritti</h3>
<p>Potete esercitare i diritti di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione (artt.
15-22 GDPR) scrivendo all'Istituto ai recapiti sopra indicati: la Fondazione lo assiste nel darvi seguito (per
individuare i dati possono servire sessione, nickname e data di utilizzo). Potete proporre reclamo al Garante per la
protezione dei dati personali (www.garanteprivacy.it).</p>
<p>{where}, [data]<br>Il Dirigente scolastico<br>{who}</p>"""


def legal_doc_html(key: str, **ctx) -> tuple[str, str] | None:
    """Ritorna (titolo, html) per un documento dell'onboarding."""
    if key == "deployer-agreement":
        return "Accordo di adozione e responsabilità del Dirigente", deployer_agreement_html(**ctx)
    if key == "teacher-declaration":
        return "Dichiarazione d'uso del docente", teacher_declaration_html(ctx.get("school_name", "[Istituto]"))
    return None
