import { useState, useRef, useEffect, useMemo, type CSSProperties } from 'react'
import { Bell, ChevronLeft, ChevronRight, Columns3, LayoutGrid, Plus, Video } from '@/components/icons'
import { tl } from '@/i18n/tl'
import { useAuthStore } from '@/stores/auth'
import { CalendarEventDialog, type CalendarDraft } from '@/components/calendar/CalendarEventDialog'
import { CalendarExpandedModal } from '@/components/calendar/CalendarExpandedModal'
import { CalendarReminderPopup } from '@/components/calendar/CalendarReminderPopup'
import {
  MONTHS, OPEN_CALENDAR_EVENT, addDays, dayKey, eventsOnDay, formatWhen, startOfDay, useCalendarEvents,
  type CalendarItem, type CalendarView,
} from '@/components/calendar/calendarUtils'

const WEEKDAYS_SHORT = ['L', 'M', 'M', 'G', 'V', 'S', 'D']

export function NavbarCalendarClock({
  sessionId,
  accentColor,
  inNavCluster = false,
  role = 'teacher',
}: {
  sessionId?: string
  accentColor: string
  inNavCluster?: boolean
  role?: 'teacher' | 'student'
}) {
  const userId = useAuthStore((state) => state.user?.id)
  const studentId = useAuthStore((state) => state.studentSession?.student_id)
  const viewerId = role === 'teacher' ? userId : studentId
  const canCreate = role === 'teacher'
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [viewMonth, setViewMonth] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<{ view: CalendarView; anchor: Date } | null>(null)
  const [dialog, setDialog] = useState<{ event?: CalendarItem; draft?: CalendarDraft } | null>(null)
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

  // The chat calendar agent opens the enlarged calendar on the first day it touched.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ date: string | null; view?: CalendarView }>).detail || { date: null }
      setOpen(false)
      setExpanded({ view: detail.view || 'week', anchor: detail.date ? new Date(detail.date) : new Date() })
    }
    window.addEventListener(OPEN_CALENDAR_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CALENDAR_EVENT, onOpen)
  }, [])

  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0)
  const today = startOfDay(now)
  // The month on screen plus the next month from today, so "upcoming" never runs dry at month end.
  const range = useMemo(() => {
    const from = monthStart < today ? monthStart : today
    const monthTo = addDays(monthEnd, 1)
    const upcomingTo = addDays(today, 31)
    return { from, to: monthTo > upcomingTo ? monthTo : upcomingTo }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart.getTime(), today.getTime()])

  const { data: items = [] } = useCalendarEvents(range.from, range.to, sessionId, open)

  // ── "New event" badge: events shared with me (not mine) created/changed since I last opened the calendar.
  const seenKey = viewerId ? `calendar-last-seen:${role}:${viewerId}` : null
  const [lastSeen, setLastSeen] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!seenKey) return
    try {
      const stored = Number(localStorage.getItem(seenKey))
      if (stored) setLastSeen(stored)
      else localStorage.setItem(seenKey, String(Date.now()))
    } catch { /* storage unavailable: badge only for this tab */ }
  }, [seenKey])
  const watchFrom = useMemo(() => addDays(today, -1), [today.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const watchTo = useMemo(() => addDays(today, 90), [today.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data: watched = [] } = useCalendarEvents(watchFrom, watchTo, undefined, !!viewerId)
  const unseen = useMemo(() => watched.filter((e) =>
    e.source === 'event'
    && e.owner_teacher_id !== userId
    && new Date(e.updated_at || e.created_at || 0).getTime() > lastSeen,
  ), [watched, userId, lastSeen])
  // Ids highlighted as "new" while the popover is open; captured when it opens.
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const markSeen = () => {
    const nowTs = Date.now()
    setFreshIds(new Set(unseen.map((e) => e.id)))
    setLastSeen(nowTs)
    try { if (seenKey) localStorage.setItem(seenKey, String(nowTs)) } catch { /* noop */ }
  }
  const freshDays = useMemo(() => {
    const set = new Set<string>()
    for (const e of watched) if (freshIds.has(e.id)) set.add(dayKey(e.start))
    return set
  }, [watched, freshIds])

  const eventDays = useMemo(() => {
    const map = new Map<string, string>()
    for (let i = 1; i <= monthEnd.getDate(); i += 1) {
      const day = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i)
      const first = eventsOnDay(items, day)[0]
      if (first) map.set(dayKey(day), first.color || accentColor)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, viewMonth.getFullYear(), viewMonth.getMonth(), accentColor])

  const todayStr = dayKey(now)
  const listed = selectedDay
    ? eventsOnDay(items, new Date(`${selectedDay}T00:00:00`))
    : items.filter((e) => e.end >= now || (e.all_day && dayKey(e.end) >= todayStr)).sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, 6)

  const daysInMonth = monthEnd.getDate()
  const firstDow = (monthStart.getDay() + 6) % 7 // Monday = 0

  const hh = now.getHours().toString().padStart(2, '0')
  const mm = now.getMinutes().toString().padStart(2, '0')

  const createOn = (day: Date) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0)
    setOpen(false)
    setDialog({ draft: { start, end: new Date(start.getTime() + 3600_000), allDay: false } })
  }

  const openExpanded = (view: CalendarView) => {
    setOpen(false)
    setExpanded({ view, anchor: selectedDay ? new Date(`${selectedDay}T00:00:00`) : view === 'month' ? viewMonth : now })
  }

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={() => {
          if (!open) {
            if (unseen.length) {
              // Jump to the month of the first new event so its day is visible.
              const first = [...unseen].sort((a, b) => a.start.getTime() - b.start.getTime())[0]
              setViewMonth(new Date(first.start.getFullYear(), first.start.getMonth(), 1))
            }
            markSeen()
          }
          setOpen(v => !v)
        }}
        className={`relative ${inNavCluster ? 'navbar-inline-control h-9' : 'navbar-widget-control navbar-widget-control-inset h-auto'} flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 sm:px-3 transition-colors`}
        style={{ '--btn-tone': accentColor } as CSSProperties}
        aria-label={unseen.length ? tl("Calendario: {0} nuovi eventi", unseen.length) : tl("Calendario")}
        title={unseen.length ? tl("{0} nuovi eventi in calendario", unseen.length) : undefined}
      >
        <span
          className="flex h-[22px] min-w-[22px] items-center justify-center rounded-md px-1 text-[11px] font-bold leading-none text-white tabular-nums"
          style={{ backgroundColor: 'var(--ds-cal-today)' }}
          title={now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          aria-hidden="true"
        >
          {now.getDate()}
        </span>
        <div className="text-[13px] font-semibold leading-tight text-slate-700 tabular-nums">{hh}:{mm}</div>
        {unseen.length > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-bold text-white shadow-[var(--ds-shadow-1)]"
            style={{ backgroundColor: accentColor }}
          >
            <Bell className="h-2.5 w-2.5" />{unseen.length > 9 ? '9+' : unseen.length}
          </span>
        )}
      </button>

      {open && (
        <div className="ds-popover nav-cluster-unroll absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-[var(--ds-radius-panel)] max-md:fixed max-md:right-3 max-md:top-[4.25rem] max-md:mt-0">
          {/* Month nav + enlarge */}
          <div className="flex items-center gap-1 px-3 pt-3 pb-2">
            <button
              onClick={() => { setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1)); setSelectedDay(null) }}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label={tl("Mese precedente")}
            >
              <ChevronLeft className="h-4 w-4 text-slate-400" />
            </button>
            <span className="flex-1 text-center text-sm font-semibold text-slate-700">
              {MONTHS()[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              onClick={() => { setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1)); setSelectedDay(null) }}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label={tl("Mese successivo")}
            >
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-slate-200" />
            <button onClick={() => openExpanded('week')} className="p-1 rounded-lg hover:bg-slate-100 transition-colors" title={tl("Apri vista settimanale")} aria-label={tl("Apri vista settimanale")}>
              <Columns3 className="h-4 w-4 text-slate-500" />
            </button>
            <button onClick={() => openExpanded('month')} className="p-1 rounded-lg hover:bg-slate-100 transition-colors" title={tl("Apri vista mensile")} aria-label={tl("Apri vista mensile")}>
              <LayoutGrid className="h-4 w-4 text-slate-500" />
            </button>
            <button onClick={() => { setOpen(false); window.open('/call', '_blank', 'noopener') }} className="p-1 rounded-lg hover:bg-slate-100 transition-colors" title={tl("Videochiamate: entra con un codice o gestisci i link")} aria-label={tl("Videochiamate")}>
              <Video className="h-4 w-4 text-slate-500" />
            </button>
            {canCreate && (
              <button onClick={() => createOn(selectedDay ? new Date(`${selectedDay}T00:00:00`) : now)} className="p-1 rounded-lg hover:bg-slate-100 transition-colors" title={tl("Nuovo evento")} aria-label={tl("Nuovo evento")}>
                <Plus className="h-4 w-4" style={{ color: accentColor }} />
              </button>
            )}
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 px-3 pb-1">
            {WEEKDAYS_SHORT.map((d, i) => (
              <div key={i} className="text-center text-[9px] font-semibold text-slate-400">{d}</div>
            ))}
          </div>

          {/* Days grid: click selects the day, double click creates an event on it */}
          <div className="grid grid-cols-7 px-3 pb-2 gap-y-0.5">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)
              const dayStr = dayKey(day)
              const isToday = dayStr === todayStr
              const isSelected = dayStr === selectedDay
              const dot = eventDays.get(dayStr)
              const isFresh = freshDays.has(dayStr)
              return (
                <button
                  key={dayStr}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : dayStr)}
                  onDoubleClick={() => { if (canCreate) createOn(day) }}
                  className="relative flex select-none flex-col items-center"
                  aria-label={day.toLocaleDateString()}
                  aria-pressed={isSelected}
                >
                  <span
                    className={`text-xs w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                      isToday ? 'font-bold text-white' : isSelected ? 'ds-selected font-semibold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    style={isToday ? { backgroundColor: 'var(--ds-cal-today)' } : {}}
                  >
                    {i + 1}
                  </span>
                  {dot && (
                    <span className="absolute bottom-0 w-1 h-1 rounded-full" style={{ backgroundColor: dot }} />
                  )}
                  {isFresh && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-white" style={{ backgroundColor: accentColor }} title={tl("Nuovo evento")}>
                      <Bell className="h-2 w-2" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {canCreate && (
            <p className="px-4 pb-2 text-center text-[10px] text-[var(--text-secondary)]">{tl("Doppio clic su un giorno per creare un evento")}</p>
          )}

          {/* Selected day / upcoming events */}
          <div className="border-t border-slate-100 px-4 pt-2.5 pb-1 flex items-center justify-between">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              {selectedDay ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : tl("Prossimi eventi")}
            </div>
            {selectedDay && (
              <button onClick={() => setSelectedDay(null)} className="text-[10px] font-semibold text-[var(--text-secondary)] hover:underline">{tl("Prossimi")}</button>
            )}
          </div>
          {listed.length > 0 ? (
            <div className="max-h-56 overflow-y-auto px-2 pb-3 space-y-0.5">
              {listed.map(evt => (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => { setOpen(false); setDialog({ event: evt }) }}
                  className="flex w-full items-center gap-2.5 px-2 py-1.5 rounded-xl text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: evt.color || accentColor }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-700 truncate">{evt.title}</span>
                      {evt.voice_call && <Video className={`h-3 w-3 flex-shrink-0 ${evt.voice_call.live ? 'text-emerald-600' : 'text-slate-400'}`} aria-label={tl("Con videochiamata")} />}
                      {freshIds.has(evt.id) && <span className="flex-shrink-0 rounded-full px-1.5 text-[9px] font-bold uppercase text-white" style={{ backgroundColor: accentColor }}>{tl("Nuovo")}</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{formatWhen(evt)}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 pb-3 pt-1 text-xs text-slate-400 text-center">
              {selectedDay && canCreate ? (
                <button onClick={() => createOn(new Date(`${selectedDay}T00:00:00`))} className="font-semibold hover:underline" style={{ color: accentColor }}>
                  {tl("+ Crea un evento in questo giorno")}
                </button>
              ) : tl("Nessun evento in programma")}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <CalendarExpandedModal
          open
          onOpenChange={(value) => { if (!value) setExpanded(null) }}
          view={expanded.view}
          onViewChange={(view) => setExpanded((prev) => prev && { ...prev, view })}
          anchor={expanded.anchor}
          onAnchorChange={(anchor) => setExpanded((prev) => prev && { ...prev, anchor })}
          sessionId={sessionId}
          accentColor={accentColor}
          canCreate={canCreate}
          onCreate={(draft) => setDialog({ draft })}
          onOpenEvent={(event) => setDialog({ event })}
        />
      )}

      <CalendarEventDialog
        open={!!dialog}
        onOpenChange={(value) => { if (!value) setDialog(null) }}
        event={dialog?.event ?? null}
        draft={dialog?.draft ?? null}
        canCreate={canCreate}
        defaultSessionId={sessionId}
      />

      <CalendarReminderPopup role={role} userId={userId} />
    </div>
  )
}
