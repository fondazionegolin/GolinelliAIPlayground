import { hexToRgba } from '@/design/themes/colorUtils'
import { getAccentTheme, DEFAULT_ACCENT, type AccentTheme } from '@/design/themes/roleThemes'

type Theme = AccentTheme

export function getAppBackgroundGradient(theme: Theme) {
  void theme
  return 'var(--app-body-bg)'
}

export const DEFAULT_GRADIENT = getAppBackgroundGradient(getAccentTheme(DEFAULT_ACCENT))
export { hexToRgba }
