import { CalendarDays } from '@/components/icons'
import { Button } from '@/design'
import type { CalendarAgentState } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { openCalendarAt } from './calendarUtils'

/** Result of a calendar-agent turn in the teacher chat, with a shortcut back to the calendar. */
export function CalendarAgentCard({ state }: { state: CalendarAgentState }) {
  const parts = [
    state.created ? tl("{0} aggiunti", state.created) : '',
    state.updated ? tl("{0} modificati", state.updated) : '',
    state.deleted ? tl("{0} eliminati", state.deleted) : '',
    state.errors ? tl("{0} non applicati", state.errors) : '',
  ].filter(Boolean)
  return (
    <div className="ds-semantic-surface mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-[rgba(123,105,201,0.055)] p-3">
      <CalendarDays className="h-5 w-5 flex-shrink-0 text-[var(--text-secondary)]" />
      <div className="min-w-0 flex-1 text-xs font-semibold text-[var(--text-primary)]">
        {parts.length ? parts.join(' · ') : tl("Nessuna modifica al calendario")}
      </div>
      <Button tone="accent" surface="solid" density="compact" onClick={() => openCalendarAt(state.focus_date, 'week')}>
        {tl("Apri calendario")}
      </Button>
    </div>
  )
}
