import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, LANG_STORAGE_KEY, type LangCode } from '@/i18n/i18n'

interface LanguageSwitcherProps {
  /** 'row' = flag + code side-by-side (navbar), 'full' = full label with flag (dropdown) */
  variant?: 'row' | 'full'
  className?: string
}

export function LanguageSwitcher({ variant = 'row', className = '' }: LanguageSwitcherProps) {
  const { i18n } = useTranslation()
  const current = i18n.language as LangCode

  const toggle = () => {
    const next: LangCode = current === 'it' ? 'en' : 'it'
    i18n.changeLanguage(next)
    localStorage.setItem(LANG_STORAGE_KEY, next)
  }

  if (variant === 'row') {
    const lang = SUPPORTED_LANGUAGES.find(l => l.code === current) ?? SUPPORTED_LANGUAGES[0]
    const other = SUPPORTED_LANGUAGES.find(l => l.code !== current) ?? SUPPORTED_LANGUAGES[1]
    return (
      <button
        onClick={toggle}
        title={`Switch to ${other.label}`}
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white/60 hover:bg-white transition-colors text-slate-600 hover:text-slate-800 ${className}`}
      >
        <span className="text-base leading-none">{lang.flag}</span>
        <span className="uppercase tracking-wide">{lang.code}</span>
      </button>
    )
  }

  // 'full' variant: two clickable flag buttons
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {SUPPORTED_LANGUAGES.map(lang => (
        <button
          key={lang.code}
          onClick={() => {
            i18n.changeLanguage(lang.code)
            localStorage.setItem(LANG_STORAGE_KEY, lang.code)
          }}
          title={lang.label}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            current === lang.code
              ? 'bg-slate-100 border-slate-300 text-slate-800'
              : 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span className="text-base leading-none">{lang.flag}</span>
          <span>{lang.label}</span>
        </button>
      ))}
    </div>
  )
}
