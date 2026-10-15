import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Clock3, KeyRound, Loader2, LockKeyhole, Sparkles, Trophy, X } from '@/components/icons'
import { liveInteractionApi } from '@/lib/api'
import AchievementIcon from '@/components/live/AchievementIcon'

export interface LiveEscapeState {
  active: boolean
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
  interaction_type: 'escape_room'
  live_interaction_id: string
  title: string
  narrative_intro?: string | null
  mission?: string | null
  current_step: number
  total_steps: number
  attempts: number
  current_challenge: { number: number; false_statement: string; prompt: string } | null
  inventory: Array<{ name: string; icon: string; description: string }>
  started_at: string
  completed_at?: string | null
  message?: string | null
  correct?: boolean | null
  achievement?: { name: string; icon: string; description: string } | null
}

function formatTime(total: number) {
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

interface EscapeSummary {
  title: string
  total_participants: number
  completed_count: number
  total_steps: number
  me: { nickname: string; rank: number | null; completed: boolean; duration_seconds: number; current_step: number; attempts: number }
  leaderboard: Array<{ rank: number | null; nickname: string; duration_seconds: number; completed: boolean; current_step: number; is_me: boolean }>
  questions: Array<{
    number: number
    statement: string
    is_true: boolean
    correct_answer: string
    explanation: string
    solved: boolean
    attempts: Array<{ value: string; correct: boolean }>
  }>
}

function EscapeRecap({ interactionId, onExit }: { interactionId: string; onExit?: () => void }) {
  const [summary, setSummary] = useState<EscapeSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    liveInteractionApi.escapeSummary(interactionId)
      .then(response => { if (!cancelled) setSummary(response.data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [interactionId])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 sm:items-center sm:justify-center sm:bg-slate-950/70 sm:p-6 sm:backdrop-blur-sm">
      <div className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-slate-50 sm:h-auto sm:max-h-[92vh] sm:rounded-3xl sm:shadow-2xl">
        {!summary ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-slate-500">
            {failed ? <p>Il docente ha terminato la sessione. Il riepilogo non è disponibile.</p> : <><Loader2 className="h-6 w-6 animate-spin" /><p>Preparo il tuo riepilogo…</p></>}
            {failed && onExit && <button onClick={onExit} className="mt-2 rounded-xl bg-violet-600 px-5 py-3 font-bold text-white">Esci dalla sessione</button>}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <header className="bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 px-5 pb-6 pt-7 text-center text-white">
                <Trophy className="mx-auto h-10 w-10 text-amber-300" />
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-violet-200">Sessione terminata</p>
                <h2 className="mt-1 text-2xl font-black">
                  {summary.me.rank ? `${summary.me.rank}° posto su ${summary.completed_count}` : 'Missione non completata'}
                </h2>
                <p className="mt-1 text-sm text-white/75">
                  {summary.me.completed
                    ? `Tempo ${formatTime(summary.me.duration_seconds)} · ${summary.me.attempts} tentativi`
                    : `Indizi risolti ${summary.me.current_step}/${summary.total_steps} · ${summary.me.attempts} tentativi`}
                </p>
              </header>

              <section className="px-4 pt-5">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Classifica</h3>
                <ol className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                  {summary.leaderboard.map((row, index) => (
                    <li key={index} className={`flex items-center gap-3 px-4 py-3 ${row.is_me ? 'bg-violet-50' : ''}`}>
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-600">{row.rank ?? '–'}</span>
                      <span className={`min-w-0 flex-1 truncate text-sm ${row.is_me ? 'font-black text-violet-800' : 'font-semibold text-slate-800'}`}>{row.nickname}{row.is_me ? ' (tu)' : ''}</span>
                      <span className="font-mono text-xs font-bold text-slate-500">{row.completed ? formatTime(row.duration_seconds) : `${row.current_step}/${summary.total_steps}`}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="space-y-3 px-4 py-5">
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Domande e risposte</h3>
                {summary.questions.map(question => (
                  <article key={question.number} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-violet-700">
                      Indizio {question.number}
                      {question.solved && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-base leading-7 text-slate-900">{question.statement}</p>
                    <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                      {question.is_true ? 'Era già tutto vero: ' : 'Risposta giusta: '}<span className="font-black">{question.correct_answer}</span>
                    </p>
                    {question.explanation && <p className="mt-2 text-sm leading-6 text-slate-600">{question.explanation}</p>}
                    <div className="mt-3">
                      <p className="text-xs font-bold text-slate-500">I tuoi tentativi ({question.attempts.length})</p>
                      {question.attempts.length > 0 ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {question.attempts.map((attempt, index) => (
                            <li key={index} className={`max-w-full break-words rounded-full px-3 py-1 text-xs font-semibold ${attempt.correct ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>{attempt.value}</li>
                          ))}
                        </ul>
                      ) : <p className="mt-1 text-xs text-slate-400">Nessun tentativo su questo indizio.</p>}
                    </div>
                  </article>
                ))}
              </section>
            </div>
            <div className="border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button onClick={onExit} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-base font-bold text-white"><X className="h-5 w-5" /> Esci dalla sessione</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function LiveEscapeRoomStudent({ state, onUpdate, onExit }: { state: LiveEscapeState; onUpdate: (state: LiveEscapeState) => void; onExit?: () => void }) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [showReward, setShowReward] = useState(false)

  useEffect(() => {
    if (!state.correct || !state.achievement) return
    setShowReward(true)
    const timer = window.setTimeout(() => setShowReward(false), 2200)
    return () => window.clearTimeout(timer)
  }, [state.achievement, state.correct, state.current_step])

  useEffect(() => {
    const tick = () => {
      const end = state.completed_at ? new Date(state.completed_at).getTime() : Date.now()
      setElapsed(Math.max(0, Math.floor((end - new Date(state.started_at).getTime()) / 1000)))
    }
    tick()
    const id = state.completed_at ? undefined : window.setInterval(tick, 1000)
    return () => { if (id) window.clearInterval(id) }
  }, [state.completed_at, state.started_at])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!value.trim() || loading) return
    setLoading(true)
    try {
      const response = await liveInteractionApi.submitEscapeAnswer({ live_interaction_id: state.live_interaction_id, value: value.trim() })
      onUpdate(response.data)
      if (response.data.correct) setValue('')
    } finally {
      setLoading(false)
    }
  }

  const completed = Boolean(state.completed_at)

  if (state.status === 'CLOSED') return <EscapeRecap interactionId={state.live_interaction_id} onExit={onExit} />

  if (state.status === 'DRAFT') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-7 text-center text-white shadow-2xl">
          <LockKeyhole className="mx-auto h-12 w-12 text-violet-200" />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-violet-200">Live Escape Room</p>
          <h2 className="mt-2 text-2xl font-black">{state.title}</h2>
          {state.narrative_intro && <p className="mt-3 text-sm leading-6 text-white/80">{state.narrative_intro}</p>}
          {state.mission && <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-violet-100">{state.mission}</p>}
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin" /> Sei dentro! Attendi che il docente avvii la stanza…</p>
        </motion.div>
      </div>
    )
  }

  const slots = Array.from({ length: state.total_steps }, (_, index) => state.inventory[index])
  const stepLabel = completed ? `${state.total_steps}/${state.total_steps}` : `${Math.min(state.current_step + 1, state.total_steps)}/${state.total_steps}`

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white sm:items-center sm:justify-center sm:bg-slate-950/70 sm:p-6 sm:backdrop-blur-sm">
      <AnimatePresence>
        {showReward && state.correct && state.achievement && (
          <motion.div key={`${state.current_step}-${state.achievement.name}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-violet-950/25 p-4 backdrop-blur-[2px]">
            <motion.div initial={{ opacity: 0, scale: 0.45, rotate: -8 }} animate={{ opacity: 1, scale: [0.45, 1.08, 1], rotate: [-8, 2, 0] }} exit={{ opacity: 0, scale: 1.15, y: -30 }} transition={{ duration: 0.55, ease: 'easeOut' }} className="relative w-full max-w-xs overflow-hidden rounded-[32px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-violet-50 p-6 text-center shadow-2xl shadow-violet-950/30">
              <motion.div animate={{ y: [0, -8, 0], rotate: [0, -4, 4, 0] }} transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.5 }} className="mx-auto w-fit"><AchievementIcon icon={state.achievement.icon} index={state.current_step - 1} size={72} /></motion.div>
              <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-amber-600">Oggetto sbloccato</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">{state.achievement.name}</h3>
              {!completed && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-black text-violet-700"><Sparkles className="h-3.5 w-3.5" /> Indizio {state.current_step + 1} sbloccato</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[92vh] sm:rounded-3xl sm:shadow-2xl">
        <header className="shrink-0 bg-gradient-to-br from-violet-700 to-indigo-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-bold">{state.title}</span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-mono text-xs"><Clock3 className="h-3.5 w-3.5" /> {formatTime(elapsed)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-emerald-300 transition-all" style={{ width: `${state.total_steps ? (state.current_step / state.total_steps) * 100 : 0}%` }} /></div>
            <span className="text-xs font-bold text-white/80">{stepLabel}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-6">
          {completed ? (
            <motion.section initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-amber-50 to-white p-6 text-center">
              <Trophy className="mx-auto h-12 w-12 text-amber-500" />
              <h3 className="mt-3 text-xl font-black text-emerald-900">Missione completata!</h3>
              <p className="mt-1 text-sm text-emerald-700">Tempo finale <strong>{formatTime(elapsed)}</strong> · {state.attempts} tentativi</p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Attendi che il docente chiuda la sessione: vedrai classifica e risposte.</p>
            </motion.section>
          ) : state.current_challenge && (
            <>
              <motion.div key={state.current_challenge.number} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 24 }}>
                <p className="text-xs font-black uppercase tracking-wide text-violet-600">Indizio {state.current_challenge.number}</p>
                <p className="mt-2 whitespace-pre-wrap text-xl font-semibold leading-8 text-slate-900">{state.current_challenge.false_statement}</p>
              </motion.div>
              <form onSubmit={submit} className="mt-6 space-y-3">
                <label htmlFor="escape-answer" className="block text-sm leading-5 text-slate-500">{state.current_challenge.prompt}</label>
                <input
                  id="escape-answer"
                  value={value}
                  onChange={event => setValue(event.target.value)}
                  disabled={loading}
                  autoComplete="off"
                  autoCorrect="off"
                  enterKeyHint="send"
                  placeholder="La tua correzione…"
                  className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:border-violet-500 focus:bg-white"
                />
                <button disabled={!value.trim() || loading} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-40">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />} Verifica
                </button>
              </form>
            </>
          )}
          {state.message && !completed && <motion.p key={`${state.current_step}-${state.message}-${state.attempts}`} initial={{ opacity: 0, y: 8 }} animate={state.correct === false ? { opacity: 1, y: 0, x: [0, -6, 6, -3, 3, 0] } : { opacity: 1, y: 0 }} className={`mt-4 rounded-xl px-3 py-2.5 text-sm font-medium ${state.correct === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{state.message}</motion.p>}
        </main>

        <footer className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-center gap-2 overflow-x-auto">
            {slots.map((item, index) => item
              ? <motion.span key={index} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }} className="shrink-0"><AchievementIcon icon={item.icon} index={index} size={30} title={item.name} /></motion.span>
              : <span key={index} className="shrink-0"><AchievementIcon index={index} size={30} locked /></span>)}
          </div>
        </footer>
      </div>
    </div>
  )
}
