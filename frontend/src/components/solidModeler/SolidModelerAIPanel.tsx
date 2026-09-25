import { useRef, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, Loader2, Send, Sparkles, Square, XCircle } from 'lucide-react'
import type { AgentStepEvent, SceneObject } from './types'

const MODELS = [
  { value: 'anthropic|claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (consigliato)' },
  { value: 'anthropic|claude-opus-4-8', label: 'Claude Opus 4.8 (più accurato)' },
  { value: 'openai|gpt-5.2', label: 'GPT-5.2' },
  { value: 'default|', label: 'Modello predefinito piattaforma' },
]

const SUGGESTIONS = [
  'Un tavolo con piano rettangolare e quattro gambe cilindriche',
  'Un portapenne esagonale cavo con base piena',
  'Una casetta con tetto a spiovente, porta e due finestre',
  'Un castello con quattro torri merlate agli angoli',
  'Un portachiavi a stella con foro per l\'anello',
  'Un razzo con tre alette',
]

interface ChatTurn {
  prompt: string
  steps: AgentStepEvent[]
  status: 'running' | 'done' | 'error' | 'stopped'
  message?: string
  model?: string
  cost?: number
}

interface Props {
  objects: SceneObject[]
  selection: string[]
  /** Called once before the first scene update of a run (push undo snapshot). */
  onRunStart: () => void
  /** Live scene updates from the agent (no history entry). */
  onScene: (objects: SceneObject[]) => void
}

function authHeader(): Record<string, string> {
  try {
    const token = JSON.parse(localStorage.getItem('eduai-auth') || 'null')?.state?.accessToken
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export default function SolidModelerAIPanel({ objects, selection, onRunStart, onScene }: Props) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(MODELS[0].value)
  const [maxSteps, setMaxSteps] = useState(6)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const patchLast = (fn: (t: ChatTurn) => ChatTurn) =>
    setTurns(prev => prev.map((t, i) => (i === prev.length - 1 ? fn(t) : t)))

  const scrollDown = () => requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }))

  async function run(text = prompt) {
    const request = text.trim()
    if (!request || running) return
    const [provider, modelName] = model.split('|')
    setPrompt('')
    setRunning(true)
    setTurns(prev => [...prev, { prompt: request, steps: [], status: 'running' }])
    scrollDown()
    const controller = new AbortController()
    abortRef.current = controller
    let started = false
    try {
      const res = await fetch('/api/v1/solid-modeler/agent', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          prompt: request,
          scene: objects,
          selection,
          provider: provider === 'default' ? null : provider,
          model: provider === 'default' ? null : modelName,
          max_steps: maxSteps,
        }),
      })
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || `Errore ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = JSON.parse(line)
          if (ev.scene) {
            if (!started) { onRunStart(); started = true }
            onScene(ev.scene as SceneObject[])
          }
          if (ev.type === 'start') patchLast(t => ({ ...t, model: ev.model }))
          else if (ev.type === 'step') {
            patchLast(t => ({ ...t, steps: [...t.steps, ev as AgentStepEvent] }))
            scrollDown()
          } else if (ev.type === 'done') patchLast(t => ({ ...t, status: 'done', message: ev.message, cost: ev.cost }))
          else if (ev.type === 'error') patchLast(t => ({ ...t, status: 'error', message: ev.detail }))
        }
      }
      patchLast(t => (t.status === 'running' ? { ...t, status: 'error', message: 'Connessione interrotta.' } : t))
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError'
      patchLast(t => ({ ...t, status: aborted ? 'stopped' : 'error', message: aborted ? 'Interrotto: la scena resta all\'ultimo passo.' : (err as Error).message }))
    } finally {
      setRunning(false)
      abortRef.current = null
      scrollDown()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3 text-xs leading-5 text-violet-900">
            <p className="flex items-center gap-1.5 font-black"><Sparkles className="h-3.5 w-3.5" /> Costruttore agentico</p>
            <p className="mt-1">
              Descrivi un oggetto: l'agente lo scompone in primitive, le posiziona, verifica contatti e fori
              sui bounding box reali e si corregge in più passi. Puoi anche selezionare oggetti e chiedere modifiche.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => run(s)} className="rounded-full border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-6 rounded-xl rounded-tr-sm bg-slate-900 px-3 py-2 text-xs font-semibold text-white">{turn.prompt}</div>
            {turn.steps.map(step => (
              <div key={step.step} className="rounded-xl border border-slate-200 bg-white/90 p-2.5 text-[11px] leading-5 text-slate-700">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  <Bot className="h-3 w-3" /> Passo {step.step}
                </p>
                {step.thought && <p className="whitespace-pre-wrap text-slate-800">{step.thought}</p>}
                {step.actions.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 font-mono text-[10.5px] text-slate-500">
                    {step.actions.slice(0, 14).map((a, k) => <li key={k} className="truncate">{a}</li>)}
                    {step.actions.length > 14 && <li>… +{step.actions.length - 14} azioni</li>}
                  </ul>
                )}
                {step.errors.map((e, k) => <p key={`e${k}`} className="mt-1 flex gap-1 text-rose-700"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />{e}</p>)}
                {step.warnings.map((w, k) => <p key={`w${k}`} className="mt-1 flex gap-1 text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</p>)}
              </div>
            ))}
            {turn.status === 'running' && (
              <p className="flex items-center gap-2 px-1 text-[11px] font-semibold text-violet-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> L'agente sta {turn.steps.length ? 'verificando e correggendo' : 'progettando'}…
              </p>
            )}
            {turn.status !== 'running' && turn.message && (
              <div className={`rounded-xl px-3 py-2 text-xs leading-5 ${turn.status === 'done' ? 'border border-emerald-200 bg-emerald-50 text-emerald-900' : 'border border-rose-200 bg-rose-50 text-rose-900'}`}>
                <p className="flex gap-1.5">
                  {turn.status === 'done' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{turn.message}</span>
                </p>
                {turn.status === 'done' && (
                  <p className="mt-1 text-[10px] text-emerald-700">
                    {turn.model} · {turn.steps.length} passi{turn.cost ? ` · $${turn.cost.toFixed(4)}` : ''} · Ctrl+Z per annullare
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 bg-white/80 p-3">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() } }}
          rows={3}
          placeholder={selection.length ? 'Cosa cambio negli oggetti selezionati?' : 'Descrivi cosa costruire con le primitive…'}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
        />
        <div className="mt-2 flex items-center gap-2">
          <select value={model} onChange={e => setModel(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700">
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} title="Passi massimi dell'agente" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700">
            {[3, 4, 6, 8, 10].map(n => <option key={n} value={n}>{n} passi</option>)}
          </select>
          {running ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700">
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : (
            <button type="button" disabled={!prompt.trim()} onClick={() => run()} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40">
              <Send className="h-3 w-3" /> Crea
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
