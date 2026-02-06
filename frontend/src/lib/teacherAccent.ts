export type TeacherAccentId = 'red' | 'indigo' | 'gray' | 'green' | 'slateblue'

export interface TeacherAccentTheme {
  id: TeacherAccentId
  label: string
  accent: string
  text: string
  soft: string
  softStrong: string
  border: string
}

export const DEFAULT_TEACHER_ACCENT: TeacherAccentId = 'red'

export const TEACHER_ACCENTS: Record<TeacherAccentId, TeacherAccentTheme> = {
  red: {
    id: 'red',
    label: 'Rosso',
    accent: '#ef4444',
    text: '#dc2626',
    soft: '#fef2f2',
    softStrong: '#fecaca',
    border: '#fca5a5',
  },
  indigo: {
    id: 'indigo',
    label: 'Indaco',
    accent: '#6366f1',
    text: '#4f46e5',
    soft: '#eef2ff',
    softStrong: '#c7d2fe',
    border: '#a5b4fc',
  },
  gray: {
    id: 'gray',
    label: 'Grigio',
    accent: '#6b7280',
    text: '#4b5563',
    soft: '#f3f4f6',
    softStrong: '#d1d5db',
    border: '#9ca3af',
  },
  green: {
    id: 'green',
    label: 'Verde',
    accent: '#16a34a',
    text: '#15803d',
    soft: '#f0fdf4',
    softStrong: '#bbf7d0',
    border: '#86efac',
  },
  slateblue: {
    id: 'slateblue',
    label: 'Slate Blue',
    accent: '#5b6ee1',
    text: '#4757c8',
    soft: '#eef2ff',
    softStrong: '#c7d2fe',
    border: '#a5b4fc',
  },
}

export const getTeacherAccentTheme = (accent?: string): TeacherAccentTheme => {
  if (!accent) return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
  if (accent in TEACHER_ACCENTS) return TEACHER_ACCENTS[accent as TeacherAccentId]
  return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
}
