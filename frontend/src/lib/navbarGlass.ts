import type { CSSProperties } from 'react'
import { hexToRgb, rgbToHsl, setHexLightness } from '@/design/themes/colorUtils'
import type { AccentTheme } from '@/design/themes/roleThemes'

export function buildAccentNavbarStyle(
  theme: AccentTheme,
  cssVars: Record<string, string>
): CSSProperties {
  void theme
  return {
    ...cssVars,
    // Navbar sits on the page backdrop (--ds-canvas-mesh): no fill of its own.
    background: 'transparent',
    border: '0',
    boxShadow: 'none',
  }
}

export function buildAccentNavClusterStyle(theme: AccentTheme): CSSProperties {
  void theme
  return {
    borderRadius: 'var(--selection-radius)',
    backgroundColor: 'var(--ds-navbar-cluster)',
    backgroundImage: 'var(--ds-navbar-cluster-bg)',
    border: '0',
    boxShadow: 'var(--ds-shadow-cluster)',
  }
}

export function getAccentBodyTint(theme: AccentTheme): string {
  const baseGray = '#dee7f2'
  const { r, g, b } = hexToRgb(baseGray)
  const { l } = rgbToHsl(r, g, b)
  return setHexLightness(theme.accent, l, theme.id === 'black' ? 0.08 : 0.22)
}
