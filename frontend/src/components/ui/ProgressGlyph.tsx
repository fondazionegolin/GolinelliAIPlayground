type GlyphProps = {
  /** 0..1 */
  value: number
  color: string
  size?: number
}

/**
 * Navbar status glyphs (credits ring, background-job pie): thin solid strokes in the status color
 * over a translucent track of the same color.
 */
export function ProgressRing({ value, color, size = 20 }: GlyphProps) {
  const radius = 10.2
  const circumference = 2 * Math.PI * radius
  const progress = Math.max(0, Math.min(1, value))
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r={radius} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth="3.4" />
      <circle
        cx="14" cy="14" r={radius} fill="none" stroke={color} strokeOpacity={0.92} strokeWidth="3.4" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 14 14)" className="transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  )
}

export function ProgressPie({ value, color, size = 22 }: GlyphProps) {
  const r = 7.4
  const angle = Math.max(0.001, Math.min(0.999, value)) * 2 * Math.PI
  const x = 12 + r * Math.sin(angle)
  const y = 12 - r * Math.cos(angle)
  const largeArc = angle > Math.PI ? 1 : 0
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke={color} strokeOpacity={0.9} strokeWidth="2.2" />
      <circle cx="12" cy="12" r={r} fill={color} fillOpacity={0.14} />
      <path d={`M 12 12 L 12 ${12 - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`} fill={color} fillOpacity={0.85} />
    </svg>
  )
}
