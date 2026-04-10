import { useEffect, useState } from 'react'

interface ClockConfig {
  style?: 'digital' | 'analog'
  show_seconds?: boolean
  show_date?: boolean
}

interface ClockWidgetProps {
  config: ClockConfig
  onConfigChange?: (config: ClockConfig) => void
}

export default function ClockWidget({ config, onConfigChange }: ClockWidgetProps) {
  const [now, setNow] = useState(new Date())
  const [mode, setMode] = useState<'digital' | 'analog'>(config.style ?? 'digital')
  const showSeconds = config.show_seconds ?? true
  const showDate = config.show_date ?? true

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  function toggleMode() {
    const next = mode === 'digital' ? 'analog' : 'digital'
    setMode(next)
    onConfigChange?.({ ...config, style: next })
  }

  // ── Digital ───────────────────────────────────────────────────────────────
  const pad = (n: number) => String(n).padStart(2, '0')
  const timeStr = showSeconds
    ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    : `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const dateStr = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

  // ── Analog ────────────────────────────────────────────────────────────────
  const sec = now.getSeconds()
  const min = now.getMinutes()
  const hr = now.getHours() % 12
  const secAngle = (sec / 60) * 360 - 90
  const minAngle = ((min + sec / 60) / 60) * 360 - 90
  const hrAngle = ((hr + min / 60) / 12) * 360 - 90
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const hx = (angle: number, len: number) => 50 + len * Math.cos(toRad(angle))
  const hy = (angle: number, len: number) => 50 + len * Math.sin(toRad(angle))

  return (
    <div className="h-full flex flex-col items-center justify-center select-none p-3 gap-1 relative group/clock">
      {/* Toggle button — visible on hover */}
      <button
        onClick={toggleMode}
        className="absolute top-2 right-2 w-6 h-6 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center opacity-0 group-hover/clock:opacity-100 transition-opacity text-white/40 hover:text-white/70 text-xs font-mono"
        title={mode === 'digital' ? 'Passa ad analogico' : 'Passa a digitale'}
      >
        {mode === 'digital' ? '◔' : '0:0'}
      </button>

      {mode === 'digital' ? (
        <>
          <div className="font-mono text-4xl font-light text-white/90 tracking-widest tabular-nums">
            {timeStr}
          </div>
          {showDate && (
            <div className="text-sm text-white/50 capitalize mt-1">{dateStr}</div>
          )}
        </>
      ) : (
        <>
          <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0">
            {/* Outer ring */}
            <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
            {/* Hour / minute markers */}
            {Array.from({ length: 60 }).map((_, i) => {
              const isHour = i % 5 === 0
              const angle = (i / 60) * 360 - 90
              const r1 = isHour ? 37 : 40
              const r2 = 43
              return (
                <line key={i}
                  x1={50 + r1 * Math.cos(toRad(angle))} y1={50 + r1 * Math.sin(toRad(angle))}
                  x2={50 + r2 * Math.cos(toRad(angle))} y2={50 + r2 * Math.sin(toRad(angle))}
                  stroke={isHour ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'}
                  strokeWidth={isHour ? 1.5 : 0.8}
                  strokeLinecap="round"
                />
              )
            })}
            {/* Hour hand */}
            <line x1={50} y1={50} x2={hx(hrAngle, 25)} y2={hy(hrAngle, 25)}
              stroke="rgba(255,255,255,0.9)" strokeWidth="3" strokeLinecap="round" />
            {/* Minute hand */}
            <line x1={50} y1={50} x2={hx(minAngle, 34)} y2={hy(minAngle, 34)}
              stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
            {/* Second hand */}
            {showSeconds && (
              <>
                <line x1={hx(secAngle + 180, 8)} y1={hy(secAngle + 180, 8)}
                  x2={hx(secAngle, 38)} y2={hy(secAngle, 38)}
                  stroke="#e85c8d" strokeWidth="1" strokeLinecap="round" />
                <circle cx={50} cy={50} r="2" fill="#e85c8d" />
              </>
            )}
            {!showSeconds && <circle cx="50" cy="50" r="2.5" fill="rgba(255,255,255,0.8)" />}
          </svg>
          {showDate && (
            <div className="text-xs text-white/40 capitalize">{dateStr}</div>
          )}
        </>
      )}
    </div>
  )
}
