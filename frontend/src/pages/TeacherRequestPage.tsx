import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { GraduationCap, ArrowLeft, CheckCircle } from 'lucide-react'
import { AppBackground } from '@/components/ui/AppBackground'
import { useTranslation } from 'react-i18next'

export default function TeacherRequestPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [schoolName, setSchoolName] = useState('')
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
        school_name: schoolName || undefined,
      })
      setSubmitted(true)
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string | object } } }
      let errorMessage = t('teacher_request.error_submit')
      if (err.response?.data?.detail) {
        const detail = err.response.data.detail
        errorMessage = typeof detail === 'string' ? detail : JSON.stringify(detail)
      }
      toast({ variant: 'destructive', title: t('common.error'), description: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <AppBackground className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">{t('teacher_request.success_title')}</h2>
            <p className="text-muted-foreground mb-6">{t('teacher_request.success_body')}</p>
            <Button onClick={() => navigate('/login')}>{t('teacher_request.back_login')}</Button>
          </CardContent>
        </Card>
      </AppBackground>
    )
  }

  return (
    <AppBackground className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary rounded-full p-3">
              <GraduationCap className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{t('teacher_request.title')}</h1>
          <p className="text-gray-600 mt-2">{t('teacher_request.subtitle')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('teacher_request.card_title')}</CardTitle>
            <CardDescription>{t('teacher_request.card_subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t('teacher_request.first_name')}</Label>
                  <Input
                    id="firstName" type="text"
                    placeholder={t('teacher_request.placeholder_first')}
                    value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t('teacher_request.last_name')}</Label>
                  <Input
                    id="lastName" type="text"
                    placeholder={t('teacher_request.placeholder_last')}
                    value={lastName} onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('teacher_request.email')}</Label>
                <Input
                  id="email" type="email"
                  placeholder="mario.rossi@scuola.edu"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schoolName">Scuola / Istituto</Label>
                <Input
                  id="schoolName" type="text"
                  placeholder="I.I.S. Galileo Galilei"
                  value={schoolName} onChange={(e) => setSchoolName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenantSlug">Codice Scuola (opzionale)</Label>
                <Input
                  id="tenantSlug" type="text"
                  placeholder="liceo-galilei"
                  value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)}
                />
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
            {t('teacher_request.back_login')}
          </Link>
        </div>
      </div>
    </AppBackground>
  )
}
