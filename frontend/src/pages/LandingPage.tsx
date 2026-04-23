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
  Menu,
  X,
  FlaskConical
} from 'lucide-react'
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
          ctx.fillStyle = `rgba(148, 163, 184, ${alpha})`
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
    <canvas
      ref={canvasRef}
      className="absolute inset-0 -z-10"
      style={{ background: '#f6f8fc' }}
    />
  )
}

export default function LandingPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'home' | 'teachers' | 'students'>('home')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
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
    setIsMobileMenuOpen(false)
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col font-sans text-slate-900">
      <DottedGridBackground />

      {/* --- Navbar --- */}
      <nav className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/92 px-6 py-4 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => switchTab('home')}>
            <img src="/logo_new.png" alt="Golinelli AI" className="h-10 w-auto shadow-sm rounded-md" />
            <span className="text-2xl tracking-tight" style={{ fontFamily: '"SofiaPro"' }}>
              <span className="font-bold text-[#2d2d2d]/85">Golinelli</span>
              <span className="font-black text-[#e85c8d]">.ai</span>
            </span>
          </div>
          <div className="hidden md:block h-7 w-px bg-slate-200 mx-1" />
          <a
            href="https://www.fondazionegolinelli.it"
            target="_blank"
            rel="noreferrer"
            className="hidden md:flex items-center gap-2 group"
          >
            <img src="/golinelli-logo.svg" alt="Fondazione Golinelli" className="h-8 w-auto opacity-70 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-50/90 p-1">
          <TabButton active={activeTab === 'home'} onClick={() => switchTab('home')} color="#e85c8d">{t('landing.nav_explore')}</TabButton>
          <TabButton active={activeTab === 'teachers'} onClick={() => switchTab('teachers')} color="#a855f7">{t('landing.nav_teachers')}</TabButton>
          <TabButton active={activeTab === 'students'} onClick={() => switchTab('students')} color="#38bdf8">{t('landing.nav_students')}</TabButton>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={() => setOpenDocument('privacy')}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#e85c8d] transition-colors px-2 py-1"
          >
            <ShieldCheck size={13} />
            Privacy
          </button>
          <button
            onClick={() => setOpenDocument('ai-act')}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#a855f7] transition-colors px-2 py-1"
          >
            <Sparkles size={13} />
            AI Act
          </button>
          <LanguageSwitcher variant="row" />
        </div>

        {/* Mobile Menu Toggle */}
        <button className="md:hidden p-2 text-slate-700" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </nav>

      {/* --- Mobile Menu Overlay --- */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-0 right-0 z-40 border-b border-slate-200 bg-white/96 p-4 md:hidden flex flex-col gap-2"
          >
            <Button variant={activeTab === 'home' ? 'default' : 'ghost'} onClick={() => switchTab('home')} className="w-full justify-start">{t('landing.nav_explore')}</Button>
            <Button variant={activeTab === 'teachers' ? 'default' : 'ghost'} onClick={() => switchTab('teachers')} className="w-full justify-start">{t('landing.nav_teacher_area')}</Button>
            <Button variant={activeTab === 'students' ? 'default' : 'ghost'} onClick={() => switchTab('students')} className="w-full justify-start">{t('landing.nav_student_area')}</Button>
            <button
              onClick={() => { setOpenDocument('privacy'); setIsMobileMenuOpen(false) }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-[#e85c8d] transition-colors"
            >
              <ShieldCheck size={15} /> Privacy
            </button>
            <button
              onClick={() => { setOpenDocument('ai-act'); setIsMobileMenuOpen(false) }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-[#a855f7] transition-colors"
            >
              <Sparkles size={15} /> AI Act
            </button>
            <div className="pt-1"><LanguageSwitcher variant="full" /></div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Main Content Area --- */}
      <main className="flex-grow flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'home' && <HomeSection key="home" onCta={() => switchTab('teachers')} />}
          {activeTab === 'teachers' && <TeachersSection key="teachers" />}
          {activeTab === 'students' && <StudentsSection key="students" />}
        </AnimatePresence>
      </main>

      {/* --- Footer --- */}
      <footer className="border-t border-slate-200/80 bg-white/88 py-6 text-center text-sm text-slate-500 backdrop-blur-sm">
        <p>{t('landing.footer_copyright')}</p>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          un progetto di{' '}
          <a
            href="https://www.fondazionegolinelli.it"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-500 hover:text-[#e85c8d] transition-colors"
          >
            Fondazione Golinelli
          </a>
        </p>
        <p className="mt-2">
          <span className="inline-flex items-center gap-3 text-xs">
            <button
              onClick={() => setOpenDocument('privacy')}
              className="text-slate-400 hover:text-[#e85c8d] transition-colors underline underline-offset-2"
            >
              Privacy
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={() => setOpenDocument('ai-act')}
              className="text-slate-400 hover:text-[#a855f7] transition-colors underline underline-offset-2"
            >
              AI Act
            </button>
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

function TabButton({ active, children, onClick, color = '#1e293b' }: {
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

function HomeSection({ onCta }: { onCta: () => void }) {
  const { t } = useTranslation()

  const FEATURES = [
    {
      title: t('landing.feature_teacher_loop_title'),
      body: t('landing.feature_teacher_loop_body'),
      icon: Workflow, color: 'text-indigo-700', bg: 'bg-indigo-100'
    },
    {
      title: t('landing.feature_privacy_title'),
      body: t('landing.feature_privacy_body'),
      icon: ShieldCheck, color: 'text-emerald-700', bg: 'bg-emerald-100'
    },
    {
      title: t('landing.feature_ai_edu_title'),
      body: t('landing.feature_ai_edu_body'),
      icon: Eye, color: 'text-rose-700', bg: 'bg-rose-100'
    },
    {
      title: t('landing.feature_multimodal_title'),
      body: t('landing.feature_multimodal_body'),
      icon: Sparkles, color: 'text-amber-700', bg: 'bg-amber-100'
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5 }}
      className="max-w-5xl w-full grid md:grid-cols-2 gap-12 items-center"
    >
      <div className="space-y-6 text-center md:text-left">
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-sky-700">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          {t('landing.nav_explore')}
        </div>

        <h1 className="text-4xl md:text-6xl font-black text-slate-900 leading-tight">
          L'Intelligenza Artificiale <br />
          <span className="text-sky-700">
            entra in classe.
          </span>
        </h1>

        <p className="text-lg text-slate-600 leading-relaxed max-w-lg mx-auto md:mx-0">
          Un ambiente sicuro, controllato e creativo dove docenti e studenti esplorano le potenzialità dell'AI Generativa.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
          <Button size="lg" onClick={onCta} className="rounded-full bg-slate-900 px-8 text-white hover:bg-slate-800">
            Inizia Ora
          </Button>
          <a href="https://www.fondazionegolinelli.it" target="_blank" rel="noreferrer">
            <Button variant="outline" size="lg" className="rounded-full px-8 border-slate-300">
              Scopri di più
            </Button>
          </a>
        </div>

        <div className="flex justify-center md:justify-start">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Beta Pubblica — accesso libero per studenti
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 * i }}
            className="rounded-[28px] border border-slate-200/90 bg-white/90 p-5 transition-all hover:-translate-y-1"
          >
            <div className={`w-10 h-10 rounded-2xl ${f.bg} ${f.color} flex items-center justify-center mb-3`}>
              <f.icon size={20} />
            </div>
            <h3 className="font-bold text-slate-900 mb-1">{f.title}</h3>
            <p className="text-sm text-slate-700 leading-relaxed">{f.body}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
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
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Email inviata</h3>
            <p className="text-sm text-slate-500 mb-4">Se la mail è registrata riceverai un link per reimpostare la password entro qualche minuto.</p>
            <button onClick={onClose} className="w-full h-10 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors">Chiudi</button>
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
              <Button type="submit" className="w-full h-10" style={{ backgroundColor: '#a855f7' }} disabled={loading || !email.trim()}>
                {loading ? (
                  <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Invio...</span>
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
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
      navigate(role === 'ADMIN' ? '/admin' : '/teacher')
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

  return (
    <>
    <motion.div
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }} className="max-w-md w-full"
    >
      <div className="overflow-hidden rounded-[30px] border border-slate-200/90 bg-white/94">
        <div className="border-b border-violet-200/80 bg-violet-50 p-6 text-center text-slate-900">
          <div className="relative z-10">
            <School className="mx-auto mb-3 h-12 w-12 text-violet-700" />
            <h2 className="text-2xl font-bold">{t('landing.nav_teacher_area')}</h2>
            <p className="text-sm text-slate-600">{t('login.subtitle')}</p>
          </div>
        </div>

        <div className="p-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('teacher_request.email')}</Label>
              <Input
                id="email" type="email"
                placeholder={t('login.email_placeholder')}
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="border-slate-200 bg-slate-50 focus:ring-indigo-500"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" onClick={() => setShowForgot(true)} className="text-xs text-violet-700 hover:underline">Recupera?</button>
              </div>
              <Input
                id="password" type="password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="border-slate-200 bg-slate-50 focus:ring-indigo-500"
                required
              />
            </div>
            <Button type="submit" className="h-11 w-full text-base" style={{ backgroundColor: '#8b5cf6' }} disabled={loading}>
              {loading ? t('login.logging_in') : t('login.login_btn')}
            </Button>
          </form>

          <div className="mt-8 border-t border-slate-100 pt-6 text-center">
            <p className="text-sm text-slate-500 mb-3">Non hai ancora un account?</p>
            <Link to="/teacher-request">
              <Button variant="outline" className="w-full border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800">
                {t('teacher_request.title')}
              </Button>
            </Link>
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
      exit={{ opacity: 0, x: 20 }} className="max-w-md w-full"
    >
      <div className="overflow-hidden rounded-[30px] border border-slate-200/90 bg-white/94">
        <div className="border-b border-sky-200/80 bg-sky-50 p-6 text-center text-slate-900">
          <GraduationCap className="mx-auto mb-3 h-12 w-12 text-sky-700" />
          <h2 className="text-2xl font-bold">{t('landing.nav_student_area')}</h2>
          <p className="text-sm text-slate-600">{t('student_join.subtitle')}</p>
        </div>

        <div className="p-8">
          <StudentAccessForm
            submitButtonClassName="group h-11 w-full text-base"
            submitButtonStyle={{ backgroundColor: '#0ea5e9' }}
          />
        </div>
      </div>
    </motion.div>
  )
}
