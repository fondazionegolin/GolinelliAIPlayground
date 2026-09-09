import type { CSSProperties } from 'react'
import { hexToRgb, rgbToHsl, setHexLightness } from '@/design/themes/colorUtils'
import type { AccentTheme } from '@/design/themes/roleThemes'

// Chrome is intentionally NEUTRAL: the navbar and nav clusters are base surfaces
// (light grey / white glass), never accent-tinted. Accent colours are reserved for
// interactive tokens (buttons / selectors / pills), not for background chrome.
const NEUTRAL_TINT = 'rgba(148, 163, 184, 0.07)' // slate-400 @ ~7%

export function buildAccentNavbarStyle(
  theme: AccentTheme,
  cssVars: Record<string, string>
): CSSProperties {
  void theme
  return {
    ...cssVars,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    backgroundImage: [
      `linear-gradient(${NEUTRAL_TINT}, ${NEUTRAL_TINT})`,
      'linear-gradient(rgba(255,255,255,0.45), rgba(255,255,255,0.45))',
    ].join(', '),
    backdropFilter: 'blur(30px) saturate(140%)',
    WebkitBackdropFilter: 'blur(30px) saturate(140%)',
    borderBottomColor: 'rgba(148, 163, 184, 0.30)',
    borderBottomWidth: '1px',
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.05)',
  }
}

export function buildAccentNavClusterStyle(theme: AccentTheme): CSSProperties {
  void theme
  return {
    borderRadius: 'var(--selection-radius)',
    backgroundColor: 'rgba(255, 255, 255, 0.64)',
    backgroundImage: [
      'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.50))',
      `linear-gradient(${NEUTRAL_TINT}, ${NEUTRAL_TINT})`,
    ].join(', '),
    borderColor: 'rgba(148, 163, 184, 0.24)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.82), 0 7px 18px rgba(15, 23, 42, 0.05)',
    backdropFilter: 'blur(18px) saturate(150%)',
    WebkitBackdropFilter: 'blur(18px) saturate(150%)',
  }
}

export function getAccentBodyTint(theme: AccentTheme): string {
  const baseGray = '#dee7f2'
  const { r, g, b } = hexToRgb(baseGray)
  const { l } = rgbToHsl(r, g, b)
  return setHexLightness(theme.accent, l, theme.id === 'black' ? 0.08 : 0.22)
}
