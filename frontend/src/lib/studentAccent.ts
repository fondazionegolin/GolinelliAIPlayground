export type StudentAccentId = 'cyan' | 'orange' | 'black' | 'red'

export interface StudentAccentTheme {
  id: StudentAccentId
  label: string
  accent: string
  text: string
  soft: string
  softMid: string
  softStrong: string
  border: string
}

export const STUDENT_ACCENT_STORAGE_KEY = 'student_ui_accent'
export const DEFAULT_STUDENT_ACCENT: StudentAccentId = 'cyan'

export const STUDENT_ACCENTS: Record<StudentAccentId, StudentAccentTheme> = {
  cyan: {
    id: 'cyan',
    label: 'Light Cyan',
    accent: '#06b6d4',
    text: '#0891b2',
    soft: '#ecfeff',
    softMid: '#cffafe',
    softStrong: '#a5f3fc',
    border: '#67e8f9',
  },
  orange: {
    id: 'orange',
    label: 'Warm Orange',
    accent: '#f97316',
    text: '#ea580c',
    soft: '#fff7ed',
    softMid: '#fed7aa',
    softStrong: '#fdba74',
    border: '#fb923c',
  },
  black: {
    id: 'black',
    label: 'High Contrast',
    accent: '#000000',
    text: '#000000',
    soft: '#f3f4f6',
    softMid: '#e5e7eb',
    softStrong: '#d1d5db',
    border: '#9ca3af',
  },
  red: {
    id: 'red',
    label: 'Acid Red',
    accent: '#e11d48',
    text: '#be123c',
    soft: '#fff1f2',
    softMid: '#ffe4e6',
    softStrong: '#fecdd3',
    border: '#fda4af',
  },
}

export const getStudentAccentTheme = (accent?: StudentAccentId): StudentAccentTheme => {
  if (!accent) return STUDENT_ACCENTS[DEFAULT_STUDENT_ACCENT]
  return STUDENT_ACCENTS[accent] || STUDENT_ACCENTS[DEFAULT_STUDENT_ACCENT]
}

export const loadStudentAccent = (): StudentAccentId => {
  if (typeof window === 'undefined') return DEFAULT_STUDENT_ACCENT
  const value = localStorage.getItem(STUDENT_ACCENT_STORAGE_KEY)
  if (!value || !(value in STUDENT_ACCENTS)) return DEFAULT_STUDENT_ACCENT
  return value as StudentAccentId
}

export const saveStudentAccent = (accent: StudentAccentId): void => {
  if (typeof window === 'undefined') return
  localStorage.setItem(STUDENT_ACCENT_STORAGE_KEY, accent)
}
