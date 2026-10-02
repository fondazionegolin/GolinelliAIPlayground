/** User preferences for automatic composition while typing in the word processor (kept per browser). */
export interface CompositionPrefs {
  /** "- ", "* ", "• ", "1. ", "1) " at the start of a line start a list. */
  lists: boolean
  /** Capital letter at the start of a paragraph and after . ! ? */
  capitalize: boolean
  /** Curly quotes and apostrophes, "…", " – ", no double spaces. */
  typography: boolean
  /** Small first-line indent on the paragraph created by pressing Enter after body text. */
  indent: boolean
}

export const DEFAULT_COMPOSITION: CompositionPrefs = { lists: true, capitalize: true, typography: true, indent: true }
export const COMPOSITION_INDENT = '24px'

const KEY = 'documents.composition'
let current: CompositionPrefs = readStored()
const listeners = new Set<() => void>()

function readStored(): CompositionPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CompositionPrefs>
      return {
        lists: parsed.lists !== false,
        capitalize: parsed.capitalize !== false,
        typography: parsed.typography !== false,
        indent: parsed.indent !== false,
      }
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_COMPOSITION }
}

/** Live preferences; the editor extension reads this on every keystroke, so toggles apply immediately. */
export const getCompositionPrefs = () => current

export function setCompositionPrefs(next: CompositionPrefs) {
  current = next
  try { window.localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener())
}

export function subscribeCompositionPrefs(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
