export type StudentAccentId = 'pink' | 'slate' | 'black' | 'blue'

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
export const DEFAULT_STUDENT_ACCENT: StudentAccentId = 'pink'

export const STUDENT_ACCENTS: Record<StudentAccentId, StudentAccentTheme> = {
  pink: {
    id: 'pink',
    label: 'Brand Pink',
    accent: '#e85c8d', // Logo Pink
    text: '#c13d6a',
    soft: '#fff5f8',
    softMid: '#ffe4ee',
    softStrong: '#ffc9db',
    border: '#f9a8d4',
  },
  slate: {
    id: 'slate',
    label: 'Brand Slate',
    accent: '#2d2d2d', // Logo Slate
    text: '#1a1a1a',
    soft: '#f8f8f8',
    softMid: '#eeeeee',
    softStrong: '#e0e0e0',
    border: '#cccccc',
  },
  black: {
    id: 'black',
    label: 'High Contrast',
    accent: '#000000', // Black
    text: '#000000',
    soft: '#f3f4f6',
    softMid: '#e5e7eb',
    softStrong: '#d1d5db',
    border: '#9ca3af',
  },
  blue: {
    id: 'blue',
    label: 'Professional Blue',
    accent: '#2563eb',
    text: '#1d4ed8',
    soft: '#eff6ff',
    softMid: '#dbeafe',
    softStrong: '#bfdbfe',
    border: '#93c5fd',
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
