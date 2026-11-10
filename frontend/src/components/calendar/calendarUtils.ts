import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { calendarApi, type SharedCalendarEvent } from '@/lib/api'
import { PLATFORM_REALTIME_EVENT, type PlatformRealtimeDetail } from '@/lib/realtimeEvents'
import { tl } from '@/i18n/tl'

export const MONTHS = () => [tl("Gennaio"), tl("Febbraio"), tl("Marzo"), tl("Aprile"), tl("Maggio"), tl("Giugno"), tl("Luglio"), tl("Agosto"), tl("Settembre"), tl("Ottobre"), tl("Novembre"), tl("Dicembre")]
export const WEEKDAYS_SHORT = () => [tl("Lun"), tl("Mar"), tl("Mer"), tl("Gio"), tl("Ven"), tl("Sab"), tl("Dom")]

export const EVENT_COLORS = ['#6366f1', '#e85c8d', '#0d9488', '#f59e0b', '#3b82f6', '#8b5cf6', '#64748b']

export type CalendarView = 'week' | 'month'

/** Local calendar day key (YYYY-MM-DD) — never toISOString, which shifts days across UTC. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)

/** 6×7 grid starting on the Monday on/before the 1st of the month. */
export const monthGridStart = (d: Date) => startOfWeek(startOfMonth(d))

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export interface CalendarItem extends SharedCalendarEvent {
  start: Date
  end: Date
}

export function toItem(event: SharedCalendarEvent): CalendarItem {
  const start = new Date(event.starts_at)
  let end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + (event.all_day ? 0 : 60 * 60 * 1000))
  if (event.all_day && end < start) end = start
  return { ...event, start, end }
}

/** Events touching the local day (all-day events span whole days). */
export function eventsOnDay(items: CalendarItem[], day: Date) {
  const from = startOfDay(day).getTime()
  const to = addDays(startOfDay(day), 1).getTime()
  return items
    .filter((item) => {
      if (item.all_day) return dayKey(item.start) <= dayKey(day) && dayKey(item.end) >= dayKey(day)
      return item.start.getTime() < to && Math.max(item.end.getTime(), item.start.getTime() + 1) > from
    })
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.getTime() - b.start.getTime())
}

export function formatWhen(item: CalendarItem) {
  const date = item.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  if (item.all_day) return `${date} · ${tl("Tutto il giorno")}`
  const sameEnd = item.ends_at && sameDay(item.start, item.end)
  return `${date} · ${hhmm(item.start)}${item.ends_at ? ` – ${sameEnd ? hhmm(item.end) : item.end.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`
}

export const calendarQueryKey = ['shared-calendar'] as const

/** Visible events in [from, to); refetches when a shared event changes anywhere. */
export function useCalendarEvents(from: Date, to: Date, sessionId: string | undefined, enabled = true) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const onRealtime = (event: Event) => {
      const { type } = (event as CustomEvent<PlatformRealtimeDetail>).detail || {}
      if (type === 'calendar_changed') queryClient.invalidateQueries({ queryKey: calendarQueryKey })
    }
    window.addEventListener(PLATFORM_REALTIME_EVENT, onRealtime)
    return () => window.removeEventListener(PLATFORM_REALTIME_EVENT, onRealtime)
  }, [queryClient])

  return useQuery({
    queryKey: [...calendarQueryKey, from.toISOString(), to.toISOString(), sessionId || ''],
    queryFn: async () => (await calendarApi.listShared(from.toISOString(), to.toISOString(), sessionId)).data.map(toItem),
    enabled,
    staleTime: 30_000,
  })
}

/** Ask the navbar calendar to open its enlarged view on a date (used by the chat calendar agent). */
export const OPEN_CALENDAR_EVENT = 'golinelli:open-calendar'
export function openCalendarAt(date?: string | Date | null, view: CalendarView = 'week') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_CALENDAR_EVENT, { detail: { date: date ? new Date(date).toISOString() : null, view } }))
}

export const RECURRENCE_LABEL = (freq?: string, interval = 1) => {
  if (freq === 'daily') return interval > 1 ? tl("Ogni {0} giorni", interval) : tl("Ogni giorno")
  if (freq === 'weekly') return interval > 1 ? tl("Ogni {0} settimane", interval) : tl("Ogni settimana")
  if (freq === 'monthly') return interval > 1 ? tl("Ogni {0} mesi", interval) : tl("Ogni mese")
  return ''
}
