import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiThemeStore, type UiTheme } from '@/stores/uiTheme'

/** Dropdown row that flips light/dark and saves the choice to the user's server profile. */
export function ThemeToggleMenuItem({ persist }: { persist: (theme: UiTheme) => Promise<unknown> }) {
  const { t } = useTranslation()
  const theme = useUiThemeStore((s) => s.theme)
  const setTheme = useUiThemeStore((s) => s.setTheme)
  const dark = theme === 'dark'

  const toggle = () => {
    const next: UiTheme = dark ? 'light' : 'dark'
    setTheme(next)
    persist(next).catch((err) => console.error('Failed to save theme preference:', err))
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={toggle}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
    >
      {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="flex-1 text-left">{t('navbar.dark_mode')}</span>
      <span
        aria-hidden
        className={`relative h-4 w-7 rounded-full transition-colors ${dark ? 'bg-[var(--logo-violet)]' : 'bg-slate-200'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${dark ? 'translate-x-3.5' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  )
}
