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

export function isEnglishUi(): boolean {
  return (i18n.resolvedLanguage || i18n.language || 'it').startsWith('en')
}

/** Label for a stored option value (e.g. «contiene»): `opt|<value>` entries translate it, otherwise the value is shown as-is. */
export function tlOption(value: string): string {
  if (!isEnglishUi()) return value
  return EN[`opt|${value}`] ?? EN[value] ?? value
}

type MessagePattern = { re: RegExp; groups: number[]; out: string }
let messagePatterns: MessagePattern[] | null = null

function buildMessagePatterns(): MessagePattern[] {
  const escape = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns: MessagePattern[] = []
  for (const [key, out] of Object.entries(EN)) {
    if (!/\{\d+\}/.test(key)) continue
    const parts = key.split(/\{(\d+)\}/)
    const literalLength = parts.filter((_, index) => index % 2 === 0).join('').trim().length
    if (literalLength < 6) continue
    const groups: number[] = []
    let source = ''
    parts.forEach((part, index) => {
      if (index % 2 === 0) source += escape(part)
      else { groups.push(Number(part)); source += '([\\s\\S]*?)' }
    })
    patterns.push({ re: new RegExp(`^${source}$`), groups, out })
  }
  // Longest literal text first: the most specific template wins over generic ones such as «{0} · {1}: {2}».
  return patterns.sort((a, b) => b.re.source.length - a.re.source.length)
}

/** Translate a runtime message produced by the server (errors, validation) whose Italian text embeds variable parts.
 *  Tries an exact match, then the `{n}` templates of `auto/en.json`; captured parts are translated too. */
export function tlDyn(source: string, depth = 0): string {
  if (!source || !isEnglishUi()) return source
  const exact = EN[source]
  if (exact !== undefined) return exact
  if (depth > 2) return source
  messagePatterns ??= buildMessagePatterns()
  for (const pattern of messagePatterns) {
    const match = pattern.re.exec(source)
    if (!match) continue
    return pattern.out.replace(/\{(\d+)\}/g, (placeholder, index) => {
      const position = pattern.groups.indexOf(Number(index))
      return position < 0 ? placeholder : tlDyn(match[position + 1], depth + 1)
    })
  }
  return source
}
