import {
  ACCENT_THEMES,
  DEFAULT_ACCENT,
  getAccentTheme,
  type AccentId,
  type AccentTheme,
} from '@/design/themes/roleThemes'

export type StudentAccentId = AccentId
export type StudentAccentTheme = AccentTheme

export const STUDENT_ACCENT_STORAGE_KEY = 'student_ui_accent'
export const DEFAULT_STUDENT_ACCENT: StudentAccentId = DEFAULT_ACCENT
export const STUDENT_ACCENTS: Record<StudentAccentId, StudentAccentTheme> = ACCENT_THEMES

export const getStudentAccentTheme = (accent?: StudentAccentId): StudentAccentTheme =>
  getAccentTheme(accent)

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
