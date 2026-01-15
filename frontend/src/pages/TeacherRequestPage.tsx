import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { GraduationCap, ArrowLeft, CheckCircle } from 'lucide-react'

export default function TeacherRequestPage() {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await authApi.requestTeacher({
        email,
        first_name: firstName,
        last_name: lastName,
        tenant_slug: tenantSlug || undefined,
      })
      setSubmitted(true)
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string | object } } }
      let errorMessage = 'Errore durante la richiesta'
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail
        errorMessage = typeof detail === 'string' ? detail : JSON.stringify(detail)
      }
      toast({
        variant: 'destructive',
        title: 'Errore',
        description: errorMessage,
      })
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Richiesta Inviata!</h2>
            <p className="text-muted-foreground mb-6">
              La tua richiesta è stata inviata con successo. 
              Riceverai una notifica quando sarà approvata dall'amministratore.
            </p>
            <Button onClick={() => navigate('/login')}>
              Torna al Login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary rounded-full p-3">
              <GraduationCap className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Richiedi Accesso Docente</h1>
          <p className="text-gray-600 mt-2">Compila il form per richiedere l'accesso come docente</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dati Personali</CardTitle>
            <CardDescription>
              Inserisci i tuoi dati per la richiesta
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Nome</Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="Mario"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Cognome</Label>
                  <Input
                    id="lastName"
                    type="text"
                    placeholder="Rossi"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email istituzionale</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="mario.rossi@scuola.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenantSlug">Codice Scuola (opzionale)</Label>
                <Input
                  id="tenantSlug"
                  type="text"
                  placeholder="liceo-galilei"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se conosci il codice della tua scuola, inseriscilo qui
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Invio in corso...' : 'Invia Richiesta'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <Link to="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Torna al login
          </Link>
        </div>
      </div>
    </div>
  )
}
