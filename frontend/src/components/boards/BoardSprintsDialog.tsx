import { useState } from 'react'
import { CalendarRange, Plus, Trash2, X } from 'lucide-react'
import type { BoardSprintInput } from '@/lib/api'

export type BoardSprint = { id: string; name: string; goal?: string; start_date?: string | null; end_date?: string | null }

const addDays = (iso: string, days: number) => {
  const value = new Date(`${iso}T00:00:00`)
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

// A new sprint starts the Monday after the previous one ends (or next Monday) and lasts two weeks.
function nextSprintDates(previous?: BoardSprintInput): { start_date: string; end_date: string } {
  let start: string
  if (previous?.end_date) {
    start = addDays(previous.end_date, 1)
    while (new Date(`${start}T00:00:00`).getDay() !== 1) start = addDays(start, 1)
  } else {
    const today = new Date()
    start = addDays(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, ((8 - today.getDay()) % 7) || 7)
  }
  return { start_date: start, end_date: addDays(start, 11) }
}

export default function BoardSprintsDialog({ sprints, cardCounts, pending, onClose, onSave }: {
  sprints: BoardSprint[]
  cardCounts: Record<string, number>
  pending: boolean
  onClose: () => void
  onSave: (sprints: BoardSprintInput[]) => void
}) {
  const [draft, setDraft] = useState<BoardSprintInput[]>(sprints.map((sprint) => ({ ...sprint, goal: sprint.goal || '' })))
  const update = (index: number, patch: Partial<BoardSprintInput>) => setDraft((current) => current.map((sprint, i) => i === index ? { ...sprint, ...patch } : sprint))
  const inputClass = 'h-9 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:ring-2 focus:ring-slate-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ds-popover flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--ds-radius-card)]" role="dialog" aria-modal="true" aria-labelledby="board-sprints-title">
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h3 id="board-sprints-title" className="flex items-center gap-2 text-lg font-black text-slate-900"><CalendarRange className="h-5 w-5" /> Sprint</h3>
            <p className="mt-1 text-sm text-slate-500">Dividi il lavoro in iterazioni. Eliminando uno sprint i suoi task tornano senza sprint.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {draft.length === 0 && <p className="text-sm text-slate-400">Nessuno sprint.</p>}
          {draft.map((sprint, index) => (
            <div key={sprint.id || `new-${index}`} className="space-y-2 rounded-[var(--ds-radius-control)] bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <input value={sprint.name} onChange={(event) => update(index, { name: event.target.value })} maxLength={60} placeholder={`Sprint ${index + 1}`} className={`${inputClass} font-bold`} aria-label="Nome sprint" />
                {sprint.id && cardCounts[sprint.id] ? <span className="shrink-0 text-xs text-slate-400">{cardCounts[sprint.id]} task</span> : null}
                <button type="button" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Elimina ${sprint.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input value={sprint.goal || ''} onChange={(event) => update(index, { goal: event.target.value })} maxLength={300} placeholder="Obiettivo dello sprint" className={inputClass} aria-label="Obiettivo sprint" />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Inizio
                  <input type="date" value={sprint.start_date || ''} onChange={(event) => update(index, { start_date: event.target.value || null })} className={`${inputClass} mt-1 font-normal`} />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Fine
                  <input type="date" value={sprint.end_date || ''} min={sprint.start_date || undefined} onChange={(event) => update(index, { end_date: event.target.value || null })} className={`${inputClass} mt-1 font-normal`} />
                </label>
              </div>
            </div>
          ))}
          {draft.length < 24 && (
            <button
              type="button"
              onClick={() => setDraft((current) => [...current, { name: `Sprint ${current.length + 1}`, goal: '', ...nextSprintDates(current[current.length - 1]) }])}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 text-xs font-bold text-slate-600 hover:border-slate-400"
            >
              <Plus className="h-4 w-4" /> Nuovo sprint
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">Annulla</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave(draft.map((sprint, index) => ({ ...sprint, name: sprint.name.trim() || `Sprint ${index + 1}` })))}
            className="h-10 rounded-full border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] px-4 text-sm font-bold text-[var(--selection-active-text)] disabled:opacity-40"
          >
            {pending ? 'Salvataggio…' : 'Salva sprint'}
          </button>
        </div>
      </div>
    </div>
  )
}
