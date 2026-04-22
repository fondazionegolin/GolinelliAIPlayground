import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { calendarApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'

const DAYS_ABR = ['dom','lun','mar','mer','gio','ven','sab']
const MONTHS_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
const MONTHS_ABR = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic']
const WEEKDAYS_SHORT = ['L','M','M','G','V','S','D']

export function NavbarCalendarClock({ sessionId, accentColor }: { sessionId?: string; accentColor: string }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [viewMonth, setViewMonth] = useState(() => new Date())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0)
  const toYMD = (d: Date) => d.toISOString().slice(0, 10)

  const { data: events = [] } = useQuery({
    queryKey: ['navbar-cal-events', sessionId, toYMD(monthStart), toYMD(monthEnd)],
    queryFn: async () => {
      if (!sessionId) return []
      const res = await calendarApi.listEvents(sessionId, toYMD(monthStart), toYMD(monthEnd))
      return res.data as Array<{ id: string; title: string; event_date: string; event_time?: string; color: string }>
    },
    enabled: !!sessionId && open,
    staleTime: 60_000,
  })

  const eventDates = new Set(events.map(e => e.event_date))
  const todayStr = toYMD(now)
  const upcomingEvents = events
    .filter(e => e.event_date >= todayStr)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .slice(0, 6)

  const daysInMonth = monthEnd.getDate()
  const firstDow = (monthStart.getDay() + 6) % 7 // Monday = 0

  const hh = now.getHours().toString().padStart(2, '0')
  const mm = now.getMinutes().toString().padStart(2, '0')

  return (
    <div ref={ref} className="relative hidden lg:flex">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 h-auto py-1.5 px-3 rounded-xl bg-white/88 hover:bg-white transition-colors shadow-sm cursor-pointer"
      >
        <div className="text-left">
          <div className="text-[13px] font-semibold text-slate-700 tabular-nums leading-tight">{hh}:{mm}</div>
          <div className="text-[9px] text-slate-400 leading-tight">
            {DAYS_ABR[now.getDay()]} {now.getDate()} {MONTHS_ABR[now.getMonth()]}
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right z-50">
          {/* Month nav */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <button
              onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-slate-400" />
            </button>
            <span className="text-sm font-semibold text-slate-700">
              {MONTHS_IT[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 px-3 pb-1">
            {WEEKDAYS_SHORT.map((d, i) => (
              <div key={i} className="text-center text-[9px] font-semibold text-slate-400">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const dayStr = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isToday = dayStr === todayStr
              const hasEvent = eventDates.has(dayStr)
              return (
                <div key={dayStr} className="relative flex flex-col items-center">
                  <span
                    className={`text-xs w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                      isToday ? 'font-bold text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    style={isToday ? { backgroundColor: accentColor } : {}}
                  >
                    {day}
                  </span>
                  {hasEvent && (
                    <span className="absolute bottom-0 w-1 h-1 rounded-full" style={{ backgroundColor: accentColor }} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Upcoming events */}
          {sessionId ? (
            upcomingEvents.length > 0 ? (
              <>
                <div className="border-t border-slate-100 px-4 pt-2.5 pb-1">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Prossimi eventi</div>
                </div>
                <div className="px-2 pb-3 space-y-0.5">
                  {upcomingEvents.map(evt => (
                    <div key={evt.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition-colors">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: evt.color || accentColor }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-700 truncate">{evt.title}</div>
                        <div className="text-[10px] text-slate-400">
                          {evt.event_date}{evt.event_time ? ` · ${evt.event_time.slice(0, 5)}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 text-center">
                Nessun evento in programma
              </div>
            )
          ) : (
            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 text-center">
              Seleziona una sessione per vedere gli eventi
            </div>
          )}
        </div>
      )}
    </div>
  )
}
