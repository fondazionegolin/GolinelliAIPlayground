import { Moon, Sun } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { useUiThemeStore, type UiTheme } from '@/stores/uiTheme'

/** Dropdown row with an explicit Light | Dark segmented control; saves the choice to the user's server profile. */
export function ThemeToggleMenuItem({ persist }: { persist: (theme: UiTheme) => Promise<unknown> }) {
  const { t } = useTranslation()
  const theme = useUiThemeStore((s) => s.theme)
  const setTheme = useUiThemeStore((s) => s.setTheme)

  const choose = (next: UiTheme) => {
    if (next === theme) return
    setTheme(next)
    persist(next).catch((err) => console.error('Failed to save theme preference:', err))
  }

  const options: { value: UiTheme; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: t('navbar.theme_light'), Icon: Sun },
    { value: 'dark', label: t('navbar.theme_dark'), Icon: Moon },
  ]

  return (
    <div className="px-4 py-2.5">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {t('navbar.theme_label')}
      </div>
      <div role="radiogroup" aria-label={t('navbar.theme_label')} className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-black/30">
        {options.map(({ value, label, Icon }) => {
          const active = theme === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(value)}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#3a3d44] dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
