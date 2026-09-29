const PASTEL_FAMILIES = {
  neutral: {
    surface: 'border-0 bg-white/[0.78] bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-white hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-neutral-900/[0.08]',
    iconText: 'text-neutral-900',
  },
  brand: {
    surface: 'border-0 bg-[rgba(254,0,77,0.07)] bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-[rgba(254,0,77,0.10)] hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-[rgba(254,0,77,0.14)]',
    iconText: 'text-[#fe004d]',
  },
  info: {
    surface: 'border-0 bg-[rgba(62,169,244,0.07)] bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-[rgba(62,169,244,0.10)] hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-[rgba(62,169,244,0.14)]',
    iconText: 'text-[var(--logo-blue-strong)]',
  },
  support: {
    surface: 'border-0 bg-[rgba(123,105,201,0.07)] bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-[rgba(123,105,201,0.10)] hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-[rgba(123,105,201,0.14)]',
    iconText: 'text-[var(--logo-violet-strong)]',
  },
  success: {
    surface: 'border-0 bg-sky-50 bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-sky-100/70 hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-sky-100',
    iconText: 'text-sky-700',
  },
  warning: {
    surface: 'border-0 bg-fuchsia-50 bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-fuchsia-100/70 hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-fuchsia-100',
    iconText: 'text-fuchsia-700',
  },
  danger: {
    surface: 'border-0 bg-pink-50 bg-[image:var(--ds-semantic-shading)] shadow-[var(--ds-shadow-1)] hover:bg-pink-100/70 hover:shadow-[var(--ds-shadow-2)]',
    iconBg: 'bg-pink-100',
    iconText: 'text-pink-700',
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
