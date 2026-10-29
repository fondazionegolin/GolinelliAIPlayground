import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/design'
import { agenticApi } from '@/lib/api'
import {
  apiDetail, streamAssistantEdit, streamAssistantPlan, wait,
  type AssistantAnswer, type AssistantEdge, type AssistantEditResult, type AssistantHistoryTurn, type AssistantIntake, type AssistantIssue,
  type AssistantNode, type AssistantOp, type AssistantPlanResult,
} from '@/lib/agenticAssistant'
import { AlertTriangle, ArrowUp, Check, History, Loader2, MessageSquarePlus, Play, Plus, RefreshCw, Sparkles, Square, Trash2, Undo2, X } from '@/components/icons'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { tl } from '@/i18n/tl'

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; ts: string }
type ConversationItem = { id: string; title: string; workflow_id: string | null; message_count: number; updated_at: string }
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(16).slice(2)}`)
const MAX_SAVED_MESSAGES = 400

type Phase = 'idle' | 'intake' | 'confirm' | 'planning' | 'plan' | 'building' | 'reviewing' | 'done'
export type CanvasSnapshot = { nodes: AssistantNode[]; edges: AssistantEdge[] }

const EXAMPLES = [
  tl("Genera 12 immagini diverse a partire da prompt scritti dall’AI su un tema"),
  tl("Addestra un classificatore su dati sintetici e mostra i risultati su un grafico"),
  tl("Crea un chatbot tutor che interroga lo studente e ripete la domanda se sbaglia"),
]
const EDIT_EXAMPLES = [
  tl("Aggiungi un filtro che tenga solo le righe con punti maggiori di 5"),
  tl("Dopo il chatbot salva ogni risposta in una tabella «risposte»"),
  tl("Cambia il numero di righe a 50 e ordina dal più alto al più basso"),
]
const NODE_DELAY_MS = 420
const EDGE_DELAY_MS = 180

type Props = {
  open: boolean
  workflowId: string | null
  style: CSSProperties
  onHeaderPointerDown: (event: ReactPointerEvent) => void
  onWorking: (working: boolean) => void
  nodeCount: number
  selectedId: string | null
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
export function AssistantPanel({ open, workflowId, style, onHeaderPointerDown, onWorking, nodeCount, selectedId, labelOf, snapshot, restore, reset, applyOp, setLocked, onTitle, onClose }: Props) {
  // Empty canvas → first-build mode; canvas with nodes → diff editing (the tab lets the user force a rebuild).
  const [modeChoice, setMode] = useState<'edit' | 'build'>(nodeCount > 0 ? 'edit' : 'build')
  const mode: 'edit' | 'build' = nodeCount > 0 ? modeChoice : 'build'
  const [phase, setPhase] = useState<Phase>('idle')
  const [intent, setIntent] = useState('')
  const [understanding, setUnderstanding] = useState('')
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  // Edit mode: a proposal waits for «Applica»; every applied edit can be undone one by one.
  const [instruction, setInstruction] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [proposal, setProposal] = useState<AssistantEditResult | null>(null)
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([])
  const [intake, setIntake] = useState<AssistantIntake | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState<AssistantPlanResult | null>(null)
  const [error, setError] = useState('')
  const [review, setReview] = useState<AssistantIssue[] | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [undo, setUndo] = useState<CanvasSnapshot | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Whole chat history: saved on the server per workflow so it can be reopened later; the model remembers the last turns.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [composer, setComposer] = useState('')
  const messagesRef = useRef(messages); messagesRef.current = messages
  const conversationRef = useRef<{ id: string | null; creating: boolean; workflowId: string | null; dirty: boolean }>({ id: null, creating: false, workflowId: null, dirty: false })
  const threadRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const say = useCallback((role: ChatMessage['role'], text: string) => {
    const clean = text.trim()
    if (!clean) return
    conversationRef.current.dirty = true
    setMessages((current) => [...current, { id: newId(), role, text: clean, ts: new Date().toISOString() }].slice(-MAX_SAVED_MESSAGES))
  }, [])
  const stopRef = useRef(false)
  const prevNodeCount = useRef(nodeCount)
  useEffect(() => {
    const before = prevNodeCount.current
    prevNodeCount.current = nodeCount
    if (before === 0 && nodeCount > 0 && phase === 'idle') setMode('edit')
    // Canvas emptied (new canvas, deleted nodes): drop a finished/stale flow so the composer is not left locked.
    if (nodeCount === 0 && (phase === 'done' || phase === 'reviewing') && !busy) resetFlow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount])
  useEffect(() => () => { abortRef.current?.abort(); stopRef.current = true; setLocked(false) }, [setLocked])

  useEffect(() => { conversationRef.current.workflowId = workflowId }, [workflowId])
  useEffect(() => {
    // Pick up the latest saved chat of this workflow when it is opened (a brand new chat starts empty).
    if (!workflowId || conversationRef.current.id || messagesRef.current.length) return
    let cancelled = false
    void (async () => {
      try {
        const list = (await agenticApi.listAssistantConversations(workflowId)).data.conversations as ConversationItem[]
        if (cancelled || conversationRef.current.id || messagesRef.current.length || !list.length) return
        const full = (await agenticApi.getAssistantConversation(list[0].id)).data
        if (cancelled || conversationRef.current.id || messagesRef.current.length) return
        conversationRef.current = { ...conversationRef.current, id: full.id, dirty: false }
        setConversationId(full.id); setMessages(full.messages as ChatMessage[])
      } catch { /* history is a convenience: the chat works without it */ }
    })()
    return () => { cancelled = true }
  }, [workflowId])
  useEffect(() => {
    if (!messages.length || !conversationRef.current.dirty) return
    const timer = window.setTimeout(async () => {
      const state = conversationRef.current
      if (state.creating) return
      state.dirty = false
      const first = messagesRef.current.find((item) => item.role === 'user')?.text || tl("Nuova conversazione")
      const title = first.length > 70 ? `${first.slice(0, 67)}…` : first
      try {
        if (!state.id) {
          state.creating = true
          const { data } = await agenticApi.createAssistantConversation({ workflow_id: state.workflowId, title, messages: messagesRef.current })
          state.id = data.id; setConversationId(data.id)
        } else {
          await agenticApi.updateAssistantConversation(state.id, { messages: messagesRef.current, ...(state.workflowId ? { workflow_id: state.workflowId } : {}) })
        }
      } catch { state.dirty = true } finally { state.creating = false }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [messages, workflowId])
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }) }, [messages.length, open, historyOpen])

  const refreshConversations = async () => {
    try { setConversations((await agenticApi.listAssistantConversations(workflowId)).data.conversations as ConversationItem[]) } catch { setConversations([]) }
  }
  const resetFlow = () => {
    setPhase('idle'); setIntent(''); setIntake(null); setPlan(null); setReview(null); setUndo(null); setProposal(null)
    setInstruction(''); setFeedback(''); setError(''); setComposer(''); setUndoStack([])
  }
  const startNewChat = () => {
    if (busy) return
    conversationRef.current = { ...conversationRef.current, id: null, dirty: false }
    setConversationId(null); setMessages([]); resetFlow(); setHistoryOpen(false)
  }
  const openConversation = async (id: string) => {
    if (busy) return
    try {
      const full = (await agenticApi.getAssistantConversation(id)).data
      conversationRef.current = { ...conversationRef.current, id: full.id, dirty: false }
      setConversationId(full.id); setMessages(full.messages as ChatMessage[]); resetFlow(); setHistoryOpen(false)
    } catch { setError(tl("Non riesco ad aprire questa conversazione.")) }
  }
  const removeConversation = async (id: string) => {
    if (!window.confirm(tl("Eliminare questa conversazione dallo storico?"))) return
    try { await agenticApi.deleteAssistantConversation(id) } catch { return }
    setConversations((current) => current.filter((item) => item.id !== id))
    if (conversationRef.current.id === id) startNewChat()
  }

  const answerList = (): AssistantAnswer[] => (intake?.questions || []).map((item) => ({ question: item.question, answer: (answers[item.question] || '').trim() })).filter((item) => item.answer)

  const startIntake = async (override?: string) => {
    const request = (override ?? intent).trim()
    if (!request) return
    setError(''); setPhase('intake'); say('user', request)
    try {
      const { data } = await agenticApi.assistantIntake({ intent: request })
      const result = data as AssistantIntake
      say('assistant', tl("Ho capito così: {0}", result.understanding))
      setIntake(result); setUnderstanding(result.understanding); setAssumptions(result.assumptions); setAnswers({}); setPhase('confirm')
    } catch (reason) { setError(apiDetail(reason, tl("L’assistente non risponde: riprova."))); setPhase('idle') }
  }

  const startPlan = async (revise = false, override?: string) => {
    if (!intake) return
    const change = revise ? (override ?? feedback).trim() : ''
    setError(''); setStatus(change ? tl("Rivedo il piano…") : tl("Avvio l’architetto…")); setPhase('planning')
    const controller = new AbortController(); abortRef.current = controller
    try {
      const body = { intent: intent.trim(), understanding: understanding.trim() || intake.understanding, assumptions: assumptions.map((item) => item.trim()).filter(Boolean), answers: answerList() }
      if (change) say('user', change)
      const planned = await streamAssistantPlan(change && plan ? { ...body, previous_blueprint: plan.blueprint, feedback: change } : body, setStatus, controller.signal)
      setPlan(planned)
      say('assistant', tl("Piano «{0}»: {1}.", planned.title, planned.blueprint.steps.map((step) => labelOf(step.node)).join(' → ')))
      setFeedback('')
      setPhase('plan')
    } catch (reason: any) {
      if (reason?.name !== 'AbortError') { setError(reason?.message || tl("Progettazione non riuscita")); setPhase('confirm') } else setPhase('confirm')
    } finally { abortRef.current = null }
  }

  const build = async () => {
    if (!plan) return
    if (nodeCount > 0 && !window.confirm(tl("Il Canvas non è vuoto: l’assistente lo sostituisce con il nuovo workflow. Potrai annullare tutto dopo. Procedo?"))) return
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
    if (stopRef.current) { setPhase('plan'); setError(tl("Costruzione interrotta: puoi annullare tutto o ricostruire.")); return }
    onTitle(plan.title)
    say('assistant', tl("Ho costruito «{0}» sul Canvas: {1} nodi, {2} collegamenti.", plan.title, plan.graph.nodes.length, plan.graph.edges.length))
    setPhase('reviewing')
    try {
      const { data } = await agenticApi.assistantLint(plan.graph as unknown as Record<string, unknown>)
      setReview(data.issues as AssistantIssue[])
    } catch { setReview([{ severity: 'warning', node: null, message: tl("Non sono riuscito a rivedere il workflow: controllalo a mano.") }]) }
    setPhase('done')
  }

  const graphForEdit = () => {
    const snap = snapshot()
    return {
      nodes: snap.nodes.map((node) => ({ id: node.id, instanceId: node.instanceId, x: node.x, y: node.y, status: 'idle', label: node.label, config: node.config })),
      edges: snap.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, sourcePort: edge.sourcePort, targetPort: edge.targetPort })),
    }
  }
  // Memory of the chat: the model sees the latest turns of this conversation, whatever happened before.
  const historyForEdit = (): AssistantHistoryTurn[] => messagesRef.current.slice(-12).map((item) => ({ role: item.role, content: item.text }))
  const askEdit = async (override?: string) => {
    const text = (override ?? instruction).trim()
    if (!text || editBusy) return
    const memory = historyForEdit()
    setError(''); setProposal(null); setEditBusy(true); setStatus(tl("Leggo il Canvas…")); say('user', text)
    const controller = new AbortController(); abortRef.current = controller
    try {
      const result = await streamAssistantEdit({ graph: graphForEdit(), instruction: text, selected: selectedId, history: memory }, setStatus, controller.signal)
      setProposal(result)
      say('assistant', result.explanation || (result.ops.length ? result.summary.join('; ') : tl("Nessuna modifica al Canvas.")))
    } catch (reason: any) {
      if (reason?.name !== 'AbortError') setError(reason?.message || tl("Modifica non riuscita"))
    } finally { abortRef.current = null; setEditBusy(false) }
  }
  const applyProposal = async () => {
    if (!proposal) return
    const done = proposal
    stopRef.current = false
    setUndoStack((current) => [...current, snapshot()])
    setLocked(true)
    for (const op of done.ops) {
      applyOp(op)
      await wait(op.type === 'add_node' ? 260 : 90)
    }
    setLocked(false)
    setProposal(null); setInstruction('')
    say('assistant', tl("Modifica applicata al Canvas."))
  }
  const undoLastEdit = () => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    restore(previous)
    say('assistant', tl("Ultima modifica annullata."))
    setUndoStack((current) => current.slice(0, -1))
  }

  const undoAll = () => {
    if (undo) restore(undo)
    setUndo(null); setPhase('idle'); setPlan(null); setReview(null)
  }
  const stopBuild = () => { stopRef.current = true }
  const close = () => { onClose() }
  const busy = phase === 'intake' || phase === 'planning' || phase === 'building' || phase === 'reviewing' || editBusy
  useEffect(() => { onWorking(busy) }, [busy, onWorking])

  const composerMode: 'idle' | 'edit' | 'plan' | 'locked' = mode === 'edit' ? 'edit' : phase === 'idle' ? 'idle' : phase === 'plan' ? 'plan' : 'locked'
  const composerPlaceholder = busy ? tl("L’assistente sta lavorando…")
    : composerMode === 'edit' ? (selectedId ? tl("Cosa cambio? Il nodo selezionato è il contesto") : tl("Chiedimi di cambiare il workflow…"))
    : composerMode === 'idle' ? tl("Descrivi cosa vuoi costruire…")
    : composerMode === 'plan' ? tl("Cosa cambieresti nel piano?")
    : phase === 'done' ? tl("Per continuare scegli «Modifica questo workflow» o «Nuova richiesta»")
    : tl("Conferma o correggi qui sopra")
  const composerDisabled = busy || composerMode === 'locked'
  const sendComposer = () => {
    const text = composer.trim()
    if (!text || composerDisabled) return
    setComposer('')
    if (composerMode === 'edit') { setInstruction(text); void askEdit(text) }
    else if (composerMode === 'idle') { setIntent(text); void startIntake(text) }
    else if (composerMode === 'plan') { setFeedback(text); void startPlan(true, text) }
  }
  const errors = (review || []).filter((item) => item.severity === 'error')
  const unanswered = (intake?.questions || []).filter((item) => !(answers[item.question] || '').trim()).length

  return <aside className="absolute z-[34] flex w-[min(25rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl" style={{ ...style, display: open ? undefined : 'none' }} aria-label={tl("Assistente workflow")} aria-hidden={!open}>
    <header className="flex cursor-grab touch-none items-center gap-2 border-b border-slate-100 bg-violet-50 px-3 py-2.5 active:cursor-grabbing" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button')) onHeaderPointerDown(event) }}>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-white"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1"><p className="text-xs font-black text-slate-800">{tl("Assistente workflow")}</p><p className="text-[10px] text-slate-500">{mode === 'edit' ? tl("Chiedimi di cambiare il workflow che hai sul Canvas") : tl("Descrivi cosa vuoi fare: lo costruisco io")}</p></div>
      <button type="button" onClick={startNewChat} disabled={busy} className="rounded-full p-1.5 text-slate-500 hover:bg-white disabled:opacity-40" aria-label={tl("Nuova conversazione")} title={tl("Nuova conversazione")}><MessageSquarePlus className="h-4 w-4" /></button>
      <button type="button" onClick={() => { const next = !historyOpen; setHistoryOpen(next); if (next) void refreshConversations() }} className={`rounded-full p-1.5 text-slate-500 hover:bg-white ${historyOpen ? 'bg-white text-violet-700' : ''}`} aria-label={tl("Storico conversazioni")} aria-pressed={historyOpen} title={tl("Storico conversazioni")}><History className="h-4 w-4" /></button>
      <button type="button" onClick={close} className="rounded-full p-1.5 text-slate-500 hover:bg-white" aria-label={tl("Nascondi assistente")} title={tl("Riduci a icona")}><X className="h-4 w-4" /></button>
    </header>

    {nodeCount > 0 && <div className="flex gap-1 border-b border-slate-100 px-3 py-2" role="tablist">
      {([['edit', tl("Modifica questo workflow")], ['build', tl("Nuovo workflow")]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} disabled={busy}
        onClick={() => setMode(value)} className={`rounded-full px-3 py-1 text-[11px] font-bold ${mode === value ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{label}</button>)}
    </div>}

    {historyOpen ? <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3 text-xs text-slate-700">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{tl("Conversazioni salvate")}</p>
      {conversations.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">{tl("Nessuna conversazione salvata per questo workflow.")}</p>}
      {conversations.map((item) => <div key={item.id} className={`flex items-center gap-1 rounded-xl border p-2 ${item.id === conversationId ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-violet-200'}`}>
        <button type="button" onClick={() => void openConversation(item.id)} className="min-w-0 flex-1 text-left"><b className="block truncate text-slate-800">{item.title}</b>
          <span className="text-[10px] text-slate-400">{new Date(item.updated_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} · {item.message_count} {tl("messaggi")}</span></button>
        <button type="button" onClick={() => void removeConversation(item.id)} className="rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-rose-600" aria-label={tl("Elimina conversazione")}><Trash2 className="h-3.5 w-3.5" /></button></div>)}
    </div> : <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs text-slate-700">
      {messages.length === 0 && <div className="space-y-2">
        <p className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-[12px] leading-5 text-slate-700">{tl("Ciao!")} {mode === 'edit' ? tl("Dimmi cosa vuoi cambiare nel workflow sul Canvas.") : tl("Raccontami cosa vuoi ottenere e costruisco il workflow per te.")} {tl("Ricordo tutta la conversazione e la ritrovi nello storico.")}</p>
        <div className="flex flex-col gap-1.5">{(mode === 'edit' ? EDIT_EXAMPLES : EXAMPLES).map((example) => <button key={example} type="button" onClick={() => { setComposer(example); composerRef.current?.focus() }} className="rounded-lg border border-dashed border-slate-200 px-2.5 py-1.5 text-left text-[11px] text-slate-500 hover:border-violet-300 hover:text-violet-700">{example}</button>)}</div></div>}
      {messages.map((item) => <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12px] leading-5 ${item.role === 'user' ? 'rounded-br-sm bg-violet-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-800'}`}>{item.text}</p></div>)}
      {mode === 'edit' && <>
        {proposal && <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/60 p-2.5">
          {proposal.explanation && <p className="leading-5 text-slate-800">{proposal.explanation}</p>}
          {proposal.summary.length > 0 && <ul className="space-y-0.5">{proposal.summary.map((line, index) => <li key={index} className="flex gap-1.5 text-[11px] text-slate-700"><Check className="mt-0.5 h-3 w-3 shrink-0 text-violet-600" /><span>{line}</span></li>)}</ul>}
          {proposal.ops.length === 0 && <p className="text-[11px] text-slate-500">{tl("Nessuna modifica al Canvas.")}</p>}
          {[...proposal.warnings, ...proposal.issues.map((issue) => issue.message)].map((message) => <p key={message} className="rounded-lg bg-amber-50 p-1.5 text-[11px] text-amber-800">{message}</p>)}
          {proposal.estimate.credit_nodes.length > 0 && <p className="flex gap-2 rounded-lg bg-amber-50 p-1.5 text-[11px] leading-4 text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{tl("Il workflow spende crediti quando lo esegui:")} {proposal.estimate.credit_nodes.map((item) => `${labelOf(item.type)}${item.function ? ` (${item.function})` : ''}`).join(', ')}.</span></p>}
          {proposal.ops.length > 0 && <div className="flex gap-2">
            <Button onClick={() => setProposal(null)} tone="neutral" surface="outline" density="compact" className="rounded-full">{tl("Scarta")}</Button>
            <Button onClick={() => void applyProposal()} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full"><Check className="h-4 w-4" /> {tl("Applica al Canvas")}</Button></div>}
        </section>}
        {editBusy && <div className="space-y-2"><p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> {status || tl("Preparo le modifiche…")}</p>
          <Button onClick={() => abortRef.current?.abort()} tone="neutral" surface="outline" density="compact" fullWidth className="rounded-full"><Square className="h-3.5 w-3.5" /> {tl("Interrompi")}</Button></div>}
        {undoStack.length > 0 && !editBusy && <Button onClick={undoLastEdit} tone="neutral" surface="outline" density="compact" className="rounded-full" title={tl("Annulla l’ultima modifica applicata")}><Undo2 className="h-3.5 w-3.5" /> {tl("Annulla ultima modifica")}</Button>}
        {error && <p className="rounded-xl bg-rose-50 p-2.5 text-[11px] leading-4 text-rose-700" role="alert">{error}</p>}
      </>}

      {mode === 'build' && <>
      {phase === 'intake' && <p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> {tl("Sto capendo…")}</p>}

      {(phase === 'confirm' || phase === 'planning') && intake && <>
        <section className="rounded-xl bg-violet-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-violet-700">{tl("Ho capito così · puoi correggermi")}</p>
          <textarea value={understanding} disabled={phase === 'planning'} onChange={(event) => setUnderstanding(event.target.value)} rows={3} maxLength={1000}
            className="mt-1 w-full resize-none rounded-lg border border-violet-100 bg-white p-2 leading-5 text-slate-800 outline-none focus:border-violet-400" /></section>
        <section><p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">{tl("Scelte che farò (modificabili)")}</p>
          <ul className="space-y-1">{assumptions.map((item, index) => <li key={index} className="flex gap-1">
            <input value={item} disabled={phase === 'planning'} onChange={(event) => setAssumptions((current) => current.map((value, i) => i === index ? event.target.value : value))} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] outline-none focus:border-violet-400" />
            <button type="button" disabled={phase === 'planning'} onClick={() => setAssumptions((current) => current.filter((_, i) => i !== index))} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" aria-label={tl("Togli questa scelta")}><Trash2 className="h-3.5 w-3.5" /></button></li>)}</ul>
          {assumptions.length < 8 && <button type="button" disabled={phase === 'planning'} onClick={() => setAssumptions((current) => [...current, ''])} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-violet-700 hover:underline"><Plus className="h-3 w-3" /> {tl("Aggiungi una scelta")}</button>}</section>
        {intake.questions.map((item) => <section key={item.question} className="rounded-xl border border-slate-200 p-2.5">
          <p className="font-bold text-slate-800">{item.question}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">{item.suggestions.map((suggestion) => <button key={suggestion} type="button" disabled={phase === 'planning'} onClick={() => setAnswers((current) => ({ ...current, [item.question]: suggestion }))}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${answers[item.question] === suggestion ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 text-slate-600 hover:border-violet-300'}`}>{suggestion}</button>)}</div>
          <input value={answers[item.question] || ''} disabled={phase === 'planning'} onChange={(event) => setAnswers((current) => ({ ...current, [item.question]: event.target.value }))} placeholder={tl("Oppure scrivi la risposta")} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] outline-none focus:border-violet-400" />
        </section>)}
        {phase === 'planning'
          ? <div className="space-y-2"><p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> {status || tl("Progetto il workflow…")}</p>
            <Button onClick={() => abortRef.current?.abort()} tone="neutral" surface="outline" density="compact" fullWidth className="rounded-full"><Square className="h-3.5 w-3.5" /> {tl("Interrompi")}</Button></div>
          : <div className="flex gap-2">
            <Button onClick={() => { setPhase('idle'); setIntake(null) }} tone="neutral" surface="outline" density="compact" className="rounded-full">{tl("Correggi")}</Button>
            <Button onClick={() => void startPlan()} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full" title={unanswered ? tl("Se non rispondi uso le scelte indicate sopra") : undefined}><Check className="h-4 w-4" /> {tl("Sì, progetta")}</Button></div>}
      </>}

      {(phase === 'plan' || phase === 'building') && plan && <>
        <section><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{tl("Piano ·")} {plan.title}</p>
          <ol className="mt-1.5 space-y-1.5">{plan.blueprint.steps.map((step, index) => <li key={step.key} className="flex gap-2 rounded-lg bg-slate-50 p-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-black text-violet-700">{index + 1}</span>
            <span className="min-w-0"><b className="block truncate text-slate-800">{labelOf(step.node)}</b><span className="block text-[11px] leading-4 text-slate-500">{step.purpose || step.node}</span></span></li>)}</ol></section>
        {plan.estimate.credit_nodes.length > 0 && <p className="flex gap-2 rounded-xl bg-amber-50 p-2.5 text-[11px] leading-4 text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{tl("Quando lo avvierai spenderà crediti:")} {plan.estimate.credit_nodes.map((item) => `${labelOf(item.type)}${item.function ? ` (${item.function})` : ''} × ${item.times ?? '?'}`).join(', ')}{tl(". Costruire non esegue nulla.")}</span></p>}
        {[...plan.blueprint.warnings, ...plan.warnings].map((warning) => <p key={warning} className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{warning}</p>)}
        {plan.issues.length > 0 && <ul className="space-y-1">{plan.issues.map((issue) => <li key={issue.message} className={`rounded-lg p-2 text-[11px] ${issue.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{issue.message}</li>)}</ul>}
        {phase === 'building'
          ? <div className="space-y-2"><p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin text-violet-600" /> {tl("Costruisco sul Canvas…")} {progress.done}/{progress.total}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600 transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            <Button onClick={stopBuild} tone="neutral" surface="outline" density="compact" fullWidth className="rounded-full"><Square className="h-3.5 w-3.5" /> {tl("Interrompi")}</Button></div>
          : <div className="space-y-2">
            <p className="text-[11px] text-slate-500">{tl("Scrivi qui sotto cosa cambieresti nel piano, oppure costruisci.")}</p>
          <div className="flex gap-2">
            <Button onClick={() => void startPlan()} tone="neutral" surface="outline" density="compact" className="rounded-full" title={tl("Chiedi un altro piano da zero")}><RefreshCw className="h-3.5 w-3.5" /> {tl("Rigenera")}</Button>
            <Button onClick={() => void build()} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full"><Play className="h-4 w-4" /> {tl("Costruisci sul Canvas")}</Button></div></div>}
      </>}

      {(phase === 'reviewing' || phase === 'done') && plan && <>
        <section className="space-y-1.5">
          <p className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /><b>{tl("Workflow costruito")}</b> · {plan.graph.nodes.length} nodi, {plan.graph.edges.length} collegamenti</p>
          <p className="flex items-center gap-2">{review === null ? <Loader2 className="h-4 w-4 animate-spin text-violet-600" /> : errors.length ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : <Check className="h-4 w-4 text-emerald-600" />}<span><b>{tl("Validazione")}</b> {review === null ? tl("in corso…") : errors.length ? tl("· {0} problema/i da sistemare", errors.length) : tl("· struttura e collegamenti verificati")}</span></p>
          <p className="flex items-center gap-2 text-slate-500"><span className="flex h-4 w-4 items-center justify-center text-slate-400">–</span><span><b>{tl("Prova dei nodi")}</b> {tl("· non ancora disponibile: nessun nodo è stato eseguito")}</span></p>
        </section>
        {(review || []).length > 0 && <ul className="space-y-1">{(review || []).map((issue) => <li key={issue.message} className={`rounded-lg p-2 text-[11px] ${issue.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{issue.message}</li>)}</ul>}
        {phase === 'done' && <>
          <p className="rounded-xl bg-emerald-50 p-2.5 text-[11px] leading-4 text-emerald-800">{errors.length ? tl("Ho costruito il workflow ma restano dei punti da sistemare (sopra). ") : tl("Il workflow è pronto. ")}{tl("Ora è tuo: modifica i parametri dall’Inspector e premi Esegui quando vuoi.")}</p>
          <div className="flex gap-2">
            <Button onClick={undoAll} tone="neutral" surface="outline" density="compact" className="rounded-full"><Undo2 className="h-3.5 w-3.5" /> {tl("Annulla tutto")}</Button>
            <Button onClick={() => { setPhase('idle'); setIntent(''); setIntake(null); setPlan(null); setReview(null); setUndo(null) }} tone="accent" surface="solid" density="compact" fullWidth className="rounded-full">{tl("Nuova richiesta")}</Button></div>
        </>}
      </>}

      {error && <p className="rounded-xl bg-rose-50 p-2.5 text-[11px] leading-4 text-rose-700" role="alert">{error}</p>}
      </>}
    </div>}

    {!historyOpen && <footer className="shrink-0 border-t border-slate-100 bg-white p-2.5">
      <div className={`flex items-end gap-1 rounded-2xl border bg-slate-50 px-2 py-1.5 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 ${composerDisabled ? 'opacity-70' : 'border-slate-200'}`}>
        <textarea ref={composerRef} value={composer} onChange={(event) => setComposer(event.target.value)} disabled={composerDisabled} rows={1} maxLength={4000}
          onInput={(event) => { const el = event.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px` }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendComposer() } }}
          placeholder={composerPlaceholder} aria-label={tl("Messaggio per l’assistente")}
          className="max-h-[120px] min-h-[28px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-xs leading-5 text-slate-800 outline-none placeholder:text-slate-400" />
        <VoiceRecorder compact allowTranslate={false} onInsertText={(text) => setComposer((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text))} />
        {editBusy || phase === 'planning' || phase === 'intake'
          ? <button type="button" onClick={() => abortRef.current?.abort()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white hover:bg-slate-800" aria-label={tl("Interrompi")} title={tl("Interrompi")}><Square className="h-3 w-3 fill-white" /></button>
          : <button type="button" onClick={sendComposer} disabled={!composer.trim() || composerDisabled} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300" aria-label={tl("Invia")} title={tl("Invia (Invio)")}><ArrowUp className="h-4 w-4" /></button>}
      </div>
    </footer>}
  </aside>
}
