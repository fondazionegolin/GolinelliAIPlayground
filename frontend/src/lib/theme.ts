import { hexToRgba } from '@/design/themes/colorUtils'
import { getAccentTheme, DEFAULT_ACCENT, type AccentTheme } from '@/design/themes/roleThemes'

type Theme = AccentTheme

export function getAppBackgroundGradient(theme: Theme) {
  return theme.soft
}

export const DEFAULT_GRADIENT = getAppBackgroundGradient(getAccentTheme(DEFAULT_ACCENT))
export { hexToRgba }
