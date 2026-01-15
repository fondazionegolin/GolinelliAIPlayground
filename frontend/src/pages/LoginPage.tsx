import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Users } from 'lucide-react'

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/golinelli-logo.svg" alt="Golinelli" className="h-16 w-16" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Golinelli AI Playground</h1>
          <p className="text-gray-600 mt-2">Piattaforma educativa AI per scuole</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Accesso Docenti / Admin</CardTitle>
            <CardDescription>
              Inserisci le tue credenziali per accedere
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

        <Card>
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
      </div>
    </div>
  )
}
