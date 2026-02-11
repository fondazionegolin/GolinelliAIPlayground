import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { BrainCircuit, Eye, FlaskConical, ShieldCheck, Users, Workflow } from 'lucide-react'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogoMark } from '@/components/LogoMark'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [heroTilt, setHeroTilt] = useState({ x: 0, y: 0 })
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { toast } = useToast()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await authApi.login(email, password)
      const { access_token, user_id, role, tenant_id } = response.data

      setUser(
        { id: user_id, email, role, tenant_id },
        access_token
      )

      if (role === 'ADMIN') {
        navigate('/admin')
      } else {
        navigate('/teacher')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string | object } } }
      let errorMessage = 'Credenziali non valide'
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail
        errorMessage = typeof detail === 'string' ? detail : JSON.stringify(detail)
      }
      toast({
        variant: 'destructive',
        title: 'Errore di accesso',
        description: errorMessage,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppBackground className="min-h-screen flex items-center justify-center p-4 md:p-6 overflow-hidden bg-[#f7f9ff]">
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-fuchsia-300/40 blur-3xl"
          animate={{ x: [0, 40, -10, 0], y: [0, 30, -20, 0], scale: [1, 1.15, 0.95, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-10 right-4 h-64 w-64 rounded-full bg-cyan-300/35 blur-3xl"
          animate={{ x: [0, -35, 20, 0], y: [0, 15, -20, 0], scale: [1, 0.9, 1.1, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-emerald-300/35 blur-3xl"
          animate={{ x: [0, 20, -25, 0], y: [0, -30, 10, 0], scale: [1, 1.1, 0.95, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(30,41,59,.12) 1px, transparent 0), linear-gradient(135deg, rgba(255,255,255,.2), rgba(255,255,255,0))',
            backgroundSize: '24px 24px, 100% 100%',
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-7xl"
      >
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.45 }}
          className="mb-4 flex items-center justify-center"
        >
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/85 px-2 py-1 shadow-sm backdrop-blur">
            {['Piattaforma', 'Compliance', 'Laboratori AI', 'Beta Access'].map((item) => (
              <a
                key={item}
                href="#"
                onClick={(e) => e.preventDefault()}
                className="rounded-full px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-900 hover:text-white"
              >
                {item}
              </a>
            ))}
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-[1.18fr_0.82fr]">
          <section
            className="rounded-[2rem] border border-slate-200/70 bg-white/78 p-6 md:p-8 shadow-[0_20px_70px_rgba(46,74,174,0.15)] backdrop-blur-xl"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width - 0.5
              const y = (e.clientY - rect.top) / rect.height - 0.5
              setHeroTilt({ x, y })
            }}
            onMouseLeave={() => setHeroTilt({ x: 0, y: 0 })}
          >
            <div className="flex items-center gap-4">
              <LogoMark className="h-14 w-14" bubbleColor="#111827" />
              <div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900" style={{ fontFamily: 'Space Grotesk, Sora, Manrope, sans-serif' }}>
                  Golinelli AI Playground
                </h1>
                <p className="text-slate-700 mt-1 font-medium">Piattaforma professionale per fare lezione con l'AI</p>
              </div>
            </div>

            <p className="mt-6 text-[15px] text-slate-700 leading-relaxed">
              Un workspace educativo progettato per scuole e docenti: esperienze AI multimodali, controllo didattico completo e conformità normativa in un'interfaccia unica.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/teacher-request">
                <Button className="h-11 rounded-xl px-5 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 shadow-lg shadow-fuchsia-300/50">
                  REGISTRATI QUI
                </Button>
              </Link>
              <Link to="/join">
                <Button variant="outline" className="h-11 rounded-xl px-5 border-slate-300 bg-white/85">
                  Entra come studente
                </Button>
              </Link>
            </div>

            <div className="mt-7 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dashboard Preview</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">Orchestrazione lezioni AI in tempo reale</h3>
                <p className="mt-2 text-sm text-slate-600">Sessioni, chatbot, documenti e compiti in un flusso unico per il docente.</p>
              </div>
              <motion.div
                className="relative rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-900 to-indigo-950 p-3 shadow-xl"
                animate={{ rotateX: -heroTilt.y * 10, rotateY: heroTilt.x * 12 }}
                transition={{ type: 'spring', stiffness: 120, damping: 16, mass: 0.4 }}
                style={{ transformPerspective: 1200 }}
              >
                <div className="rounded-xl bg-white p-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-semibold text-slate-500">Sessione Classe</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">LIVE</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-violet-50 p-2">
                      <p className="text-[10px] font-semibold text-violet-700">Teacher in the Loop</p>
                    </div>
                    <div className="rounded-lg bg-cyan-50 p-2">
                      <p className="text-[10px] font-semibold text-cyan-700">Privacy by Design</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2">
                      <p className="text-[10px] font-semibold text-emerald-700">AI Explainability</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2">
                      <p className="text-[10px] font-semibold text-amber-700">ML/Data Science</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
              className="mt-7 grid gap-3 sm:grid-cols-2"
            >
              {[
                {
                  title: 'Teacher in the Loop',
                  text: 'Il docente mantiene pieno controllo su contenuti, attività e pubblicazione.',
                  icon: Workflow,
                  cls: 'from-rose-50 to-fuchsia-50 border-rose-200 text-rose-900',
                },
                {
                  title: 'Privacy by Design',
                  text: 'Flussi orientati a minimizzazione dati, separazione contesti e protezione identità.',
                  icon: ShieldCheck,
                  cls: 'from-emerald-50 to-lime-50 border-emerald-200 text-emerald-900',
                },
                {
                  title: 'AI Act Compliancy',
                  text: 'Nessun utilizzo per scoring o valutazioni automatiche ad alto impatto sugli studenti.',
                  icon: ShieldCheck,
                  cls: 'from-blue-50 to-cyan-50 border-blue-200 text-blue-900',
                },
                {
                  title: 'Explainability',
                  text: 'Risposte interpretabili e passaggi espliciti per supportare verifica didattica.',
                  icon: Eye,
                  cls: 'from-violet-50 to-indigo-50 border-violet-200 text-violet-900',
                },
                {
                  title: 'AI Multimodale',
                  text: 'Chat, immagini, report e documenti in percorsi didattici integrati.',
                  icon: BrainCircuit,
                  cls: 'from-amber-50 to-orange-50 border-amber-200 text-amber-900',
                },
                {
                  title: 'ML & Data Science Lab',
                  text: 'Laboratori su dataset, visualizzazioni e modelli per attività pratiche in classe.',
                  icon: FlaskConical,
                  cls: 'from-teal-50 to-sky-50 border-teal-200 text-teal-900',
                },
              ].map((item) => (
                <motion.div
                  key={item.title}
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  whileHover={{ y: -4, scale: 1.015 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 16 }}
                  className={`rounded-2xl border bg-gradient-to-br p-4 shadow-sm ${item.cls}`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <item.icon className="h-4 w-4" />
                    {item.title}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed opacity-90">{item.text}</p>
                </motion.div>
              ))}
            </motion.div>
          </section>

          <section className="space-y-4">
            <Card className="rounded-[1.75rem] border-slate-200/80 bg-white/84 shadow-[0_20px_70px_rgba(79,70,229,0.18)] backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-slate-900">Accesso Docenti / Admin</CardTitle>
                <CardDescription>
                  Accedi alla piattaforma e configura la tua classe AI
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="docente@scuola.it"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-11 rounded-xl border-slate-300 bg-white/90"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="h-11 rounded-xl border-slate-300 bg-white/90"
                    />
                  </div>
                  <Button type="submit" className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800" disabled={loading}>
                    {loading ? 'Accesso in corso...' : 'Accedi'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200/80 bg-white/82">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-slate-500" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">Sei uno studente?</p>
                    <p className="text-xs text-slate-600">Usa il codice della sessione fornito dal docente</p>
                  </div>
                  <Link to="/join">
                    <Button variant="outline" size="sm" className="rounded-lg border-slate-300 bg-white/90">
                      Partecipa
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <p className="text-center text-sm text-slate-700">
              Accesso beta per docenti?{' '}
              <Link to="/teacher-request" className="font-bold text-violet-700 hover:text-violet-600 hover:underline">
                REGISTRATI QUI
              </Link>
            </p>
          </section>
        </div>
      </motion.div>
    </AppBackground>
  )
}
