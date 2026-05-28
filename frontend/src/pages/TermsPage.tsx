import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
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
} from 'lucide-react'

const CONTACT_EMAIL = 'a.saracino@fondazionegolinelli.it'

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
          ctx.fillStyle = `rgba(148,163,184,${Math.min(0.28 + displacement * 0.007, 0.68)})`
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

  return <canvas ref={canvasRef} className="fixed inset-0 -z-10" style={{ background: '#f8fafc' }} />
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
  { id: 'oggetto', label: 'Oggetto e fase pilota' },
  { id: 'accesso', label: 'Accesso e utenti' },
  { id: 'studenti', label: 'Studenti minorenni' },
  { id: 'contenuti', label: 'Contenuti e responsabilità' },
  { id: 'ai', label: 'Funzionalità AI' },
  { id: 'usi-vietati', label: 'Usi vietati e alert' },
  { id: 'crediti', label: 'Crediti AI' },
  { id: 'servizio', label: 'Disponibilità' },
  { id: 'privacy', label: 'Dati e privacy' },
  { id: 'contatti', label: 'Contatti' },
]

export default function TermsPage() {
  return (
    <div className="relative min-h-screen font-sans text-slate-900">
      <DottedGridBackground />

      <nav className="sticky top-0 z-50 flex w-full items-center justify-between border-b border-white/50 bg-white/70 px-6 py-4 backdrop-blur-md">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo_new.png" alt="Golinelli AI" className="h-9 w-auto rounded-md shadow-sm" />
          <span className="text-xl tracking-tight" style={{ fontFamily: '"SofiaPro"' }}>
            <span className="font-bold text-[#2d2d2d]/85">Golinelli</span>
            <span className="font-black text-[#e85c8d]">.ai</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-semibold uppercase tracking-widest text-slate-400 sm:inline">Termini e condizioni</span>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-white"
          >
            <ChevronLeft size={14} /> Torna alla home
          </Link>
        </div>
      </nav>

      <header className="relative overflow-hidden">
        <div className="mx-auto max-w-5xl px-4 pb-8 pt-12 sm:px-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-rose-700">
            <Scale size={12} /> Documento operativo
          </div>
          <h1 className="mb-3 text-4xl font-black leading-tight text-slate-900 sm:text-5xl">
            Termini e Condizioni <br />
            <span className="bg-gradient-to-r from-[#e85c8d] via-indigo-600 to-[#2d2d2d] bg-clip-text text-transparent">
              della piattaforma Golinelli.ai
            </span>
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Condizioni d'uso della piattaforma sperimentale Golinelli.ai, accessibile solo su invito nell'ambito delle attività formative e di sperimentazione promosse da Fondazione Golinelli.
            Ultimo aggiornamento: maggio 2026.
          </p>
          <p className="mt-3 inline-block rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            Bozza tecnico-operativa: il presente documento non sostituisce consulenza legale qualificata e dovrà essere verificato prima della pubblicazione definitiva.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl items-start gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside className="sticky top-24 hidden lg:block">
          <div className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur-xl">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Contenuto</p>
            <nav className="space-y-1">
              {TOC.map((item) => (
                <a key={item.id} href={`#${item.id}`} className="block truncate py-1 text-xs text-slate-500 transition-colors hover:font-medium hover:text-[#e85c8d]">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <main className="space-y-6 pt-2">
          <SectionCard id="oggetto" icon={FileText} color="text-indigo-700" bg="bg-indigo-100" title="1. Oggetto e natura sperimentale del servizio">
            <InfoRow label="Gestore" value="Fondazione Golinelli, Via Paolo Nanni Costa 14, 40133 Bologna, P.IVA 03939010371." />
            <InfoRow label="Piattaforma" value="Golinelli.ai, ambiente digitale per attività formative, didattiche e di sperimentazione con strumenti di intelligenza artificiale." />
            <InfoRow label="Fase attuale" value="Servizio pilota e sperimentale, accessibile esclusivamente su invito e non aperto al pubblico generale." />
            <p>
              L'utilizzo della piattaforma è consentito nell'ambito dei corsi, dei percorsi formativi e delle attività di sperimentazione promosse o autorizzate da Fondazione Golinelli.
              Le presenti condizioni regolano l'accesso degli utenti finali e integrano eventuali accordi specifici stipulati con scuole, enti o partner.
            </p>
          </SectionCard>

          <SectionCard id="accesso" icon={KeyRound} color="text-sky-700" bg="bg-sky-100" title="2. Accesso, account e utenti autorizzati">
            <p>
              Possono accedere alla piattaforma solo i docenti invitati dagli amministratori di Golinelli.ai e, tramite loro, gli studenti coinvolti nelle attività didattiche autorizzate.
              Il docente è responsabile della custodia delle proprie credenziali, della corretta configurazione delle classi e dell'utilizzo della piattaforma nel contesto formativo previsto.
            </p>
            <p>
              Gli studenti accedono alle sessioni tramite codice classe generato dal docente e utilizzano un nickname e una password. Non è consentito condividere codici, credenziali o accessi con soggetti non autorizzati.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Tag variant="ok">Solo su invito</Tag>
              <Tag>Docenti in formazione</Tag>
              <Tag>Studenti tramite codice classe</Tag>
            </div>
          </SectionCard>

          <SectionCard id="studenti" icon={GraduationCap} color="text-emerald-700" bg="bg-emerald-100" title="3. Studenti, minorenni e contesto scolastico">
            <p>
              La piattaforma può essere utilizzata anche da studenti minorenni, esclusivamente sotto la responsabilità e la supervisione del docente e dell'istituzione scolastica o del contesto educativo di riferimento.
              Il docente deve proporre attività adeguate all'età, al livello di maturità e agli obiettivi didattici degli studenti coinvolti.
            </p>
            <p>
              Golinelli.ai non è pensata per un uso autonomo da parte degli studenti al di fuori delle sessioni didattiche autorizzate. L'accesso tramite nickname e codice classe serve a ridurre la raccolta di dati identificativi diretti degli studenti.
            </p>
          </SectionCard>

          <SectionCard id="contenuti" icon={Users} color="text-violet-700" bg="bg-violet-100" title="4. Contenuti caricati, attività didattiche e responsabilità">
            <p>
              Docenti e studenti restano responsabili dei contenuti, materiali, prompt, allegati, consegne e messaggi inseriti nella piattaforma. È vietato caricare materiali in violazione di diritti di terzi, obblighi di riservatezza, norme scolastiche o disposizioni applicabili.
            </p>
            <p>
              La piattaforma supporta il docente nell'organizzazione di materiali, interazioni e dati utili alla didattica. Non effettua valutazioni automatiche vincolanti degli studenti e non sostituisce il giudizio professionale, pedagogico e valutativo del docente.
            </p>
          </SectionCard>

          <SectionCard id="ai" icon={Bot} color="text-rose-700" bg="bg-rose-100" title="5. Funzionalità di intelligenza artificiale">
            <p>
              Golinelli.ai integra modelli di intelligenza artificiale disponibili sul mercato. Come ogni sistema AI generativo, tali modelli possono produrre risposte incomplete, imprecise, non aggiornate, non pertinenti o apparentemente corrette ma errate.
            </p>
            <p>
              Gli output generati dall'AI sono strumenti di supporto e devono essere sempre verificati criticamente dal docente o dall'utente responsabile prima di essere utilizzati in attività didattiche, materiali, comunicazioni o decisioni.
            </p>
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-xs text-rose-700">
              Nessun output AI deve essere considerato consulenza professionale, valutazione automatica dello studente o fonte unica per decisioni educative rilevanti.
            </div>
          </SectionCard>

          <SectionCard id="usi-vietati" icon={ShieldAlert} color="text-amber-700" bg="bg-amber-100" title="6. Usi vietati, filtri e segnalazioni">
            <p>Non è consentito utilizzare la piattaforma per:</p>
            <ul className="list-inside list-disc space-y-1 pl-1">
              <li>generare, cercare o diffondere contenuti offensivi, discriminatori, violenti, sessualmente espliciti, illeciti o non adatti al contesto scolastico;</li>
              <li>inserire dati personali, sensibili o riservati non necessari all'attività didattica;</li>
              <li>aggirare sistemi di sicurezza, filtri, limiti di utilizzo o controlli predisposti dalla piattaforma;</li>
              <li>usare gli output AI per plagio, sostituzione indebita del lavoro personale o violazione delle regole del corso;</li>
              <li>effettuare profilazione, sorveglianza impropria o valutazione automatizzata degli studenti.</li>
            </ul>
            <p>
              La piattaforma può includere sistemi di filtro, alert e rilevazione di usi non consentiti, inclusi tentativi di ricerche critiche o l'impiego di parole e concetti offensivi.
              Tali sistemi sono misure di sicurezza e supporto, ma non sostituiscono la supervisione educativa del docente.
            </p>
          </SectionCard>

          <SectionCard id="crediti" icon={CreditCard} color="text-cyan-700" bg="bg-cyan-100" title="7. Crediti AI e limiti di utilizzo">
            <p>
              Nella fase pilota non sono previsti pagamenti diretti da parte degli utenti finali. L'utilizzo delle funzionalità AI è tuttavia soggetto a limiti tecnici ed economici interni, necessari a garantire sostenibilità, equità d'uso e continuità del servizio.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">Docente</p>
                <p className="mt-1 text-2xl font-black text-slate-800">3 euro/mese</p>
                <p className="mt-1 text-xs text-slate-500">limite indicativo di crediti AI per docente</p>
              </div>
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">Studente</p>
                <p className="mt-1 text-2xl font-black text-slate-800">2 euro/mese</p>
                <p className="mt-1 text-xs text-slate-500">limite indicativo di crediti AI per studente associato</p>
              </div>
            </div>
            <p>
              Fondazione Golinelli potrà aggiornare, sospendere o rimodulare tali limiti durante la sperimentazione, anche in base al numero di utenti, ai costi dei modelli AI e alle esigenze del percorso formativo.
            </p>
          </SectionCard>

          <SectionCard id="servizio" icon={Sparkles} color="text-fuchsia-700" bg="bg-fuchsia-100" title="8. Disponibilità, modifiche e sospensione del servizio">
            <p>
              Poiché Golinelli.ai è in fase pilota, alcune funzionalità possono essere modificate, limitate, sospese o disattivate senza preavviso, anche per esigenze tecniche, organizzative, di sicurezza o di conformità.
              Fondazione Golinelli si impegna a gestire la piattaforma con cura e continuità ragionevole, ma non garantisce assenza di errori, interruzioni o malfunzionamenti.
            </p>
            <p>
              In caso di uso improprio, rischio per la sicurezza, violazione delle presenti condizioni o necessità di tutela degli utenti, l'accesso potrà essere limitato o sospeso.
            </p>
          </SectionCard>

          <SectionCard id="privacy" icon={Lock} color="text-indigo-700" bg="bg-indigo-100" title="9. Privacy, sicurezza e dati personali">
            <p>
              Il trattamento dei dati personali avviene secondo l'informativa privacy della piattaforma e nel rispetto delle misure tecniche e organizzative previste per il contesto educativo e sperimentale.
              Gli utenti devono evitare l'inserimento di dati personali non necessari, informazioni sensibili o contenuti riservati non pertinenti all'attività.
            </p>
            <p>
              Per maggiori dettagli sul trattamento dei dati, sull'uso dell'AI e sui diritti degli interessati, consulta la pagina Privacy e AI Act Compliance.
            </p>
            <Link to="/privacy" className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100">
              <ShieldCheck size={13} /> Vai alla Privacy Policy
            </Link>
          </SectionCard>

          <SectionCard id="contatti" icon={LifeBuoy} color="text-slate-700" bg="bg-slate-100" title="10. Contatti, aggiornamenti e legge applicabile">
            <InfoRow label="Segnalazioni" value={CONTACT_EMAIL} />
            <InfoRow label="Abusi o problemi" value={`Per usi impropri, contenuti non consentiti, problemi di accesso o richieste sulla sperimentazione scrivere a ${CONTACT_EMAIL}.`} />
            <p>
              Le presenti condizioni potranno essere aggiornate durante la fase pilota. La versione pubblicata su questa pagina è quella vigente per l'utilizzo della piattaforma.
              Per quanto non espressamente previsto, si applica la legge italiana.
            </p>
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <span>Prima dell'uso esteso o pubblico, il testo dovrebbe essere rivisto da un consulente legale, soprattutto per coordinamento con privacy, contratti con scuole e consenso/informativa per studenti minorenni.</span>
            </div>
          </SectionCard>

          <div className="rounded-3xl border border-white/80 bg-white/70 p-6 text-center text-xs text-slate-400 shadow-sm backdrop-blur-xl">
            <Fingerprint className="mx-auto mb-2 h-5 w-5 text-slate-300" />
            Documento generato per la fase pilota di Golinelli.ai. Ultimo aggiornamento: maggio 2026.
          </div>
        </main>
      </div>
    </div>
  )
}
