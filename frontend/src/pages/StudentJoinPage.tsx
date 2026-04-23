import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogoMark } from '@/components/LogoMark'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { StudentAccessForm } from '@/components/auth/StudentAccessForm'

export default function StudentJoinPage() {
  const { t } = useTranslation()

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
            <StudentAccessForm submitButtonClassName="w-full bg-emerald-600 hover:bg-emerald-700" />
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
