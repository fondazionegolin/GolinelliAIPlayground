import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield, FileText, Users, Brain, Database, Lock, Scale,
  ChevronLeft, ExternalLink, AlertTriangle, Clock, Gavel,
  Bot, Eye, BookOpen, Server
} from 'lucide-react'

// ── Dotted grid background (same as LandingPage) ──────────────────────────────
const DottedGridBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const SPACING = 32, DOT_R = 1.6, INFLUENCE = 150, STRENGTH = 50
    const balls = [
      { cx: 0.15, cy: 0.30, rx: 200, ry: 150, wx: 0.11, wy: 0.07, ph: 0.0 },
      { cx: 0.85, cy: 0.70, rx: 170, ry: 200, wx: 0.08, wy: 0.12, ph: 2.1 },
      { cx: 0.50, cy: 0.15, rx: 220, ry: 120, wx: 0.05, wy: 0.17, ph: 0.8 },
      { cx: 0.30, cy: 0.85, rx: 140, ry: 180, wx: 0.15, wy: 0.09, ph: 3.5 },
    ]
    let rafId: number, t0: number | null = null, lastFrameTime = 0
    const FRAME_INTERVAL = 1000 / 30
    const INFLUENCE_SQ = INFLUENCE * INFLUENCE
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)
    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)
      if (document.hidden) return
      if (now - lastFrameTime < FRAME_INTERVAL) return
      lastFrameTime = now
      if (t0 === null) t0 = now
      const t = (now - t0) * 0.001
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const bPos = balls.map(b => ({
        x: b.cx * canvas.width  + b.rx * Math.sin(b.wx * t + b.ph),
        y: b.cy * canvas.height + b.ry * Math.cos(b.wy * t + b.ph * 0.7),
      }))
      const cols = Math.ceil(canvas.width  / SPACING) + 2
      const rows = Math.ceil(canvas.height / SPACING) + 2
      for (let r = -1; r < rows; r++) {
        for (let c = -1; c < cols; c++) {
          const gx = c * SPACING, gy = r * SPACING
          let dx = 0, dy = 0
          for (const bp of bPos) {
            const ex = gx - bp.x, ey = gy - bp.y
            const dSq = ex * ex + ey * ey
            if (dSq < INFLUENCE_SQ && dSq > 0) { const d = Math.sqrt(dSq); const f = STRENGTH * (1 - d / INFLUENCE) ** 2; dx += (ex / d) * f; dy += (ey / d) * f }
          }
          const disp = Math.sqrt(dx * dx + dy * dy)
          ctx.beginPath()
          ctx.arc(gx + dx, gy + dy, Math.min(DOT_R * (1 + disp * 0.045), DOT_R * 3.5), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(148,163,184,${Math.min(0.28 + disp * 0.007, 0.68)})`
          ctx.fill()
        }
      }
    }
    rafId = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={canvasRef} className="fixed inset-0 -z-10" style={{ background: '#f8fafc' }} />
}

// ── Reusable components ───────────────────────────────────────────────────────

function SectionCard({ id, icon: Icon, color, bg, title, children }: {
  id?: string; icon: React.ElementType; color: string; bg: string; title: string; children: React.ReactNode
}) {
  return (
    <div id={id} className="scroll-mt-24 bg-white/80 backdrop-blur-xl rounded-3xl border border-white/80 shadow-sm p-7">
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-10 h-10 rounded-2xl ${bg} ${color} flex items-center justify-center flex-shrink-0`}>
          <Icon size={20} />
        </div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      </div>
      <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
        {children}
      </div>
    </div>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <h3 className="font-semibold text-slate-700 mb-1.5">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider sm:w-40 flex-shrink-0">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}

function Tag({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'warning' | 'ok' }) {
  const styles = {
    default: 'bg-slate-100 text-slate-600 border-slate-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[variant]}`}>
      {children}
    </span>
  )
}

function Ref({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline">
      {children}<ExternalLink size={11} />
    </a>
  )
}

// ── Anchor nav items ──────────────────────────────────────────────────────────

const TOC = [
  { id: 'policy',      label: 'Privacy Policy' },
  { id: 'dati',        label: 'Dati trattati' },
  { id: 'finalita',    label: 'Finalità e basi giuridiche' },
  { id: 'ai',          label: 'Uso dell\'AI' },
  { id: 'minori',      label: 'Minori e scuola' },
  { id: 'sicurezza',   label: 'Sicurezza' },
  { id: 'diritti',     label: 'Diritti degli interessati' },
  { id: 'compliance',  label: 'Compliance & AI Act' },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen font-sans text-slate-900">
      <DottedGridBackground />

      {/* Navbar */}
      <nav className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/70 border-b border-white/50 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo_new.png" alt="Golinelli AI" className="h-9 w-auto shadow-sm rounded-md" />
          <span className="text-xl tracking-tight" style={{ fontFamily: '"SofiaPro"' }}>
            <span className="font-bold text-[#2d2d2d]/85">Golinelli</span>
            <span className="font-black text-[#e85c8d]">.ai</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs font-semibold text-slate-400 uppercase tracking-widest">Privacy & AI Act</span>
          <Link to="/"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 hover:border-slate-300 bg-white/60 hover:bg-white transition-colors text-slate-600">
            <ChevronLeft size={14} /> Torna alla home
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold uppercase tracking-wider mb-4">
            <Shield size={12} /> Documento ufficiale
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-slate-900 leading-tight mb-3">
            Privacy Policy <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#e85c8d] via-indigo-600 to-[#2d2d2d]">
              & AI Act Compliance
            </span>
          </h1>
          <p className="text-slate-500 text-sm max-w-2xl">
            Informativa sul trattamento dei dati personali e analisi di conformità della piattaforma Golinelli.ai ai sensi del GDPR (UE 2016/679) e dell'AI Act (UE 2024/1689).
            Ultimo aggiornamento: febbraio 2026.
          </p>
          <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 inline-block">
            Documento tecnico-operativo in bozza — non sostituisce consulenza legale qualificata.
          </p>
        </div>
      </div>

      {/* Content grid: ToC + main */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-20 grid lg:grid-cols-[220px_1fr] gap-8 items-start">

        {/* Sticky ToC */}
        <aside className="hidden lg:block sticky top-24">
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl border border-white/80 shadow-sm p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Contenuto</p>
            <nav className="space-y-1">
              {TOC.map(item => (
                <a key={item.id} href={`#${item.id}`}
                  className="block text-xs text-slate-500 hover:text-[#e85c8d] hover:font-medium py-1 transition-colors truncate">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Sections */}
        <main className="space-y-6 pt-2">

          {/* 8.1 Titolare */}
          <SectionCard id="policy" icon={Scale} color="text-indigo-700" bg="bg-indigo-100" title="8.1 — Titolare e contatti">
            <InfoRow label="Titolare" value="Fondazione Golinelli, [indirizzo], in qualità di Titolare/Responsabile del trattamento per la piattaforma Golinelli.ai (EduAI)." />
            <InfoRow label="Contatto privacy" value="[email privacy] — [PEC]" />
            <InfoRow label="DPO" value="[nome/contatto — se nominato]" />
          </SectionCard>

          {/* 8.2 Dati */}
          <SectionCard id="dati" icon={Database} color="text-violet-700" bg="bg-violet-100" title="8.2 — Dati trattati">
            <p>Trattiamo, in base ai servizi attivati:</p>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>Dati anagrafici e account (docenti/amministratori): email, nome, cognome, istituzione, preferenze</li>
              <li>Identificativi studente: nickname, token di sessione, stato freeze</li>
              <li>Contenuti didattici e messaggi: chat, compiti, quiz, allegati, documenti</li>
              <li>Metadati tecnici e di sicurezza: log accessi, audit eventi, modello AI utilizzato</li>
              <li>Dati contenuti nei documenti caricati da scuole, docenti e studenti</li>
            </ul>
            <p className="pt-2 text-slate-500 text-xs bg-slate-50 rounded-xl px-3 py-2">
              Non è richiesto il conferimento di categorie particolari di dati (art. 9 GDPR), salvo casi strettamente necessari e disciplinati da specifica base giuridica e misure rafforzate.
            </p>
          </SectionCard>

          {/* 8.3 Finalità */}
          <SectionCard id="finalita" icon={Gavel} color="text-emerald-700" bg="bg-emerald-100" title="8.3 — Finalità e basi giuridiche">
            <SubSection title="Finalità principali">
              <ol className="list-decimal list-inside space-y-1 pl-1">
                <li>Erogazione del servizio educativo digitale e gestione account</li>
                <li>Supporto didattico tramite sistemi AI</li>
                <li>Sicurezza, audit, prevenzione abusi e gestione incidenti</li>
                <li>Adempimenti normativi e tutela legale</li>
              </ol>
            </SubSection>
            <SubSection title="Basi giuridiche">
              <p>In base al ruolo e al contesto: art. 6(1)(b), 6(1)(c), 6(1)(e), 6(1)(f) GDPR. Per le scuole pubbliche prevale la base di interesse pubblico/compiti istituzionali definita dall'istituzione scolastica.</p>
            </SubSection>
          </SectionCard>

          {/* 8.4 AI */}
          <SectionCard id="ai" icon={Bot} color="text-rose-700" bg="bg-rose-100" title="8.4 — Uso dell'Intelligenza Artificiale">
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <Eye size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
                <span>Gli utenti sono informati quando interagiscono con un sistema AI.</span>
              </li>
              <li className="flex items-start gap-2">
                <Brain size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
                <span>Le risposte AI sono strumenti di supporto e <strong>non sostituiscono</strong> la valutazione professionale del docente.</span>
              </li>
              <li className="flex items-start gap-2">
                <Users size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
                <span>Le decisioni ad impatto rilevante sugli studenti non devono essere assunte in modo esclusivamente automatizzato senza supervisione umana.</span>
              </li>
            </ul>
            <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 mt-2">
              <p className="text-xs text-rose-700 font-medium">Provider LLM attivi sulla piattaforma</p>
              <p className="text-xs text-rose-600 mt-1">OpenAI (GPT), Anthropic (Claude), DeepSeek, Ollama (self-hosted). Ciascun provider è soggetto a DPA/SCC per i trasferimenti extra-UE ove applicabili.</p>
            </div>
          </SectionCard>

          {/* 8.5 Minori */}
          <SectionCard id="minori" icon={BookOpen} color="text-amber-700" bg="bg-amber-100" title="8.5 — Minori e contesto scolastico">
            <p>Il trattamento avviene nel contesto delle attività scolastiche sotto la responsabilità dell'istituzione scolastica competente.</p>
            <p>Sono adottate misure specifiche per:</p>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>Tutela dei minori</li>
              <li>Minimizzazione dei dati raccolti</li>
              <li>Limitazione degli accessi per ruolo (RBAC, multi-tenant)</li>
              <li>Identificazione degli studenti tramite pseudonimo (nickname)</li>
            </ul>
          </SectionCard>

          {/* 8.6–8.7 Destinatari / Trasferimenti */}
          <SectionCard id="destinatari" icon={Server} color="text-sky-700" bg="bg-sky-100" title="8.6–8.7 — Destinatari e trasferimenti extra-UE">
            <SubSection title="Fornitori tecnici">
              <p>I dati possono essere trattati da fornitori tecnici necessari all'erogazione del servizio (hosting, storage, modelli AI, monitoraggio), nominati ove richiesto come responsabili/sub-responsabili del trattamento. L'elenco aggiornato è disponibile su richiesta a [contatto privacy].</p>
            </SubSection>
            <SubSection title="Trasferimenti extra-SEE">
              <p>Qualora alcuni fornitori AI siano stabiliti fuori dallo SEE, i trasferimenti avvengono con garanzie adeguate ai sensi degli artt. 44 e ss. GDPR (es. Clausole Contrattuali Standard e misure supplementari).</p>
            </SubSection>
          </SectionCard>

          {/* 8.8 Conservazione */}
          <SectionCard id="conservazione" icon={Clock} color="text-slate-600" bg="bg-slate-100" title="8.8 — Conservazione dei dati">
            <p>I dati sono conservati per il tempo strettamente necessario alle finalità dichiarate e secondo policy di retention definite con le istituzioni scolastiche.</p>
            <div className="mt-3 rounded-xl overflow-hidden border border-slate-100">
              <div className="grid grid-cols-2 text-xs">
                <div className="px-3 py-2 bg-slate-50 font-semibold text-slate-500 border-b border-slate-100">Categoria</div>
                <div className="px-3 py-2 bg-slate-50 font-semibold text-slate-500 border-b border-slate-100">Periodo indicativo</div>
                <div className="px-3 py-2 border-b border-slate-100">Log tecnici e sicurezza</div>
                <div className="px-3 py-2 border-b border-slate-100 text-amber-600">[X mesi] — da finalizzare</div>
                <div className="px-3 py-2 border-b border-slate-100">Chat e contenuti didattici</div>
                <div className="px-3 py-2 border-b border-slate-100 text-amber-600">[X mesi/anni scolastici]</div>
                <div className="px-3 py-2">Allegati e documenti</div>
                <div className="px-3 py-2 text-amber-600">[X mesi/anni], salvo obblighi normativi</div>
              </div>
            </div>
          </SectionCard>

          {/* 8.9 Sicurezza */}
          <SectionCard id="sicurezza" icon={Lock} color="text-indigo-700" bg="bg-indigo-100" title="8.9 — Sicurezza">
            <p>Applichiamo misure tecniche e organizzative adeguate:</p>
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              {[
                'Controllo accessi per ruolo (RBAC)',
                'Segregazione multi-tenant',
                'Audit logging degli eventi',
                'Token di autenticazione sicuri',
                'Protezioni infrastrutturali',
                'Procedure di gestione incidenti',
              ].map(m => (
                <div key={m} className="flex items-center gap-2 bg-indigo-50 rounded-xl px-3 py-2 text-xs text-indigo-700">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  {m}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 8.10 Diritti */}
          <SectionCard id="diritti" icon={FileText} color="text-teal-700" bg="bg-teal-100" title="8.10 — Diritti degli interessati">
            <p>Gli interessati possono esercitare i diritti previsti dagli <strong>artt. 15–22 GDPR</strong>:</p>
            <div className="grid sm:grid-cols-2 gap-1.5 mt-2">
              {['Accesso (art. 15)', 'Rettifica (art. 16)', 'Cancellazione (art. 17)', 'Limitazione (art. 18)', 'Opposizione (art. 21)', 'Portabilità (art. 20)'].map(r => (
                <div key={r} className="text-xs bg-teal-50 text-teal-700 rounded-lg px-3 py-1.5 border border-teal-100">{r}</div>
              ))}
            </div>
            <p className="mt-3">Per l'esercizio dei diritti: <span className="font-medium text-indigo-600">[email privacy]</span></p>
            <p className="text-xs text-slate-400 mt-1">Resta fermo il diritto di reclamo al Garante per la protezione dei dati personali.</p>
          </SectionCard>

          {/* 8.11 Aggiornamenti */}
          <div className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/70 px-6 py-4 text-sm text-slate-500">
            <strong className="text-slate-700">Aggiornamenti policy.</strong> La presente informativa può essere aggiornata periodicamente. La versione vigente è sempre pubblicata su questa pagina con data di ultimo aggiornamento.
          </div>

          {/* ── Divider: Compliance Analysis ── */}
          <div className="flex items-center gap-4 pt-4">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Analisi di Conformità</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Quadro normativo */}
          <SectionCard id="compliance" icon={Scale} color="text-indigo-700" bg="bg-indigo-100" title="Quadro normativo sintetico">
            <SubSection title="AI Act (UE 2024/1689) — date chiave">
              <div className="space-y-1.5">
                {[
                  { label: 'Entrata in vigore', value: '1 agosto 2024' },
                  { label: 'Piena applicabilità', value: '2 agosto 2026 (con eccezioni progressive)' },
                  { label: 'AI literacy (art. 4)', value: 'Applicabile dal 2 febbraio 2025' },
                  { label: 'Trasparenza (art. 50) + high-risk', value: 'Applicabili da agosto 2026' },
                ].map(r => <InfoRow key={r.label} label={r.label} value={r.value} />)}
              </div>
              <div className="flex flex-wrap gap-2 pt-3">
                <Ref href="https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai">AI Act timeline (Commissione UE)</Ref>
                <Ref href="https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-4">Art. 4 — AI Literacy</Ref>
                <Ref href="https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50">Art. 50 — Trasparenza</Ref>
                <Ref href="https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3">Allegato III — High-risk</Ref>
              </div>
            </SubSection>
            <SubSection title="Contesto italiano e Garante">
              <div className="flex flex-wrap gap-2">
                <Ref href="https://www.mim.gov.it/-/decreto-ministeriale-n-166-del-9-agosto-2025">DM MIM n. 166 del 09/08/2025</Ref>
                <Ref href="https://www.garanteprivacy.it/temi/scuola">Garante Privacy — area Scuola</Ref>
                <Ref href="https://www.garanteprivacy.it/web/guest/home/docweb/-/docweb-display/print/10163470">Garante — schema MIM su IA</Ref>
              </div>
            </SubSection>
          </SectionCard>

          {/* Classificazione AI Act */}
          <SectionCard icon={AlertTriangle} color="text-amber-700" bg="bg-amber-100" title="Classificazione AI Act per i moduli EduAI">
            <SubSection title="Limited-risk / Trasparenza">
              <ul className="list-disc list-inside space-y-0.5 pl-1">
                <li>Chatbot di supporto didattico generale</li>
                <li>Generazione contenuti (testo/immagini) senza decisioni automatizzate su accesso o valutazione formale</li>
              </ul>
              <div className="flex gap-2 mt-2 flex-wrap">
                <Tag>Art. 50 — Trasparenza</Tag>
                <Tag>Art. 4 — AI Literacy</Tag>
              </div>
            </SubSection>
            <SubSection title="Potenzialmente High-risk (Allegato III)">
              <ul className="list-disc list-inside space-y-0.5 pl-1">
                <li>Quiz scoring automatico che incide sul percorso scolastico</li>
                <li>Analytics predittivo su performance studentesche</li>
                <li>Assessment del livello educativo accessibile</li>
              </ul>
              <div className="flex gap-2 mt-2 flex-wrap">
                <Tag variant="warning">FRIA richiesta (art. 27)</Tag>
                <Tag variant="warning">DPIA GDPR (art. 35)</Tag>
              </div>
            </SubSection>
            <SubSection title="Pratiche vietate (art. 5) — da bloccare">
              <ul className="list-disc list-inside space-y-0.5 pl-1 text-rose-700">
                <li>Emotion recognition su studenti/docenti per finalità non mediche/sicurezza</li>
                <li>Pratiche manipolative o sfruttamento vulnerabilità legate all'età</li>
              </ul>
            </SubSection>
          </SectionCard>

          {/* Gap analysis */}
          <SectionCard icon={Eye} color="text-slate-600" bg="bg-slate-100" title="Gap analysis preliminare">
            <div className="space-y-3">
              {[
                { label: 'A. Governance AI Act', stato: 'parziale', gap: 'Classificazione formale per use case; fascicolo tecnico per high-risk; policy post-market monitoring.' },
                { label: 'B. Trasparenza', stato: 'migliorabile', gap: 'Informativa esplicita "stai interagendo con AI", etichettatura output, disclosure modelli/provider.' },
                { label: 'C. Human oversight', stato: 'parziale', gap: 'Procedure scritte su revisione umana obbligatoria prima di decisioni su studenti.' },
                { label: 'D. Data governance', stato: 'migliorabile', gap: 'Retention policy; policy dataset quality/bias; tracciamento basi giuridiche per ogni trattamento.' },
                { label: 'E. Sicurezza', stato: 'buono', gap: 'Cifratura E2E non evidenziata; piano gestione incidenti AI/privacy e SLA notifiche.' },
                { label: 'F. FRIA + DPIA', stato: 'da avviare', gap: 'Template FRIA per casi high-risk; integrazione con DPIA art. 35 GDPR.' },
              ].map(item => (
                <div key={item.label} className="flex flex-col sm:flex-row gap-2 sm:gap-4 py-2 border-b border-slate-100 last:border-0">
                  <div className="sm:w-48 flex-shrink-0">
                    <p className="font-semibold text-slate-700 text-xs">{item.label}</p>
                    <Tag variant={item.stato === 'buono' ? 'ok' : item.stato === 'parziale' ? 'default' : 'warning'}>
                      {item.stato}
                    </Tag>
                  </div>
                  <p className="text-xs text-slate-500">{item.gap}</p>
                </div>
              ))}
            </div>
          </SectionCard>

        </main>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-slate-500 bg-white/40 backdrop-blur-sm border-t border-white/50">
        <p>© 2025 Fondazione Golinelli — <Link to="/" className="hover:text-[#e85c8d] transition-colors">Golinelli.ai</Link> — Documento in bozza, versione febbraio 2026</p>
      </footer>
    </div>
  )
}
