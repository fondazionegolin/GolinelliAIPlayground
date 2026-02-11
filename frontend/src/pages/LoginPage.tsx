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

export default function LoginPage() {
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
    <AppBackground className="min-h-screen p-4 md:p-6 bg-[radial-gradient(circle_at_20%_20%,#fdf2f8_0%,transparent_35%),radial-gradient(circle_at_80%_0%,#dbeafe_0%,transparent_35%),radial-gradient(circle_at_80%_80%,#dcfce7_0%,transparent_35%),linear-gradient(135deg,#f8fafc_0%,#eef2ff_100%)]">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 p-6 md:p-8 shadow-2xl shadow-slate-300/40 backdrop-blur">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-fuchsia-300/35 to-cyan-300/20 blur-3xl" />
            <div className="absolute -right-16 top-24 h-64 w-64 rounded-full bg-gradient-to-br from-emerald-300/30 to-sky-300/20 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-gradient-to-br from-amber-200/30 to-rose-200/20 blur-2xl" />
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage: 'linear-gradient(rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.06) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
          </div>

          <div className="relative">
            <div className="flex items-center gap-4">
              <LogoMark className="h-14 w-14 drop-shadow-md" bubbleColor="#0f172a" />
              <div>
                <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900" style={{ fontFamily: 'Sora, Manrope, Avenir, sans-serif' }}>
                  Golinelli AI Playground
                </h1>
                <p className="mt-1 text-sm md:text-base font-medium text-slate-700">Piattaforma per fare lezione con l'AI</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200/70 bg-white/75 p-4 shadow-sm">
              <p className="text-sm md:text-[15px] text-slate-700 leading-relaxed">
                Un ambiente didattico operativo dove l'AI affianca il docente nella progettazione e conduzione della lezione, con strumenti avanzati e policy di conformità integrate.
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-fuchsia-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-rose-900 font-semibold text-sm"><Workflow className="h-4 w-4" /> Teacher in the Loop</div>
                <p className="text-xs text-rose-800/80 mt-2">Il docente controlla obiettivi, contenuti e pubblicazione delle attività generate.</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-lime-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm"><ShieldCheck className="h-4 w-4" /> Privacy by Design</div>
                <p className="text-xs text-emerald-800/80 mt-2">Dati minimizzati, contesti separati e processi progettati per la tutela degli utenti.</p>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-blue-900 font-semibold text-sm"><ShieldCheck className="h-4 w-4" /> AI Act Compliancy</div>
                <p className="text-xs text-blue-800/80 mt-2">Nessun scoring o valutazione automatica degli studenti nei flussi didattici.</p>
              </div>
              <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-violet-900 font-semibold text-sm"><Eye className="h-4 w-4" /> Explainability</div>
                <p className="text-xs text-violet-800/80 mt-2">Output leggibili e passaggi espliciti per supportare comprensione e verifica.</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm"><BrainCircuit className="h-4 w-4" /> AI Multimodale</div>
                <p className="text-xs text-amber-800/80 mt-2">Chat, immagini, report, documenti e task in un unico workflow educativo.</p>
              </div>
              <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-sky-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-teal-900 font-semibold text-sm"><FlaskConical className="h-4 w-4" /> ML e Data Science Lab</div>
                <p className="text-xs text-teal-800/80 mt-2">Laboratori pratici su dataset, visualizzazioni, modelli e interpretazione risultati.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <Card className="border-slate-200/70 bg-white/85 shadow-2xl shadow-indigo-200/40 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-slate-900">Accesso Docenti / Admin</CardTitle>
              <CardDescription>
                Inserisci le credenziali per entrare nella piattaforma
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
                    className="border-slate-300 bg-white/90"
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
                    className="border-slate-300 bg-white/90"
                  />
                </div>
                <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-800" disabled={loading}>
                  {loading ? 'Accesso in corso...' : 'Accedi'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-slate-200/70 bg-white/80">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-slate-500" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">Sei uno studente?</p>
                  <p className="text-xs text-slate-600">
                    Entra con il codice sessione fornito dal docente
                  </p>
                </div>
                <Link to="/join">
                  <Button variant="outline" size="sm" className="border-slate-300 bg-white">
                    Partecipa
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-slate-600">
            Vuoi diventare docente?{' '}
            <Link to="/teacher-request" className="text-slate-900 font-semibold hover:underline">
              Richiedi accesso
            </Link>
          </p>
        </section>
      </div>
    </AppBackground>
  )
}
