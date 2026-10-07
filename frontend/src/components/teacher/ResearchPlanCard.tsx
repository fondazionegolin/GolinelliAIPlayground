import { Plus, Search, Trash2 } from '@/components/icons'

export interface ResearchPlanSubtopic {
  id: string
  title: string
  queries: string[]
}

export interface ResearchPlan {
  title: string
  objective: string
  subtopics: ResearchPlanSubtopic[]
}

interface ResearchPlanCardProps {
  plan: ResearchPlan
  extending: boolean
  disabled?: boolean
  onChange: (plan: ResearchPlan) => void
  onApprove: () => void
  onCancel: () => void
}

const FIELD = 'w-full rounded-[var(--ds-radius-control)] bg-white/70 px-2.5 py-1.5 text-xs text-slate-800 outline-none shadow-[var(--ds-shadow-control)] focus:shadow-[var(--ds-shadow-focus)]'

/** The research plan proposed by the chatbot: the teacher edits topics/queries, then approves to start the agents. */
export default function ResearchPlanCard({ plan, extending, disabled, onChange, onApprove, onCancel }: ResearchPlanCardProps) {
  const update = (index: number, patch: Partial<ResearchPlanSubtopic>) =>
    onChange({ ...plan, subtopics: plan.subtopics.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  const valid = plan.subtopics.some((s) => s.title.trim())

  return (
    <div className="ds-panel mb-3 max-h-[46vh] overflow-y-auto rounded-[var(--ds-radius-panel)] p-4">
      <div className="mb-3 flex items-start gap-2">
        <Search className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-extrabold text-slate-800">{extending ? 'Cosa aggiungere al documento' : 'Piano di ricerca'}</div>
          {!extending && (
            <input
              value={plan.title}
              onChange={(e) => onChange({ ...plan, title: e.target.value })}
              aria-label="Titolo del documento"
              className={`${FIELD} mt-1.5 font-bold`}
            />
          )}
          {plan.objective && <p className="mt-1.5 text-[11px] text-slate-500">{plan.objective}</p>}
        </div>
      </div>
      <div className="space-y-2">
        {plan.subtopics.map((s, index) => (
          <div key={s.id} className="ds-control rounded-[var(--ds-radius-control)] p-2.5">
            <div className="flex items-center gap-2">
              <input value={s.title} onChange={(e) => update(index, { title: e.target.value })} aria-label="Sottoargomento" className={`${FIELD} font-bold`} />
              <button
                type="button"
                onClick={() => onChange({ ...plan, subtopics: plan.subtopics.filter((_, i) => i !== index) })}
                aria-label="Rimuovi sottoargomento"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 outline-none hover:text-rose-500 focus-visible:shadow-[var(--ds-shadow-focus)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              value={s.queries.join('\n')}
              onChange={(e) => update(index, { queries: e.target.value.split('\n') })}
              rows={Math.max(2, s.queries.length)}
              aria-label="Query di ricerca, una per riga"
              placeholder="Una query di ricerca per riga"
              className={`${FIELD} mt-1.5 resize-none text-[11px]`}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {plan.subtopics.length < 6 && (
          <button
            type="button"
            onClick={() => onChange({ ...plan, subtopics: [...plan.subtopics, { id: `s${Date.now()}`, title: '', queries: [''] }] })}
            className="ds-control inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-slate-600 outline-none focus-visible:shadow-[var(--ds-shadow-focus)]"
          >
            <Plus className="h-3.5 w-3.5" />Sottoargomento
          </button>
        )}
        <span className="flex-1 text-[11px] text-slate-400">Puoi anche scrivere in chat cosa cambiare.</span>
        <button type="button" onClick={onCancel} className="ds-control h-8 rounded-full px-3 text-xs font-bold text-slate-600 outline-none focus-visible:shadow-[var(--ds-shadow-focus)]">Annulla</button>
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled || !valid}
          className="ds-selected h-8 rounded-full px-4 text-xs font-bold outline-none focus-visible:shadow-[var(--ds-shadow-focus)] disabled:opacity-50"
        >
          Approva e avvia
        </button>
      </div>
    </div>
  )
}
