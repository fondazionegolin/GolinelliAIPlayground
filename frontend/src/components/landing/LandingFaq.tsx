import { useId, useState } from 'react'
import { ChevronDown } from '@/components/icons'
import { tl } from '@/i18n/tl'

interface FaqItem {
  q: string
  a: string[]
}

/** Every answer is grounded in the privacy notice v2.0, the AI audit and the platform configuration. */
function buildFaqs(): FaqItem[] {
  return [
    {
      q: tl("Come si accede alla piattaforma?"),
      a: [
        tl("I docenti accedono con un account personale: al momento la registrazione è su invito, non esiste un form pubblico. Per ricevere un invito chiedi alla tua scuola o scrivi alla Fondazione dalla sezione Contatti."),
        tl("Gli studenti non creano un account con email: entrano in una sessione con il codice di cinque caratteri fornito dal docente, scelgono un nickname e una password per poter rientrare. Il codice funziona solo mentre la sessione è attiva."),
      ],
    },
    {
      q: tl("Quanto costa usarla? Che cosa è gratuito?"),
      a: [
        tl("Gli studenti non pagano nulla direttamente e non hanno bisogno di un account personale. Le funzioni che usano modelli di intelligenza artificiale consumano però crediti, con tetti mensili."),
        tl("Le condizioni per la tua scuola o per il tuo progetto vanno concordate con la Fondazione: scrivici dalla sezione Contatti."),
      ],
    },
    {
      q: tl("Come funzionano i crediti?"),
      a: [
        tl("Ogni richiesta ai modelli AI ha un costo che viene conteggiato in crediti (100 crediti corrispondono a 1 euro di consumo)."),
        tl("Di default ogni docente dispone di 300 crediti al mese (3 euro), mentre gli studenti attingono a un pool mensile condiviso, di default 10 euro. I limiti sono configurabili dall'amministrazione della piattaforma, e il docente può sempre vedere il saldo residuo."),
        tl("Quando un limite è esaurito, le funzioni AI si fermano fino al rinnovo mensile o a un aumento del tetto."),
      ],
    },
    {
      q: tl("I dati degli studenti sono al sicuro? E il GDPR?"),
      a: [
        tl("Agli studenti non vengono chiesti nome, cognome, email o data di nascita: i dati sono pseudonimizzati tramite nickname e l'eventuale collegamento con l'identità resta nelle mani della scuola. L'istituto scolastico è il titolare del trattamento, la Fondazione Golinelli agisce come responsabile."),
        tl("I dati applicativi sono conservati su un server a Bologna; alcuni fornitori di AI operano fuori dallo Spazio Economico Europeo, con trasferimenti basati sulle garanzie previste dal GDPR. Tutti i dettagli sono nell'informativa privacy, disponibile in alto nella pagina."),
      ],
    },
    {
      q: tl("Che cosa succede ai file che allego nelle chat?"),
      a: [
        tl("Negli allegati testuali di molte chat un sistema eseguito sui nostri server maschera automaticamente nomi e altri dati personali (per esempio sostituendo i nomi con [NAME]) prima che il contenuto arrivi al modello, e prima dell'invio viene mostrata un'anteprima con un avviso."),
        tl("Le immagini non possono essere anonimizzate in automatico: prima di caricarle verifica che non mostrino volti, nomi o altri dati personali. Il mascheramento è un aiuto, non una garanzia assoluta."),
      ],
    },
    {
      q: tl("Che cosa dice l'AI Act? La piattaforma è conforme?"),
      a: [
        tl("L'informativa e l'audit pubblicati classificano gli assistenti didattici come sistemi a rischio limitato (art. 50 dell'AI Act) e dichiarano misure di trasparenza: gli assistenti sono sempre indicati come AI e i contenuti generati sono riconoscibili come tali."),
        tl("Ogni valutazione o feedback generato dall'AI ha natura solo formativa ed è soggetto alla supervisione del docente: la piattaforma non prende decisioni automatiche sul percorso scolastico degli studenti. Le informazioni complete sono nell'informativa privacy (link in alto) e nell'audit AI Act pubblicati dalla Fondazione."),
      ],
    },
    {
      q: tl("Posso usarla con studenti minorenni?"),
      a: [
        tl("Sì: la piattaforma è pensata per la scuola e può coinvolgere studenti minorenni di ogni ordine e grado, sempre sotto la responsabilità dell'istituto e la supervisione del docente."),
        tl("Il trattamento dei dati non si basa, di regola, sul consenso. Se una specifica attività lo richiede, per gli studenti sotto i 14 anni il consenso spetta a chi esercita la responsabilità genitoriale, e raccoglierlo e verificarlo è compito della scuola: la Fondazione non verifica l'età degli utenti."),
      ],
    },
    {
      q: tl("Quali modelli di intelligenza artificiale vengono usati?"),
      a: [
        tl("La piattaforma è multi-modello e si appoggia a fornitori come Anthropic (Claude), OpenAI e DeepSeek. Ogni funzione usa i modelli assegnati dalla configurazione della piattaforma e, dove è prevista la scelta, il docente può scegliere tra quelli disponibili."),
        tl("DeepSeek è usato solo nella sandbox di vibe coding (Vibe Lab) e non nelle normali chat: prima di accedere lo studente vede un avviso specifico e la presa visione viene registrata. In Vibe Lab agli studenti è proposta una selezione ristretta di modelli."),
        tl("Secondo l'informativa, i fornitori non usano i contenuti per addestrare i propri modelli."),
      ],
    },
    {
      q: tl("Che cosa posso fare con Golinelli.ai?"),
      a: [
        tl("Il docente può creare classi e sessioni, assegnare compiti, configurare assistenti (Teacherbot), lavorare su documenti con ricerca e risposta sui contenuti, e coinvolgere la classe con quiz, sondaggi e nuvole di parole in tempo reale."),
        tl("Gli studenti possono dialogare con tutor AI, programmare in Notebook e Vibe Lab, esplorare ML Lab e modellare in 3D. Le sezioni qui sopra descrivono tutti i moduli."),
      ],
    },
    {
      q: tl("Quali sono i limiti? Posso fidarmi delle risposte?"),
      a: [
        tl("Non del tutto, ed è giusto dirlo: i contenuti generati dall'AI possono contenere errori, imprecisioni o bias e non costituiscono consulenza professionale. Vanno verificati, soprattutto prima di usarli per valutare."),
        tl("Per questo la piattaforma è pensata con il docente nel loop: supervisiona la sessione e resta responsabile delle istruzioni dei Teacherbot. Sono inoltre in vigore i limiti di credito e alcune funzioni sono ancora in fase beta, quindi possono verificarsi bug."),
      ],
    },
  ]
}

function FaqRow({ item, id, open, onToggle }: { item: FaqItem; id: string; open: boolean; onToggle: () => void }) {
  const buttonId = `${id}-btn`
  const panelId = `${id}-panel`
  return (
    <li className="border-b border-slate-200">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-start justify-between gap-4 rounded-md py-4 text-left text-base font-bold text-[var(--logo-ink)] transition-colors hover:text-[var(--logo-pink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--logo-pink)]"
        >
          <span>{item.q}</span>
          <ChevronDown
            aria-hidden="true"
            className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h3>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} className="pb-5 pr-9">
        <div className="space-y-3 text-sm leading-relaxed text-slate-600 md:text-base">
          {item.a.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </div>
    </li>
  )
}

export function LandingFaq() {
  const baseId = useId()
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const faqs = buildFaqs()

  return (
    <section id="landing-faq" aria-labelledby={`${baseId}-title`} className="scroll-mt-28 text-left">
      <div className="border-t border-slate-200 py-10">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--logo-pink)]">{tl("Domande frequenti")}</span>
        <h2 id={`${baseId}-title`} className="mt-2 text-2xl font-black tracking-tight text-[var(--logo-ink)] md:text-3xl">
          {tl("Prima di iniziare")}
        </h2>
        <ul className="mt-6 max-w-3xl border-t border-slate-200">
          {faqs.map((item, index) => (
            <FaqRow
              key={index}
              item={item}
              id={`${baseId}-${index}`}
              open={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? null : index)}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
