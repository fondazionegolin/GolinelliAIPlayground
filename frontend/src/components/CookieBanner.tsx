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
      className="fixed inset-x-0 bottom-0 z-[200] flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-4"
      style={{ animation: 'cookieBannerIn 0.4s cubic-bezier(0.16,1,0.3,1)' }}
    >
      <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-2xl shadow-slate-200/80 backdrop-blur-md sm:flex-row sm:items-start sm:gap-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-amber-50">
            <Cookie className="h-4 w-4 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1 pr-9 sm:pr-0">
            <p className="mb-0.5 text-sm font-semibold text-slate-800">{t('cookie.title')}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              {t('cookie.body')}{' '}
              <a href="/privacy-policy" className="font-medium text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                {t('cookie.policy_link')}
              </a>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:mt-0.5">
          <button onClick={decline} className="min-h-11 flex-1 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 sm:min-h-0 sm:flex-none sm:rounded-lg sm:px-2 sm:py-1.5 sm:font-normal">
            {t('cookie.decline')}
          </button>
          <button onClick={accept} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-900 sm:min-h-0 sm:flex-none sm:rounded-lg sm:py-1.5">
            {t('cookie.accept')}
          </button>
          <button onClick={decline} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500 sm:static sm:h-auto sm:w-auto sm:rounded-lg sm:p-1" aria-label={t('common.close')}>
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
