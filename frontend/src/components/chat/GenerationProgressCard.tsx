import { useEffect, useState } from 'react'
import { Check, Loader2 } from '@/components/icons'
import { tl } from '@/i18n/tl'

export interface GenerationProgress {
  title: string
  phases: string[]
  activeIndex: number
  /** Live detail under the active phase, e.g. "Retry 2/3: la risposta era troncata". */
  note?: string
  /** Characters streamed so far: proof that the model is still writing. */
  chars?: number
  startedAt: number
}

const HEARTBEATS = [
  tl("Sto lavorando alla tua richiesta…"),
  tl("Ancora qualche secondo…"),
  tl("Ci vuole un po' di tempo: il modello sta scrivendo il codice."),
  tl("Quasi lì, sto rifinendo i dettagli…"),
]

/** Live status for long document generations: real phases, elapsed time and streamed size. */
export function GenerationProgressCard({ progress, dark = false }: { progress: GenerationProgress; dark?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, Math.round((now - progress.startedAt) / 1000))
  const heartbeat = HEARTBEATS[Math.min(HEARTBEATS.length - 1, Math.floor(elapsed / 12))]
  const shell = dark ? 'border-white/15 bg-white/10 text-white' : 'border-violet-200 bg-gradient-to-br from-violet-50 to-white text-slate-700'
  return (
    <div role="status" aria-live="polite" className={`w-full max-w-[75%] rounded-2xl rounded-tl-sm border px-4 py-3 shadow-sm max-md:max-w-[92%] ${shell}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
          {progress.title}
        </div>
        <span className="text-[11px] tabular-nums opacity-70">
          {elapsed}s{progress.chars ? ` · ${(progress.chars / 1000).toFixed(1)}k caratteri` : ''}
        </span>
      </div>
      <ol className="space-y-1">
        {progress.phases.map((phase, i) => {
          const done = i < progress.activeIndex
          const active = i === progress.activeIndex
          return (
            <li key={phase} className={`flex items-center gap-2 text-xs ${done ? 'opacity-60' : active ? 'font-semibold' : 'opacity-40'}`}>
              {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500 mx-[3px]" /> : <span className="h-1.5 w-1.5 rounded-full bg-current mx-[4px]" />}
              {phase}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[11px] opacity-70">{progress.note || heartbeat}</p>
    </div>
  )
}
