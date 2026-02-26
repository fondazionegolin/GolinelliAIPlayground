import { useState, useEffect } from 'react'
import { Cookie, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'cookie_consent'

export function CookieBanner() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      const timer = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  const accept = () => { localStorage.setItem(STORAGE_KEY, 'accepted'); setVisible(false) }
  const decline = () => { localStorage.setItem(STORAGE_KEY, 'declined'); setVisible(false) }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[200] flex justify-center px-4 pb-4"
      style={{ animation: 'cookieBannerIn 0.4s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <div className="w-full max-w-2xl bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-2xl shadow-slate-200/80 px-5 py-4 flex items-start gap-4">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center mt-0.5">
          <Cookie className="h-4 w-4 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 mb-0.5">{t('cookie.title')}</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            {t('cookie.body')}{' '}
            <a href="/privacy-policy" className="text-blue-600 hover:underline font-medium" target="_blank" rel="noreferrer">
              {t('cookie.policy_link')}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          <button onClick={decline} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-50">
            {t('cookie.decline')}
          </button>
          <button onClick={accept} className="text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 transition-colors px-4 py-1.5 rounded-lg">
            {t('cookie.accept')}
          </button>
          <button onClick={decline} className="text-slate-300 hover:text-slate-500 transition-colors p-1 rounded-lg hover:bg-slate-50" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <style>{`
        @keyframes cookieBannerIn {
          from { transform: translateY(120%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
