import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft } from 'lucide-react'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogoMark } from '@/components/LogoMark'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export default function StudentJoinPage() {
  const { t } = useTranslation()
  const [joinCode, setJoinCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setStudentSession } = useAuthStore()
  const { toast } = useToast()

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await studentApi.join(joinCode.toUpperCase(), nickname)
      const { join_token, student_id, session_id, session_title } = response.data
      setStudentSession({ student_id, session_id, session_title, nickname }, join_token)
      connectSocket(join_token)
      navigate('/student')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: err.response?.data?.detail || 'Impossibile partecipare alla sessione',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppBackground className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-4">
            <LogoMark className="h-14 w-14" />
            <h1 className="text-[30px] leading-[1.15] tracking-tight text-left pb-[1px]" style={{ fontFamily: '"SofiaPro"' }}>
              <span className="font-bold text-[#2d2d2d]/85">Golinelli</span>
              <span className="font-black text-[#e85c8d]">.ai</span>
            </h1>
          </div>
          <p className="text-gray-600 mt-2">{t('student_join.code_intro')}</p>
          <div className="flex justify-center mt-2">
            <LanguageSwitcher variant="row" />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('student_join.title')}</CardTitle>
            <CardDescription>{t('student_join.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="joinCode">{t('student_join.code_label')}</Label>
                <Input
                  id="joinCode" type="text"
                  placeholder={t('student_join.code_placeholder')}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={5}
                  className="text-center text-2xl tracking-widest font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nickname">{t('student_join.nickname_label')}</Label>
                <Input
                  id="nickname" type="text"
                  placeholder={t('student_join.nickname_placeholder')}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  required
                />
              </div>
              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                {loading ? t('student_join.joining') : t('student_join.join_btn')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <Link to="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('student_join.back_login')}
          </Link>
        </div>
      </div>
    </AppBackground>
  )
}
