import { colorTokens } from '@/design/tokens/color'

export const semanticTokens = {
  text: {
    primary: colorTokens.slate[900],
    secondary: colorTokens.slate[500],
    muted: colorTokens.slate[400],
    inverse: colorTokens.white,
  },
  surface: {
    page: colorTokens.slate[50],
    base: colorTokens.white,
    elevated: 'rgba(255,255,255,0.92)',
    muted: colorTokens.slate[100],
  },
  border: {
    subtle: colorTokens.slate[200],
    strong: colorTokens.slate[300],
  },
  feedback: {
    success: colorTokens.success[500],
    warning: colorTokens.warning[500],
    danger: colorTokens.danger[500],
  },
} as const
