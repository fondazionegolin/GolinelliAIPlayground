import type { ReactNode } from 'react'

export const ACHIEVEMENT_ICON_KEYS = [
  'key', 'flashlight', 'map', 'shield', 'gem', 'book',
  'compass', 'lock', 'bulb', 'star', 'flask', 'puzzle',
] as const

export type AchievementIconKey = typeof ACHIEVEMENT_ICON_KEYS[number]

const TILE: Record<AchievementIconKey, string> = {
  key: '#f59e0b', flashlight: '#0ea5e9', map: '#14b8a6', shield: '#8b5cf6',
  gem: '#ec4899', book: '#f97316', compass: '#6366f1', lock: '#f43f5e',
  bulb: '#eab308', star: '#22c55e', flask: '#06b6d4', puzzle: '#a855f7',
}

// Flat glyphs on a 32x32 tile: `g` is the glyph colour, `t` the tile colour (used for cut-outs).
const GLYPH: Record<AchievementIconKey, (g: string, t: string) => ReactNode> = {
  key: g => <><circle cx="11" cy="16" r="5" fill="none" stroke={g} strokeWidth="3" /><path d="M16 16h10M22 16v4M26 16v4" stroke={g} strokeWidth="3" strokeLinecap="round" /></>,
  flashlight: g => <><rect x="8" y="12" width="14" height="8" rx="2" fill={g} /><path d="M22 11l6-3v16l-6-3z" fill={g} opacity=".6" /></>,
  map: (g, t) => <><path d="M7 9l6 2 6-2 6 2v12l-6-2-6 2-6-2z" fill={g} /><path d="M13 11v12M19 9v12" stroke={t} strokeWidth="1.5" /></>,
  shield: (g, t) => <><path d="M16 6l9 3.5V16c0 5.5-4 9-9 11-5-2-9-5.5-9-11V9.5z" fill={g} /><path d="M12 16.5l3 3 5-6" fill="none" stroke={t} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></>,
  gem: (g, t) => <><path d="M10 9h12l5 6-11 11L5 15z" fill={g} /><path d="M5 15h22" stroke={t} strokeWidth="1.5" /></>,
  book: (g, t) => <><rect x="8" y="7" width="16" height="18" rx="2" fill={g} /><rect x="8" y="7" width="4" height="18" rx="1" fill={g} opacity=".6" /><path d="M15 13h6M15 17h6" stroke={t} strokeWidth="1.6" strokeLinecap="round" /></>,
  compass: g => <><circle cx="16" cy="16" r="10" fill="none" stroke={g} strokeWidth="2.5" /><path d="M20.5 11.5l-2 6.5-6.5 2 2-6.5z" fill={g} /></>,
  lock: (g, t) => <><rect x="9" y="15" width="14" height="11" rx="3" fill={g} /><path d="M12 15v-3a4 4 0 018 0v3" fill="none" stroke={g} strokeWidth="3" /><circle cx="16" cy="20.5" r="1.8" fill={t} /></>,
  bulb: g => <><circle cx="16" cy="13" r="7" fill={g} /><rect x="13" y="21" width="6" height="5" rx="1.5" fill={g} opacity=".65" /></>,
  star: g => <path d="M16 5.5l3.1 6.8 7.4.8-5.5 5 1.6 7.3-6.6-3.8-6.6 3.8 1.6-7.3-5.5-5 7.4-.8z" fill={g} />,
  flask: (g, t) => <><path d="M13 6h6v7l5 10a2 2 0 01-1.8 3H9.8A2 2 0 018 23l5-10z" fill={g} /><path d="M10.5 21h11" stroke={t} strokeWidth="1.8" /></>,
  puzzle: g => <><rect x="8" y="10" width="14" height="14" rx="3" fill={g} /><circle cx="15" cy="9" r="3" fill={g} /><circle cx="23" cy="17" r="3" fill={g} /></>,
}

export function resolveAchievementIcon(icon: string | undefined | null, index = 0): AchievementIconKey {
  if (icon && (ACHIEVEMENT_ICON_KEYS as readonly string[]).includes(icon)) return icon as AchievementIconKey
  return ACHIEVEMENT_ICON_KEYS[Math.abs(index) % ACHIEVEMENT_ICON_KEYS.length]
}

export default function AchievementIcon({ icon, index = 0, size = 32, locked = false, title, className }: {
  icon?: string | null
  index?: number
  size?: number
  locked?: boolean
  title?: string
  className?: string
}) {
  const key = resolveAchievementIcon(icon, index)
  const tile = locked ? '#e2e8f0' : TILE[key]
  const glyph = locked ? '#94a3b8' : '#ffffff'
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={title || key} className={className}>
      {title && <title>{title}</title>}
      <rect width="32" height="32" rx="9" fill={tile} />
      {GLYPH[key](glyph, tile)}
    </svg>
  )
}
