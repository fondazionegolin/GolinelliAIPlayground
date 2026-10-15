import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Clock3, KeyRound, Loader2, LockKeyhole, Sparkles, Trophy, X } from '@/components/icons'
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

// Same family as the quiz overlay: dark backdrop, white rounded card, warm gradient header.
const HEADER_GRAD = 'from-amber-400 via-orange-400 to-rose-500'
const BUTTON_GRAD = 'from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-orange-200'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {!summary ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-slate-500">
            {failed ? <p>Il docente ha terminato la sessione. Il riepilogo non è disponibile.</p> : <><Loader2 className="h-6 w-6 animate-spin" /><p>Preparo il tuo riepilogo…</p></>}
            {failed && onExit && <button onClick={onExit} className={`mt-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-bold text-white shadow-lg ${BUTTON_GRAD}`}>Esci dalla sessione</button>}
          </div>
        ) : (
          <>
            <header className={`shrink-0 bg-gradient-to-r ${HEADER_GRAD} px-6 pb-5 pt-5 text-center text-white`}>
              <Trophy className="mx-auto h-10 w-10" />
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-white/80">Sessione terminata</p>
              <h2 className="mt-1 text-3xl font-black leading-tight">
                {summary.me.rank ? `${summary.me.rank}° posto su ${summary.completed_count}` : 'Missione non completata'}
              </h2>
              <p className="mt-1 text-sm font-medium text-white/90">
                {summary.me.completed
                  ? `Tempo ${formatTime(summary.me.duration_seconds)} · ${summary.me.attempts} tentativi`
                  : `Indizi risolti ${summary.me.current_step}/${summary.total_steps} · ${summary.me.attempts} tentativi`}
              </p>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Classifica</h3>
                <ol className="mt-2 space-y-1.5">
                  {summary.leaderboard.map((row, index) => (
                    <li key={index} className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${row.is_me ? 'bg-amber-50 ring-2 ring-amber-300' : 'bg-slate-50'}`}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${row.rank === 1 ? 'bg-amber-400 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{row.rank ?? '–'}</span>
                      <span className={`min-w-0 flex-1 truncate text-base ${row.is_me ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}>{row.nickname}{row.is_me ? ' (tu)' : ''}</span>
                      <span className="font-mono text-sm font-bold text-slate-500">{row.completed ? formatTime(row.duration_seconds) : `${row.current_step}/${summary.total_steps}`}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Domande e risposte</h3>
                {summary.questions.map(question => (
                  <article key={question.number} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-orange-600">
                      Indizio {question.number}
                      {question.solved && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-lg font-semibold leading-7 text-slate-900">{question.statement}</p>
                    <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-base text-emerald-900">
                      {question.is_true ? 'Era già tutto vero: ' : 'Risposta giusta: '}<span className="font-black">{question.correct_answer}</span>
                    </p>
                    {question.explanation && <p className="mt-2 text-sm leading-6 text-slate-600">{question.explanation}</p>}
                    <div className="mt-3">
                      <p className="text-xs font-bold text-slate-500">I tuoi tentativi ({question.attempts.length})</p>
                      {question.attempts.length > 0 ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {question.attempts.map((attempt, index) => (
                            <li key={index} className={`max-w-full break-words rounded-full px-3 py-1 text-sm font-semibold ${attempt.correct ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>{attempt.value}</li>
                          ))}
                        </ul>
                      ) : <p className="mt-1 text-sm text-slate-400">Nessun tentativo su questo indizio.</p>}
                    </div>
                  </article>
                ))}
              </section>
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
              <button onClick={onExit} className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r py-4 text-lg font-bold text-white shadow-xl transition active:scale-[0.98] ${BUTTON_GRAD}`}><X className="h-5 w-5" /> Esci dalla sessione</button>
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
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className={`bg-gradient-to-r ${HEADER_GRAD} px-6 pb-5 pt-5 text-center text-white`}>
            <LockKeyhole className="mx-auto h-10 w-10" />
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-white/80">Escape Room</p>
            <h2 className="mt-1 text-2xl font-black leading-tight">{state.title}</h2>
          </div>
          <div className="space-y-4 px-5 py-6 text-center sm:px-6">
            {state.narrative_intro && <p className="text-base leading-7 text-slate-700">{state.narrative_intro}</p>}
            {state.mission && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-base font-medium leading-6 text-amber-900 ring-1 ring-amber-200">{state.mission}</p>}
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700"><Loader2 className="h-4 w-4 animate-spin" /> Sei dentro! Attendi che il docente avvii la stanza…</p>
          </div>
        </motion.div>
      </div>
    )
  }

  const slots = Array.from({ length: state.total_steps }, (_, index) => state.inventory[index])
  const pct = state.total_steps ? (state.current_step / state.total_steps) * 100 : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6">
      <AnimatePresence>
        {showReward && state.correct && state.achievement && (
          <motion.div key={`${state.current_step}-${state.achievement.name}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.45, rotate: -8 }} animate={{ opacity: 1, scale: [0.45, 1.08, 1], rotate: [-8, 2, 0] }} exit={{ opacity: 0, scale: 1.15, y: -30 }} transition={{ duration: 0.55, ease: 'easeOut' }} className="relative w-full max-w-xs overflow-hidden rounded-3xl bg-white p-6 text-center shadow-2xl ring-4 ring-amber-300">
              <motion.div animate={{ y: [0, -8, 0], rotate: [0, -4, 4, 0] }} transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.5 }} className="mx-auto w-fit"><AchievementIcon icon={state.achievement.icon} index={state.current_step - 1} size={80} /></motion.div>
              <p className="mt-3 text-xs font-black uppercase tracking-wide text-orange-600">Oggetto trovato!</p>
              <h3 className="mt-1 text-2xl font-black text-slate-900">{state.achievement.name}</h3>
              {!completed && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800"><Sparkles className="h-3.5 w-3.5" /> Indizio {state.current_step + 1} sbloccato</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className={`shrink-0 bg-gradient-to-r ${HEADER_GRAD} px-5 pb-4 pt-4 text-white sm:px-6`}>
          <div className="flex items-center justify-between gap-3 text-xs font-medium text-white/85">
            <span className="flex min-w-0 items-center gap-2"><KeyRound className="h-4 w-4 shrink-0" /><span className="font-bold uppercase tracking-wide">Escape Room</span><span className="opacity-60">·</span><span className="truncate">{state.title}</span></span>
            <span className="shrink-0 font-bold tabular-nums">{Math.min(state.current_step + (completed ? 0 : 1), state.total_steps)} / {state.total_steps}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Clock3 className="h-5 w-5 shrink-0 text-white/80" />
            <span className="text-3xl font-black tabular-nums leading-none">{formatTime(elapsed)}</span>
            <div className="ml-1 h-2.5 flex-1 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${completed ? 100 : pct}%` }} /></div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {completed ? (
            <motion.section initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl bg-emerald-50 p-6 text-center ring-1 ring-emerald-200">
              <Trophy className="mx-auto h-12 w-12 text-amber-500" />
              <h3 className="mt-3 text-2xl font-black text-emerald-900">Missione completata!</h3>
              <p className="mt-1 text-base text-emerald-800">Tempo finale <strong>{formatTime(elapsed)}</strong> · {state.attempts} tentativi</p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Attendi che il docente chiuda la sessione: vedrai classifica e risposte.</p>
            </motion.section>
          ) : state.current_challenge && (
            <>
              <motion.div key={state.current_challenge.number} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 24 }} className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <p className="text-xs font-black uppercase tracking-wide text-orange-600">Indizio {state.current_challenge.number}</p>
                <p className="mt-2 whitespace-pre-wrap text-xl font-bold leading-8 text-slate-900">{state.current_challenge.false_statement}</p>
              </motion.div>
              <form onSubmit={submit} className="mt-5 space-y-3">
                <label htmlFor="escape-answer" className="block text-base leading-6 text-slate-600">{state.current_challenge.prompt}</label>
                <input
                  id="escape-answer"
                  value={value}
                  onChange={event => setValue(event.target.value)}
                  disabled={loading}
                  autoComplete="off"
                  autoCorrect="off"
                  enterKeyHint="send"
                  placeholder="Scrivi la correzione…"
                  className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                />
                <button disabled={!value.trim() || loading} className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r py-4 text-lg font-bold text-white shadow-xl transition active:scale-[0.98] disabled:opacity-50 ${BUTTON_GRAD}`}>
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Verifica <ArrowRight className="h-5 w-5" /></>}
                </button>
              </form>
            </>
          )}
          {state.message && !completed && <motion.p key={`${state.current_step}-${state.message}-${state.attempts}`} initial={{ opacity: 0, y: 8 }} animate={state.correct === false ? { opacity: 1, y: 0, x: [0, -6, 6, -3, 3, 0] } : { opacity: 1, y: 0 }} className={`mt-4 rounded-2xl px-4 py-3 text-base font-medium ${state.correct === false ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>{state.message}</motion.p>}
        </main>

        <footer className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
            <span>Oggetti trovati</span><span className="tabular-nums">{state.inventory.length} / {state.total_steps}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {slots.map((item, index) => item
              ? <motion.span key={index} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}><AchievementIcon icon={item.icon} index={index} size={34} title={item.name} /></motion.span>
              : <span key={index}><AchievementIcon index={index} size={34} locked /></span>)}
          </div>
        </footer>
      </motion.div>
    </div>
  )
}
