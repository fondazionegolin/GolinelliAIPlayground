import { StudentAccentTheme, STUDENT_ACCENTS, DEFAULT_STUDENT_ACCENT } from './studentAccent'
import { TeacherAccentTheme } from './teacherAccent'

type Theme = StudentAccentTheme | TeacherAccentTheme

function hexToRgba(hex: string, opacity: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function getAppBackgroundGradient(theme: Theme) {
  return theme.soft
}

export const DEFAULT_GRADIENT = getAppBackgroundGradient(STUDENT_ACCENTS[DEFAULT_STUDENT_ACCENT])
export { hexToRgba }
