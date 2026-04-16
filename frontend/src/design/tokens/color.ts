export const colorTokens = {
  white: '#ffffff',
  black: '#0f172a',
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  cyan: {
    300: '#9ad9e1',
    500: '#22b8cf',
    700: '#0f6f82',
  },
  orange: {
    300: '#efc2a0',
    500: '#f19b61',
    700: '#a85a26',
  },
  rose: {
    300: '#ebb4c1',
    500: '#e27c92',
    700: '#a94f66',
  },
  indigo: {
    100: '#e0e7ff',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
  },
  success: {
    100: '#dcfce7',
    500: '#22c55e',
    700: '#15803d',
  },
  warning: {
    100: '#fef3c7',
    500: '#f59e0b',
    700: '#b45309',
  },
  danger: {
    100: '#fee2e2',
    500: '#ef4444',
    700: '#b91c1c',
  },
} as const

export type ColorTokens = typeof colorTokens
