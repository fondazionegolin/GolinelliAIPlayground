export const brandTokens = {
  color: {
    pink: '#fe004d',
    blue: '#3ea9f4',
    violet: '#7b69c9',
    ink: '#17151b',
  },
  alpha: {
    pink: {
      6: 'rgba(254, 0, 77, 0.06)',
      10: 'rgba(254, 0, 77, 0.10)',
      14: 'rgba(254, 0, 77, 0.14)',
      22: 'rgba(254, 0, 77, 0.22)',
    },
    blue: {
      6: 'rgba(62, 169, 244, 0.06)',
      10: 'rgba(62, 169, 244, 0.10)',
      14: 'rgba(62, 169, 244, 0.14)',
      22: 'rgba(62, 169, 244, 0.22)',
    },
    violet: {
      6: 'rgba(123, 105, 201, 0.06)',
      10: 'rgba(123, 105, 201, 0.10)',
      14: 'rgba(123, 105, 201, 0.14)',
      22: 'rgba(123, 105, 201, 0.22)',
    },
  },
  action: {
    radius: '1rem',
    height: {
      compact: '2.25rem',
      default: '2.75rem',
      roomy: '3.125rem',
      icon: '2.75rem',
    },
    paddingX: {
      compact: '0.875rem',
      default: '1.25rem',
      roomy: '1.5rem',
    },
    shadow: 'var(--button-accent-shadow)',
  },
} as const

export type BrandTokens = typeof brandTokens
