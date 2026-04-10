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
