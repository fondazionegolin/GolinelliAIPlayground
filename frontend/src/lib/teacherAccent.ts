export type TeacherAccentId = 'cyan' | 'orange' | 'black' | 'red'

export interface TeacherAccentTheme {
  id: TeacherAccentId
  label: string
  accent: string
  text: string
  soft: string
  softMid: string
  softStrong: string
  border: string
}

export const DEFAULT_TEACHER_ACCENT: TeacherAccentId = 'cyan'

export const TEACHER_ACCENTS: Record<TeacherAccentId, TeacherAccentTheme> = {
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

export const getTeacherAccentTheme = (accent?: string): TeacherAccentTheme => {
  if (!accent) return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
  if (accent in TEACHER_ACCENTS) return TEACHER_ACCENTS[accent as TeacherAccentId]
  return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
}
