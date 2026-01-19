import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Eye, EyeOff, Copy, Check, KeyRound, Loader2 } from 'lucide-react'
import api from '@/lib/api'

interface ActivationInfo {
  first_name: string
  last_name: string
  email: string
  temporary_password: string
  is_used: boolean
}

export default function ActivatePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<ActivationInfo | null>(null)
  
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)
  
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)

  useEffect(() => {
    const fetchActivationInfo = async () => {
      if (!token) {
        setError('Token non valido')
        setLoading(false)
        return
      }

      try {
        const response = await api.get(`/auth/activate/${token}`)
        setInfo(response.data)
      } catch (err: unknown) {
        const error = err as { response?: { status?: number; data?: { detail?: string } } }
        if (error.response?.status === 404) {
          setError('Link non valido o già utilizzato')
        } else if (error.response?.status === 410) {
          setError('Il link di attivazione è scaduto')
        } else {
          setError(error.response?.data?.detail || 'Errore nel caricamento')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchActivationInfo()
  }, [token])

  const copyPassword = async () => {
    if (info?.temporary_password) {
      await navigator.clipboard.writeText(info.temporary_password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: 'Password copiata',
        description: 'La password è stata copiata negli appunti',
      })
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (newPassword !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'Errore',
        description: 'Le password non corrispondono',
      })
      return
    }

    if (newPassword.length < 8) {
      toast({
        variant: 'destructive',
        title: 'Errore',
        description: 'La password deve essere di almeno 8 caratteri',
      })
      return
    }

    setChangingPassword(true)

    try {
      await api.post(`/auth/activate/${token}/change-password`, {
        new_password: newPassword,
      })
      
      setPasswordChanged(true)
      toast({
        title: 'Password aggiornata',
        description: 'Ora puoi accedere con la nuova password',
      })
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      toast({
        variant: 'destructive',
        title: 'Errore',
        description: error.response?.data?.detail || 'Errore nel cambio password',
      })
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Caricamento...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Errore</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => navigate('/login')} className="w-full">
              Vai al login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (passwordChanged) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-center">Password Aggiornata!</CardTitle>
            <CardDescription className="text-center">
              Il tuo account è pronto. Ora puoi accedere con la nuova password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/login')} className="w-full">
              Vai al login
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
            <img src="/golinelli-logo.svg" alt="Golinelli" className="h-16 w-16" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Attivazione Account</h1>
          <p className="text-gray-600 mt-2">Benvenuto/a, {info?.first_name}!</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Le tue credenziali
            </CardTitle>
            <CardDescription>
              Queste sono le credenziali per accedere alla piattaforma
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="p-3 bg-muted rounded-md font-mono text-sm">
                {info?.email}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Password temporanea</Label>
              <div className="flex gap-2">
                <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm flex items-center">
                  {showPassword ? info?.temporary_password : '••••••••••••'}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyPassword}
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {info?.is_used && (
              <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
                ⚠️ La password è già stata cambiata. Puoi comunque cambiarla di nuovo.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cambia Password</CardTitle>
            <CardDescription>
              Ti consigliamo di impostare una password personale
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nuova password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimo 8 caratteri"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Conferma password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ripeti la password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={changingPassword}>
                {changingPassword ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Aggiornamento...
                  </>
                ) : (
                  'Cambia Password'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Puoi anche accedere direttamente con la password temporanea.{' '}
          <button
            onClick={() => navigate('/login')}
            className="text-primary hover:underline"
          >
            Vai al login
          </button>
        </p>
      </div>
    </div>
  )
}
