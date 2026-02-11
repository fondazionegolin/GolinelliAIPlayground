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
    <AppBackground className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-slate-200 bg-white/95 p-6 md:p-8 shadow-xl shadow-slate-200/60">
          <div className="flex items-center gap-4">
            <LogoMark className="h-14 w-14" bubbleColor="#1e293b" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">Golinelli AI Playground</h1>
              <p className="text-sm md:text-base text-slate-600 mt-1">Piattaforma per fare lezione con l'AI</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm md:text-base text-slate-700 leading-relaxed">
              Ambiente didattico per docenti e scuole, progettato per integrare strumenti AI in classe con controllo umano, tracciabilità e tutela dei dati.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm"><Workflow className="h-4 w-4" /> Teacher in the Loop</div>
              <p className="text-xs text-slate-600 mt-2">Il docente guida, valida e pubblica i contenuti: l'AI supporta il processo didattico.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm"><ShieldCheck className="h-4 w-4" /> Privacy by Design</div>
              <p className="text-xs text-slate-600 mt-2">Progettazione orientata alla minimizzazione dei dati, separazione dei contesti e controlli di accesso.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm"><ShieldCheck className="h-4 w-4" /> AI Act Compliancy</div>
              <p className="text-xs text-slate-600 mt-2">Uso educativo conforme: nessuna valutazione automatica, scoring o decisione ad alto impatto sugli studenti.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm"><Eye className="h-4 w-4" /> Explainability</div>
              <p className="text-xs text-slate-600 mt-2">Output interpretabili, motivazioni testuali e trasparenza dei passaggi nei flussi di lavoro.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm"><BrainCircuit className="h-4 w-4" /> Strumenti AI Multimodali</div>
              <p className="text-xs text-slate-600 mt-2">Chat, immagini, documenti e contenuti strutturati in un workspace unico per la classe.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm"><FlaskConical className="h-4 w-4" /> ML e Data Science Lab</div>
              <p className="text-xs text-slate-600 mt-2">Laboratori pratici per dataset, visualizzazioni e modelli di machine learning in ottica didattica.</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <Card className="border-slate-200 shadow-lg shadow-slate-200/60">
            <CardHeader>
              <CardTitle>Accesso Docenti / Admin</CardTitle>
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
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Accesso in corso...' : 'Accedi'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Sei uno studente?</p>
                  <p className="text-xs text-muted-foreground">
                    Usa il codice della sessione per partecipare
                  </p>
                </div>
                <Link to="/join">
                  <Button variant="outline" size="sm">
                    Partecipa
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground">
            Vuoi diventare docente?{' '}
            <Link to="/teacher-request" className="text-primary hover:underline">
              Richiedi accesso
            </Link>
          </p>
        </section>
      </div>
    </AppBackground>
  )
}
