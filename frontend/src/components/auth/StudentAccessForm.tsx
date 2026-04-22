import { useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, KeyRound, UserRound } from 'lucide-react'

import { studentApi } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useTranslation } from 'react-i18next'

type AccessMode = 'register' | 'login' | 'claim'

interface AccessInfo {
  session_id: string
  session_title: string
  normalized_nickname: string
  access_mode: AccessMode
}

interface Props {
  submitButtonClassName?: string
  submitButtonStyle?: CSSProperties
}

export function StudentAccessForm({ submitButtonClassName, submitButtonStyle }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setStudentSession } = useAuthStore()
  const { toast } = useToast()

  const [joinCode, setJoinCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const passwordStep = accessInfo !== null
  const needsPasswordConfirmation = accessInfo?.access_mode === 'register' || accessInfo?.access_mode === 'claim'

  const submitLabel = useMemo(() => {
    if (!accessInfo) return t('student_join.continue_btn')
    if (accessInfo.access_mode === 'login') return t('student_join.login_btn')
    return t('student_join.create_access_btn')
  }, [accessInfo, t])

  const handleInitialSubmit = async () => {
    const response = await studentApi.checkAccess(joinCode.toUpperCase(), nickname.trim())
    setAccessInfo(response.data)
    setNickname(response.data.normalized_nickname)
  }

  const handleAuthenticate = async () => {
    if (password.trim().length < 8) {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('student_join.password_min_length'),
      })
      return
    }

    if (needsPasswordConfirmation && password !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('student_join.password_mismatch'),
      })
      return
    }

    const response = await studentApi.join(joinCode.toUpperCase(), nickname.trim(), password)
    const { join_token, student_id, session_id, session_title } = response.data
    const effectiveNickname = accessInfo?.normalized_nickname || nickname.trim()
    setStudentSession({ student_id, session_id, session_title, nickname: effectiveNickname }, join_token)
    connectSocket(join_token)
    navigate('/student')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (!passwordStep) {
        await handleInitialSubmit()
      } else {
        await handleAuthenticate()
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: err.response?.data?.detail || t('student_join.error_generic'),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    setAccessInfo(null)
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="joinCode">{t('student_join.code_label')}</Label>
        <Input
          id="joinCode"
          type="text"
          placeholder={t('student_join.code_placeholder')}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          maxLength={5}
          className="border-slate-200 bg-slate-50 text-center font-mono text-2xl tracking-widest"
          required
          disabled={passwordStep || loading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nickname">{t('student_join.nickname_label')}</Label>
        <Input
          id="nickname"
          type="text"
          placeholder={t('student_join.nickname_placeholder')}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          className="border-slate-200 bg-slate-50"
          required
          disabled={passwordStep || loading}
        />
      </div>

      {accessInfo && (
        <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/70 px-4 py-3 text-sm text-slate-700">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-white/80 p-2 text-fuchsia-600">
              {accessInfo.access_mode === 'login' ? <KeyRound className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{accessInfo.session_title}</p>
              <p className="mt-0.5 text-slate-600">
                {t(`student_join.mode_${accessInfo.access_mode}`)}
              </p>
            </div>
          </div>
        </div>
      )}

      {passwordStep && (
        <>
          <div className="space-y-2">
            <Label htmlFor="password">{t('student_join.password_label')}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t('student_join.password_placeholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoFocus
              required
              disabled={loading}
            />
          </div>
          {needsPasswordConfirmation && (
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('student_join.confirm_password_label')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('student_join.confirm_password_placeholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
                disabled={loading}
              />
            </div>
          )}
        </>
      )}

      <div className="flex gap-2">
        {passwordStep && (
          <Button type="button" variant="outline" className="h-11 px-4" onClick={handleBack} disabled={loading}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('student_join.change_identity_btn')}
          </Button>
        )}
        <Button
          type="submit"
          className={passwordStep ? `h-11 flex-1 ${submitButtonClassName ?? ''}` : `group h-11 w-full text-base ${submitButtonClassName ?? ''}`}
          style={submitButtonStyle}
          disabled={loading}
        >
          {loading ? t('student_join.loading') : submitLabel}
          {!loading && !passwordStep && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />}
        </Button>
      </div>
    </form>
  )
}
