import { useEffect, useRef, useState } from 'react'
import { Button } from '@/design'
import { agenticApi } from '@/lib/api'
import {
  apiDetail, streamAssistantPlan, wait,
  type AssistantAnswer, type AssistantEdge, type AssistantIntake, type AssistantIssue, type AssistantNode, type AssistantOp, type AssistantPlanResult,
} from '@/lib/agenticAssistant'
import { AlertTriangle, Check, Loader2, Play, RefreshCw, Sparkles, Square, Undo2, X } from '@/components/icons'

type Phase = 'idle' | 'intake' | 'confirm' | 'planning' | 'plan' | 'building' | 'reviewing' | 'done'
export type CanvasSnapshot = { nodes: AssistantNode[]; edges: AssistantEdge[] }

const EXAMPLES = [
  'Genera 12 immagini diverse a partire da prompt scritti dall’AI su un tema',
  'Addestra un classificatore su dati sintetici e mostra i risultati su un grafico',
  'Crea un chatbot tutor che interroga lo studente e ripete la domanda se sbaglia',
]
const NODE_DELAY_MS = 420
const EDGE_DELAY_MS = 180

type Props = {
  nodeCount: number
  labelOf: (nodeId: string) => string
  snapshot: () => CanvasSnapshot
  restore: (snapshot: CanvasSnapshot) => void
  reset: () => void
  applyOp: (op: AssistantOp) => void
  setLocked: (locked: boolean) => void
  onTitle: (title: string) => void
  onClose: () => void
}

/** Describe-and-build assistant: intake («ho capito bene?») → architect plan → nodes appear on the canvas → static review. */
export function AssistantPanel({ nodeCount, labelOf, snapshot, restore, reset, applyOp, setLocked, onTitle, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [intent, setIntent] = useState('')
  const [intake, setIntake] = useState<AssistantIntake | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState<AssistantPlanResult | null>(null)
  const [error, setError] = useState('')
  const [review, setReview] = useState<AssistantIssue[] | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [undo, setUndo] = useState<CanvasSnapshot | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stopRef = useRef(false)
  useEffect(() => () => { abortRef.current?.abort(); stopRef.current = true; setLocked(false) }, [setLocked])

  const answerList = (): AssistantAnswer[] => (intake?.questions || []).map((item) => ({ question: item.question, answer: (answers[item.question] || '').trim() })).filter((item) => item.answer)

  const startIntake = async () => {
    if (!intent.trim()) return
    setError(''); setPhase('intake')
    try {
      const { data } = await agenticApi.assistantIntake({ intent: intent.trim() })
      setIntake(data as AssistantIntake); setAnswers({}); setPhase('confirm')
    } catch (reason) { setError(apiDetail(reason, 'L’assistente non risponde: riprova.')); setPhase('idle') }
  }

  const startPlan = async () => {
    if (!intake) return
    setError(''); setStatus('Avvio l’architetto…'); setPhase('planning')
    const controller = new AbortController(); abortRef.current = controller
    try {
      setPlan(await streamAssistantPlan({ intent: intent.trim(), understanding: intake.understanding, assumptions: intake.assumptions, answers: answerList() }, setStatus, controller.signal))
      setPhase('plan')
    } catch (reason: any) {
      if (reason?.name !== 'AbortError') { setError(reason?.message || 'Progettazione non riuscita'); setPhase('confirm') } else setPhase('confirm')
    } finally { abortRef.current = null }
  }

  const build = async () => {
    if (!plan) return
    if (nodeCount > 0 && !window.confirm('Il Canvas non è vuoto: l’assistente lo sostituisce con il nuovo workflow. Potrai annullare tutto dopo. Procedo?')) return
    stopRef.current = false
    setUndo(snapshot()); setError(''); setReview(null)
    const steps = plan.ops.filter((op) => op.type !== 'done')
    setProgress({ done: 0, total: steps.length }); setPhase('building'); setLocked(true)
    reset()
    await wait(120)
    let done = 0
    for (const op of steps) {
      if (stopRef.current) break
      applyOp(op)
      done += 1; setProgress({ done, total: steps.length })
      await wait(op.type === 'add_node' ? NODE_DELAY_MS : EDGE_DELAY_MS)
    }
    setLocked(false)
    if (stopRef.current) { setPhase('plan'); setError('Costruzione interrotta: puoi annullare tutto o ricostruire.'); return }
    onTitle(plan.title)
    setPhase('reviewing')
    try {
      const { data } = await agenticApi.assistantLint(plan.graph as unknown as Record<string, unknown>)
      setReview(data.issues as AssistantIssue[])
    } catch { setReview([{ severity: 'warning', node: null, message: 'Non sono riuscito a rivedere il workflow: controllalo a mano.' }]) }
    setPhase('done')
  }

  const undoAll = () => {
    if (undo) restore(undo)
    setUndo(null); setPhase('idle'); setPlan(null); setReview(null)
  }
  const stopBuild = () => { stopRef.current = true }
  const close = () => { abortRef.current?.abort(); stopRef.current = true; onClose() }

  const errors = (review || []).filter((item) => item.severity === 'error')
  const unanswered = (intake?.questions || []).filter((item) => !(answers[item.question] || '').trim()).length

  return <aside className="absolute left-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl" aria-label="Assistente workflow">
    <header className="flex items-center gap-2 border-b border-slate-100 bg-violet-50 px-3 py-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-white"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1"><p className="text-xs font-black text-slate-800">Assistente workflow</p><p className="text-[10px] text-slate-500">Descrivi cosa vuoi fare: lo costruisco io</p></div>
      <button type="button" onClick={close} className="rounded-full p-1.5 text-slate-500 hover:bg-white" aria-label="Chiudi assistente"><X className="h-4 w-4" /></button>
    </header>

    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs text-slate-700">
      {(phase === 'idle' || phase === 'intake') && <>
        <label className="block"><span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400">Che cosa vuoi fare?</span>
          <textarea value={intent} onChange={(event) => setIntent(event.target.value)} disabled={phase === 'intake'} rows={4} maxLength={4000} placeholder="Es. voglio generare una serie di immagini, una per ogni riga di una tabella di prompt scritta dall’AI…"
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
        {!intent && <div className="flex flex-col gap-1.5">{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setIntent(example)} className="rounded-lg border border-dashed border-slate-200 px-2.5 py-1.5 text-left text-[11px] text-slate-500 hover:border-violet-300 hover:text-violet-700">{example}</button>)}</div>}
        <Button onClick={() => void startIntake()} disabled={!intent.trim() || phase === 'intake'} tone="accent" surface="solid" fullWidth className="rounded-full">
          {phase === 'intake' ? <><Loader2 className="h-4 w-4 animate-spin" /> Sto capendo…</> : <><Sparkles className="h-4 w-4" /> Avanti</>}
        </Button>
      </>}

      {(phase === 'confirm' || phase === 'planning') && intake && <>
        <section className="rounded-xl bg-violet-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-violet-700">Ho capito così</p><p className="mt-1 leading-5 text-slate-800">{intake.understanding}</p></section>
        {intake.assumptions.length > 0 && <section><p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Se non mi dici altro, scelgo</p><ul className="list-disc space-y-0.5 pl-4 text-slate-600">{intake.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        {intake.questions.map((item) => <section key={item.question} className="rounded-xl border border-slate-200 p-2.5">
          <p className="font-bold text-slate-800">{item.question}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">{item.suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={phase === 'planning'} onClick={() => setAnswers((current) => ({ ...current, [item.question]: suggestion }))}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${answers[item.question] === suggestion ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 text-slate-600 hover:border-violet-300'}`}>{suggestion}</button>)}</div>
          <input value={answers[item.question] || ''} disabled={phase === 'planning'} onChange={(event) => setAnswers((current) => ({ ...current, [item.question]: event.target.value }))} placeholder="Oppure scrivi la risposta" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] outline-none focus:border-violet-400" />
        </section>)}
        {phase === 'planning'
          ? <div className="space-y-2"><p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> {status || 'Progetto il workflow…'}</p>
            <Button onClick={() => abortRef.current?.abort()} tone="neutral" surface="outline" density="compact" fullWidth className="rounded-full"><Square className="h-3.5 w-3.5" /> Interrompi</Button></div>
          : <div className="flex gap-2">
            <Button onClick={() => { setPhase('idle'); setIntake(null) }} tone="neutral" surface="outline" density="compact" className="rounded-full">Correggi</Button>
            <Button onClick={() => void startPlan()} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full" title={unanswered ? 'Se non rispondi uso le scelte indicate sopra' : undefined}><Check className="h-4 w-4" /> Sì, progetta</Button></div>}
      </>}

      {(phase === 'plan' || phase === 'building') && plan && <>
        <section><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Piano · {plan.title}</p>
          <ol className="mt-1.5 space-y-1.5">{plan.blueprint.steps.map((step, index) => <li key={step.key} className="flex gap-2 rounded-lg bg-slate-50 p-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-black text-violet-700">{index + 1}</span>
            <span className="min-w-0"><b className="block truncate text-slate-800">{labelOf(step.node)}</b><span className="block text-[11px] leading-4 text-slate-500">{step.purpose || step.node}</span></span></li>)}</ol></section>
        {plan.estimate.credit_nodes.length > 0 && <p className="flex gap-2 rounded-xl bg-amber-50 p-2.5 text-[11px] leading-4 text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Quando lo avvierai spenderà crediti: {plan.estimate.credit_nodes.map((item) => `${labelOf(item.type)}${item.function ? ` (${item.function})` : ''} × ${item.times ?? '?'}`).join(', ')}. Costruire non esegue nulla.</span></p>}
        {[...plan.blueprint.warnings, ...plan.warnings].map((warning) => <p key={warning} className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{warning}</p>)}
        {plan.issues.length > 0 && <ul className="space-y-1">{plan.issues.map((issue) => <li key={issue.message} className={`rounded-lg p-2 text-[11px] ${issue.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{issue.message}</li>)}</ul>}
        {phase === 'building'
          ? <div className="space-y-2"><p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> Costruisco sul Canvas… {progress.done}/{progress.total}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            <Button onClick={stopBuild} tone="neutral" surface="outline" density="compact" fullWidth className="rounded-full"><Square className="h-3.5 w-3.5" /> Interrompi</Button></div>
          : <div className="flex gap-2">
            <Button onClick={() => void startPlan()} tone="neutral" surface="outline" density="compact" className="rounded-full" title="Chiedi un altro piano"><RefreshCw className="h-3.5 w-3.5" /> Rigenera</Button>
            <Button onClick={() => void build()} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full"><Play className="h-4 w-4" /> Costruisci sul Canvas</Button></div>}
      </>}

      {(phase === 'reviewing' || phase === 'done') && plan && <>
        <section className="space-y-1.5">
          <p className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /><b>Workflow costruito</b> · {plan.graph.nodes.length} nodi, {plan.graph.edges.length} collegamenti</p>
          <p className="flex items-center gap-2">{review === null ? <Loader2 className="h-4 w-4 animate-spin text-violet-600" /> : errors.length ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : <Check className="h-4 w-4 text-emerald-600" />}<span><b>Validazione</b> {review === null ? 'in corso…' : errors.length ? `· ${errors.length} problema/i da sistemare` : '· struttura e collegamenti verificati'}</span></p>
          <p className="flex items-center gap-2 text-slate-500"><span className="flex h-4 w-4 items-center justify-center text-slate-400">–</span><span><b>Prova dei nodi</b> · non ancora disponibile: nessun nodo è stato eseguito</span></p>
        </section>
        {(review || []).length > 0 && <ul className="space-y-1">{(review || []).map((issue) => <li key={issue.message} className={`rounded-lg p-2 text-[11px] ${issue.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{issue.message}</li>)}</ul>}
        {phase === 'done' && <>
          <p className="rounded-xl bg-emerald-50 p-2.5 text-[11px] leading-4 text-emerald-800">{errors.length ? 'Ho costruito il workflow ma restano dei punti da sistemare (sopra). ' : 'Il workflow è pronto. '}Ora è tuo: modifica i parametri dall’Inspector e premi Esegui quando vuoi.</p>
          <div className="flex gap-2">
            <Button onClick={undoAll} tone="neutral" surface="outline" density="compact" className="rounded-full"><Undo2 className="h-3.5 w-3.5" /> Annulla tutto</Button>
            <Button onClick={() => { setPhase('idle'); setIntent(''); setIntake(null); setPlan(null); setReview(null); setUndo(null) }} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full">Nuova richiesta</Button></div>
        </>}
      </>}

      {error && <p className="rounded-xl bg-rose-50 p-2.5 text-[11px] leading-4 text-rose-700" role="alert">{error}</p>}
    </div>
  </aside>
}
