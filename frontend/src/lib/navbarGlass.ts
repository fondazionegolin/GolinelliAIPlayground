import type { CSSProperties } from 'react'
import { hexToRgba, hexToRgb, rgbToHsl, setHexLightness } from '@/design/themes/colorUtils'
import type { AccentTheme } from '@/design/themes/roleThemes'

export function buildAccentNavbarStyle(
  theme: AccentTheme,
  cssVars: Record<string, string>
): CSSProperties {
  const accentTint = hexToRgba(theme.accent, theme.id === 'black' ? 0.05 : 0.08)
  const whiteVeil = 'rgba(255,255,255,0.34)'
  return {
    ...cssVars,
    backgroundColor: hexToRgba(theme.accent, theme.id === 'black' ? 0.035 : 0.06),
    backgroundImage: [
      `linear-gradient(${accentTint}, ${accentTint})`,
      `linear-gradient(${whiteVeil}, ${whiteVeil})`,
    ].join(', '),
    backdropFilter: 'blur(30px) saturate(185%)',
    WebkitBackdropFilter: 'blur(30px) saturate(185%)',
    borderBottomColor: hexToRgba(theme.accent, theme.id === 'black' ? 0.32 : 0.5),
    borderBottomWidth: '2px',
    boxShadow: `0 8px 24px ${hexToRgba(theme.accent, theme.id === 'black' ? 0.03 : 0.06)}`,
  }
}

export function buildAccentNavClusterStyle(theme: AccentTheme): CSSProperties {
  return {
    backgroundColor: 'rgba(255,255,255,0.64)',
    backgroundImage: [
      'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.48))',
      `radial-gradient(140% 180% at 16% -70%, ${hexToRgba(theme.accent, theme.id === 'black' ? 0.08 : 0.16)} 0%, transparent 62%)`,
      `linear-gradient(135deg, ${hexToRgba(theme.accent, theme.id === 'black' ? 0.035 : 0.07)}, transparent 58%)`,
    ].join(', '),
    borderColor: hexToRgba(theme.accent, theme.id === 'black' ? 0.16 : 0.24),
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.82), inset 0 -1px 0 ${hexToRgba(theme.accent, theme.id === 'black' ? 0.12 : 0.18)}, 0 7px 18px ${hexToRgba(theme.accent, theme.id === 'black' ? 0.03 : 0.065)}`,
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
