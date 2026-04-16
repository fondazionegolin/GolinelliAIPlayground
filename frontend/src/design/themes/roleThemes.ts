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
    label: 'Soft Cyan',
    accent: colorTokens.cyan[500],
    text: colorTokens.cyan[700],
    soft: '#f4fcfd',
    softMid: '#ddf6f8',
    softStrong: '#c5edf1',
    border: colorTokens.cyan[300],
  },
  orange: {
    id: 'orange',
    label: 'Soft Apricot',
    accent: colorTokens.orange[500],
    text: colorTokens.orange[700],
    soft: '#fff9f4',
    softMid: '#fde8d6',
    softStrong: '#f8d4b8',
    border: colorTokens.orange[300],
  },
  black: {
    id: 'black',
    label: 'Graphite Mist',
    accent: colorTokens.slate[600],
    text: colorTokens.slate[700],
    soft: '#f7f8fb',
    softMid: '#eaedf3',
    softStrong: '#d9dfe9',
    border: '#c3cad7',
  },
  red: {
    id: 'red',
    label: 'Soft Rose',
    accent: colorTokens.rose[500],
    text: colorTokens.rose[700],
    soft: '#fff7f8',
    softMid: '#fde3e8',
    softStrong: '#f8cdd7',
    border: colorTokens.rose[300],
  },
}

export const DEFAULT_ACCENT: AccentId = 'cyan'

export interface RoleTheme {
  role: RoleThemeId
  defaultAccent: AccentId
}

export const roleThemes: Record<RoleThemeId, RoleTheme> = {
  teacher: { role: 'teacher', defaultAccent: 'cyan' },
  student: { role: 'student', defaultAccent: 'cyan' },
  admin: { role: 'admin', defaultAccent: 'black' },
}

export function getAccentTheme(accent?: string): AccentTheme {
  if (!accent) return ACCENT_THEMES[DEFAULT_ACCENT]
  if (accent in ACCENT_THEMES) return ACCENT_THEMES[accent as AccentId]
  return ACCENT_THEMES[DEFAULT_ACCENT]
}
