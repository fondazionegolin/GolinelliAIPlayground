import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  ChevronLeft,
  CreditCard,
  FileText,
  Fingerprint,
  GraduationCap,
  KeyRound,
  LifeBuoy,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from '@/components/icons'
import { tl } from '@/i18n/tl'

const CONTACT_EMAIL = 'a.saracino@fondazionegolinelli.it'
const PRIVACY_EMAIL = 'privacy@fondazionegolinelli.it'

function DottedGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const SPACING = 32
    const DOT_R = 1.6
    const INFLUENCE = 150
    const STRENGTH = 50
    const balls = [
      { cx: 0.18, cy: 0.32, rx: 190, ry: 140, wx: 0.11, wy: 0.08, ph: 0.0 },
      { cx: 0.78, cy: 0.62, rx: 165, ry: 190, wx: 0.09, wy: 0.13, ph: 2.1 },
      { cx: 0.54, cy: 0.18, rx: 210, ry: 115, wx: 0.06, wy: 0.18, ph: 0.8 },
      { cx: 0.34, cy: 0.84, rx: 140, ry: 170, wx: 0.16, wy: 0.10, ph: 3.5 },
    ]

    let rafId: number
    let t0: number | null = null
    let lastFrameTime = 0
    const frameInterval = 1000 / 30
    const influenceSq = INFLUENCE * INFLUENCE

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resize()
    window.addEventListener('resize', resize)

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      if (document.hidden || now - lastFrameTime < frameInterval) return

      lastFrameTime = now
      if (t0 === null) t0 = now
      const t = (now - t0) * 0.001

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const ballPositions = balls.map((ball) => ({
        x: ball.cx * canvas.width + ball.rx * Math.sin(ball.wx * t + ball.ph),
        y: ball.cy * canvas.height + ball.ry * Math.cos(ball.wy * t + ball.ph * 0.7),
      }))

      const cols = Math.ceil(canvas.width / SPACING) + 2
      const rows = Math.ceil(canvas.height / SPACING) + 2

      for (let row = -1; row < rows; row += 1) {
        for (let col = -1; col < cols; col += 1) {
          const gx = col * SPACING
          const gy = row * SPACING
          let dx = 0
          let dy = 0

          for (const point of ballPositions) {
            const ex = gx - point.x
            const ey = gy - point.y
            const distanceSq = ex * ex + ey * ey

            if (distanceSq < influenceSq && distanceSq > 0) {
              const distance = Math.sqrt(distanceSq)
              const force = STRENGTH * (1 - distance / INFLUENCE) ** 2
              dx += (ex / distance) * force
              dy += (ey / distance) * force
            }
          }

          const displacement = Math.sqrt(dx * dx + dy * dy)
          ctx.beginPath()
          ctx.arc(
            gx + dx,
            gy + dy,
            Math.min(DOT_R * (1 + displacement * 0.045), DOT_R * 3.5),
            0,
            Math.PI * 2,
          )
          ctx.fillStyle = `rgba(163,163,163,${Math.min(0.28 + displacement * 0.007, 0.68)})`
          ctx.fill()
        }
      }
    }

    rafId = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 -z-10" style={{ background: '#fafafa' }} />
}

function SectionCard({
  id,
  icon: Icon,
  color,
  bg,
  title,
  children,
}: {
  id: string
  icon: React.ElementType
  color: string
  bg: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-white/80 bg-white/82 p-7 shadow-sm backdrop-blur-xl">
      <div className="mb-5 flex items-center gap-3">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ${bg} ${color}`}>
          <Icon size={20} />
        </div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-start sm:gap-3">
      <span className="flex-shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:w-44">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}

function Tag({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'warning' | 'ok' }) {
  const styles = {
    default: 'border-slate-200 bg-slate-100 text-slate-600',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}

const TOC = [
  { id: 'oggetto', label: tl("Oggetto e definizioni") },
  { id: 'accesso', label: tl("Accesso e account") },
  { id: 'studenti', label: tl("Studenti e istituti") },
  { id: 'contenuti', label: tl("Contenuti e responsabilità") },
  { id: 'ai', label: tl("Funzionalità AI") },
  { id: 'usi-vietati', label: tl("Usi vietati e moderazione") },
  { id: 'crediti', label: tl("Crediti AI") },
  { id: 'servizio', label: tl("Disponibilità e sospensione") },
  { id: 'privacy', label: tl("Dati e privacy") },
  { id: 'proprieta', label: tl("Proprietà intellettuale") },
  { id: 'contatti', label: tl("Modifiche, legge e contatti") },
]

const LAST_UPDATE = tl("novembre 2026")

export default function TermsPage() {
  // Se l'admin ha caricato un PDF per i termini (pannello Licenze) è quello il documento vigente.
  const { data: current } = useQuery<Record<string, { title: string; version: string; source_url: string }>>({
    queryKey: ['legal-docs-current'],
    queryFn: async () => (await fetch('/api/v1/legal-docs/current')).json(),
    staleTime: 60_000,
    retry: false,
  })
  const custom = current?.license_terms && current.license_terms.source_url !== '/terms' ? current.license_terms : null

  return (
    <div className="relative min-h-screen font-sans text-slate-900">
      <DottedGridBackground />

      <nav className="sticky top-0 z-50 flex w-full items-center justify-between border-b border-white/50 bg-white/70 px-6 py-4 backdrop-blur-md">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo_new.png" alt={tl("Golinelli AI")} className="h-9 w-auto rounded-md shadow-sm" />
          <span className="text-xl tracking-tight" style={{ fontFamily: 'var(--font-family-brand)' }}>
            <span className="font-bold text-[var(--logo-ink)]">Golinelli</span>
            <span className="font-black text-[var(--logo-pink)]">.ai</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-semibold uppercase tracking-widest text-slate-400 sm:inline">{tl("Condizioni d'uso")}</span>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-white"
          >
            <ChevronLeft size={14} /> {tl("Torna alla home")}
          </Link>
        </div>
      </nav>

      {custom ? (
        <main className="mx-auto max-w-5xl space-y-4 px-4 py-10 sm:px-6">
          <h1 className="text-3xl font-black text-slate-900">{custom.title}</h1>
          <p className="text-sm text-slate-500">{tl("Versione")} {custom.version}</p>
          <iframe
            src={`${custom.source_url}#toolbar=0&navpanes=0&view=FitH`}
            title={custom.title}
            className="h-[80vh] min-h-[480px] w-full rounded-xl border border-slate-200 bg-white"
          />
        </main>
      ) : (
      <>
      <header className="relative overflow-hidden">
        <div className="mx-auto max-w-5xl px-4 pb-8 pt-12 sm:px-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-rose-700">
            <Scale size={12} /> {tl("Termini e licenza")}
          </div>
          <h1 className="mb-3 text-4xl font-black leading-tight text-slate-900 sm:text-5xl">
            {tl("Condizioni d'uso")} <br />
            <span className="bg-gradient-to-r from-[#fe004d] via-indigo-600 to-[#2d2d2d] bg-clip-text text-transparent">
              {tl("della piattaforma Golinelli.ai")}
            </span>
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            {tl("Le regole con cui docenti, studenti e istituti utilizzano Golinelli.ai – AI Playground, la piattaforma didattica di Fondazione Golinelli. Il documento va letto insieme all'Informativa sul trattamento dei dati personali (versione 2.0). Ultimo aggiornamento:")} {LAST_UPDATE}.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl items-start gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="sticky top-24 hidden lg:block">
          <div className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">{tl("Contenuto")}</p>
            <nav className="space-y-1">
              {TOC.map((item) => (
                <a key={item.id} href={`#${item.id}`} className="block truncate py-1 text-xs text-slate-500 transition-colors hover:font-medium hover:text-[var(--logo-pink)]">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <main className="space-y-6 pt-2">
          <SectionCard id="oggetto" icon={FileText} color="text-indigo-700" bg="bg-indigo-100" title={tl("1. Oggetto e definizioni")}>
            <InfoRow label={tl("Gestore")} value="Fondazione Golinelli, Via Paolo Nanni Costa 14, 40133 Bologna (BO), C.F./P.IVA 03823850374." />
            <InfoRow label={tl("Piattaforma")} value="Golinelli.ai – AI Playground (playground.golinelli.ai), ambiente digitale per la didattica con strumenti di intelligenza artificiale." />
            <InfoRow label={tl("Destinatari")} value="Docenti, studenti e istituti scolastici o enti formativi che adottano la piattaforma." />
            <p>
              {tl("Le presenti condizioni regolano l'accesso e l'uso della piattaforma da parte degli utenti. L'accettazione è condizione per l'utilizzo del servizio e integra eventuali accordi specifici stipulati con scuole, enti o partner, che prevalgono per le parti in cui dispongono diversamente.")}
            </p>
            <p>
              {tl("Per «Docente» si intende l'utente registrato che crea classi e sessioni; per «Studente» chi accede a una sessione con il codice fornito dal Docente; per «Istituto» la scuola o l'ente che adotta la piattaforma e, per i dati degli Studenti, ne è Titolare del trattamento.")}
            </p>
          </SectionCard>

          <SectionCard id="accesso" icon={KeyRound} color="text-sky-700" bg="bg-sky-100" title={tl("2. Accesso, account e utenti autorizzati")}>
            <p>
              {tl("L'account Docente viene attivato su invito o dopo approvazione da parte della Fondazione. Il Docente è responsabile della custodia delle proprie credenziali, della corretta configurazione delle classi e delle sessioni e dell'uso della piattaforma nel contesto didattico previsto. Ogni accesso effettuato con le sue credenziali gli è attribuito.")}
            </p>
            <p>
              {tl("Gli Studenti non creano un account con email: accedono a una sessione attiva con il codice fornito dal Docente, un nickname e una password di almeno otto caratteri. Non è consentito condividere codici o credenziali con soggetti non autorizzati né usare il nickname di altri.")}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Tag variant="ok">{tl("Account Docente su invito o approvazione")}</Tag>
              <Tag>{tl("Studenti tramite codice sessione")}</Tag>
              <Tag>{tl("Credenziali personali")}</Tag>
            </div>
          </SectionCard>

          <SectionCard id="studenti" icon={GraduationCap} color="text-emerald-700" bg="bg-emerald-100" title={tl("3. Studenti, minorenni e istituti scolastici")}>
            <p>
              {tl("La piattaforma può essere utilizzata da studenti di ogni ordine e grado, anche minorenni, esclusivamente nell'ambito di attività didattiche autorizzate e sotto la supervisione del Docente e la responsabilità dell'Istituto. Il Docente propone attività adeguate all'età, alla maturità e agli obiettivi didattici degli Studenti.")}
            </p>
            <p>
              {tl("Quando la piattaforma è usata in ambito scolastico, l'Istituto è Titolare del trattamento dei dati degli Studenti e la Fondazione agisce come Responsabile del trattamento, secondo le istruzioni documentate dell'Istituto. Spetta all'Istituto informare le famiglie e raccogliere le autorizzazioni eventualmente richieste, in particolare per gli Studenti minori di 14 anni o per funzioni che le richiedano (ad esempio l'uso della webcam in ML Lab).")}
            </p>
            <p>
              {tl("Agli Studenti non vengono richiesti dati anagrafici: l'associazione tra nickname e identità è gestita esclusivamente dall'Istituto.")}
            </p>
          </SectionCard>

          <SectionCard id="contenuti" icon={Users} color="text-violet-700" bg="bg-violet-100" title={tl("4. Contenuti caricati e responsabilità")}>
            <p>
              {tl("Docenti e Studenti restano responsabili dei contenuti, dei materiali, dei prompt, degli allegati, dei codici e dei messaggi che inseriscono. È vietato caricare materiali in violazione di diritti di terzi, obblighi di riservatezza, regolamenti scolastici o norme applicabili. Chi carica un contenuto garantisce di averne il diritto e concede alla Fondazione la sola licenza necessaria a erogare il servizio.")}
            </p>
            <p>
              {tl("Il Docente è responsabile della configurazione dei propri Teacherbot (istruzioni, documenti, conoscenza) e dell'uso che ne fanno gli Studenti. La piattaforma supporta l'attività didattica ma non sostituisce il giudizio professionale, pedagogico e valutativo del Docente e non effettua valutazioni automatiche vincolanti.")}
            </p>
          </SectionCard>

          <SectionCard id="ai" icon={Bot} color="text-rose-700" bg="bg-rose-100" title={tl("5. Funzionalità di intelligenza artificiale")}>
            <p>
              {tl("Golinelli.ai integra sistemi di intelligenza artificiale generativa di fornitori terzi. Tutti gli assistenti sono sistemi di AI, non persone, e testi, immagini, audio e contenuti 3D che producono sono generati artificialmente (art. 50 del Regolamento UE 2024/1689, AI Act). I fornitori coinvolti sono elencati nell'Informativa privacy.")}
            </p>
            <p>
              {tl("I contenuti generati possono essere incompleti, imprecisi, non aggiornati o contenere bias, anche quando appaiono convincenti. Sono strumenti di supporto e vanno verificati criticamente dall'utente prima di essere usati in attività didattiche, materiali o decisioni.")}
            </p>
            <p>
              {tl("Ogni valutazione o feedback prodotto dall'AI ha natura esclusivamente formativa ed è soggetto alla supervisione del Docente (human-in-the-loop). Nessun output AI è consulenza professionale né l'unica base per decisioni che incidano sul percorso scolastico dello Studente.")}
            </p>
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-xs text-rose-700">
              {tl("I Teacherbot non possono essere configurati per supporto psicologico o sanitario, per valutare lo stato emotivo o di salute degli Studenti né per profilarli.")}
            </div>
          </SectionCard>

          <SectionCard id="usi-vietati" icon={ShieldAlert} color="text-amber-700" bg="bg-amber-100" title={tl("6. Usi vietati, moderazione e segnalazioni")}>
            <p>{tl("Non è consentito utilizzare la piattaforma per:")}</p>
            <ul className="list-inside list-disc space-y-1 pl-1">
              <li>{tl("generare, cercare o diffondere contenuti offensivi, discriminatori, violenti, sessualmente espliciti, illeciti o non adatti al contesto scolastico;")}</li>
              <li>{tl("inserire dati personali di terzi, dati di categorie particolari (art. 9 GDPR, ad esempio salute, origine, convinzioni religiose o politiche) o informazioni riservate non necessari all'attività didattica;")}</li>
              <li>{tl("aggirare sistemi di sicurezza, filtri, limiti di utilizzo, controlli di accesso o l'isolamento tra istituti, classi e sessioni;")}</li>
              <li>{tl("usare gli output AI per plagio, sostituzione indebita del lavoro personale o violazione delle regole del corso;")}</li>
              <li>{tl("effettuare profilazione, sorveglianza impropria, riconoscimento biometrico o delle emozioni, o valutazione automatizzata degli Studenti;")}</li>
              <li>{tl("compromettere la disponibilità o la sicurezza del servizio, o rivenderlo o ridistribuirlo senza autorizzazione.")}</li>
            </ul>
            <p>
              {tl("La piattaforma utilizza strumenti automatici di moderazione e di segnalazione degli usi non consentiti. Sono misure di sicurezza e supporto, non sostituiscono la supervisione educativa del Docente e dell'Istituto. La Fondazione può limitare o sospendere l'accesso in caso di uso non conforme alle presenti condizioni o alla normativa.")}
            </p>
          </SectionCard>

          <SectionCard id="crediti" icon={CreditCard} color="text-cyan-700" bg="bg-cyan-100" title={tl("7. Crediti AI e limiti di utilizzo")}>
            <p>
              {tl("L'uso delle funzionalità AI è misurato in crediti, per garantire sostenibilità, equità d'uso e continuità del servizio. I limiti sono assegnati per Docente e, per gli Studenti, tramite un fondo condiviso a livello di istituto o di piattaforma; il consumo residuo è visibile all'utente nell'interfaccia.")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">{tl("Docente")}</p>
                <p className="mt-1 text-sm text-slate-700">{tl("Limite mensile individuale, stabilito dalla Fondazione al momento dell'approvazione dell'account e aggiornabile.")}</p>
              </div>
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">{tl("Studenti")}</p>
                <p className="mt-1 text-sm text-slate-700">{tl("Fondo mensile condiviso, senza limite individuale per singolo Studente.")}</p>
              </div>
            </div>
            <p>
              {tl("Al raggiungimento di un limite le funzioni AI interessate possono essere temporaneamente non disponibili fino al successivo rinnovo o a un adeguamento concordato. La Fondazione può aggiornare i limiti in base ai costi dei modelli, al numero di utenti e agli accordi con gli istituti, dandone comunicazione quando incidono in modo sostanziale sul servizio.")}
            </p>
          </SectionCard>

          <SectionCard id="servizio" icon={Sparkles} color="text-fuchsia-700" bg="bg-fuchsia-100" title={tl("8. Disponibilità, modifiche e sospensione")}>
            <p>
              {tl("La Fondazione gestisce la piattaforma con la diligenza richiesta dal contesto educativo e si adopera per assicurarne continuità e sicurezza, ma non garantisce l'assenza di errori o interruzioni. Funzionalità e modelli possono evolvere nel tempo; le modifiche che riducano in modo rilevante il servizio sono comunicate agli utenti. Sono possibili interventi di manutenzione e sospensioni per motivi tecnici o di sicurezza, anche urgenti.")}
            </p>
            <p>
              {tl("In caso di uso improprio, rischio per la sicurezza, violazione delle presenti condizioni o necessità di tutela degli utenti, l'accesso può essere limitato o sospeso. L'utente può chiedere in ogni momento la chiusura del proprio account; i dati sono conservati e cancellati secondo i tempi indicati nell'Informativa privacy.")}
            </p>
            <p>
              {tl("Nei limiti consentiti dalla legge, la Fondazione non risponde di danni indiretti derivanti dall'uso degli output AI o dall'indisponibilità temporanea del servizio, fermi i diritti inderogabili degli utenti e le responsabilità non escludibili per legge.")}
            </p>
          </SectionCard>

          <SectionCard id="privacy" icon={Lock} color="text-indigo-700" bg="bg-indigo-100" title={tl("9. Privacy, sicurezza e dati personali")}>
            <p>
              {tl("Il trattamento dei dati personali è descritto nell'Informativa sul trattamento dei dati personali (versione 2.0, 26 ottobre 2026), che indica titolari e responsabili, finalità e basi giuridiche, fornitori di AI e sub-responsabili, trasferimenti extra-SEE, tempi di conservazione, misure di sicurezza e diritti degli interessati. In sintesi: i dati applicativi risiedono su server a Bologna, non sono usati per addestrare modelli di AI né per marketing, e agli Studenti non vengono richiesti dati anagrafici.")}
            </p>
            <p>
              {tl("Per i dati degli Studenti il Titolare è l'Istituto: le richieste degli interessati vanno rivolte a quest'ultimo, che la Fondazione assiste nel darvi seguito. Per i dati dei Docenti e per la sicurezza della piattaforma la Fondazione opera come Titolare.")}
            </p>
            <Link to="/privacy" className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100">
              <ShieldCheck size={13} /> {tl("Leggi l'Informativa privacy")}
            </Link>
          </SectionCard>

          <SectionCard id="proprieta" icon={Fingerprint} color="text-teal-700" bg="bg-teal-100" title={tl("10. Proprietà intellettuale e licenza d'uso")}>
            <p>
              {tl("Software, interfaccia, marchi, modelli didattici e documentazione di Golinelli.ai sono di titolarità della Fondazione o dei rispettivi licenziatari. Ai Docenti e agli istituti è concessa una licenza personale, non esclusiva, non trasferibile e revocabile all'uso della piattaforma per finalità didattiche, nei limiti delle presenti condizioni.")}
            </p>
            <p>
              {tl("I materiali creati dagli utenti (lezioni, Teacherbot, progetti, quiz, elaborati) restano degli autori o dell'Istituto, secondo le regole applicabili. Gli output generati dall'AI sono utilizzabili per fini didattici; l'utente è responsabile di verificarne l'originalità e il rispetto di diritti di terzi prima di diffonderli.")}
            </p>
          </SectionCard>

          <SectionCard id="contatti" icon={LifeBuoy} color="text-slate-700" bg="bg-slate-100" title={tl("11. Modifiche, legge applicabile e contatti")}>
            <InfoRow label={tl("Assistenza e segnalazioni")} value={CONTACT_EMAIL} />
            <InfoRow label={tl("Privacy e dati personali")} value={PRIVACY_EMAIL} />
            <p>
              {tl("Le presenti condizioni possono essere aggiornate per variazioni normative, tecnologiche o organizzative. La versione vigente è quella pubblicata su questa pagina con la data di revisione; per le modifiche sostanziali ai Docenti registrati è richiesta una nuova accettazione e gli istituti sono informati via email.")}
            </p>
            <p>
              {tl("Per quanto non previsto si applica la legge italiana. Per ogni controversia con utenti che agiscono come professionisti o enti è competente in via esclusiva il Foro di Bologna, salvi i fori inderogabili previsti dalla legge.")}
            </p>
          </SectionCard>

          <div className="rounded-3xl border border-white/80 bg-white/70 p-6 text-center text-xs text-slate-400 shadow-sm backdrop-blur-xl">
            <Fingerprint className="mx-auto mb-2 h-5 w-5 text-slate-300" />
            {tl("Golinelli.ai – Condizioni d'uso. Fondazione Golinelli. Ultimo aggiornamento:")} {LAST_UPDATE}.
          </div>
        </main>
      </div>
      </>
      )}
    </div>
  )
}
