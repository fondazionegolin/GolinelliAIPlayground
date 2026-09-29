import { colorTokens } from '@/design/tokens/color'

export const semanticTokens = {
  text: {
    primary: colorTokens.neutral[900],
    secondary: colorTokens.neutral[500],
    muted: colorTokens.neutral[400],
    inverse: colorTokens.white,
  },
  surface: {
    page: '#f2f4f7',
    base: 'rgba(255,255,255,0.94)',
    elevated: 'rgba(255,255,255,0.97)',
    muted: 'rgba(241,245,249,0.88)',
    glass: 'rgba(255,255,255,0.92)',
    header: 'rgba(255,255,255,0.96)',
  },
  border: {
    subtle: 'transparent',
    strong: 'transparent',
  },
  overlay: {
    soft: 'rgba(23,23,23,0.12)',
    modal: 'rgba(23,23,23,0.5)',
  },
  feedback: {
    success: colorTokens.success[500],
    warning: colorTokens.warning[500],
    danger: colorTokens.danger[500],
  },
  accent: {
    brand: colorTokens.brand[500],
    info: colorTokens.info[500],
    overlap: colorTokens.overlap[500],
  },
} as const
