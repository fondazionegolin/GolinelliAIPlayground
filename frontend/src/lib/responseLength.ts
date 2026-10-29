import { tl } from '@/i18n/tl'
export type ResponseLength = 'concise' | 'extended' | 'in_depth'

export const RESPONSE_LENGTH_KEY = 'teacher_response_length'

export const RESPONSE_LENGTH_OPTIONS: { id: ResponseLength; label: string; description: string }[] = [
  { id: 'concise', label: tl("Concise"), description: tl("Dirette, poche frasi") },
  { id: 'extended', label: tl("Estese"), description: tl("Complete, con esempi") },
  { id: 'in_depth', label: tl("Approfondite"), description: tl("Strutturate, con ragionamento") },
]

export function getResponseLength(): ResponseLength {
  try {
    const value = localStorage.getItem(RESPONSE_LENGTH_KEY)
    if (value === 'extended' || value === 'in_depth' || value === 'concise') return value
  } catch { /* storage unavailable */ }
  return 'concise'
}

export function setResponseLength(value: ResponseLength) {
  try { localStorage.setItem(RESPONSE_LENGTH_KEY, value) } catch { /* storage unavailable */ }
}
