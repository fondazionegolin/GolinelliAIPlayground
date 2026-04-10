import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Check, KeyRound, Loader2 } from 'lucide-react'
import { authApi } from '@/lib/api'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogoMark } from '@/components/LogoMark'

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [userInfo, setUserInfo]         = useState<{ first_name: string; email: string } | null>(null)
  const [newPassword, setNewPassword]   = useState('')
  const [confirmPassword, setConfirm]   = useState('')
  const [saving, setSaving]             = useState(false)
  const [done, setDone]                 = useState(false)

  useEffect(() => {
    if (!token) { setError('Link non valido'); setLoading(false); return }
    authApi.getResetPasswordInfo(token)
      .then(res => setUserInfo(res.data))
      .catch(err => {
        const detail = err.response?.data?.detail
        if (err.response?.status === 404) setError('Link non valido o già utilizzato.')
        else if (err.response?.status === 410) setError('Link scaduto. Chiedi un nuovo reset all\'amministratore.')
        else setError(detail || 'Errore durante la verifica del link.')
      })
      .finally(() => setLoading(false))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Errore', description: 'Le password non coincidono' })
      return
    }
    if (newPassword.length < 8) {
      toast({ variant: 'destructive', title: 'Errore', description: 'La password deve essere di almeno 8 caratteri' })
      return
    }
    setSaving(true)
    try {
      await authApi.setNewPassword(token!, { new_password: newPassword, confirm_password: confirmPassword })
      setDone(true)
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Errore', description: err.response?.data?.detail || 'Errore durante il salvataggio' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <AppBackground className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Verifica link in corso…</p>
          </CardContent>
        </Card>
      </AppBackground>
    )
  }

  if (error) {
    return (
      <AppBackground className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Link non valido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => navigate('/login')} className="w-full">
              Torna al login
            </Button>
          </CardContent>
        </Card>
      </AppBackground>
    )
  }

  if (done) {
    return (
      <AppBackground className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-center">Password aggiornata!</CardTitle>
            <CardDescription className="text-center">
              Puoi ora accedere con la tua nuova password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/login')} className="w-full">
              Vai al login
            </Button>
          </CardContent>
        </Card>
      </AppBackground>
    )
  }

  return (
    <AppBackground className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-4">
            <LogoMark className="h-12 w-12" />
            <span className="text-[28px] leading-[1.15] tracking-tight" style={{ fontFamily: '"SofiaPro"' }}>
              <span className="font-bold text-[#2d2d2d]/85">Golinelli</span>
              <span className="font-black text-[#e85c8d]">.ai</span>
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Scegli una nuova password
            </CardTitle>
            <CardDescription>
              {userInfo?.first_name ? `Ciao ${userInfo.first_name}! ` : ''}
              Inserisci la nuova password per l'account <strong>{userInfo?.email}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nuova password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimo 8 caratteri"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Conferma password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Ripeti la password"
                  required
                />
              </div>
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Le password non coincidono</p>
              )}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio…</> : 'Imposta nuova password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppBackground>
  )
}
