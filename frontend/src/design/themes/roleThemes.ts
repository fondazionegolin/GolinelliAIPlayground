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
    accent: colorTokens.logo.blue,
    text: colorTokens.logo.blue,
    soft: 'rgba(62, 169, 244, 0.08)',
    softMid: 'rgba(62, 169, 244, 0.12)',
    softStrong: colorTokens.logo.blue,
    border: colorTokens.logo.blue,
  },
  orange: {
    id: 'orange',
    label: 'Logo Violet',
    accent: colorTokens.logo.violet,
    text: colorTokens.logo.violet,
    soft: 'rgba(123, 105, 201, 0.08)',
    softMid: 'rgba(123, 105, 201, 0.12)',
    softStrong: colorTokens.logo.violet,
    border: colorTokens.logo.violet,
  },
  black: {
    id: 'black',
    label: 'Logo Ink',
    accent: colorTokens.logo.ink,
    text: colorTokens.logo.ink,
    soft: 'rgba(23, 21, 27, 0.06)',
    softMid: 'rgba(23, 21, 27, 0.10)',
    softStrong: colorTokens.logo.ink,
    border: colorTokens.logo.ink,
  },
  red: {
    id: 'red',
    label: 'Logo Pink',
    accent: colorTokens.logo.pink,
    text: colorTokens.logo.pink,
    soft: 'rgba(254, 0, 77, 0.08)',
    softMid: 'rgba(254, 0, 77, 0.12)',
    softStrong: colorTokens.logo.pink,
    border: colorTokens.logo.pink,
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
