import { colorTokens } from '@/design/tokens/color'

export type RoleThemeId = 'teacher' | 'student' | 'admin'
export type AccentId = 'cyan' | 'orange' | 'black' | 'red'

export interface AccentTheme {
  id: AccentId
  label: string
  accent: string
  text: string
  soft: string
  softMid: string
  softStrong: string
  border: string
}

export const ACCENT_THEMES: Record<AccentId, AccentTheme> = {
  cyan: {
    id: 'cyan',
    label: 'Logo Blue',
    accent: colorTokens.info[500],
    text: colorTokens.info[700],
    soft: colorTokens.info[50],
    softMid: colorTokens.info[100],
    softStrong: colorTokens.info[200],
    border: colorTokens.info[200],
  },
  orange: {
    id: 'orange',
    label: 'Logo Violet',
    accent: colorTokens.overlap[500],
    text: colorTokens.overlap[700],
    soft: colorTokens.overlap[50],
    softMid: colorTokens.overlap[100],
    softStrong: colorTokens.overlap[200],
    border: colorTokens.overlap[200],
  },
  black: {
    id: 'black',
    label: 'Soft Graphite',
    accent: colorTokens.neutral[600],
    text: colorTokens.neutral[700],
    soft: '#faf6fb',
    softMid: '#f1e7f5',
    softStrong: '#e6d9ec',
    border: '#d8c5e0',
  },
  red: {
    id: 'red',
    label: 'Logo Magenta',
    accent: colorTokens.brand[500],
    text: colorTokens.brand[700],
    soft: colorTokens.brand[50],
    softMid: colorTokens.brand[100],
    softStrong: colorTokens.brand[200],
    border: colorTokens.brand[200],
  },
}

export const DEFAULT_ACCENT: AccentId = 'red'

export interface RoleTheme {
  role: RoleThemeId
  defaultAccent: AccentId
}

export const roleThemes: Record<RoleThemeId, RoleTheme> = {
  teacher: { role: 'teacher', defaultAccent: 'red' },
  student: { role: 'student', defaultAccent: 'red' },
  admin: { role: 'admin', defaultAccent: 'black' },
}

export function getAccentTheme(accent?: string): AccentTheme {
  if (!accent) return ACCENT_THEMES[DEFAULT_ACCENT]
  if (accent in ACCENT_THEMES) return ACCENT_THEMES[accent as AccentId]
  return ACCENT_THEMES[DEFAULT_ACCENT]
}
