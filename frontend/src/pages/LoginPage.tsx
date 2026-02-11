import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BrainCircuit,
  Eye,
  FlaskConical,
  Lock,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { AppBackground } from '@/components/ui/AppBackground'

type TileSize = '1x1' | '1x2' | '2x2'

type LandingTile = {
  id: string
  title: string
  subtitle: string
  body: string
  colorClass: string
  icon: React.ComponentType<{ className?: string }>
  initialSize: TileSize
  allowedSizes: TileSize[]
}

const TILES: LandingTile[] = [
  {
    id: 'lezione-ai',
    title: 'Lezione con l\'AI',
    subtitle: 'Core Value',
    body: 'Ambiente unico per progettare, condurre e monitorare la didattica assistita da AI.',
    icon: BrainCircuit,
    colorClass: 'from-sky-500 to-cyan-400 text-white',
    initialSize: '2x2',
    allowedSizes: ['2x2', '1x2'],
  },
  {
    id: 'teacher-loop',
    title: 'Teacher in the Loop',
    subtitle: 'Controllo Didattico',
    body: 'Il docente decide workflow, contenuti e pubblicazione delle attivita.',
    icon: Workflow,
    colorClass: 'from-emerald-500 to-lime-400 text-white',
    initialSize: '1x2',
    allowedSizes: ['1x1', '1x2'],
  },
  {
    id: 'privacy-design',
    title: 'Privacy by Design',
    subtitle: 'Sicurezza',
    body: 'Minimizzazione dei dati e protezione delle identita come scelta strutturale.',
    icon: Lock,
    colorClass: 'from-indigo-500 to-blue-500 text-white',
    initialSize: '1x1',
    allowedSizes: ['1x1', '1x2'],
  },
  {
    id: 'ai-act',
    title: 'AI Act Compliancy',
    subtitle: 'Compliance',
    body: 'Nessun uso per scoring o valutazioni automatiche degli studenti.',
    icon: ShieldCheck,
    colorClass: 'from-fuchsia-500 to-rose-400 text-white',
    initialSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x2'],
  },
  {
    id: 'explainability',
    title: 'Explainability',
    subtitle: 'Trasparenza',
    body: 'Risposte AI interpretabili e verificabili nel contesto didattico.',
    icon: Eye,
    colorClass: 'from-violet-500 to-purple-400 text-white',
    initialSize: '1x1',
    allowedSizes: ['1x1', '2x2'],
  },
  {
    id: 'multimodal',
    title: 'AI Multimodale',
    subtitle: 'Strumenti',
    body: 'Chat, immagini, documenti e report in un unico ecosistema.',
    icon: Sparkles,
    colorClass: 'from-amber-500 to-orange-400 text-slate-900',
    initialSize: '2x2',
    allowedSizes: ['1x2', '2x2'],
  },
  {
    id: 'labs',
    title: 'ML & Data Science Lab',
    subtitle: 'Laboratori',
    body: 'Esperienze pratiche su dataset, visualizzazioni e modelli.',
    icon: FlaskConical,
    colorClass: 'from-teal-500 to-emerald-400 text-white',
    initialSize: '1x2',
    allowedSizes: ['1x1', '1x2', '2x2'],
  },
  {
    id: 'student',
    title: 'Accesso Studenti',
    subtitle: 'Join Session',
    body: 'Ingresso rapido con codice classe per collaborare in tempo reale.',
    icon: Users,
    colorClass: 'from-pink-500 to-fuchsia-400 text-white',
    initialSize: '1x1',
    allowedSizes: ['1x1', '1x2'],
  },
]

const sizeClassMap: Record<TileSize, string> = {
  '1x1': 'col-span-1 row-span-1',
  '1x2': 'col-span-1 row-span-2',
  '2x2': 'col-span-2 row-span-2',
}

const pickNextSize = (allowed: TileSize[], current: TileSize): TileSize => {
  const candidates = allowed.filter((size) => size !== current)
  if (candidates.length === 0) return current
  return candidates[Math.floor(Math.random() * candidates.length)]
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [tileSizes, setTileSizes] = useState<Record<string, TileSize>>(() =>
    TILES.reduce<Record<string, TileSize>>((acc, tile) => {
      acc[tile.id] = tile.initialSize
      return acc
    }, {})
  )

  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { toast } = useToast()

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTileSizes((prev) => {
        const next = { ...prev }
        const randomizedTiles = [...TILES].sort(() => Math.random() - 0.5).slice(0, 3)
        randomizedTiles.forEach((tile) => {
          next[tile.id] = pickNextSize(tile.allowedSizes, prev[tile.id] ?? tile.initialSize)
        })
        return next
      })
    }, 3000)

    return () => window.clearInterval(timer)
  }, [])

  const orderedTiles = useMemo(() => {
    return [...TILES].sort((a, b) => {
      const score = { '2x2': 3, '1x2': 2, '1x1': 1 }
      return score[(tileSizes[b.id] ?? b.initialSize)] - score[(tileSizes[a.id] ?? a.initialSize)]
    })
  }, [tileSizes])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await authApi.login(email, password)
      const { access_token, user_id, role, tenant_id } = response.data

      setUser({ id: user_id, email, role, tenant_id }, access_token)

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
    <AppBackground className="min-h-screen bg-white px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto max-w-[1680px]">
        <div className="mb-4 text-center lg:pr-[390px]">
          <h1
            className="text-3xl font-black text-slate-900 md:text-5xl"
            style={{ fontFamily: 'Space Grotesk, Sora, Manrope, sans-serif' }}
          >
            Golinelli AI Playground
          </h1>
          <p className="mx-auto mt-2 max-w-3xl text-sm font-medium text-slate-600 md:text-base">
            Piattaforma per fare lezione con l\'AI: strumenti multimodali, compliance normativa e laboratori data-driven.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
          <motion.section
            layout
            className="grid min-h-[calc(100vh-150px)] auto-rows-[96px] grid-cols-4 gap-3 [grid-auto-flow:dense] sm:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10"
          >
            {orderedTiles.map((tile, index) => {
              const activeSize = tileSizes[tile.id] ?? tile.initialSize
              return (
                <motion.article
                  key={tile.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    layout: { duration: 0.65, ease: 'easeInOut' },
                    delay: index * 0.03,
                  }}
                  whileHover={{ scale: 1.02, y: -2 }}
                  className={`${sizeClassMap[activeSize]} rounded-3xl bg-gradient-to-br p-4 shadow-[0_10px_24px_rgba(15,23,42,0.14)] ${tile.colorClass}`}
                >
                  <div className="flex h-full flex-col">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{tile.subtitle}</p>
                        <h2 className="mt-1 text-sm font-extrabold md:text-base">{tile.title}</h2>
                      </div>
                      <tile.icon className="h-5 w-5 opacity-90" />
                    </div>
                    <p className="mt-2 line-clamp-4 text-xs leading-relaxed opacity-95">{tile.body}</p>
                    {tile.id === 'lezione-ai' && (
                      <div className="mt-auto pt-3">
                        <Link to="/teacher-request">
                          <Button className="h-8 rounded-xl bg-white/90 px-3 text-xs font-bold text-slate-900 hover:bg-white">
                            REGISTRATI QUI
                          </Button>
                        </Link>
                      </div>
                    )}
                    {tile.id === 'student' && (
                      <div className="mt-auto pt-3">
                        <Link to="/join">
                          <Button className="h-8 rounded-xl bg-white/90 px-3 text-xs font-bold text-slate-900 hover:bg-white">
                            Entra come studente
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </motion.article>
              )
            })}
          </motion.section>

          <Card className="sticky top-4 border-slate-200 bg-white/95 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
            <CardHeader>
              <CardTitle className="text-slate-900">Login Docente / Admin</CardTitle>
              <CardDescription>Accedi al tuo spazio classe AI</CardDescription>
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
                    className="h-11"
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
                    className="h-11"
                  />
                </div>
                <Button type="submit" className="h-11 w-full bg-slate-900 hover:bg-slate-800" disabled={loading}>
                  {loading ? 'Accesso in corso...' : 'Accedi'}
                </Button>
              </form>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  Accesso beta docenti:{' '}
                  <Link to="/teacher-request" className="font-semibold text-slate-900 hover:underline">
                    REGISTRATI QUI
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppBackground>
  )
}
