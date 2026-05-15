import type { CSSProperties } from 'react'
import { hexToRgba, hexToRgb, rgbToHsl, setHexLightness } from '@/design/themes/colorUtils'
import type { AccentTheme } from '@/design/themes/roleThemes'

export function buildAccentNavbarStyle(
  theme: AccentTheme,
  cssVars: Record<string, string>
): CSSProperties {
  return {
    ...cssVars,
    backgroundColor: hexToRgba(theme.accent, 0.1),
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.64), rgba(255,255,255,0.72))',
    backdropFilter: 'blur(20px) saturate(138%)',
    WebkitBackdropFilter: 'blur(20px) saturate(138%)',
    borderBottomColor: hexToRgba(theme.accent, 0.15),
    borderBottomWidth: '1px',
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.42), 0 8px 24px ${hexToRgba(theme.accent, 0.04)}`,
  }
}

export function buildAccentNavClusterStyle(theme: AccentTheme): CSSProperties {
  return {
    backgroundColor: 'rgba(255,255,255,0.58)',
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.24))',
    borderColor: hexToRgba(theme.accent, 0.14),
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.78), inset 0 -1px 0 rgba(255,255,255,0.18), 0 6px 18px ${hexToRgba(theme.accent, 0.04)}`,
  }
}

export function getAccentBodyTint(theme: AccentTheme): string {
  const baseGray = '#dee7f2'
  const { r, g, b } = hexToRgb(baseGray)
  const { l } = rgbToHsl(r, g, b)
  return setHexLightness(theme.accent, l, theme.id === 'black' ? 0.08 : 0.22)
}
