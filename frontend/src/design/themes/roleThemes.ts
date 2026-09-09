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
    // Darker readable blue for text on light surfaces (the vivid blue fails contrast on white/chrome).
    text: colorTokens.info[700],
    soft: 'rgba(62, 169, 244, 0.08)',
    softMid: 'rgba(62, 169, 244, 0.12)',
    softStrong: colorTokens.logo.blue,
    border: colorTokens.logo.blue,
  },
  orange: {
    id: 'orange',
    label: 'Logo Violet',
    accent: colorTokens.logo.violet,
    // Darker readable violet for text on light surfaces (the vivid violet is too light on white/chrome).
    text: colorTokens.overlap[700],
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
    text: colorTokens.brand[700],
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

// Per-user accent themes were removed: the app now uses one fixed brand palette.
// The "accent" (buttons / primary actions / navbar action buttons) is neutral.
// Selectors and pill-like accent buttons use the lavender/violet CSS tokens.
// Any stored/selected accent is ignored.
const BRAND_THEME: AccentTheme = {
  id: 'red',
  label: 'Brand',
  accent: '#475569',  // slate-600 — buttons reset to neutral grey
  text: '#334155',    // slate-700
  soft: 'rgba(71, 85, 105, 0.08)',
  softMid: 'rgba(71, 85, 105, 0.12)',
  softStrong: '#475569',
  border: '#475569',
}

export function getAccentTheme(_accent?: string): AccentTheme {
  void _accent
  return BRAND_THEME
}
