import { CalendarRange, Plus } from 'lucide-react'
import type { BoardSprint } from './BoardSprintsDialog'

type TimelineCard = {
  id: string
  column_id: string
  title: string
  card_type?: 'epic' | 'story' | 'task' | null
  story_points?: number | null
  sprint_id?: string | null
  sort_order?: string | null
}
type TimelineColumn = { id: string; label: string; color: string }

export function formatSprintDates(sprint: BoardSprint) {
  const fmt = (value?: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''
  return [fmt(sprint.start_date), fmt(sprint.end_date)].filter(Boolean).join(' → ')
}

export function sprintStatus(sprint: BoardSprint): 'past' | 'current' | 'future' | 'unscheduled' {
  if (!sprint.start_date || !sprint.end_date) return 'unscheduled'
  const today = new Date().toISOString().slice(0, 10)
  if (today < sprint.start_date) return 'future'
  if (today > sprint.end_date) return 'past'
  return 'current'
}

const STATUS_DOT: Record<ReturnType<typeof sprintStatus>, string> = {
  past: 'bg-slate-400',
  current: 'bg-violet-600 ring-4 ring-violet-200',
  future: 'bg-white ring-2 ring-slate-300',
  unscheduled: 'bg-white ring-2 ring-slate-200',
}

export default function BoardTimeline({ sprints, sprintCode, cards, columns, canManage, onManageSprints, onOpenCard }: {
  sprints: BoardSprint[]
  sprintCode: Record<string, string>
  cards: TimelineCard[]
  columns: TimelineColumn[]
  canManage: boolean
  onManageSprints: () => void
  onOpenCard: (id: string) => void
}) {
  const columnIndex = Object.fromEntries(columns.map((column, index) => [column.id, index]))
  const columnById = Object.fromEntries(columns.map((column) => [column.id, column]))
  const doneColumnId = columns[columns.length - 1]?.id
  const sprintIds = new Set(sprints.map((sprint) => sprint.id))
  const sortCards = (list: TimelineCard[]) => [...list].sort((a, b) =>
    (columnIndex[b.column_id] ?? 0) - (columnIndex[a.column_id] ?? 0) || (a.sort_order || '').localeCompare(b.sort_order || ''))

  const lanes = [
    ...sprints.map((sprint) => ({
      key: sprint.id,
      code: sprintCode[sprint.id],
      title: sprint.name,
      dates: formatSprintDates(sprint) || 'Date da definire',
      goal: sprint.goal,
      status: sprintStatus(sprint),
      cards: sortCards(cards.filter((card) => card.sprint_id === sprint.id)),
    })),
  ]
  const unplanned = cards.filter((card) => card.card_type !== 'epic' && !(card.sprint_id && sprintIds.has(card.sprint_id)))
  if (unplanned.length) {
    lanes.push({ key: 'none', code: '—', title: 'Senza sprint', dates: 'Da pianificare', goal: '', status: 'unscheduled', cards: sortCards(unplanned) })
  }

  if (!lanes.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
        <CalendarRange className="h-8 w-8 text-slate-300" />
        Nessun task da mostrare sulla timeline.
        {canManage && (
          <button type="button" onClick={onManageSprints} className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 text-xs font-bold text-slate-600 hover:border-slate-400">
            <Plus className="h-4 w-4" /> Crea sprint
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] md:p-4">
      <ol className="flex min-h-full w-max gap-4">
        {lanes.map((lane, laneIndex) => {
          const done = lane.cards.filter((card) => card.column_id === doneColumnId).length
          const points = lane.cards.reduce((sum, card) => sum + (card.story_points || 0), 0)
          return (
            <li key={lane.key} className="flex w-[260px] shrink-0 flex-col">
              <div className="relative flex h-6 items-center" aria-hidden="true">
                <span className={`absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-slate-200 ${laneIndex === lanes.length - 1 ? 'right-0' : '-right-4'}`} />
                <span className={`relative ml-3 h-3 w-3 rounded-full ${STATUS_DOT[lane.status]}`} />
              </div>
              <div className="px-1 pb-2 pt-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${lane.status === 'current' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-white'}`}>{lane.code}</span>
                  <span className="text-xs font-bold text-slate-500">{lane.dates}</span>
                  {lane.status === 'current' && <span className="text-[10px] font-bold text-violet-600">in corso</span>}
                </div>
                <h3 className="mt-1 truncate text-sm font-black text-slate-900" title={lane.title}>{lane.title}</h3>
                {lane.goal && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{lane.goal}</p>}
                <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-slate-400">
                  <span>{lane.cards.length} task{points ? ` · ${points} pt` : ''}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${lane.cards.length ? (done / lane.cards.length) * 100 : 0}%` }} />
                  </span>
                  <span>{done}/{lane.cards.length}</span>
                </div>
              </div>
              <ul className="ds-panel flex-1 space-y-0.5 rounded-[var(--ds-radius-panel)] p-1.5">
                {lane.cards.length === 0 && <li className="px-2 py-3 text-center text-[11px] text-slate-300">Nessun task</li>}
                {lane.cards.map((card) => {
                  const column = columnById[card.column_id]
                  const isDone = card.column_id === doneColumnId
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => onOpenCard(card.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-900/[0.04]"
                        title={`${card.title}${column ? ` — ${column.label}` : ''}`}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: column?.color || '#cbd5e1' }} />
                        <span className={`min-w-0 flex-1 truncate text-xs ${isDone ? 'text-slate-400 line-through' : 'font-bold text-slate-700'}`}>{card.title}</span>
                        {card.story_points ? <span className="shrink-0 text-[10px] text-slate-400">{card.story_points}</span> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
        {columns.map((column) => (
          <span key={column.id} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: column.color }} />{column.label}</span>
        ))}
      </div>
    </div>
  )
}
