import { useEffect, useState } from 'react'

interface ClockConfig {
  style?: 'digital' | 'analog'
  show_seconds?: boolean
  show_date?: boolean
}

export default function ClockWidget({ config }: { config: ClockConfig }) {
  const [now, setNow] = useState(new Date())
  const showSeconds = config.show_seconds ?? true
  const showDate = config.show_date ?? true

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const pad = (n: number) => String(n).padStart(2, '0')
  const timeStr = showSeconds
    ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    : `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const dateStr = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="h-full flex flex-col items-center justify-center select-none gap-1 p-3">
      <div className="font-mono text-4xl font-light text-white/90 tracking-widest tabular-nums">
        {timeStr}
      </div>
      {showDate && (
        <div className="text-xs text-white/50 capitalize mt-1">{dateStr}</div>
      )}
    </div>
  )
}
