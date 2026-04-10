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
    label: 'Soft Cyan',
    accent: '#22b8cf',
    text: '#0f6f82',
    soft: '#f4fcfd',
    softMid: '#ddf6f8',
    softStrong: '#c5edf1',
    border: '#9ad9e1',
  },
  orange: {
    id: 'orange',
    label: 'Soft Apricot',
    accent: '#f19b61',
    text: '#a85a26',
    soft: '#fff9f4',
    softMid: '#fde8d6',
    softStrong: '#f8d4b8',
    border: '#efc2a0',
  },
  black: {
    id: 'black',
    label: 'Graphite Mist',
    accent: '#475569',
    text: '#334155',
    soft: '#f7f8fb',
    softMid: '#eaedf3',
    softStrong: '#d9dfe9',
    border: '#c3cad7',
  },
  red: {
    id: 'red',
    label: 'Soft Rose',
    accent: '#e27c92',
    text: '#a94f66',
    soft: '#fff7f8',
    softMid: '#fde3e8',
    softStrong: '#f8cdd7',
    border: '#ebb4c1',
  },
}

export const getTeacherAccentTheme = (accent?: string): TeacherAccentTheme => {
  if (!accent) return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
  if (accent in TEACHER_ACCENTS) return TEACHER_ACCENTS[accent as TeacherAccentId]
  return TEACHER_ACCENTS[DEFAULT_TEACHER_ACCENT]
}
