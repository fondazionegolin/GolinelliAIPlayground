import { useState } from 'react'
import { Compass, ChevronDown } from '@/components/icons'

export interface ToolRouting {
  tool: string
  action: 'chat' | 'create' | 'edit' | 'ask_about'
  actionAlternatives?: { tool: string; probability: number }[]
  top: string
  confidence: number
  alternatives: { tool: string; probability: number }[]
  routed: boolean
}

export const TOOL_LABELS: Record<string, string> = {
  chat: 'Chat',
  image: 'Immagine',
  presentation: 'Presentazione',
  brochure: 'Brochure',
  dispensa: 'Dispensa',
  podcast: 'Podcast',
  html_page: 'Pagina interattiva',
  quiz: 'Quiz',
  exercise: 'Esercizio',
  dataset: 'Dataset',
}

export const ACTION_LABELS: Record<string, string> = { chat: 'Conversazione', create: 'Crea', edit: 'Modifica', ask_about: 'Domanda su' }

const label = (tool: string) => TOOL_LABELS[tool] ?? tool
const pct = (value: number) => `${Math.round(value * 100)}%`

/** Shows what the Decisions router understood and how sure it was; click to see the runner-up tools. */
export function ToolRoutingChip({ routing, dark = false }: { routing: ToolRouting; dark?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!routing.routed) return null
  const notRouted = routing.top !== 'chat' && routing.tool === 'chat'
  const tone = dark ? 'border-white/20 bg-white/10 text-white/80' : 'border-slate-200 bg-white/80 text-slate-500'
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}
        title="Come ho capito la richiesta"
      >
        <Compass className="h-3 w-3" />
        {notRouted
          ? `Chat · ${label(routing.top)} solo ${pct(routing.confidence)}, non abbastanza sicuro`
          : routing.tool === 'chat'
            ? `Conversazione · sicurezza ${pct(routing.confidence)}`
            : `${ACTION_LABELS[routing.action] ?? ''} ${label(routing.tool)} · sicurezza ${pct(routing.confidence)}`}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && routing.alternatives.length > 0 && (
        <div className={`w-56 space-y-1 rounded-xl border p-2 ${tone}`}>
          {routing.actionAlternatives && routing.actionAlternatives.length > 0 && (
            <>
              <div className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Azione</div>
              {routing.actionAlternatives.map((alt) => (
                <div key={`a-${alt.tool}`} className="flex items-center gap-2 text-[10px]">
                  <span className="w-24 shrink-0 truncate">{ACTION_LABELS[alt.tool] ?? alt.tool}</span>
                  <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${dark ? 'bg-white/15' : 'bg-slate-100'}`}>
                    <div className="h-full rounded-full bg-sky-500" style={{ width: pct(alt.probability) }} />
                  </div>
                  <span className="w-8 shrink-0 text-right tabular-nums">{pct(alt.probability)}</span>
                </div>
              ))}
              <div className="pt-1 text-[9px] font-semibold uppercase tracking-wide opacity-70">Contenuto</div>
            </>
          )}
          {routing.alternatives.map((alt) => (
            <div key={alt.tool} className="flex items-center gap-2 text-[10px]">
              <span className="w-24 shrink-0 truncate">{label(alt.tool)}</span>
              <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${dark ? 'bg-white/15' : 'bg-slate-100'}`}>
                <div className="h-full rounded-full bg-violet-500" style={{ width: pct(alt.probability) }} />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums">{pct(alt.probability)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
