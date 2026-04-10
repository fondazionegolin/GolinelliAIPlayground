import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CalendarConfig {
  notes?: Record<string, string>
}

interface CalendarWidgetProps {
  config: CalendarConfig
  onConfigChange: (config: CalendarConfig) => void
}

const DAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

export default function CalendarWidget({ config, onConfigChange }: CalendarWidgetProps) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const notes = config.notes ?? {}

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDow = (firstDay.getDay() + 6) % 7
  const totalCells = startDow + lastDay.getDate()
  const rows = Math.ceil(totalCells / 7)

  const fmtKey = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const isToday = (d: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === d

  const handleDayClick = (d: number) => {
    const key = fmtKey(d)
    const note = notes[key] ?? ''
    const newNote = window.prompt(`Nota per il ${d}/${month + 1}/${year}:`, note)
    if (newNote === null) return
    const updated = { ...notes }
    if (newNote.trim()) updated[key] = newNote.trim()
    else delete updated[key]
    onConfigChange({ ...config, notes: updated })
  }

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: lastDay.getDate() }, (_, i) => i + 1),
    ...Array((rows * 7) - totalCells).fill(null),
  ]

  return (
    <div className="h-full flex flex-col p-3 gap-2">
      <div className="flex items-center justify-between">
        <button
          className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5 text-white/50" />
        </button>
        <span className="text-sm font-semibold text-white/70">
          {MONTHS[month]} {year}
        </span>
        <button
          className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
        >
          <ChevronRight className="h-3.5 w-3.5 text-white/50" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {DAYS.map((d, i) => (
          <div key={i} className="text-center text-[11px] font-semibold text-white/30 py-0.5">{d}</div>
        ))}
        {cells.map((day, i) => (
          <button
            key={i}
            disabled={!day}
            onClick={() => day && handleDayClick(day)}
            className={`relative text-center text-sm py-1 rounded-lg transition-colors
              ${!day ? '' : 'hover:bg-white/10'}
              ${day && isToday(day) ? 'bg-white/20 text-white font-bold' : 'text-white/60'}
            `}
          >
            {day}
            {day && notes[fmtKey(day)] && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-cyan-400" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
