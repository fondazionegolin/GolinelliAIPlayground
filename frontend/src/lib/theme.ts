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
  // Interfaccia "Ethereal Mesh" - Gradienti pastello con shading più evidente
  // Alternanza di punti luce quasi bianchi e zone più profonde in tono
  // Usiamo opacità regolate per non scurire troppo con gli accenti slate/black
  const accentOpacityFactor = (theme.id === 'black' || theme.id === 'slate') ? 0.6 : 1;

  // 4 corner gradients + white center — reduced from 9 for GPU performance
  return [
    `radial-gradient(at 0% 0%, ${hexToRgba(theme.accent, 0.14 * accentOpacityFactor)} 0px, transparent 55%)`,
    `radial-gradient(at 100% 0%, ${hexToRgba(theme.accent, 0.10 * accentOpacityFactor)} 0px, transparent 55%)`,
    `radial-gradient(at 100% 100%, ${hexToRgba(theme.accent, 0.16 * accentOpacityFactor)} 0px, transparent 65%)`,
    `radial-gradient(at 0% 100%, ${hexToRgba(theme.accent, 0.12 * accentOpacityFactor)} 0px, transparent 60%)`,
    theme.soft,
  ].join(', ')
}

export const DEFAULT_GRADIENT = getAppBackgroundGradient(STUDENT_ACCENTS[DEFAULT_STUDENT_ACCENT])
