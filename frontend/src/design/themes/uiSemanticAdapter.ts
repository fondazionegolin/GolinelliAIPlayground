import { colorTokens } from '@/design/tokens/color'
import { semanticTokens } from '@/design/themes/semanticTokens'

export interface UiTone {
  bg: string
  bgHover: string
  border: string
  text: string
  icon: string
}

export interface UiSemanticAdapter {
  text: {
    primary: string
    secondary: string
    muted: string
    inverse: string
  }
  surface: {
    page: string
    base: string
    elevated: string
    muted: string
    sunken: string
    glass: string
    header: string
    sidebar: string
  }
  border: {
    subtle: string
    strong: string
    inverse: string
  }
  overlay: {
    soft: string
    modal: string
  }
  tones: {
    neutral: UiTone
    accent: UiTone
    info: UiTone
    success: UiTone
    warning: UiTone
    danger: UiTone
  }
}

export const uiSemanticAdapter: UiSemanticAdapter = {
  text: {
    primary: semanticTokens.text.primary,
    secondary: semanticTokens.text.secondary,
    muted: semanticTokens.text.muted,
    inverse: semanticTokens.text.inverse,
  },
  surface: {
    page: semanticTokens.surface.page,
    base: semanticTokens.surface.base,
    elevated: semanticTokens.surface.elevated,
    muted: semanticTokens.surface.muted,
    sunken: colorTokens.slate[100],
    glass: 'rgba(255,255,255,0.86)',
    header: 'rgba(255,255,255,0.94)',
    sidebar: 'rgba(248,250,252,0.92)',
  },
  border: {
    subtle: semanticTokens.border.subtle,
    strong: semanticTokens.border.strong,
    inverse: 'rgba(255,255,255,0.24)',
  },
  overlay: {
    soft: 'rgba(15,23,42,0.12)',
    modal: 'rgba(15,23,42,0.5)',
  },
  tones: {
    neutral: {
      bg: colorTokens.slate[100],
      bgHover: colorTokens.slate[50],
      border: colorTokens.slate[200],
      text: colorTokens.slate[600],
      icon: colorTokens.slate[500],
    },
    accent: {
      bg: colorTokens.indigo[100],
      bgHover: '#c7d2fe',
      border: '#c7d2fe',
      text: colorTokens.indigo[700],
      icon: colorTokens.indigo[600],
    },
    info: {
      bg: '#e0f2fe',
      bgHover: '#bae6fd',
      border: '#bae6fd',
      text: '#0369a1',
      icon: '#0284c7',
    },
    success: {
      bg: colorTokens.success[100],
      bgHover: '#bbf7d0',
      border: '#bbf7d0',
      text: colorTokens.success[700],
      icon: colorTokens.success[500],
    },
    warning: {
      bg: colorTokens.warning[100],
      bgHover: '#fde68a',
      border: '#fde68a',
      text: colorTokens.warning[700],
      icon: colorTokens.warning[500],
    },
    danger: {
      bg: colorTokens.danger[100],
      bgHover: '#fecaca',
      border: '#fecaca',
      text: colorTokens.danger[700],
      icon: colorTokens.danger[500],
    },
  },
}

export type UiSemanticToneName = keyof typeof uiSemanticAdapter.tones

export function getUiTone(name: UiSemanticToneName): UiTone {
  return uiSemanticAdapter.tones[name]
}
