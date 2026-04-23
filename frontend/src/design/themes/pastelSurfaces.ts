const PASTEL_FAMILIES = {
  neutral: {
    surface: 'bg-[#faf6fb]/92 border border-[#e6d9ec]/78 hover:bg-[#fdfaff] hover:border-[#d8c5e0]/88',
    iconBg: 'bg-[#f1e7f5]',
    iconText: 'text-[#6a5872]',
  },
  brand: {
    surface: 'bg-[#fdf0f5]/92 border border-[#f3c6d8]/82 hover:bg-[#fff6fa] hover:border-[#ea9cbc]/92',
    iconBg: 'bg-[#f8d6e5]',
    iconText: 'text-[#b51f5f]',
  },
  info: {
    surface: 'bg-[#eef7fe]/92 border border-[#cfe3fb]/82 hover:bg-[#f6fbff] hover:border-[#9ecaf8]/92',
    iconBg: 'bg-[#d9ecfd]',
    iconText: 'text-[#1d7dd8]',
  },
  support: {
    surface: 'bg-[#f7eff9]/92 border border-[#dfc6e6]/82 hover:bg-[#fcf8fd] hover:border-[#c999d5]/92',
    iconBg: 'bg-[#ebd9f0]',
    iconText: 'text-[#9452a3]',
  },
  success: {
    surface: 'bg-[#eef7fe]/92 border border-[#cfe3fb]/82 hover:bg-[#f6fbff] hover:border-[#9ecaf8]/92',
    iconBg: 'bg-[#d9ecfd]',
    iconText: 'text-[#1d7dd8]',
  },
  warning: {
    surface: 'bg-[#f7eff9]/92 border border-[#dfc6e6]/82 hover:bg-[#fcf8fd] hover:border-[#c999d5]/92',
    iconBg: 'bg-[#ebd9f0]',
    iconText: 'text-[#9452a3]',
  },
  danger: {
    surface: 'bg-[#fdf0f5]/92 border border-[#f3c6d8]/82 hover:bg-[#fff6fa] hover:border-[#ea9cbc]/92',
    iconBg: 'bg-[#f8d6e5]',
    iconText: 'text-[#b51f5f]',
  },
} as const

export type PastelFamily = keyof typeof PASTEL_FAMILIES

export const UI_TONE_SURFACES: Record<PastelFamily, string> = {
  neutral: PASTEL_FAMILIES.neutral.surface,
  brand: PASTEL_FAMILIES.brand.surface,
  info: PASTEL_FAMILIES.info.surface,
  support: PASTEL_FAMILIES.support.surface,
  success: PASTEL_FAMILIES.success.surface,
  warning: PASTEL_FAMILIES.warning.surface,
  danger: PASTEL_FAMILIES.danger.surface,
}

export const UI_TONE_ICON_BACKGROUNDS: Record<PastelFamily, string> = {
  neutral: PASTEL_FAMILIES.neutral.iconBg,
  brand: PASTEL_FAMILIES.brand.iconBg,
  info: PASTEL_FAMILIES.info.iconBg,
  support: PASTEL_FAMILIES.support.iconBg,
  success: PASTEL_FAMILIES.success.iconBg,
  warning: PASTEL_FAMILIES.warning.iconBg,
  danger: PASTEL_FAMILIES.danger.iconBg,
}

export const UI_TONE_ICON_TEXT: Record<PastelFamily, string> = {
  neutral: PASTEL_FAMILIES.neutral.iconText,
  brand: PASTEL_FAMILIES.brand.iconText,
  info: PASTEL_FAMILIES.info.iconText,
  support: PASTEL_FAMILIES.support.iconText,
  success: PASTEL_FAMILIES.success.iconText,
  warning: PASTEL_FAMILIES.warning.iconText,
  danger: PASTEL_FAMILIES.danger.iconText,
}

export const PASTEL_SURFACES = {
  slate: UI_TONE_SURFACES.neutral,
  indigo: UI_TONE_SURFACES.brand,
  violet: PASTEL_FAMILIES.support.surface,
  emerald: PASTEL_FAMILIES.support.surface,
  amber: PASTEL_FAMILIES.support.surface,
  rose: UI_TONE_SURFACES.danger,
  cyan: UI_TONE_SURFACES.info,
  blue: UI_TONE_SURFACES.info,
  sky: UI_TONE_SURFACES.info,
  teal: UI_TONE_SURFACES.info,
  orange: PASTEL_FAMILIES.support.surface,
} as const

export const PASTEL_ICON_BACKGROUNDS = {
  slate: UI_TONE_ICON_BACKGROUNDS.neutral,
  indigo: UI_TONE_ICON_BACKGROUNDS.brand,
  violet: PASTEL_FAMILIES.support.iconBg,
  emerald: PASTEL_FAMILIES.support.iconBg,
  amber: PASTEL_FAMILIES.support.iconBg,
  rose: UI_TONE_ICON_BACKGROUNDS.danger,
  cyan: UI_TONE_ICON_BACKGROUNDS.info,
  blue: UI_TONE_ICON_BACKGROUNDS.info,
  sky: UI_TONE_ICON_BACKGROUNDS.info,
  teal: UI_TONE_ICON_BACKGROUNDS.info,
  orange: PASTEL_FAMILIES.support.iconBg,
} as const

export const PASTEL_ICON_TEXT = {
  slate: UI_TONE_ICON_TEXT.neutral,
  indigo: UI_TONE_ICON_TEXT.brand,
  violet: PASTEL_FAMILIES.support.iconText,
  emerald: PASTEL_FAMILIES.support.iconText,
  amber: PASTEL_FAMILIES.support.iconText,
  rose: UI_TONE_ICON_TEXT.danger,
  cyan: UI_TONE_ICON_TEXT.info,
  blue: UI_TONE_ICON_TEXT.info,
  sky: UI_TONE_ICON_TEXT.info,
  teal: UI_TONE_ICON_TEXT.info,
  orange: PASTEL_FAMILIES.support.iconText,
} as const

export type PastelTone = keyof typeof PASTEL_SURFACES
