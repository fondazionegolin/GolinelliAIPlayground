export const typographyTokens = {
  fontFamily: {
    ui: "'Lexend', system-ui, sans-serif",
    brand: "'SofiaPro', 'Lexend', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    black: 900,
  },
  lineHeight: {
    xs: 1.35,
    sm: 1.4,
    md: 1.5,
    lg: 1.6,
    xl: 1.15,
  },
  letterSpacing: {
    tight: '-0.025em',
    normal: '0em',
    wide: '0.02em',
  },
  textStyle: {
    caption: {
      fontSize: '0.75rem',
      lineHeight: 1.35,
      fontWeight: 500,
      letterSpacing: '0em',
    },
    bodySm: {
      fontSize: '0.875rem',
      lineHeight: 1.4,
      fontWeight: 400,
      letterSpacing: '0em',
    },
    body: {
      fontSize: '1rem',
      lineHeight: 1.5,
      fontWeight: 400,
      letterSpacing: '0em',
    },
    bodyLg: {
      fontSize: '1.125rem',
      lineHeight: 1.6,
      fontWeight: 400,
      letterSpacing: '0em',
    },
    titleSm: {
      fontSize: '1.25rem',
      lineHeight: 1.2,
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    titleMd: {
      fontSize: '1.5rem',
      lineHeight: 1.15,
      fontWeight: 700,
      letterSpacing: '-0.025em',
    },
    titleLg: {
      fontSize: '1.875rem',
      lineHeight: 1.15,
      fontWeight: 700,
      letterSpacing: '-0.025em',
    },
    display: {
      fontSize: '3rem',
      lineHeight: 1,
      fontWeight: 900,
      letterSpacing: '-0.025em',
    },
  },
} as const

export type TypographyTokens = typeof typographyTokens
