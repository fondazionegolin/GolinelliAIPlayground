import { useState } from 'react'
import { Plus, Tags, Trash2, X } from 'lucide-react'

export type BoardLabel = { id: string; name: string; color: string }

export const LABEL_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#64748b']

type DraftLabel = { id?: string; name: string; color: string }

export default function BoardLabelsDialog({ labels, pending, onClose, onSave }: {
  labels: BoardLabel[]
  pending: boolean
  onClose: () => void
  onSave: (labels: DraftLabel[]) => void
}) {
  const [draft, setDraft] = useState<DraftLabel[]>(labels.map((label) => ({ ...label })))
  const update = (index: number, patch: Partial<DraftLabel>) => setDraft((current) => current.map((label, i) => i === index ? { ...label, ...patch } : label))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ds-popover flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--ds-radius-card)]" role="dialog" aria-modal="true" aria-labelledby="board-labels-title">
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h3 id="board-labels-title" className="flex items-center gap-2 text-lg font-black text-slate-900"><Tags className="h-5 w-5" /> Etichette</h3>
            <p className="mt-1 text-sm text-slate-500">Le etichette distinguono la natura dei task. Eliminandone una la rimuovi da tutti i task.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-5">
          {draft.length === 0 && <p className="text-sm text-slate-400">Nessuna etichetta.</p>}
          {draft.map((label, index) => (
            <div key={label.id || `new-${index}`} className="flex items-center gap-2">
              <div className="grid shrink-0 grid-cols-5 gap-1" role="radiogroup" aria-label={`Colore ${label.name || 'etichetta'}`}>
                {LABEL_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={label.color === color}
                    onClick={() => update(index, { color })}
                    className={`h-4 w-4 rounded-full ${label.color === color ? 'ring-2 ring-slate-900 ring-offset-1' : ''}`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <input
                value={label.name}
                onChange={(event) => update(index, { name: event.target.value })}
                maxLength={40}
                placeholder="Nome etichetta"
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />
              <button type="button" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Elimina ${label.name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {draft.length < 20 && (
            <button
              type="button"
              onClick={() => setDraft((current) => [...current, { name: '', color: LABEL_COLORS[current.length % LABEL_COLORS.length] }])}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 text-xs font-bold text-slate-600 hover:border-slate-400"
            >
              <Plus className="h-4 w-4" /> Nuova etichetta
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">Annulla</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave(draft.filter((label) => label.name.trim()).map((label) => ({ ...label, name: label.name.trim() })))}
            className="h-10 rounded-full border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] px-4 text-sm font-bold text-[var(--selection-active-text)] disabled:opacity-40"
          >
            {pending ? 'Salvataggio…' : 'Salva etichette'}
          </button>
        </div>
      </div>
    </div>
  )
}
