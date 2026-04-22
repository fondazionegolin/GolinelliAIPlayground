import { colorTokens } from '@/design/tokens/color'

export const semanticTokens = {
  text: {
    primary: colorTokens.neutral[900],
    secondary: colorTokens.neutral[500],
    muted: colorTokens.neutral[400],
    inverse: colorTokens.white,
  },
  surface: {
    page: colorTokens.neutral[50],
    base: colorTokens.white,
    elevated: 'rgba(255,255,255,0.92)',
    muted: colorTokens.neutral[100],
  },
  border: {
    subtle: colorTokens.neutral[200],
    strong: colorTokens.neutral[300],
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
