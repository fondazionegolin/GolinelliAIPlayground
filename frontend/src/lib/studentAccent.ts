export type StudentAccentId = 'pink' | 'blue' | 'cyan' | 'orange' | 'mustard'

export interface StudentAccentTheme {
  id: StudentAccentId
  label: string
  accent: string
  text: string
  soft: string
  softStrong: string
  border: string
}

export const STUDENT_ACCENT_STORAGE_KEY = 'student_ui_accent'
export const DEFAULT_STUDENT_ACCENT: StudentAccentId = 'pink'

export const STUDENT_ACCENTS: Record<StudentAccentId, StudentAccentTheme> = {
  pink: {
    id: 'pink',
    label: 'Rosa',
    accent: '#ec4899',
    text: '#be185d',
    soft: '#fdf2f8',
    softStrong: '#fbcfe8',
    border: '#f9a8d4',
  },
  blue: {
    id: 'blue',
    label: 'Blu',
    accent: '#2563eb',
    text: '#1d4ed8',
    soft: '#eff6ff',
    softStrong: '#bfdbfe',
    border: '#93c5fd',
  },
  cyan: {
    id: 'cyan',
    label: 'Cyan',
    accent: '#0891b2',
    text: '#0e7490',
    soft: '#ecfeff',
    softStrong: '#a5f3fc',
    border: '#67e8f9',
  },
  orange: {
    id: 'orange',
    label: 'Arancio',
    accent: '#ea580c',
    text: '#c2410c',
    soft: '#fff7ed',
    softStrong: '#fed7aa',
    border: '#fdba74',
  },
  mustard: {
    id: 'mustard',
    label: 'Senape',
    accent: '#ca8a04',
    text: '#a16207',
    soft: '#fefce8',
    softStrong: '#fde68a',
    border: '#fcd34d',
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
