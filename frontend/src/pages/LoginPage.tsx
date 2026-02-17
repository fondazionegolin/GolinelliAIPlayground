import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BrainCircuit, ShieldCheck, Sparkles, Workflow, FlaskConical, Eye } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { useState } from 'react'

const FEATURES = [
  {
    title: 'Teacher in the Loop',
    body: 'Il docente mantiene il controllo su prompt, pubblicazioni e workflow didattici.',
    icon: Workflow,
  },
  {
    title: 'Privacy by Design',
    body: 'Gestione dati orientata a minimizzazione, segregazione tenant e tracciabilita operativa.',
    icon: ShieldCheck,
  },
  {
    title: 'AI Act Compliance',
    body: 'Uso educativo senza scoring o valutazioni automatiche degli studenti.',
    icon: Eye,
  },
  {
    title: 'Strumenti Multimodali',
    body: 'Chat, documenti, immagini, quiz e report in un unico ambiente di lezione.',
    icon: Sparkles,
  },
  {
    title: 'Lezione con AI',
    body: 'Piattaforma progettata per orchestrare attività in classe con assistenti specializzati.',
    icon: BrainCircuit,
  },
  {
    title: 'ML & Data Science Lab',
    body: 'Laboratori pratici su dataset, analisi e visualizzazioni guidate.',
    icon: FlaskConical,
  },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { toast } = useToast()

  const { data: publicSettings } = useQuery<{ beta_disclaimer_html: string }>({
    queryKey: ['public-settings-login'],
    queryFn: async () => (await authApi.getPublicSettings()).data,
    staleTime: 60_000,
  })

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await authApi.login(email, password)
      const { access_token, user_id, role, tenant_id } = response.data
      setUser({ id: user_id, email, role, tenant_id }, access_token)
      navigate(role === 'ADMIN' ? '/admin' : '/teacher')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string | object } } }
      const detail = err.response?.data?.detail
      toast({
        variant: 'destructive',
        title: 'Errore di accesso',
        description: typeof detail === 'string' ? detail : 'Credenziali non valide',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-600 via-blue-700 to-indigo-900 px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-7xl grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-2xl backdrop-blur-md md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-100">Fondazione Golinelli</p>
          <h1 className="mt-2 text-4xl font-black leading-tight md:text-5xl">
            Golinelli AI Playground
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-blue-100 md:text-base">
            Piattaforma moderna per fare lezione con l&apos;AI in modo strutturato, trasparente e conforme al contesto educativo.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            {FEATURES.map((item) => (
              <article key={item.title} className="rounded-2xl border border-white/20 bg-white/10 p-4">
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-sky-100" />
                  <h3 className="text-sm font-bold">{item.title}</h3>
                </div>
                <p className="mt-2 text-xs text-blue-100">{item.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-amber-200/60 bg-amber-50 p-4 text-amber-900">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide">Beta Disclaimer</p>
            <div
              className="text-sm [&_p]:mb-2 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: publicSettings?.beta_disclaimer_html || '' }}
            />
          </div>
        </section>

        <aside className="flex items-start justify-center lg:items-center">
          <Card className="w-full max-w-md border-white/40 bg-white/95 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-slate-900">Accesso Docente / Admin</CardTitle>
              <CardDescription>Entra in piattaforma o richiedi l&apos;accesso beta.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleLogin} className="space-y-3">
                <div className="space-y-1.5">
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
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-800" disabled={loading}>
                  {loading ? 'Accesso in corso...' : 'Accedi'}
                </Button>
              </form>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Link to="/teacher-request">
                  <Button variant="outline" className="w-full">
                    REGISTRATI QUI
                  </Button>
                </Link>
                <Link to="/join">
                  <Button variant="secondary" className="w-full">
                    Entra Studente
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
