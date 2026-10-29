import i18n from './i18n'
import en from './auto/en.json'

/** Translate an inline UI string written in Italian (the source language of the codebase).
 *
 * The Italian text itself is the key of `auto/en.json`, so components keep reading naturally and
 * nothing renders blank when a translation is missing (it falls back to Italian). Template
 * placeholders `{0}`, `{1}`… are filled from `args`. Prefer `t('key')` with the structured
 * locale files for new strings; `tl` covers the large body of strings that were hard-coded.
 * The language is read at call time; switching language reloads the page (LanguageSwitcher), so
 * module-level constants built with `tl` are always in the current language too.
 */
const EN = en as Record<string, string>

export function tl(source: string, ...args: unknown[]): string {
  const english = (i18n.resolvedLanguage || i18n.language || 'it').startsWith('en')
  const text = english ? (EN[source] ?? source) : source
  return args.length ? text.replace(/\{(\d+)\}/g, (match, index) => (Number(index) < args.length ? String(args[Number(index)] ?? '') : match)) : text
}
