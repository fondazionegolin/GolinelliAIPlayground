import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Eye, EyeOff, Copy, Check, KeyRound, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogoMark } from '@/components/LogoMark'

interface ActivationInfo {
  first_name: string
  last_name: string
  email: string
  temporary_password: string
  is_used: boolean
}

export default function ActivatePage() {
  const { t } = useTranslation()
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
        setError(t('activate.invalid_token'))
        setLoading(false)
        return
      }

      try {
        const response = await api.get(`/auth/activate/${token}`)
        setInfo(response.data)
      } catch (err: unknown) {
        const error = err as { response?: { status?: number; data?: { detail?: string } } }
        if (error.response?.status === 404) {
          setError(t('activate.invalid_link'))
        } else if (error.response?.status === 410) {
          setError(t('activate.expired_link'))
        } else {
          setError(error.response?.data?.detail || t('activate.load_error'))
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
        title: t('activate.password_copied_title'),
        description: t('activate.password_copied_body'),
      })
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('activate.password_mismatch'),
      })
      return
    }

    if (newPassword.length < 8) {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('activate.password_too_short'),
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
        title: t('activate.password_updated_title'),
        description: t('activate.password_updated_body'),
      })
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: error.response?.data?.detail || t('activate.password_change_error'),
      })
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return (
      <AppBackground className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">{t('common.loading')}</p>
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
            <CardTitle className="text-destructive">{t('common.error')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => navigate('/login')} className="w-full">
              {t('activate.go_to_login')}
            </Button>
          </CardContent>
        </Card>
      </AppBackground>
    )
  }

  if (passwordChanged) {
    return (
      <AppBackground className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-center">{t('activate.success_title')}</CardTitle>
            <CardDescription className="text-center">
              {t('activate.success_desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/login')} className="w-full">
              {t('activate.go_to_login')}
            </Button>
          </CardContent>
        </Card>
      </AppBackground>
    )
  }

  return (
    <AppBackground className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-2">
            <LogoMark className="h-12 w-12" />
            <span className="text-[28px] leading-[1.15] tracking-tight text-left pb-[1px]" style={{ fontFamily: '"SofiaPro"' }}>
              <span className="font-bold text-[#2d2d2d]/85">
                Golinelli
              </span>
              <span className="font-black text-[#e85c8d]">.ai</span>
            </span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{t('activate.title')}</h1>
          <p className="text-gray-600 mt-2">{t('activate.welcome', { name: info?.first_name })}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {t('activate.credentials_title')}
            </CardTitle>
            <CardDescription>
              {t('activate.credentials_desc')}
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
              <Label>{t('activate.temp_password')}</Label>
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
                ⚠️ {t('activate.password_already_changed')}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('activate.change_password_title')}</CardTitle>
            <CardDescription>
              {t('activate.change_password_desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('activate.new_password_label')}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('activate.min_chars')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('activate.confirm_password_label')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('activate.repeat_password')}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={changingPassword}>
                {changingPassword ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('activate.updating')}
                  </>
                ) : (
                  t('activate.change_password_btn')
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          {t('activate.temp_login_hint')}{' '}
          <button
            onClick={() => navigate('/login')}
            className="text-primary hover:underline"
          >
            {t('activate.go_to_login')}
          </button>
        </p>
      </div>
    </AppBackground>
  )
}
