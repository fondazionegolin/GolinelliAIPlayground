import { describe, expect, it } from 'vitest'
import { dayKey, eventsOnDay, monthGridStart, startOfWeek, toItem } from './calendarUtils'
import type { SharedCalendarEvent } from '@/lib/api'

const ev = (over: Partial<SharedCalendarEvent>): SharedCalendarEvent => ({
  id: 'e', source: 'event', title: 't', starts_at: new Date(2026, 10, 9, 9, 0).toISOString(), ends_at: null,
  all_day: false, color: '#000', can_edit: true, targets: [], ...over,
})

describe('calendarUtils', () => {
  it('weeks start on Monday and the month grid covers the 1st', () => {
    expect(dayKey(startOfWeek(new Date(2026, 10, 9)))).toBe('2026-11-09')
    expect(dayKey(startOfWeek(new Date(2026, 10, 15)))).toBe('2026-11-09')
    expect(dayKey(monthGridStart(new Date(2026, 10, 20)))).toBe('2026-10-26')
  })

  it('places timed and multi-day all-day events on local days', () => {
    const timed = toItem(ev({ id: 'a' }))
    const allDay = toItem(ev({
      id: 'b', all_day: true,
      starts_at: new Date(2026, 10, 9, 0, 0).toISOString(),
      ends_at: new Date(2026, 10, 11, 23, 59).toISOString(),
    }))
    const items = [timed, allDay]
    expect(eventsOnDay(items, new Date(2026, 10, 9)).map((i) => i.id)).toEqual(['b', 'a'])
    expect(eventsOnDay(items, new Date(2026, 10, 11)).map((i) => i.id)).toEqual(['b'])
    expect(eventsOnDay(items, new Date(2026, 10, 12))).toEqual([])
  })
})
