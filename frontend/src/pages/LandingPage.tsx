import { useState } from 'react'
import { PRIVACY_DOCUMENT_VIEWER_URL } from '@/lib/legalDocuments'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GraduationCap,
  School,
  FlaskConical,
  KeyRound,
  Lock,
  ArrowRight,
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
import { tl } from '@/i18n/tl'
import { LandingFaq } from '@/components/landing/LandingFaq'

export default function LandingPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'home' | 'teachers' | 'students'>('home')
  const [openDocument, setOpenDocument] = useState<null | 'privacy' | 'ai-act'>(null)

  const documentMeta = {
    privacy: {
      title: tl("Informativa privacy"),
      description: tl("Informativa privacy della piattaforma Golinelli.ai — versione 2.0, 26 ottobre 2026"),
      src: PRIVACY_DOCUMENT_VIEWER_URL,
    },
    'ai-act': {
      title: tl("AI Act"),
      description: tl("Audit AI Act e conformità del sistema Golinelli.ai"),
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
    <div className="relative min-h-screen w-full flex flex-col bg-white font-sans text-slate-900">

      {/* --- Navbar --- */}
      <nav className="sticky top-0 z-50 w-full border-b border-slate-100 bg-white/95 px-4 py-4 backdrop-blur-sm md:px-6 md:py-4">
        <div className="mx-auto max-w-screen-2xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => switchTab('home')}>
                <img src="/logo_new.png" alt={tl("Golinelli AI")} className="h-10 w-auto" />
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

            <div className="hidden md:flex items-center gap-1">
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
                  {tl("Contatti")}
                </button>
              </div>
              <LanguageSwitcher variant="row" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:hidden" aria-label={tl("Accesso alla piattaforma")}>
            <MobileNavButton active={activeTab === 'students'} onClick={() => switchTab('students')} tone="sky">
              <GraduationCap className="h-4 w-4" />
              {tl("Studente")}
            </MobileNavButton>
            <MobileNavButton active={activeTab === 'teachers'} onClick={() => switchTab('teachers')} tone="violet">
              <School className="h-4 w-4" />
              {tl("Docente")}
            </MobileNavButton>
          </div>
          <div className="mt-3 flex justify-end border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setOpenDocument('privacy')}
              className="text-sm font-medium text-slate-600 underline underline-offset-4 transition-colors hover:text-[var(--logo-pink)]"
            >
              {tl("Informativa privacy")}
            </button>
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
      <footer className="border-t border-slate-100 bg-white py-8 text-center text-sm text-slate-500">
        <p>{t('landing.footer_copyright')}</p>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          {tl("un progetto di")}{' '}
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
              {tl("Informativa privacy")}
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={() => setOpenDocument('ai-act')}
              className="text-slate-400 hover:text-[#7b69c9] transition-colors underline underline-offset-2"
            >
              {tl("AI Act")}
            </button>
            <span className="text-slate-300">•</span>
            <Link
              to="/terms"
              className="text-slate-400 hover:text-[var(--logo-pink)] transition-colors underline underline-offset-2"
            >
              {tl("Termini")}
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
      className="relative rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-slate-50"
      style={{ color: active ? color : undefined }}
      aria-pressed={active}
    >
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

const MODULES = [
  { key: 'chat', illustration: 'teacherbots' },
  { key: 'docs', illustration: 'documents' },
  { key: 'notebook', illustration: 'notebooks' },
  { key: 'vibe', illustration: 'coding' },
  { key: 'ml', illustration: 'ml-lab' },
  { key: 'solid', illustration: '3d-lab' },
  { key: 'live', illustration: 'live-interaction' },
  { key: 'classes', illustration: 'classes' },
]

const MODULE_COPY: Record<string, { title: string; body: string }> = {
  chat: { title: tl("Chat AI e Teacherbot"), body: tl("Assistenti con prompt, conoscenza e limiti scelti dal docente, per la preparazione e per la classe.") },
  docs: { title: tl("Documenti e slide"), body: tl("Testi, schede e presentazioni generati e rifiniti con l'AI, da pubblicare agli studenti.") },
  notebook: { title: 'Notebook', body: tl("Python, p5.js e micro:bit con tutor AI integrato e cronologia delle versioni.") },
  vibe: { title: 'Vibe Lab', body: tl("Si descrive un'app o un gioco, l'AI lo scrive, lo studente lo vede girare e lo modifica.") },
  ml: { title: 'ML Lab', body: tl("Classificatori di immagini, pose e mani addestrati dal browser, per capire come impara una macchina.") },
  solid: { title: '3D Lab', body: tl("Modellazione solida stile Tinkercad con un assistente AI e link pubblico con QR.") },
  live: { title: 'Live Interaction', body: tl("Quiz, nuvole di parole, sondaggi e feedback in tempo reale durante la lezione.") },
  classes: { title: tl("Classi e compiti"), body: tl("Classi, sessioni, compiti, report e crediti sotto controllo, sempre con il docente nel loop.") },
}

function ModuleCard({ moduleKey, illustration }: { moduleKey: string; illustration: string }) {
  const { t } = useTranslation()
  const copy = MODULE_COPY[moduleKey]
  return (
    <article className="flex flex-col gap-3 border-t border-slate-200 py-6 text-left">
      <img src={`/illustrations/nav/${illustration}.webp`} alt="" width={80} height={80}
        loading="lazy" decoding="async" className="h-20 w-20 shrink-0 object-contain" />
      <div>
        <h3 className="text-base font-bold text-[var(--logo-ink)]">
          {t(`landing.mod_${moduleKey}_title`, { defaultValue: copy.title })}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {t(`landing.mod_${moduleKey}_body`, { defaultValue: copy.body })}
        </p>
      </div>
    </article>
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
        description: typeof detail === 'string' ? detail : tl("Controlla le credenziali."),
      })
    } finally {
      setLoading(false)
    }
  }

  return { email, setEmail, password, setPassword, loading, handleLogin }
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

  const pillars = [
    t('landing.feature_teacher_loop_title'),
    t('landing.feature_privacy_title'),
    t('landing.feature_ai_edu_title'),
  ]

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const TEACHER_STEPS = [
    { title: td('tut_t1_title', tl("Ricevi l'invito")), body: td('tut_t1_body', tl("Per ora i docenti si registrano solo su invito: arriva una mail con un link personale di attivazione.")) },
    { title: td('tut_t2_title', tl("Attiva l'account")), body: td('tut_t2_body', tl("Apri il link, scegli la password e accetta le informative. I crediti mensili sono già assegnati.")) },
    { title: td('tut_t3_title', tl("Crea classe e sessione")), body: td('tut_t3_body', tl("Dall'area docenti crei una classe, avvii una sessione e scegli i moduli da abilitare.")) },
    { title: td('tut_t4_title', tl("Condividi il codice")), body: td('tut_t4_body', tl("La sessione genera un codice di accesso: lo comunichi in aula o sul registro, e gli studenti entrano.")) },
  ]

  const STUDENT_STEPS = [
    { title: td('tut_s1_title', tl("Chiedi il codice al docente")), body: td('tut_s1_body', tl("Serve il codice di una sessione già avviata dal docente. Senza codice non si può entrare.")) },
    { title: td('tut_s2_title', tl("Apri «Accesso studenti»")), body: td('tut_s2_body', tl("Inserisci il codice e scegli un nickname: nessuna email, nessun dato personale richiesto.")) },
    { title: td('tut_s3_title', tl("Imposta la password")), body: td('tut_s3_body', tl("Al primo ingresso crei una password per il tuo nickname; le volte dopo accedi con quella.")) },
    { title: td('tut_s4_title', tl("Lavora nei moduli")), body: td('tut_s4_body', tl("Trovi solo i moduli abilitati dal docente per quella sessione, con il suo controllo sempre attivo.")) },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5 }}
      className="w-full max-w-6xl space-y-20 md:space-y-28"
    >

      {/* ---------- Hero ---------- */}
      <section className="relative grid gap-8 py-4 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-10 md:py-10">
        <div className="relative text-left">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            {td('hero_eyebrow', tl("Piattaforma didattica per la scuola"))}
          </span>

          <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight text-[var(--logo-ink)] md:text-5xl lg:text-6xl">
            {td('hero_title', tl("L’intelligenza artificiale"))}<br />
            <span className="text-[var(--logo-violet-strong)]">{td('hero_title_accent', tl("entra in classe."))}</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-700 md:text-lg">
            {td('hero_body', tl("Uno spazio per insegnare, creare e sperimentare con l'AI. Il docente guida, gli studenti esplorano."))}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button tone="accent" surface="solid" onClick={onTeacherCta}>
              {td('cta_teachers', tl("Area docenti"))}
            </Button>
            <Button tone="neutral" surface="outline" onClick={onStudentCta}>
              {td('cta_students', tl("Accesso studenti"))}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
            <button onClick={() => scrollTo('landing-modules')} className="inline-flex items-center gap-1 text-slate-600 transition-colors hover:text-[var(--logo-pink)]">
              {td('link_modules', tl("Cosa trovi dentro"))} <ArrowRight size={14} />
            </button>
            <button onClick={() => scrollTo('landing-tutorial')} className="inline-flex items-center gap-1 text-slate-600 transition-colors hover:text-[var(--logo-pink)]">
              {td('link_tutorial', tl("Come si entra"))} <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <figure className="min-w-0">
          <img src="/illustrations/landing/learning-together.webp"
            alt={td('hero_image_alt', tl("Due personaggi stringono la mano a una rete neurale sorridente con braccia e gambe."))}
            width={1536} height={1024} fetchPriority="high" decoding="async"
            className="mx-auto h-auto w-full max-w-[640px] object-contain" />
        </figure>
      </section>

      <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 border-y border-slate-100 py-5 text-xs font-semibold text-slate-500">
        {pillars.map(title => <span key={title}>{title}</span>)}
      </div>

      {/* ---------- Modules ---------- */}
      <section id="landing-modules" className="scroll-mt-28">
        <SectionHeading
          eyebrow={td('modules_eyebrow', tl("Dentro la piattaforma"))}
          title={td('modules_title', tl("Tutto quello che serve per una lezione con l'AI"))}
          body={td('modules_body', tl("Ogni modulo si accende per sessione: il docente decide cosa vedono gli studenti."))}
        />
        <div className="mt-8 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map(m => (
            <ModuleCard key={m.key} moduleKey={m.key} illustration={m.illustration} />
          ))}
        </div>
      </section>

      {/* ---------- Tutorial ---------- */}
      <section id="landing-tutorial" className="scroll-mt-28">
        <SectionHeading
          eyebrow={td('tut_eyebrow', 'Tutorial')}
          title={td('tut_title', tl("Come si entra in piattaforma"))}
          body={td('tut_body', tl("Due percorsi diversi: i docenti hanno un account su invito, gli studenti entrano con il codice della sessione."))}
        />

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <TutorialTrack
            accent="violet"
            icon={School}
            title={td('tut_teacher_title', tl("Per i docenti"))}
            badge={td('tut_teacher_badge', tl("Solo su invito"))}
            steps={TEACHER_STEPS}
            note={td('tut_teacher_note', tl("Al momento la registrazione docenti è chiusa: non esiste un form di iscrizione pubblico. Se non hai ricevuto un invito, chiedilo alla tua scuola o a Fondazione Golinelli."))}
            actionLabel={td('tut_teacher_action', tl("Vai al login docenti"))}
            onAction={onTeacherCta}
          />
          <TutorialTrack
            accent="blue"
            icon={GraduationCap}
            title={td('tut_student_title', tl("Per gli studenti"))}
            badge={td('tut_student_badge', tl("Serve il codice sessione"))}
            steps={STUDENT_STEPS}
            note={td('tut_student_note', tl("Senza il codice di una sessione già avviata dal docente non è possibile entrare, e non ci si può registrare in autonomia. Il codice lo comunica solo il docente."))}
            actionLabel={td('tut_student_action', tl("Ho un codice: entra"))}
            onAction={onStudentCta}
          />
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <LandingFaq />

      {/* ---------- Contacts ---------- */}
      <section id="landing-contacts" className="scroll-mt-28">
        <div className="flex flex-col gap-6 border-t border-slate-200 py-10 text-left md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--logo-pink)]">{td('contacts_eyebrow', tl("Contatti"))}</span>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--logo-ink)] md:text-3xl">
              {td('contacts_title', tl("Vuoi portare Golinelli.ai nella tua scuola?"))}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 md:text-base">
              {td('contacts_body', tl("Per richiedere un invito docente, avere informazioni sulla piattaforma o segnalare un problema, scrivici."))}
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
    <div className="max-w-2xl text-left">
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
    <details className="group rounded-2xl border border-slate-200 p-5 md:p-6">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
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
          {badge}
          <span aria-hidden className="ml-1 text-base transition-transform group-open:rotate-45">+</span>
        </span>
      </summary>

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
    </details>
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
            <h3 className="text-base font-bold text-slate-800 mb-1">{tl("Email inviata")}</h3>
            <p className="text-sm text-slate-500 mb-4">{tl("Se la mail è registrata riceverai un link per reimpostare la password entro qualche minuto.")}</p>
            <Button tone="neutral" surface="solid" className="w-full">{tl("Chiudi")}</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-800">{tl("Recupera password")}</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">{tl("Inserisci l'email del tuo account docente. Ti invieremo un link per reimpostare la password.")}</p>
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
                  <span className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4" />{tl("Invio...")}</span>
                ) : tl("Invia link di reset")}
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
            <img src="/illustrations/nav/support.webp" alt="" width={96} height={96} className="mb-3 h-24 w-24 object-contain md:mx-auto" />
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
                <button type="button" onClick={() => setShowForgot(true)} className="text-xs text-blue-700 hover:underline">{tl("Recupera?")}</button>
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
          <FlaskConical size={12} /> {tl("Piattaforma in Beta Privata")}
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
          <img src="/illustrations/nav/classes.webp" alt="" width={96} height={96} className="mb-3 h-24 w-24 object-contain md:mx-auto" />
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
