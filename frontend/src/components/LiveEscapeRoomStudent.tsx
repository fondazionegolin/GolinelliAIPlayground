import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clock3, KeyRound, Loader2, LockKeyhole, PackageOpen, Sparkles, Trophy } from '@/components/icons'
import { liveInteractionApi } from '@/lib/api'

export interface LiveEscapeState {
  active: boolean
  status: 'ACTIVE' | 'CLOSED'
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

export default function LiveEscapeRoomStudent({ state, onUpdate }: { state: LiveEscapeState; onUpdate: (state: LiveEscapeState) => void }) {
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
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6">
      <AnimatePresence>
        {showReward && state.correct && state.achievement && (
          <motion.div key={`${state.current_step}-${state.achievement.name}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-violet-950/25 p-4 backdrop-blur-[2px]">
            <motion.div initial={{ opacity: 0, scale: 0.45, rotate: -8 }} animate={{ opacity: 1, scale: [0.45, 1.08, 1], rotate: [-8, 2, 0] }} exit={{ opacity: 0, scale: 1.15, y: -30 }} transition={{ duration: 0.55, ease: 'easeOut' }} className="relative w-full max-w-sm overflow-hidden rounded-[32px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-violet-50 p-7 text-center shadow-2xl shadow-violet-950/30">
              {Array.from({ length: 16 }, (_, index) => (
                <motion.span key={index} initial={{ opacity: 1, x: 0, y: 0, rotate: 0 }} animate={{ opacity: 0, x: Math.cos(index * Math.PI / 8) * 170, y: Math.sin(index * Math.PI / 8) * 170, rotate: 240 }} transition={{ duration: 1.4, delay: 0.12 }} className={`absolute left-1/2 top-1/2 ${index % 2 ? 'text-amber-400' : 'text-violet-400'}`}>{index % 3 ? '✦' : '●'}</motion.span>
              ))}
              <motion.div animate={{ y: [0, -8, 0], rotate: [0, -4, 4, 0] }} transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.5 }} className="text-6xl">{state.achievement.icon}</motion.div>
              <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-amber-600">Oggetto sbloccato</p>
              <h3 className="mt-1 text-2xl font-black text-slate-900">{state.achievement.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{state.achievement.description}</p>
              {!completed && <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-black text-violet-700"><Sparkles className="h-3.5 w-3.5" /> Indizio {state.current_step + 1} sbloccato</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="mx-auto my-auto w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-5 text-white sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-200"><LockKeyhole className="h-4 w-4" /> Live Escape Room</span>
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-mono text-sm"><Clock3 className="h-4 w-4" /> {formatTime(elapsed)}</span>
          </div>
          <h2 className="mt-4 text-2xl font-black">{state.title}</h2>
          {state.narrative_intro && <p className="mt-2 text-sm leading-6 text-white/80">{state.narrative_intro}</p>}
          {state.mission && <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-violet-100">{state.mission}</p>}
          {state.inventory.length > 0 && <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2.5"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">Sviluppi della missione</p><div className="mt-2 space-y-2">{state.inventory.slice(-3).map((item, index, visible) => <motion.div key={`${item.name}-${state.inventory.indexOf(item)}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className={`flex items-start gap-2 text-sm leading-5 ${index === visible.length - 1 ? 'text-white' : 'text-white/60'}`}><span className="text-lg">{item.icon}</span><p>{item.description}</p></motion.div>)}</div></div>}
          <div className="mt-5 flex gap-1.5">{Array.from({ length: state.total_steps }, (_, index) => <motion.span key={index} animate={index < state.current_step ? { scaleY: [1, 2, 1] } : { scaleY: 1 }} className={`h-1.5 flex-1 rounded-full transition-colors ${index < state.current_step ? 'bg-emerald-400' : index === state.current_step && !completed ? 'bg-white' : 'bg-white/20'}`} />)}</div>
        </header>

        <main className="space-y-4 p-4 sm:p-6">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><PackageOpen className="h-4 w-4" /> Inventario</span><span className="text-xs text-slate-400">{state.inventory.length}/{state.total_steps}</span></div>
            <div className="flex min-h-14 gap-2 overflow-x-auto pb-1">
              {state.inventory.map((item, index) => <motion.div key={`${item.name}-${index}`} initial={{ opacity: 0, scale: 0.5, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20, delay: index === state.inventory.length - 1 ? 0.15 : 0 }} title={item.description} className="flex min-w-24 flex-col items-center rounded-xl border border-violet-100 bg-white px-3 py-2 text-center shadow-sm"><span className="text-2xl">{item.icon}</span><span className="mt-1 text-[11px] font-semibold text-slate-700">{item.name}</span></motion.div>)}
              {state.inventory.length === 0 && <p className="self-center text-sm text-slate-400">Gli oggetti conquistati appariranno qui.</p>}
            </div>
          </section>

          {completed ? (
            <motion.section initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }} className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-amber-50 to-white p-6 text-center"><motion.div animate={{ rotate: [0, -8, 8, 0], y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 1.8 }}><Trophy className="mx-auto h-12 w-12 text-amber-500" /></motion.div><h3 className="mt-3 text-xl font-black text-emerald-900">Missione completata!</h3><p className="mt-1 text-sm text-emerald-700">Tempo finale: <strong>{formatTime(elapsed)}</strong> · {state.attempts} tentativi</p><p className="mt-3 text-sm text-slate-600">Tutti gli oggetti sono al sicuro. Attendi la classifica finale.</p></motion.section>
          ) : state.current_challenge && (
            <>
              <motion.section key={state.current_challenge.number} initial={{ opacity: 0, x: 35, rotateY: -8 }} animate={{ opacity: 1, x: 0, rotateY: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }} className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-amber-700">Indizio {state.current_challenge.number} · trova l’informazione alterata</p><p className="mt-2 text-base leading-7 text-slate-900">{state.current_challenge.false_statement}</p></motion.section>
              <form onSubmit={submit} className="rounded-2xl bg-slate-950 p-4 text-white">
                <p className="mb-3 text-sm text-slate-300">{state.current_challenge.prompt}</p>
                <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 focus-within:border-violet-400"><span className="font-mono text-violet-300">$</span><input value={value} onChange={event => setValue(event.target.value)} autoFocus disabled={loading} placeholder="inserisci la correzione…" className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none placeholder:text-slate-600" /><button disabled={!value.trim() || loading} className="flex h-10 items-center gap-2 rounded-lg bg-violet-500 px-3 text-sm font-bold disabled:opacity-40">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Verifica</button></div>
              </form>
            </>
          )}
          {state.message && <motion.p key={`${state.current_step}-${state.message}`} initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={state.correct === false ? { opacity: 1, y: 0, scale: 1, x: [0, -6, 6, -3, 3, 0] } : { opacity: 1, y: 0, scale: 1 }} className={`rounded-xl px-3 py-2 text-sm font-medium ${state.correct === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{state.achievement ? `${state.achievement.icon} ${state.achievement.name}: ` : ''}{state.message}</motion.p>}
        </main>
      </motion.div>
    </div>
  )
}
