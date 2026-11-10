import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Clock, Plus } from '@/components/icons'
import { Button, Dialog, DialogContent, DialogTitle, IconButton, Select } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { calendarApi } from '@/lib/api'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { tl } from '@/i18n/tl'
import {
  MONTHS, WEEKDAYS_SHORT, addDays, calendarQueryKey, dayKey, eventsOnDay, hhmm, monthGridStart, sameDay, startOfDay,
  startOfMonth, startOfWeek, useCalendarEvents, type CalendarItem, type CalendarView,
} from './calendarUtils'
import type { CalendarDraft } from './CalendarEventDialog'

const HOUR_PX = 48
const SNAP_MIN = 15
const WORK_HOURS_KEY = 'calendar-work-hours'

type WorkHours = { start: number; end: number }

const readWorkHours = (): WorkHours => {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORK_HOURS_KEY) || '')
    if (Number.isInteger(parsed.start) && Number.isInteger(parsed.end) && parsed.start >= 0 && parsed.end <= 24 && parsed.end > parsed.start) return parsed
  } catch { /* default below */ }
  return { start: 7, end: 20 }
}

/** Tint of the accent over a day tile, used for "today". */
const todayTint = (accent: string, pct = 10) => `color-mix(in srgb, ${accent} ${pct}%, var(--ds-cal-day))`

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  anchor: Date
  onAnchorChange: (date: Date) => void
  sessionId?: string
  accentColor: string
  canCreate: boolean
  onCreate: (draft: CalendarDraft) => void
  onOpenEvent: (event: CalendarItem) => void
}

export function CalendarExpandedModal({
  open, onOpenChange, view, onViewChange, anchor, onAnchorChange, sessionId, accentColor, canCreate, onCreate, onOpenEvent,
}: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => new Date())
  const [workHours, setWorkHours] = useState<WorkHours>(readWorkHours)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [open])

  const updateWorkHours = (next: WorkHours) => {
    if (next.end <= next.start) return
    setWorkHours(next)
    try { localStorage.setItem(WORK_HOURS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  const range = useMemo(() => {
    if (view === 'week') {
      const from = startOfWeek(anchor)
      return { from, to: addDays(from, 7) }
    }
    const from = monthGridStart(anchor)
    return { from, to: addDays(from, 42) }
  }, [view, anchor])

  const { data: items = [] } = useCalendarEvents(range.from, range.to, sessionId, open)

  const move = useMutation({
    // `resize`: the user stretched the block, so the event gets an explicit end even if it had none.
    mutationFn: ({ item, start, end, resize }: { item: CalendarItem; start: Date; end: Date; resize?: boolean }) =>
      calendarApi.updateShared(item.id, { starts_at: start.toISOString(), ends_at: item.ends_at || resize ? end.toISOString() : null }),
    onMutate: ({ item, start, end, resize }) => {
      // Optimistic: the block lands where it was dropped, the refetch confirms it.
      queryClient.setQueriesData<CalendarItem[]>({ queryKey: calendarQueryKey }, (old) => old?.map((i) => i.id === item.id
        ? { ...i, start, end, starts_at: start.toISOString(), ends_at: i.ends_at || resize ? end.toISOString() : null }
        : i))
    },
    onError: () => toast({ title: tl("Impossibile modificare l'evento"), variant: 'destructive' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarQueryKey }),
  })
  const moveEvent = (item: CalendarItem, start: Date) => {
    const end = new Date(start.getTime() + (item.end.getTime() - item.start.getTime()))
    if (start.getTime() !== item.start.getTime()) move.mutate({ item, start, end })
  }

  /** New end time from stretching the block's bottom edge (the start stays where it is). */
  const resizeEvent = (item: CalendarItem, end: Date) => {
    if (end.getTime() > item.start.getTime() && end.getTime() !== item.end.getTime()) move.mutate({ item, start: item.start, end, resize: true })
  }

  const step = (dir: 1 | -1) => {
    if (view === 'week') onAnchorChange(addDays(anchor, 7 * dir))
    else onAnchorChange(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
  }

  const heading = view === 'month'
    ? `${MONTHS()[anchor.getMonth()]} ${anchor.getFullYear()}`
    : (() => {
      const from = range.from
      const to = addDays(range.from, 6)
      return from.getMonth() === to.getMonth()
        ? `${from.getDate()} – ${to.getDate()} ${MONTHS()[from.getMonth()]} ${from.getFullYear()}`
        : `${from.getDate()} ${MONTHS()[from.getMonth()].slice(0, 3)} – ${to.getDate()} ${MONTHS()[to.getMonth()].slice(0, 3)} ${to.getFullYear()}`
    })()

  const hourOptions = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="flex flex-col gap-3 overflow-hidden p-3 sm:p-5" aria-describedby={undefined}>
        <div className="flex flex-wrap items-center gap-2 pr-10">
          <DialogTitle className="mr-2 min-w-0 truncate text-lg sm:text-xl">{heading}</DialogTitle>
          <div className="flex items-center gap-1">
            <IconButton tone="neutral" surface="ghost" size="sm" aria-label={tl("Precedente")} onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></IconButton>
            <Button tone="neutral" surface="ghost" density="compact" onClick={() => onAnchorChange(new Date())}>{tl("Oggi")}</Button>
            <IconButton tone="neutral" surface="ghost" size="sm" aria-label={tl("Successivo")} onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></IconButton>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {view === 'week' && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]" title={tl("Orario visualizzato")}>
                <Clock className="h-4 w-4" />
                <Select density="compact" className="w-[5.5rem]" aria-label={tl("Inizio orario visualizzato")} value={workHours.start}
                  onChange={(e) => updateWorkHours({ ...workHours, start: Number(e.target.value) })}>
                  {hourOptions(0, 23).map((h) => <option key={h} value={h} disabled={h >= workHours.end}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
                <span>–</span>
                <Select density="compact" className="w-[5.5rem]" aria-label={tl("Fine orario visualizzato")} value={workHours.end}
                  onChange={(e) => updateWorkHours({ ...workHours, end: Number(e.target.value) })}>
                  {hourOptions(1, 24).map((h) => <option key={h} value={h} disabled={h <= workHours.start}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
              </div>
            )}
            <div className="flex items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
              {([['week', tl("Settimana")], ['month', tl("Mese")]] as const).map(([value, label]) => (
                <Button
                  key={value}
                  tone="neutral"
                  surface="ghost"
                  density="compact"
                  aria-pressed={view === value}
                  className={view === value ? 'ds-selected' : ''}
                  onClick={() => onViewChange(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {canCreate && (
              <Button tone="accent" surface="solid" density="compact" onClick={() => {
                const inThisWeek = sameDay(startOfWeek(anchor), startOfWeek(now))
                const base = view === 'week' && !inThisWeek
                  ? new Date(startOfWeek(anchor).getFullYear(), startOfWeek(anchor).getMonth(), startOfWeek(anchor).getDate(), Math.max(workHours.start, 9))
                  : (() => { const d = new Date(now); d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0); return d })()
                onCreate({ start: base, end: new Date(base.getTime() + 3600_000), allDay: false })
              }}>
                <Plus className="mr-1 h-4 w-4" />{tl("Evento")}
              </Button>
            )}
          </div>
        </div>
        <p className="-mt-1 text-[11px] text-[var(--text-secondary)]">
          {view === 'week'
            ? canCreate ? tl("Clicca o trascina su una fascia oraria per creare un evento; trascina un evento per spostarlo (passi di 15 minuti).") : tl("Clicca un evento per vederne i dettagli.")
            : canCreate ? tl("Doppio clic su un giorno per creare un evento; trascina un evento su un altro giorno per spostarlo.") : tl("Clicca un evento per vederne i dettagli.")}
        </p>

        <div className="min-h-0 flex-1">
          {view === 'week'
            ? <WeekView from={range.from} items={items} now={now} accentColor={accentColor} canCreate={canCreate} workHours={workHours}
                onCreate={onCreate} onOpenEvent={onOpenEvent} onMove={moveEvent} onResize={resizeEvent} />
            : <MonthView anchor={anchor} from={range.from} items={items} now={now} accentColor={accentColor} canCreate={canCreate} onCreate={onCreate} onOpenEvent={onOpenEvent}
                onMove={moveEvent} onOpenDay={(day) => { onAnchorChange(day); onViewChange('week') }} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Month ───────────────────────────────────────────────────────────────────

function MonthView({ anchor, from, items, now, accentColor, canCreate, onCreate, onOpenEvent, onOpenDay, onMove }: {
  anchor: Date; from: Date; items: CalendarItem[]; now: Date; accentColor: string; canCreate: boolean
  onCreate: (draft: CalendarDraft) => void; onOpenEvent: (event: CalendarItem) => void; onOpenDay: (day: Date) => void
  onMove: (item: CalendarItem, start: Date) => void
}) {
  const month = startOfMonth(anchor).getMonth()
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  return (
    <div className="flex h-full min-h-[480px] flex-col overflow-x-auto">
      <div className="flex min-w-[600px] flex-1 flex-col gap-[3px] rounded-2xl bg-[var(--ds-cal-gutter)] p-[3px]">
        <div className="grid grid-cols-7 gap-[3px]">
          {WEEKDAYS_SHORT().map((d, i) => {
            const isTodayCol = (now.getDay() + 6) % 7 === i && days.some((day) => sameDay(day, now))
            return (
              <div key={d} className="rounded-t-xl bg-[var(--ds-cal-day-muted)] px-2 py-1.5 text-[11px] font-bold uppercase"
                style={{ color: isTodayCol ? 'var(--ds-cal-today)' : 'var(--text-secondary)' }}>{d}</div>
            )
          })}
        </div>
        <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-[3px]">
          {days.map((day) => {
            const key = dayKey(day)
            const dayItems = eventsOnDay(items, day)
            const isToday = sameDay(day, now)
            const inMonth = day.getMonth() === month
            const isDrop = dropDay === key && dragId
            return (
              <div
                key={key}
                onDoubleClick={() => {
                  if (!canCreate) return
                  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0)
                  onCreate({ start, end: new Date(start.getTime() + 3600_000), allDay: false })
                }}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropDay(key) } }}
                onDragLeave={() => setDropDay((cur) => (cur === key ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault()
                  const item = dragId ? byId.get(dragId) : undefined
                  setDragId(null); setDropDay(null)
                  if (!item) return
                  const shift = Math.round((startOfDay(day).getTime() - startOfDay(item.start).getTime()) / 86_400_000)
                  if (shift) onMove(item, addDays(item.start, shift))
                }}
                className={`relative flex min-h-0 select-none flex-col gap-0.5 overflow-hidden rounded-lg p-1 ${canCreate ? 'cursor-cell' : ''} ${inMonth ? '' : 'opacity-60'}`}
                style={{
                  background: isToday ? todayTint(accentColor, 12) : inMonth ? 'var(--ds-cal-day)' : 'var(--ds-cal-day-muted)',
                  boxShadow: isDrop ? `inset 0 0 0 2px ${accentColor}` : undefined,
                }}
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    title={tl("Apri la settimana")}
                    className={`flex h-6 min-w-6 flex-shrink-0 items-center justify-center rounded-full px-1 text-xs ${isToday ? 'font-bold text-white' : 'font-semibold text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}
                    style={isToday ? { backgroundColor: 'var(--ds-cal-today)' } : undefined}
                  >
                    {day.getDate()}
                  </button>
                  {isToday && <span className="text-[10px] font-bold uppercase text-[var(--ds-cal-today)]">{tl("Oggi")}</span>}
                </div>
                {dayItems.slice(0, 3).map((item) => (
                  <button
                    key={`${item.id}-${key}`}
                    type="button"
                    draggable={item.can_edit}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); setDragId(item.id) }}
                    onDragEnd={() => { setDragId(null); setDropDay(null) }}
                    onClick={(e) => { e.stopPropagation(); onOpenEvent(item) }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-[var(--text-primary)] hover:brightness-110 ${item.can_edit ? 'cursor-grab active:cursor-grabbing' : ''} ${dragId === item.id ? 'opacity-40' : ''}`}
                    style={{ backgroundColor: `color-mix(in srgb, ${item.color} 24%, transparent)` }}
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    {!item.all_day && sameDay(item.start, day) && <span className="tabular-nums opacity-70">{hhmm(item.start)}</span>}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {dayItems.length > 3 && (
                  <button type="button" onClick={() => onOpenDay(day)} className="px-1.5 text-left text-[10px] font-semibold text-[var(--text-secondary)] hover:underline">
                    {tl("+{0} altri", dayItems.length - 3)}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Week ────────────────────────────────────────────────────────────────────

type Placed = { item: CalendarItem; top: number; height: number; col: number; cols: number }

/** Lay out timed events of one day inside the visible hours, side by side when they overlap. */
function placeDay(items: CalendarItem[], day: Date, hours: WorkHours): Placed[] {
  const viewStart = startOfDay(day).getTime() + hours.start * 3600_000
  const viewEnd = startOfDay(day).getTime() + hours.end * 3600_000
  const timed = items
    .filter((i) => !i.all_day)
    .map((item) => {
      const rawEnd = Math.max(item.end.getTime(), item.start.getTime() + 30 * 60_000)
      return { item, s: Math.max(item.start.getTime(), viewStart), e: Math.min(rawEnd, viewEnd) }
    })
    .filter(({ s, e }) => e > s)
    .sort((a, b) => a.s - b.s || b.e - a.e)

  const placed: Placed[] = []
  let cluster: { p: Placed; e: number }[] = []
  let clusterEnd = 0
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.p.col + 1))
    cluster.forEach((c) => { c.p.cols = cols })
    cluster = []
  }
  for (const { item, s, e } of timed) {
    if (cluster.length && s >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.e > s).map((c) => c.p.col))
    let col = 0
    while (used.has(col)) col += 1
    const p: Placed = { item, top: ((s - viewStart) / 3600_000) * HOUR_PX, height: Math.max(((e - s) / 3600_000) * HOUR_PX, 20), col, cols: 1 }
    cluster.push({ p, e })
    placed.push(p)
    clusterEnd = Math.max(clusterEnd, e)
  }
  if (cluster.length) flush()
  return placed
}

/** Timed events of the day that fall completely outside the visible hours. */
const outsideHours = (items: CalendarItem[], day: Date, hours: WorkHours) => {
  const viewStart = startOfDay(day).getTime() + hours.start * 3600_000
  const viewEnd = startOfDay(day).getTime() + hours.end * 3600_000
  return items.filter((i) => !i.all_day && (Math.max(i.end.getTime(), i.start.getTime() + 1) <= viewStart || i.start.getTime() >= viewEnd))
}

type MoveDrag = { item: CalendarItem; offsetMin: number; dayIdx: number; minutes: number; moved: boolean; x: number; y: number }

type ResizeDrag = { item: CalendarItem; dayIdx: number; startMin: number; endMin: number }

function WeekView({ from, items, now, accentColor, canCreate, workHours, onCreate, onOpenEvent, onMove, onResize }: {
  from: Date; items: CalendarItem[]; now: Date; accentColor: string; canCreate: boolean; workHours: WorkHours
  onCreate: (draft: CalendarDraft) => void; onOpenEvent: (event: CalendarItem) => void; onMove: (item: CalendarItem, start: Date) => void
  onResize: (item: CalendarItem, end: Date) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const hourCount = workHours.end - workHours.start
  const gridHeight = hourCount * HOUR_PX
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRefs = useRef<(HTMLDivElement | null)[]>([])
  const [create, setCreate] = useState<{ dayIdx: number; a: number; b: number } | null>(null)
  const [moving, setMoving] = useState<MoveDrag | null>(null)
  const movingRef = useRef<MoveDrag | null>(null)
  const [resizing, setResizing] = useState<ResizeDrag | null>(null)
  const resizingRef = useRef<ResizeDrag | null>(null)

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowVisible = nowMinutes >= workHours.start * 60 && nowMinutes <= workHours.end * 60
  const nowTop = ((nowMinutes - workHours.start * 60) / 60) * HOUR_PX
  const todayIdx = days.findIndex((d) => sameDay(d, now))

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = todayIdx >= 0 && nowVisible ? Math.max(0, nowTop - 2 * HOUR_PX) : 0
    // Only when the week or the visible hours change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.getTime(), workHours.start, workHours.end])

  /** Minutes from midnight under the pointer, snapped to 15 and clamped to the visible hours. */
  const minutesAtY = (clientY: number, col: HTMLElement, lastSlot = SNAP_MIN) => {
    const rect = col.getBoundingClientRect()
    const raw = workHours.start * 60 + ((clientY - rect.top) / HOUR_PX) * 60
    const snapped = Math.floor(raw / SNAP_MIN) * SNAP_MIN
    return Math.max(workHours.start * 60, Math.min(workHours.end * 60 - lastSlot, snapped))
  }

  const dayIdxAtX = (clientX: number) => {
    let best = 0
    let bestDist = Infinity
    columnRefs.current.forEach((col, idx) => {
      if (!col) return
      const r = col.getBoundingClientRect()
      const dist = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0
      if (dist < bestDist) { bestDist = dist; best = idx }
    })
    return best
  }

  // Moving an event: window listeners (attached at pointerdown) so the block follows the pointer across days.
  const daysRef = useRef(days)
  daysRef.current = days
  const startMove = (initial: MoveDrag) => {
    movingRef.current = initial
    setMoving(initial)
    const onMovePtr = (e: PointerEvent) => {
      const cur = movingRef.current
      if (!cur) return
      const dayIdx = dayIdxAtX(e.clientX)
      const col = columnRefs.current[dayIdx]
      if (!col) return
      const duration = Math.max(15, Math.round((cur.item.end.getTime() - cur.item.start.getTime()) / 60_000))
      const rect = col.getBoundingClientRect()
      const raw = workHours.start * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60 - cur.offsetMin
      let minutes = Math.round(raw / SNAP_MIN) * SNAP_MIN
      minutes = Math.max(workHours.start * 60, Math.min(workHours.end * 60 - Math.min(duration, hourCount * 60), minutes))
      const moved = cur.moved || Math.abs(e.clientX - cur.x) > 4 || Math.abs(e.clientY - cur.y) > 4
      if (moved !== cur.moved || dayIdx !== cur.dayIdx || minutes !== cur.minutes) {
        const next = { ...cur, dayIdx, minutes, moved }
        movingRef.current = next
        setMoving(next)
      }
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMovePtr)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      const cur = movingRef.current
      movingRef.current = null
      setMoving(null)
      if (!cur || !commit) return
      if (!cur.moved) { onOpenEvent(cur.item); return }
      const day = daysRef.current[cur.dayIdx]
      onMove(cur.item, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, cur.minutes))
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    window.addEventListener('pointermove', onMovePtr)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  // Stretching an event: grab its bottom edge and drag; the end follows the pointer in 15-minute steps.
  const startResize = (initial: ResizeDrag) => {
    resizingRef.current = initial
    setResizing(initial)
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'ns-resize'
    const onMovePtr = (e: PointerEvent) => {
      const cur = resizingRef.current
      const col = cur && columnRefs.current[cur.dayIdx]
      if (!cur || !col) return
      const raw = workHours.start * 60 + ((e.clientY - col.getBoundingClientRect().top) / HOUR_PX) * 60
      const endMin = Math.max(cur.startMin + SNAP_MIN, Math.min(workHours.end * 60, Math.round(raw / SNAP_MIN) * SNAP_MIN))
      if (endMin !== cur.endMin) {
        const next = { ...cur, endMin }
        resizingRef.current = next
        setResizing(next)
      }
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMovePtr)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      document.body.style.cursor = previousCursor
      const cur = resizingRef.current
      resizingRef.current = null
      setResizing(null)
      if (!cur || !commit) return
      const day = daysRef.current[cur.dayIdx]
      onResize(cur.item, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, cur.endMin))
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    window.addEventListener('pointermove', onMovePtr)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const finishCreate = () => {
    if (!create) return
    const lo = Math.min(create.a, create.b)
    const hi = Math.max(create.a, create.b)
    const day = days[create.dayIdx]
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, lo)
    const end = hi > lo ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, hi + SNAP_MIN) : new Date(start.getTime() + 3600_000)
    setCreate(null)
    onCreate({ start, end, allDay: false })
  }

  const allDayByDay = days.map((day) => eventsOnDay(items, day).filter((i) => i.all_day))
  const outsideByDay = days.map((day) => outsideHours(eventsOnDay(items, day), day, workHours))
  const hasTopRow = allDayByDay.some((l) => l.length) || outsideByDay.some((l) => l.length)
  const gridCols = 'grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-[3px]'
  const dayBg = (idx: number) => (idx === todayIdx ? todayTint(accentColor) : 'var(--ds-cal-day)')
  const lines: CSSProperties = {
    backgroundImage: `repeating-linear-gradient(to bottom, var(--ds-cal-hour-line) 0 1px, transparent 1px ${HOUR_PX / 2}px, var(--ds-cal-half-line) ${HOUR_PX / 2}px ${HOUR_PX / 2 + 1}px, transparent ${HOUR_PX / 2 + 1}px ${HOUR_PX}px)`,
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-x-auto">
      {/* One scroller for headers and grid: a vertical scrollbar narrows both alike, so the columns stay aligned. */}
      <div ref={scrollRef} className="relative min-h-0 min-w-[680px] flex-1 overflow-y-auto overflow-x-hidden rounded-2xl bg-[var(--ds-cal-gutter)] px-[3px] pb-[3px]">
        <div className="sticky top-0 z-50 flex flex-col gap-[3px] bg-[var(--ds-cal-gutter)] py-[3px]">
        {/* Day headers */}
        <div className={gridCols}>
          <div className="rounded-tl-xl bg-[var(--ds-cal-day-muted)]" />
          {days.map((day, idx) => {
            const isToday = idx === todayIdx
            return (
              <div key={dayKey(day)} className="flex items-center justify-center gap-2 rounded-t-xl py-2" style={{ background: dayBg(idx) }}>
                <span className="text-[11px] font-bold uppercase" style={{ color: isToday ? 'var(--ds-cal-today)' : 'var(--text-secondary)' }}>{WEEKDAYS_SHORT()[(day.getDay() + 6) % 7]}</span>
                <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-bold ${isToday ? 'text-white' : 'text-[var(--text-primary)]'}`} style={isToday ? { backgroundColor: 'var(--ds-cal-today)' } : undefined}>{day.getDate()}</span>
                {isToday && <span className="hidden text-[10px] font-bold uppercase text-[var(--ds-cal-today)] lg:inline">{tl("Oggi")}</span>}
              </div>
            )
          })}
        </div>

        {/* All-day + out-of-hours row */}
        {hasTopRow && (
          <div className={gridCols}>
            <div className="flex items-start justify-end bg-[var(--ds-cal-day-muted)] px-1 py-1 text-right text-[9px] font-semibold uppercase leading-tight text-[var(--text-secondary)]">{tl("Giorno")}</div>
            {days.map((day, idx) => (
              <div key={dayKey(day)} className="flex min-w-0 flex-col gap-0.5 p-1" style={{ background: dayBg(idx) }}>
                {allDayByDay[idx].map((item) => (
                  <button key={item.id} type="button" onClick={() => onOpenEvent(item)} className="truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-white" style={{ backgroundColor: item.color }}>
                    {item.title}
                  </button>
                ))}
                {outsideByDay[idx].map((item) => (
                  <button key={item.id} type="button" onClick={() => onOpenEvent(item)} title={tl("Fuori dall'orario visualizzato")}
                    className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-[var(--text-primary)]"
                    style={{ backgroundColor: `color-mix(in srgb, ${item.color} 22%, transparent)` }}>
                    <span className="tabular-nums opacity-70">{hhmm(item.start)}</span><span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        </div>

        {/* Time grid */}
          <div className={gridCols} style={{ height: gridHeight }}>
            <div className="relative bg-[var(--ds-cal-day-muted)]">
              {Array.from({ length: hourCount }, (_, i) => workHours.start + i).map((h, i) => (
                <div key={h} className="absolute right-1.5 text-[10px] font-medium tabular-nums text-[var(--text-secondary)]" style={{ top: i * HOUR_PX + 2 }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
              {todayIdx >= 0 && nowVisible && (
                <div className="absolute right-0.5 z-30 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white shadow-[var(--ds-shadow-1)]" style={{ top: nowTop, backgroundColor: accentColor }}>
                  {hhmm(now)}
                </div>
              )}
            </div>
            {days.map((day, idx) => {
              const placed = placeDay(eventsOnDay(items, day), day, workHours)
              const isToday = idx === todayIdx
              return (
                <div
                  key={dayKey(day)}
                  ref={(el) => { columnRefs.current[idx] = el }}
                  className={`relative touch-none select-none ${canCreate ? 'cursor-cell' : ''}`}
                  style={{ ...lines, backgroundColor: dayBg(idx) }}
                  onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
                    if (!canCreate || e.button !== 0) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    const m = minutesAtY(e.clientY, e.currentTarget)
                    setCreate({ dayIdx: idx, a: m, b: m })
                  }}
                  onPointerMove={(e) => {
                    if (!create || create.dayIdx !== idx) return
                    const m = minutesAtY(e.clientY, e.currentTarget)
                    if (m !== create.b) setCreate({ ...create, b: m })
                  }}
                  onPointerUp={finishCreate}
                  onPointerCancel={() => setCreate(null)}
                >
                  {create && create.dayIdx === idx && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-20 rounded-lg opacity-60"
                      style={{
                        top: ((Math.min(create.a, create.b) - workHours.start * 60) / 60) * HOUR_PX,
                        height: ((create.a === create.b ? 60 : Math.abs(create.b - create.a) + SNAP_MIN) / 60) * HOUR_PX,
                        backgroundColor: accentColor,
                      }}
                    />
                  )}
                  {placed.map(({ item, top, height: baseHeight, col, cols }) => {
                    const isMoving = moving?.item.id === item.id && moving.moved
                    const blockStartMin = workHours.start * 60 + (top / HOUR_PX) * 60
                    const live = resizing?.item.id === item.id ? resizing : null
                    const height = live ? Math.max(((live.endMin - blockStartMin) / 60) * HOUR_PX, 20) : baseHeight
                    const shownEnd = live ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, live.endMin) : item.end
                    // Only the block that shows the event's real end can be stretched (not a multi-day cut-off).
                    const endMinOfDay = item.end.getHours() * 60 + item.end.getMinutes()
                    const canStretch = item.can_edit && !item.all_day && sameDay(item.end, day) && endMinOfDay <= workHours.end * 60
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          if (e.button !== 0) return
                          if (!item.can_edit) return
                          e.preventDefault()
                          const colEl = columnRefs.current[idx]
                          const pointerMin = colEl ? workHours.start * 60 + ((e.clientY - colEl.getBoundingClientRect().top) / HOUR_PX) * 60 : 0
                          const startMin = sameDay(item.start, day) ? item.start.getHours() * 60 + item.start.getMinutes() : workHours.start * 60
                          startMove({ item, offsetMin: pointerMin - startMin, dayIdx: idx, minutes: startMin, moved: false, x: e.clientX, y: e.clientY })
                        }}
                        onClick={() => { if (!item.can_edit) onOpenEvent(item) }}
                        className={`group absolute z-10 overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-[var(--ds-shadow-1)] hover:brightness-110 ${item.can_edit ? 'cursor-grab' : ''} ${isMoving ? 'opacity-30' : ''} ${live ? 'z-30 ring-2 ring-white/70' : ''}`}
                        style={{
                          top: top + 1,
                          height: height - 2,
                          left: `calc(${(col / cols) * 100}% + 3px)`,
                          width: `calc(${100 / cols}% - 6px)`,
                          backgroundColor: item.color,
                        }}
                        title={item.title}
                      >
                        <span className="block truncate font-semibold">{item.title}</span>
                        {(height > 34 || live) && <span className="block truncate opacity-90 tabular-nums">{hhmm(item.start)}{item.ends_at || live ? ` – ${hhmm(shownEnd)}` : ''}</span>}
                        {canStretch && (
                          <span
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label={tl("Trascina per cambiare l'ora di fine")}
                            title={tl("Trascina per cambiare l'ora di fine")}
                            className="absolute inset-x-0 bottom-0 flex h-3.5 cursor-ns-resize items-end justify-center pb-0.5"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              if (e.button !== 0) return
                              e.preventDefault()
                              startResize({ item, dayIdx: idx, startMin: Math.round(blockStartMin), endMin: Math.max(endMinOfDay, Math.round(blockStartMin) + SNAP_MIN) })
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className={`h-1 w-7 rounded-full bg-white/70 transition-opacity ${live ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 max-md:opacity-70'}`} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {moving?.moved && moving.dayIdx === idx && (() => {
                    const duration = Math.max(15, Math.round((moving.item.end.getTime() - moving.item.start.getTime()) / 60_000))
                    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, moving.minutes)
                    return (
                      <div className="pointer-events-none absolute inset-x-1 z-40 rounded-lg px-1.5 py-0.5 text-[11px] leading-tight text-white shadow-[var(--ds-shadow-3)]"
                        style={{
                          top: ((moving.minutes - workHours.start * 60) / 60) * HOUR_PX + 1,
                          height: Math.max((duration / 60) * HOUR_PX, 20) - 2,
                          backgroundColor: moving.item.color,
                          outline: `2px solid ${accentColor}`,
                        }}>
                        <span className="block truncate font-semibold">{moving.item.title}</span>
                        <span className="block tabular-nums">{hhmm(start)} – {hhmm(new Date(start.getTime() + duration * 60_000))}</span>
                      </div>
                    )
                  })()}
                  {nowVisible && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-30"
                      style={isToday
                        ? { top: nowTop - 1, height: 3, backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }
                        : { top: nowTop, height: 1, borderTop: `1px dashed color-mix(in srgb, ${accentColor} 45%, transparent)` }}
                    >
                      {isToday && <span className="absolute -left-1.5 -top-[4.5px] h-3 w-3 rounded-full" style={{ backgroundColor: accentColor }} />}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
