import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck,
  Sparkles,
  Workflow,
  Eye,
  GraduationCap,
  School,
  FlaskConical,
  MessageSquare,
  FileText,
  Terminal,
  Code2,
  Brain,
  Box,
  Radio,
  ClipboardList,
  KeyRound,
  Lock,
  ArrowRight,
  Bot,
  Mail,
} from '@/components/icons'
import { X, Check, Loader2 } from '@/components/icons'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { StudentAccessForm } from '@/components/auth/StudentAccessForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// --- Dotted Grid Background with "ball under paper" deformation ---
const DottedGridBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const SPACING = 32      // grid dot spacing
    const DOT_R = 1.6       // base dot radius
    const INFLUENCE = 150   // ball influence radius (px)
    const STRENGTH = 50     // max displacement (px)

    // Each ball follows an elliptical orbit defined in normalised [0..1] coordinates
    const balls = [
      { cx: 0.22, cy: 0.38, rx: 190, ry: 140, wx: 0.13, wy: 0.08, ph: 0.0 },
      { cx: 0.78, cy: 0.62, rx: 160, ry: 190, wx: 0.09, wy: 0.14, ph: 2.1 },
      { cx: 0.58, cy: 0.18, rx: 210, ry: 110, wx: 0.06, wy: 0.19, ph: 0.8 },
      { cx: 0.38, cy: 0.82, rx: 130, ry: 175, wx: 0.17, wy: 0.10, ph: 3.5 },
      { cx: 0.88, cy: 0.25, rx: 140, ry: 155, wx: 0.11, wy: 0.07, ph: 1.4 },
    ]

    let rafId: number
    let t0: number | null = null
    let lastFrameTime = 0
    const TARGET_FPS = 30
    const FRAME_INTERVAL = 1000 / TARGET_FPS

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame)

      // Pause when tab is hidden
      if (document.hidden) return

      // Throttle to ~30fps
      if (now - lastFrameTime < FRAME_INTERVAL) return
      lastFrameTime = now

      if (t0 === null) t0 = now
      const t = (now - t0) * 0.001   // seconds

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // World positions of balls
      const bPos = balls.map(b => ({
        x: b.cx * canvas.width  + b.rx * Math.sin(b.wx * t + b.ph),
        y: b.cy * canvas.height + b.ry * Math.cos(b.wy * t + b.ph * 0.7),
      }))

      // Draw displaced grid dots
      const cols = Math.ceil(canvas.width  / SPACING) + 2
      const rows = Math.ceil(canvas.height / SPACING) + 2

      const INFLUENCE_SQ = INFLUENCE * INFLUENCE

      for (let r = -1; r < rows; r++) {
        for (let c = -1; c < cols; c++) {
          const gx = c * SPACING
          const gy = r * SPACING

          // Sum displacements from all balls (repulsion radially outward)
          let dx = 0, dy = 0
          for (const bp of bPos) {
            const ex = gx - bp.x
            const ey = gy - bp.y
            const dSq = ex * ex + ey * ey
            if (dSq < INFLUENCE_SQ && dSq > 0) {
              const d = Math.sqrt(dSq)
              const f = STRENGTH * (1 - d / INFLUENCE) ** 2
              dx += (ex / d) * f
              dy += (ey / d) * f
            }
          }

          const dotX = gx + dx
          const dotY = gy + dy
          const disp  = Math.sqrt(dx * dx + dy * dy)

          // Slightly enlarge and brighten dots that are displaced
          const radius = Math.min(DOT_R * (1 + disp * 0.045), DOT_R * 3.5)
          const alpha  = Math.min(0.28 + disp * 0.007, 0.68)

          ctx.beginPath()
          ctx.arc(dotX, dotY, radius, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(163, 163, 163, ${alpha})`
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

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 -z-20"
        style={{ background: '#f6f8fc' }}
      />
    </>
  )
}

export default function LandingPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'home' | 'teachers' | 'students'>('home')
  const [openDocument, setOpenDocument] = useState<null | 'privacy' | 'ai-act'>(null)

  const documentMeta = {
    privacy: {
      title: 'Privacy',
      description: 'Informativa privacy della piattaforma Golinelli.ai',
      src: '/docs/informativa-privacy.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH',
    },
    'ai-act': {
      title: 'AI Act',
      description: 'Audit AI Act e conformità del sistema Golinelli.ai',
      src: '/docs/audit-ai.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH',
    },
  } as const

  const switchTab = (tab: 'home' | 'teachers' | 'students') => {
    setActiveTab(tab)
  }

  const goToContacts = () => {
    setActiveTab('home')
    window.setTimeout(() => document.getElementById('landing-contacts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col font-sans text-slate-900">
      <DottedGridBackground />

      {/* --- Navbar --- */}
      <nav className="sticky top-0 z-50 w-full bg-[var(--ds-navbar)] px-4 py-4 shadow-[var(--ds-shadow-2)] md:px-6 md:py-4">
        <div className="mx-auto max-w-screen-2xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => switchTab('home')}>
                <img src="/logo_new.png" alt="Golinelli AI" className="h-10 w-auto rounded-md shadow-sm" />
                <span className="text-2xl tracking-tight" style={{ fontFamily: 'var(--font-family-brand)' }}>
                  <span className="font-bold text-[var(--logo-ink)]">Golinelli</span>
                  <span className="font-black text-[var(--logo-pink)]">.ai</span>
                </span>
              </div>
              <div className="mx-1 hidden h-7 w-px bg-slate-200 md:block" />
              <a
                href="https://www.fondazionegolinelli.it"
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-2 group md:flex"
              >
                <img src="/golinelli-logo.svg" alt="Fondazione Golinelli" className="h-8 w-auto opacity-70 transition-opacity group-hover:opacity-100" />
              </a>
            </div>

            <div className="hidden md:flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-50/90 p-1">
              <TabButton active={activeTab === 'home'} onClick={() => switchTab('home')} color="#fe004d">{t('landing.nav_explore')}</TabButton>
              <TabButton active={activeTab === 'teachers'} onClick={() => switchTab('teachers')} color="#7b69c9">{t('landing.nav_teachers')}</TabButton>
              <TabButton active={activeTab === 'students'} onClick={() => switchTab('students')} color="#38bdf8">{t('landing.nav_students')}</TabButton>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-3">
                <button
                  onClick={goToContacts}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-[var(--logo-pink)]"
                >
                  <Mail size={13} />
                  Contatti
                </button>
                <button
                  onClick={() => setOpenDocument('privacy')}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-[var(--logo-pink)]"
                >
                  <ShieldCheck size={13} />
                  Privacy
                </button>
                <button
                  onClick={() => setOpenDocument('ai-act')}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-[#7b69c9]"
                >
                  <Sparkles size={13} />
                  AI Act
                </button>
              </div>
              <LanguageSwitcher variant="row" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:hidden" aria-label="Accesso alla piattaforma">
            <MobileNavButton active={activeTab === 'students'} onClick={() => switchTab('students')} tone="sky">
              <GraduationCap className="h-4 w-4" />
              Studente
            </MobileNavButton>
            <MobileNavButton active={activeTab === 'teachers'} onClick={() => switchTab('teachers')} tone="violet">
              <School className="h-4 w-4" />
              Docente
            </MobileNavButton>
          </div>
        </div>
      </nav>

      {/* --- Main Content Area --- */}
      <main className={`relative flex flex-grow justify-center overflow-x-hidden p-4 md:p-8 ${activeTab === 'home' ? 'items-start py-8 md:py-14' : 'items-start py-6 md:items-center'}`}>
        <AnimatePresence mode="wait">
          {activeTab === 'home' && <HomeSection key="home" onTeacherCta={() => switchTab('teachers')} onStudentCta={() => switchTab('students')} />}
          {activeTab === 'teachers' && <TeachersSection key="teachers" />}
          {activeTab === 'students' && <StudentsSection key="students" />}
        </AnimatePresence>
      </main>

      {/* --- Footer --- */}
      <footer className="bg-[var(--ds-navbar)] py-6 text-center text-sm text-slate-500 shadow-[0_-4px_18px_rgba(88,88,92,0.08)]">
        <p>{t('landing.footer_copyright')}</p>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          un progetto di{' '}
          <a
            href="https://www.fondazionegolinelli.it"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-500 hover:text-[var(--logo-pink)] transition-colors"
          >
            Fondazione Golinelli
          </a>
        </p>
        <p className="mt-2 text-xs">
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-slate-500 transition-colors hover:text-[var(--logo-pink)]">{CONTACT_EMAIL}</a>
        </p>
        <p className="mt-2">
          <span className="inline-flex items-center gap-3 text-xs">
            <button
              onClick={() => setOpenDocument('privacy')}
              className="text-slate-400 hover:text-[var(--logo-pink)] transition-colors underline underline-offset-2"
            >
              Privacy
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={() => setOpenDocument('ai-act')}
              className="text-slate-400 hover:text-[#7b69c9] transition-colors underline underline-offset-2"
            >
              AI Act
            </button>
            <span className="text-slate-300">•</span>
            <Link
              to="/terms"
              className="text-slate-400 hover:text-[var(--logo-pink)] transition-colors underline underline-offset-2"
            >
              Termini
            </Link>
          </span>
        </p>
      </footer>

      <Dialog open={openDocument !== null} onOpenChange={(open) => !open && setOpenDocument(null)}>
        <DialogContent className="max-w-6xl h-[90vh] p-0 overflow-hidden gap-0 flex flex-col">
          {openDocument && (
            <>
              <DialogHeader className="border-b border-slate-200 bg-white/92 px-5 py-3 backdrop-blur-sm shrink-0">
                <DialogTitle className="text-base">{documentMeta[openDocument].title}</DialogTitle>
                <DialogDescription className="text-xs">
                  {documentMeta[openDocument].description}
                </DialogDescription>
              </DialogHeader>
              <div className="flex-1 min-h-0 bg-slate-100">
                <iframe
                  src={documentMeta[openDocument].src}
                  title={documentMeta[openDocument].title}
                  className="h-full w-full border-0"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MobileNavButton({
  active,
  children,
  onClick,
  tone,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
  tone: 'rose' | 'violet' | 'sky'
}) {
  const toneClass = tone === 'rose'
    ? 'border-rose-200 text-rose-700'
    : tone === 'violet'
      ? 'border-violet-200 text-violet-700'
      : 'border-sky-200 text-sky-700'

  const activeClass = tone === 'rose'
    ? 'bg-rose-600 border-rose-600 text-white'
    : tone === 'violet'
      ? 'bg-violet-600 border-violet-600 text-white'
      : 'bg-sky-600 border-sky-600 text-white'

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
        active ? activeClass : `bg-white ${toneClass}`
      }`}
    >
      {children}
    </button>
  )
}

function TabButton({ active, children, onClick, color = '#262626' }: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
        active ? 'text-white' : 'text-slate-600 hover:bg-white'
      }`}
    >
      {active && (
        <motion.div
          layoutId="activeTab"
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: color }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  )
}

type Accent = 'pink' | 'blue' | 'violet'

// Flat tints of the logo palette: strong ink for icons/numbers, soft fill for tiles.
const ACCENT: Record<Accent, { ink: string; soft: string }> = {
  pink: { ink: 'var(--logo-pink)', soft: 'rgba(254,0,77,0.09)' },
  blue: { ink: 'var(--logo-blue-strong)', soft: 'rgba(62,169,244,0.14)' },
  violet: { ink: 'var(--logo-violet-strong)', soft: 'rgba(123,105,201,0.13)' },
}

const CONTACT_EMAIL = 'a.saracino@fondazionegolinelli.it'

const MODULES: { key: string; icon: typeof Bot; accent: Accent }[] = [
  { key: 'chat', icon: MessageSquare, accent: 'pink' },
  { key: 'docs', icon: FileText, accent: 'blue' },
  { key: 'notebook', icon: Terminal, accent: 'violet' },
  { key: 'vibe', icon: Code2, accent: 'pink' },
  { key: 'ml', icon: Brain, accent: 'blue' },
  { key: 'solid', icon: Box, accent: 'violet' },
  { key: 'live', icon: Radio, accent: 'pink' },
  { key: 'classes', icon: ClipboardList, accent: 'blue' },
]

const MODULE_COPY: Record<string, { title: string; body: string }> = {
  chat: { title: 'Chat AI e Teacherbot', body: 'Assistenti con prompt, conoscenza e limiti scelti dal docente, per la preparazione e per la classe.' },
  docs: { title: 'Documenti e slide', body: 'Testi, schede e presentazioni generati e rifiniti con l\'AI, da pubblicare agli studenti.' },
  notebook: { title: 'Notebook', body: 'Python, p5.js e micro:bit con tutor AI integrato e cronologia delle versioni.' },
  vibe: { title: 'Vibe Lab', body: 'Si descrive un\'app o un gioco, l\'AI lo scrive, lo studente lo vede girare e lo modifica.' },
  ml: { title: 'ML Lab', body: 'Classificatori di immagini, pose e mani addestrati dal browser, per capire come impara una macchina.' },
  solid: { title: '3D Lab', body: 'Modellazione solida stile Tinkercad con un assistente AI e link pubblico con QR.' },
  live: { title: 'Live Interaction', body: 'Quiz, nuvole di parole, sondaggi e feedback in tempo reale durante la lezione.' },
  classes: { title: 'Classi e compiti', body: 'Classi, sessioni, compiti, report e crediti sotto controllo, sempre con il docente nel loop.' },
}

// Soft halo under text: raises the alpha of the page background only behind the copy,
// so the animated dot grid never fights with the letters. Feathered, no hard edge.
const HALO_CSS = `
.landing-halo { position: relative; isolation: isolate; }
.landing-halo::before {
  content: ''; position: absolute; z-index: -1; pointer-events: none;
  inset: -1.75rem -2.75rem;
  background: radial-gradient(ellipse farthest-side at 50% 50%, rgba(246,248,252,0.94) 0%, rgba(246,248,252,0.86) 55%, rgba(246,248,252,0) 100%);
}
`

function ModuleCard({ moduleKey, icon: Icon, accent }: { moduleKey: string; icon: typeof Bot; accent: Accent }) {
  const { t } = useTranslation()
  const a = ACCENT[accent]
  const copy = MODULE_COPY[moduleKey]
  return (
    <div className="ds-panel rounded-[var(--ds-radius-card)] p-5 transition-transform duration-200 hover:-translate-y-1">
      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: a.soft, color: a.ink }}>
        <Icon size={20} />
      </span>
      <h3 className="mt-4 text-base font-extrabold text-[var(--logo-ink)]">
        {t(`landing.mod_${moduleKey}_title`, { defaultValue: copy.title })}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
        {t(`landing.mod_${moduleKey}_body`, { defaultValue: copy.body })}
      </p>
    </div>
  )
}

// Translucent blocks drifting behind the hero, purely decorative.
const DRIFT_BLOCKS = [
  { className: 'left-[-3%] top-[6%] h-28 w-44', dy: 14, dur: 9, rot: -6 },
  { className: 'right-[2%] top-[-2%] h-36 w-36', dy: -16, dur: 11, rot: 5 },
  { className: 'left-[38%] bottom-[-6%] h-24 w-56', dy: 12, dur: 10, rot: 3 },
  { className: 'right-[-4%] bottom-[8%] h-32 w-48', dy: -12, dur: 12, rot: -4 },
]

function DriftBlocks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 hidden md:block">
      {DRIFT_BLOCKS.map((b, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-[var(--ds-radius-card)] bg-white/45 shadow-[var(--ds-shadow-1)] ${b.className}`}
          animate={{ y: [0, b.dy, 0], rotate: [b.rot, -b.rot, b.rot] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

function useTeacherLogin() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { toast } = useToast()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await authApi.login(email, password)
      const { access_token, user_id, role, tenant_id } = response.data
      setUser({ id: user_id, email, role, tenant_id }, access_token)
      navigate('/teacher')
    } catch (error: any) {
      const detail = error.response?.data?.detail
      toast({
        variant: 'destructive',
        title: t('login.title'),
        description: typeof detail === 'string' ? detail : 'Controlla le credenziali.',
      })
    } finally {
      setLoading(false)
    }
  }

  return { email, setEmail, password, setPassword, loading, handleLogin }
}

function QuickLogin({ onStudentCta }: { onStudentCta: () => void }) {
  const { t } = useTranslation()
  const { email, setEmail, password, setPassword, loading, handleLogin } = useTeacherLogin()
  return (
    <div className="ds-panel relative z-10 w-full rounded-[var(--ds-radius-card)] p-5 md:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: ACCENT.pink.soft, color: ACCENT.pink.ink }}>
          <School size={20} />
        </span>
        <div className="text-left">
          <h2 className="text-lg font-extrabold leading-tight text-[var(--logo-ink)]">
            {t('landing.quick_title', { defaultValue: 'Accesso rapido' })}
          </h2>
          <p className="text-xs text-slate-500">{t('landing.quick_subtitle', { defaultValue: 'Per i docenti con account' })}</p>
        </div>
      </div>

      <form onSubmit={handleLogin} className="mt-5 space-y-3 text-left">
        <div className="space-y-1.5">
          <Label htmlFor="quick-email">{t('teacher_request.email')}</Label>
          <Input
            id="quick-email" type="email" autoComplete="email"
            placeholder={t('login.email_placeholder')}
            value={email} onChange={(e) => setEmail(e.target.value)} required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quick-password">Password</Label>
          <Input
            id="quick-password" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
        </div>
        <Button type="submit" tone="accent" surface="solid" className="w-full" disabled={loading}>
          {loading ? t('login.logging_in') : t('login.login_btn')}
        </Button>
      </form>

      <div className="mt-4 flex flex-col gap-1 text-left text-sm">
        <button onClick={onStudentCta} className="inline-flex items-center gap-1 font-semibold text-slate-700 transition-colors hover:text-[var(--logo-pink)]">
          {t('landing.quick_student', { defaultValue: 'Sei uno studente? Entra con il codice' })} <ArrowRight size={14} />
        </button>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <KeyRound size={12} />
          {t('landing.quick_invite', { defaultValue: 'Account docente solo su invito' })}
        </p>
      </div>
    </div>
  )
}

function HomeSection({
  onTeacherCta,
  onStudentCta,
}: {
  onTeacherCta: () => void
  onStudentCta: () => void
}) {
  const { t } = useTranslation()
  const td = (key: string, fallback: string) => t(`landing.${key}`, { defaultValue: fallback })

  const PILLARS = [
    { title: t('landing.feature_teacher_loop_title'), icon: Workflow, accent: 'violet' as Accent },
    { title: t('landing.feature_privacy_title'), icon: ShieldCheck, accent: 'blue' as Accent },
    { title: t('landing.feature_ai_edu_title'), icon: Eye, accent: 'pink' as Accent },
  ]

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const TEACHER_STEPS = [
    { title: td('tut_t1_title', 'Ricevi l\'invito'), body: td('tut_t1_body', 'Per ora i docenti si registrano solo su invito: arriva una mail con un link personale di attivazione.') },
    { title: td('tut_t2_title', 'Attiva l\'account'), body: td('tut_t2_body', 'Apri il link, scegli la password e accetta le informative. I crediti mensili sono già assegnati.') },
    { title: td('tut_t3_title', 'Crea classe e sessione'), body: td('tut_t3_body', 'Dall\'area docenti crei una classe, avvii una sessione e scegli i moduli da abilitare.') },
    { title: td('tut_t4_title', 'Condividi il codice'), body: td('tut_t4_body', 'La sessione genera un codice di accesso: lo comunichi in aula o sul registro, e gli studenti entrano.') },
  ]

  const STUDENT_STEPS = [
    { title: td('tut_s1_title', 'Chiedi il codice al docente'), body: td('tut_s1_body', 'Serve il codice di una sessione già avviata dal docente. Senza codice non si può entrare.') },
    { title: td('tut_s2_title', 'Apri «Accesso studenti»'), body: td('tut_s2_body', 'Inserisci il codice e scegli un nickname: nessuna email, nessun dato personale richiesto.') },
    { title: td('tut_s3_title', 'Imposta la password'), body: td('tut_s3_body', 'Al primo ingresso crei una password per il tuo nickname; le volte dopo accedi con quella.') },
    { title: td('tut_s4_title', 'Lavora nei moduli'), body: td('tut_s4_body', 'Trovi solo i moduli abilitati dal docente per quella sessione, con il suo controllo sempre attivo.') },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5 }}
      className="w-full max-w-6xl space-y-20 md:space-y-28"
    >
      <style>{HALO_CSS}</style>

      {/* ---------- Hero ---------- */}
      <section className="relative grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-center md:gap-14">
        <DriftBlocks />
        <div className="landing-halo relative z-10 text-left">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            {td('hero_eyebrow', 'Piattaforma didattica per la scuola')}
          </span>

          <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight text-[var(--logo-ink)] md:text-6xl">
            L'Intelligenza Artificiale <br />
            <span className="text-[var(--logo-pink)]">entra in classe.</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-700 md:text-lg">
            {td('hero_body', 'Golinelli.ai è un ambiente sicuro dove il docente prepara la lezione con l\'AI e la porta in classe. Dentro trovi assistenti, documenti, notebook di codice, laboratori di machine learning e 3D, quiz in tempo reale: tutto in una sessione che gli studenti raggiungono con un solo codice.')}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {PILLARS.map(p => (
              <span key={p.title} className="ds-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700">
                <p.icon size={13} style={{ color: ACCENT[p.accent].ink }} />
                {p.title}
              </span>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button tone="accent" surface="solid" onClick={onTeacherCta}>
              {td('cta_teachers', 'Area docenti')}
            </Button>
            <Button tone="neutral" surface="outline" onClick={onStudentCta}>
              {td('cta_students', 'Accesso studenti')}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
            <button onClick={() => scrollTo('landing-modules')} className="inline-flex items-center gap-1 text-slate-600 transition-colors hover:text-[var(--logo-pink)]">
              {td('link_modules', 'Cosa trovi dentro')} <ArrowRight size={14} />
            </button>
            <button onClick={() => scrollTo('landing-tutorial')} className="inline-flex items-center gap-1 text-slate-600 transition-colors hover:text-[var(--logo-pink)]">
              {td('link_tutorial', 'Come si entra')} <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <QuickLogin onStudentCta={onStudentCta} />
      </section>

      {/* ---------- Modules (layered marquee) ---------- */}
      <section id="landing-modules" className="scroll-mt-28">
        <SectionHeading
          eyebrow={td('modules_eyebrow', 'Dentro la piattaforma')}
          title={td('modules_title', 'Tutto quello che serve per una lezione con l\'AI')}
          body={td('modules_body', 'Ogni modulo si accende per sessione: il docente decide cosa vedono gli studenti.')}
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map(m => (
            <ModuleCard key={m.key} moduleKey={m.key} icon={m.icon} accent={m.accent} />
          ))}
        </div>
      </section>

      {/* ---------- Tutorial ---------- */}
      <section id="landing-tutorial" className="scroll-mt-28">
        <SectionHeading
          eyebrow={td('tut_eyebrow', 'Tutorial')}
          title={td('tut_title', 'Come si entra in piattaforma')}
          body={td('tut_body', 'Due percorsi diversi: i docenti hanno un account su invito, gli studenti entrano con il codice della sessione.')}
        />

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <TutorialTrack
            accent="violet"
            icon={School}
            title={td('tut_teacher_title', 'Per i docenti')}
            badge={td('tut_teacher_badge', 'Solo su invito')}
            steps={TEACHER_STEPS}
            note={td('tut_teacher_note', 'Al momento la registrazione docenti è chiusa: non esiste un form di iscrizione pubblico. Se non hai ricevuto un invito, chiedilo alla tua scuola o a Fondazione Golinelli.')}
            actionLabel={td('tut_teacher_action', 'Vai al login docenti')}
            onAction={onTeacherCta}
          />
          <TutorialTrack
            accent="blue"
            icon={GraduationCap}
            title={td('tut_student_title', 'Per gli studenti')}
            badge={td('tut_student_badge', 'Serve il codice sessione')}
            steps={STUDENT_STEPS}
            note={td('tut_student_note', 'Senza il codice di una sessione già avviata dal docente non è possibile entrare, e non ci si può registrare in autonomia. Il codice lo comunica solo il docente.')}
            actionLabel={td('tut_student_action', 'Ho un codice: entra')}
            onAction={onStudentCta}
          />
        </div>
      </section>

      {/* ---------- Contacts ---------- */}
      <section id="landing-contacts" className="scroll-mt-28">
        <div className="ds-panel flex flex-col gap-5 rounded-[var(--ds-radius-card)] p-6 text-left md:flex-row md:items-center md:justify-between md:p-8">
          <div className="max-w-xl">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--logo-pink)]">{td('contacts_eyebrow', 'Contatti')}</span>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--logo-ink)] md:text-3xl">
              {td('contacts_title', 'Vuoi portare Golinelli.ai nella tua scuola?')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 md:text-base">
              {td('contacts_body', 'Per richiedere un invito docente, avere informazioni sulla piattaforma o segnalare un problema, scrivici.')}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
            <Button tone="accent" surface="solid" asChild>
              <a href={`mailto:${CONTACT_EMAIL}`}>
                <Mail size={16} />
                {CONTACT_EMAIL}
              </a>
            </Button>
            <Button tone="neutral" surface="outline" asChild>
              <a href="https://www.fondazionegolinelli.it" target="_blank" rel="noreferrer">
                Fondazione Golinelli
              </a>
            </Button>
          </div>
        </div>
      </section>
    </motion.div>
  )
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="landing-halo max-w-2xl text-left">
      <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--logo-pink)]">{eyebrow}</span>
      <h2 className="mt-2 text-3xl font-black leading-tight tracking-tight text-[var(--logo-ink)] md:text-4xl">{title}</h2>
      <p className="mt-3 text-base leading-relaxed text-slate-600">{body}</p>
    </div>
  )
}

function TutorialTrack({
  accent, icon: Icon, title, badge, steps, note, actionLabel, onAction,
}: {
  accent: Accent
  icon: typeof School
  title: string
  badge: string
  steps: { title: string; body: string }[]
  note: string
  actionLabel: string
  onAction: () => void
}) {
  const a = ACCENT[accent]
  return (
    <div className="ds-panel rounded-[var(--ds-radius-card)] p-5 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: a.soft, color: a.ink }}>
            <Icon size={20} />
          </span>
          <h3 className="text-xl font-extrabold text-[var(--logo-ink)]">{title}</h3>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
          style={{ background: a.soft, color: a.ink }}
        >
          <KeyRound size={12} />
          {badge}
        </span>
      </div>

      <ol className="mt-6 space-y-5">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black"
              style={{ background: a.soft, color: a.ink }}
            >
              {i + 1}
            </span>
            <div>
              <p className="font-bold text-[var(--logo-ink)]">{s.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex gap-3 rounded-[var(--ds-radius-panel)] p-4" style={{ background: a.soft }}>
        <Lock size={18} className="mt-0.5 shrink-0" style={{ color: a.ink }} />
        <p className="text-sm font-medium leading-relaxed text-slate-800">{note}</p>
      </div>

      <Button tone="neutral" surface="outline" onClick={onAction} className="mt-5 w-full">
        {actionLabel} <ArrowRight size={16} />
      </Button>
    </div>
  )
}

function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    try {
      await authApi.forgotPassword(email.trim())
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-[var(--shadow-xl)] border border-slate-200 p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Email inviata</h3>
            <p className="text-sm text-slate-500 mb-4">Se la mail è registrata riceverai un link per reimpostare la password entro qualche minuto.</p>
            <Button tone="neutral" surface="solid" className="w-full">Chiudi</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-800">Recupera password</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Inserisci l'email del tuo account docente. Ti invieremo un link per reimpostare la password.</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                autoFocus
                required
                placeholder="docente@scuola.it"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="bg-slate-50 border-slate-200"
              />
              <Button type="submit" tone="accent" surface="solid" className="w-full" disabled={loading || !email.trim()}>
                {loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4" />Invio...</span>
                ) : 'Invia link di reset'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function TeachersSection() {
  const { t } = useTranslation()
  const { email, setEmail, password, setPassword, loading, handleLogin } = useTeacherLogin()
  const [showForgot, setShowForgot] = useState(false)

  return (
    <>
    <motion.div
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }} className="w-full max-w-md"
    >
      <div className="overflow-hidden rounded-xl bg-[var(--ds-surface-raised)] shadow-[var(--ds-shadow-3)]">
        <div className="bg-blue-50 px-5 py-5 text-left text-slate-900 md:p-6 md:text-center">
          <div className="relative z-10">
            <School className="mb-3 h-12 w-12 text-blue-700 md:mx-auto" />
            <h2 className="text-2xl font-bold">{t('landing.nav_teacher_area')}</h2>
            <p className="text-sm text-slate-600">{t('login.subtitle')}</p>
          </div>
        </div>

        <div className="p-5 md:p-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('teacher_request.email')}</Label>
              <Input
                id="email" type="email"
                placeholder={t('login.email_placeholder')}
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="border-slate-200 bg-slate-50 focus:ring-blue-500"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" onClick={() => setShowForgot(true)} className="text-xs text-blue-700 hover:underline">Recupera?</button>
              </div>
              <Input
                id="password" type="password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="border-slate-200 bg-slate-50 focus:ring-blue-500"
                required
              />
            </div>
            <Button type="submit" tone="accent" surface="solid" className="h-12 w-full text-base" disabled={loading}>
              {loading ? t('login.logging_in') : t('login.login_btn')}
            </Button>
          </form>

          <div className="mt-8 rounded-2xl bg-[var(--ds-surface-tint)] p-4 text-left shadow-[var(--ds-shadow-inset)]">
            <p className="flex items-center gap-2 text-sm font-bold text-[var(--logo-violet-strong)]">
              <KeyRound size={16} /> {t('landing.invite_only_title', { defaultValue: 'Registrazione solo su invito' })}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {t('landing.invite_only_body', { defaultValue: 'Al momento i docenti non possono iscriversi da soli: l\'account si attiva dal link ricevuto via email. Non hai un invito?' })}{' '}
              <Link to="/teacher-request" className="font-semibold text-[var(--logo-violet-strong)] underline underline-offset-2">
                {t('landing.invite_only_request', { defaultValue: 'Richiedilo qui' })}
              </Link>
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 text-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium border border-amber-200">
          <FlaskConical size={12} /> Piattaforma in Beta Privata
        </span>
      </div>
    </motion.div>
    {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </>
  )
}

function StudentsSection() {
  const { t } = useTranslation()
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }} className="w-full max-w-md"
    >
      <div className="overflow-hidden rounded-xl bg-[var(--ds-surface-raised)] shadow-[var(--ds-shadow-3)]">
        <div className="bg-blue-50 px-5 py-5 text-left text-slate-900 md:p-6 md:text-center">
          <GraduationCap className="mb-3 h-12 w-12 text-sky-700 md:mx-auto" />
          <h2 className="text-2xl font-bold">{t('landing.nav_student_area')}</h2>
          <p className="text-sm text-slate-600">{t('student_join.subtitle')}</p>
        </div>

        <div className="p-5 md:p-8">
          <div className="mb-5 flex gap-3 rounded-2xl bg-[var(--ds-surface-tint)] p-4 text-left shadow-[var(--ds-shadow-inset)]">
            <Lock size={18} className="mt-0.5 shrink-0 text-[var(--logo-blue-strong)]" />
            <p className="text-sm leading-relaxed text-slate-700">
              {t('landing.student_code_note', { defaultValue: 'Per entrare serve il codice di una sessione già avviata dal tuo docente. Senza codice non è possibile accedere.' })}
            </p>
          </div>
          <StudentAccessForm
            submitButtonClassName="group h-11 w-full text-base"
            submitButtonStyle={{}}
          />
        </div>
      </div>
    </motion.div>
  )
}
