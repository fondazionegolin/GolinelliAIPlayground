import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, KeyRound, Loader2, LockKeyhole, PackageOpen, RotateCcw, Terminal } from '@/components/icons'

export interface EscapeRoomState {
  enabled: boolean
  status: 'not_started' | 'active' | 'completed'
  title?: string | null
  narrative_intro?: string | null
  mission?: string | null
  current_step: number
  total_steps: number
  attempts: number
  current_challenge: { number: number; false_statement: string; prompt: string } | null
  events: Array<{ step: number; input: string; correct: boolean; feedback: string }>
  inventory: Array<{ name: string; icon: string; description: string }>
  achievement?: { name: string; icon: string; description: string } | null
  message?: string | null
  correct?: boolean | null
}

export default function EscapeRoomTerminal({ state, loading, error, onStart, onSubmit }: {
  state: EscapeRoomState | null
  loading: boolean
  error?: string | null
  onStart: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const completed = state?.status === 'completed'

  useEffect(() => {
    if (state?.status === 'active' && !loading) inputRef.current?.focus()
  }, [loading, state?.current_step, state?.status])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!value.trim() || loading || completed) return
    onSubmit(value.trim())
    setValue('')
  }

  if (!state || state.status === 'not_started') {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><LockKeyhole className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-600">Escape room didattica</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">Preparazione della missione</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">Il Teacherbot sta costruendo lo scenario e nascondendo le informazioni alterate.</p>
          </div>
        </div>
        <button type="button" onClick={onStart} disabled={loading} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {loading ? 'Creazione dello scenario…' : 'Entra nella stanza'}
        </button>
        {error && <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700"><RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-sm"><LockKeyhole className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-600">Escape room didattica</p>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">{state.current_step}/{state.total_steps} chiavi</span>
            </div>
            <h3 className="mt-2 text-xl font-bold text-slate-900">{state.title || 'La stanza dei fatti alterati'}</h3>
            {state.narrative_intro && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{state.narrative_intro}</p>}
            {state.mission && <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm font-medium leading-5 text-violet-900 ring-1 ring-violet-100">{state.mission}</p>}
            {state.inventory?.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Sviluppi della missione</p><div className="mt-2 space-y-2">{state.inventory.slice(-3).map((item, index, visible) => <motion.div key={`${item.name}-${state.inventory.indexOf(item)}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className={`flex items-start gap-2 text-sm leading-5 ${index === visible.length - 1 ? 'text-slate-800' : 'text-slate-500'}`}><span className="text-lg">{item.icon}</span><p>{item.description}</p></motion.div>)}</div></div>}
          </div>
        </div>
        {state.total_steps > 0 && (
          <div className="mt-5 flex gap-1.5" aria-label={`${state.current_step} indizi completati su ${state.total_steps}`}>
            {Array.from({ length: state.total_steps }, (_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index < state.current_step ? 'bg-emerald-500' : index === state.current_step && !completed ? 'bg-violet-500' : 'bg-slate-200'}`} />)}
          </div>
        )}
      </header>

      <div className="space-y-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><PackageOpen className="h-4 w-4" /> Inventario</span><span className="text-xs text-slate-400">{state.inventory?.length || 0}/{state.total_steps}</span></div>
          <div className="flex min-h-14 gap-2 overflow-x-auto pb-1">
            {(state.inventory || []).map((item, index) => <div key={`${item.name}-${index}`} title={item.description} className="flex min-w-24 flex-col items-center rounded-xl border border-violet-100 bg-white px-3 py-2 text-center shadow-sm"><span className="text-2xl">{item.icon}</span><span className="mt-1 text-[11px] font-semibold text-slate-700">{item.name}</span></div>)}
            {!state.inventory?.length && <p className="self-center text-sm text-slate-400">Gli oggetti conquistati appariranno qui.</p>}
          </div>
        </div>
        {completed ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-emerald-800">
            <CheckCircle2 className="mx-auto h-9 w-9" />
            <p className="mt-2 text-base font-bold">Missione completata</p>
            <p className="mt-1 text-sm text-emerald-700">Hai individuato e corretto tutte le informazioni falsificate.</p>
          </div>
        ) : state.current_challenge ? (
          <>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-700">Indizio {state.current_challenge.number} · una sola informazione è stata alterata</p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{state.current_challenge.false_statement}</p>
            </div>
            <div className="overflow-hidden rounded-2xl bg-slate-950 text-slate-100 shadow-inner">
              <div className="flex items-center gap-2 border-b border-white/10 bg-slate-900 px-4 py-2.5">
                <Terminal className="h-4 w-4 text-violet-300" /><span className="font-mono text-xs text-slate-300">terminale di verifica</span><span className="ml-auto font-mono text-[10px] text-slate-500">tentativi {state.attempts}</span>
              </div>
              <div className="max-h-52 space-y-2 overflow-y-auto p-4 font-mono text-xs leading-5">
                {state.events.slice(-5).map((event, index) => (
                  <div key={`${event.step}-${index}`} className={event.correct ? 'text-emerald-300' : 'text-rose-300'}>
                    <p><span className="text-slate-500">$ </span>{event.input}</p><p>{event.correct ? '✓' : '×'} {event.feedback}</p>
                  </div>
                ))}
                <p className="font-sans text-sm text-slate-300">{state.current_challenge.prompt}</p>
                <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 focus-within:border-violet-400">
                  <span className="shrink-0 text-violet-300">$</span>
                  <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} disabled={loading} autoComplete="off" spellCheck={false} aria-label="Inserisci la tua correzione" placeholder="inserisci la correzione…" className="min-w-0 flex-1 bg-transparent font-mono text-base text-white caret-violet-300 outline-none placeholder:text-slate-600" />
                  <button type="submit" disabled={!value.trim() || loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-500 px-3 text-xs font-bold text-white transition hover:bg-violet-400 disabled:opacity-40">
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Verifica
                  </button>
                </form>
              </div>
            </div>
          </>
        ) : null}

        {(error || state.message) && <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${error || state.correct === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{error && <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />}<span>{state.achievement ? `${state.achievement.icon} ${state.achievement.name}: ` : ''}{error || state.message}</span></div>}
      </div>
    </section>
  )
}
