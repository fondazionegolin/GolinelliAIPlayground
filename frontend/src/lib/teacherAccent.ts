export type TeacherAccentId = 'pink' | 'slate' | 'black' | 'indigo' | 'purple'

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

export const DEFAULT_TEACHER_ACCENT: TeacherAccentId = 'pink'

export const TEACHER_ACCENTS: Record<TeacherAccentId, TeacherAccentTheme> = {
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
  indigo: {
    id: 'indigo',
    label: 'Professional Indigo',
    accent: '#6366f1',
    text: '#4f46e5',
    soft: '#eef2ff',
    softMid: '#e0e7ff',
    softStrong: '#c7d2fe',
    border: '#a5b4fc',
  },
  purple: {
    id: 'purple',
    label: 'Dark Purple',
    accent: '#7c3aed',
    text: '#6d28d9',
    soft: '#f5f3ff',
    softMid: '#ede9fe',
    softStrong: '#ddd6fe',
    border: '#c4b5fd',
  },
}

export const getTeacherAccentTheme = (accent?: string): TeacherAccentTheme => {
  if (!accent) return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
  if (accent in TEACHER_ACCENTS) return TEACHER_ACCENTS[accent as TeacherAccentId]
  return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
}
