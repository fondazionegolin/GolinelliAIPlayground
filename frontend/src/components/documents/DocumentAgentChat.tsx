import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Loader2, MousePointer2, Send, Sparkles, X } from 'lucide-react'
import { llmApi } from '@/lib/api'
import { useServerHealth } from '@/components/ServerHealthIndicator'
import type { FormatOperation } from '@/lib/documentFormatOps'
import { PLACEMENT_LABEL, type WritePlacement, type WriteSpec } from '@/lib/documentWriting'
import { sanitizeDocumentHtml } from '@/lib/sanitizeDocumentHtml'

export type DocumentAssistContext = {
  id: string
  kind: 'selected_text' | 'document' | 'slide_block' | 'slide' | 'presentation'
  label: string
  detail: string
  target: Record<string, unknown>
  /** Heavy payloads (e.g. the whole document HTML) are read only when the request is sent. */
  resolveTarget?: () => Record<string, unknown>
  beforePreview: string
}

type AgentStep = { agent?: string; summary?: string }
type Proposal = Record<string, unknown> & { kind?: string }
type Plan = { understanding: string; approach: 'format' | 'write' | 'rewrite' | 'ask'; question?: string; operations: FormatOperation[]; write?: WriteSpec | null }
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: 'message' | 'agent_step'
  agentName?: string
  proposal?: Proposal
  beforePreview?: string
  status?: 'pending' | 'applied' | 'rejected'
  plan?: Plan
  planPrompt?: string
  planTarget?: DocumentAssistContext
  /** The interpretation the agent acted on (shown as «Ho capito così»). */
  understood?: boolean
  /** Kept on a written proposal so it can be refined («più lungo», «più formale»…). */
  writeInfo?: { prompt: string; plan: Plan; target: DocumentAssistContext }
}

type Props = {
  context: DocumentAssistContext | null
  selectionContext?: DocumentAssistContext | null
  presentationContext?: DocumentAssistContext | null
  documentContext: Record<string, unknown>
  dims?: { width: number; height: number }
  /** Text-document mode: default scope is the whole document, a selection narrows it. */
  variant?: 'document' | 'slides'
  /** Compact structure summary of the document/selection, sent to the interpretation step. */
  getDocumentStats?: (target: DocumentAssistContext) => Record<string, unknown>
  /** Runs confirmed formatting operations on the editor; returns human-readable result lines. */
  onApplyOperations?: (operations: FormatOperation[], target: DocumentAssistContext) => string[]
  /** Title, outline and the text around the insertion point, for writing tasks. */
  getWritingContext?: (target: DocumentAssistContext) => Record<string, unknown>
  onApply: (proposal: Proposal) => void
  onClose: () => void
}

function htmlToPlainText(html: string) {
  const container = window.document.createElement('div')
  container.innerHTML = html
  return (container.textContent || '').replace(/\s+/g, ' ').trim()
}

function proposalPreview(proposal: Proposal) {
  if (typeof proposal.replacement_text === 'string') return proposal.replacement_text
  if (typeof proposal.replacement_html === 'string') return htmlToPlainText(proposal.replacement_html).slice(0, 400)
  const block = proposal.replacement_block as Record<string, unknown> | undefined
  if (block) {
    const content = typeof block.content === 'string' && block.content ? `\n${block.content}` : ''
    return `${String(block.type || 'oggetto')}${content}`
  }
  const slide = proposal.replacement_slide as { title?: string; blocks?: unknown[] } | undefined
  if (slide) return `${slide.title || 'Slide'}\n${slide.blocks?.length || 0} oggetti`
  const presentation = proposal.replacement_presentation as { title?: string; slides?: unknown[] } | undefined
  if (presentation) return `${presentation.title || 'Presentazione'}\n${presentation.slides?.length || 0} slide`
  return 'Modifica pronta'
}

const SELECTION_SUGGESTIONS: Array<[string, string]> = [
  ['Espandi', 'Espandi il testo selezionato sviluppando meglio i concetti, con spiegazioni ed esempi'],
  ['Riassumi', 'Riassumi il testo selezionato'],
  ['Semplifica', 'Semplifica il testo selezionato con parole più chiare'],
  ['Correggi', 'Correggi errori e migliora la forma del testo selezionato'],
  ['Più formale', 'Riscrivi il testo selezionato con un tono più formale'],
]
const CURSOR_SUGGESTIONS: Array<[string, string]> = [
  ['Continua a scrivere', 'Continua a scrivere da dove il testo si interrompe, nel mio stile'],
  ['Sviluppa il documento', 'Sviluppa il documento a partire dal titolo e da ciò che ho già scritto'],
  ['Aggiungi conclusione', 'Aggiungi una conclusione coerente in fondo al documento'],
  ['Aggiungi introduzione', 'Scrivi un’introduzione adatta all’inizio del documento'],
]

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export default function DocumentAgentChat({ context, selectionContext, presentationContext, documentContext, dims, variant = 'slides', getDocumentStats, onApplyOperations, getWritingContext, onApply, onClose }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [retryNotice, setRetryNotice] = useState('')
  const [scope, setScope] = useState<'current' | 'selection' | 'presentation'>('current')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const { data: serverHealth } = useServerHealth()
  const activeContext = scope === 'selection' && selectionContext
    ? selectionContext
    : scope === 'presentation' && presentationContext
      ? presentationContext
      : context
  const activeContextId = activeContext?.id
  const activeContextKind = activeContext?.kind
  const activeContextLabel = activeContext?.label
  const activeContextDetail = activeContext?.detail
  const lastContextId = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isDocument = variant === 'document'
  const selectionContextId = selectionContext?.id

  // Document mode: a selection narrows the scope automatically, clearing it goes back to the whole document.
  useEffect(() => {
    if (!isDocument) return
    setScope(selectionContextId ? 'selection' : 'current')
  }, [isDocument, selectionContextId])

  useEffect(() => {
    if (scope === 'selection' && !selectionContext) setScope('current')
    if (scope === 'presentation' && !presentationContext) setScope('current')
  }, [presentationContext, scope, selectionContext])

  useEffect(() => {
    if (!activeContextId || !activeContextLabel || !activeContextDetail || activeContextId === lastContextId.current) return
    // Text documents show the selection in the context box: no chat message for every selection change.
    if (isDocument || activeContextKind === 'document') { lastContextId.current = activeContextId; return }

    const announceContext = () => {
      lastContextId.current = activeContextId
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Hai selezionato ${activeContextLabel.toLowerCase()}: “${activeContextDetail}”. Vuoi chiedermi una modifica?`,
      }])
    }

    // Text selection changes repeatedly while the pointer is moving. Wait until it
    // has been stable long enough to announce only the user's final selection.
    const timer = window.setTimeout(announceContext, activeContextKind === 'selected_text' ? 800 : 0)
    return () => window.clearTimeout(timer)
  }, [activeContextId, activeContextKind, activeContextLabel, activeContextDetail, isDocument])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const callAssist = async (data: Parameters<typeof llmApi.documentAssist>[0], options: { timeout?: number; retries?: boolean } = {}) => {
    // Long writing calls are never retried blindly: a retry would pay (and wait) for the whole text twice.
    const maxAttempts = options.retries === false ? 1 : serverHealth?.status === 'red' ? 3 : 2
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await llmApi.documentAssist(data, undefined, options.timeout)
      } catch (error: any) {
        const status = error?.response?.status
        const retryable = !status || [502, 503, 504].includes(status)
        if (!retryable || attempt === maxAttempts) throw error
        setRetryNotice(`Server ${serverHealth?.status === 'red' ? 'in aggiornamento o sotto carico' : 'temporaneamente occupato'}: nuovo tentativo ${attempt + 1}/${maxAttempts}…`)
        await wait(attempt * 2000)
      }
    }
    throw new Error('No response')
  }

  const pushAssistant = (content: string, extra: Partial<ChatMessage> = {}) =>
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content, ...extra }])

  const failureText = (error: any) => [502, 503, 504].includes(error?.response?.status)
    ? 'Il server non è ancora disponibile dopo i nuovi tentativi. Riprova tra poco: il documento non è stato modificato.'
    : error?.response?.data?.detail || 'Non riesco a preparare la modifica in questo momento.'

  /** Generates a reviewable proposal (rewrites / slides). */
  const generate = async (prompt: string, target: DocumentAssistContext) => {
    setLoading(true)
    setRetryNotice('')
    try {
      const resolvedTarget = { ...target.target, ...(target.resolveTarget?.() ?? {}) }
      const response = await callAssist({
        prompt,
        target: { kind: target.kind, ...resolvedTarget },
        document_context: documentContext,
        dims,
      })
      const data = response.data as { summary?: string; proposal?: Proposal; agent_steps?: AgentStep[] }
      const steps = (data.agent_steps || []).filter((step) => step.summary)
      const contextualProposal = data.proposal
        ? { ...data.proposal, client_context: resolvedTarget, client_context_id: target.id }
        : undefined
      setMessages((current) => [
        ...current,
        ...steps.map<ChatMessage>((step) => ({
          id: crypto.randomUUID(),
          role: 'assistant',
          kind: 'agent_step',
          agentName: step.agent || 'Agente',
          content: step.summary || '',
        })),
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.summary || 'Ho preparato una proposta contestuale.',
          proposal: contextualProposal,
          beforePreview: target.beforePreview,
          status: 'pending',
        },
      ])
    } catch (error: any) {
      pushAssistant(failureText(error))
    } finally {
      setRetryNotice('')
      setLoading(false)
    }
  }

  /** Document mode, step 1: the agent says what it understood and waits for the user's confirmation. */
  const interpret = async (prompt: string, target: DocumentAssistContext) => {
    setLoading(true)
    setRetryNotice('')
    try {
      const history = messages
        .filter((message) => message.kind !== 'agent_step')
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.plan?.understanding || message.content }))
      const response = await callAssist({
        prompt,
        mode: 'plan',
        target: { kind: target.kind, ...(target.kind === 'selected_text' ? { text: target.target.text } : {}) },
        document_context: documentContext,
        document_stats: getDocumentStats?.(target),
        history,
      })
      const plan = (response.data as { plan: Plan }).plan
      if (plan.approach === 'ask') {
        pushAssistant(plan.question || plan.understanding)
      } else if (plan.approach === 'format') {
        // Formatting applies instantly: confirm the interpretation first.
        pushAssistant(plan.understanding, { plan, planPrompt: prompt, planTarget: target, status: 'pending' })
      } else {
        // Writing / rewriting: the reviewable proposal (with Applica / Rifiuta) is the confirmation.
        pushAssistant(plan.understanding, { understood: true })
        setLoading(false)
        if (plan.approach === 'write' && plan.write) await runWrite(prompt, plan, target)
        else await generate(`${prompt}\n\nInterpretazione confermata dall'utente: ${plan.understanding}`, target)
        return
      }
    } catch (error: any) {
      pushAssistant(failureText(error))
    } finally {
      setRetryNotice('')
      setLoading(false)
    }
  }

  /** Writing tasks (expand / continue / draft / summarise): the agent writes with the document as context. */
  const runWrite = async (prompt: string, plan: Plan, target: DocumentAssistContext, previousDraft?: string, specOverride?: WriteSpec) => {
    setLoading(true)
    setRetryNotice('')
    try {
      const spec = specOverride ?? plan.write!
      const writingContext = getWritingContext?.(target)
      const response = await callAssist({
        prompt,
        mode: 'write',
        target: { kind: target.kind, ...(target.kind === 'selected_text' ? { text: target.target.text } : {}) },
        document_context: documentContext,
        writing_context: writingContext,
        write_spec: spec as unknown as Record<string, unknown>,
        understanding: plan.understanding,
        previous_draft: previousDraft,
        merge_first_paragraph: previousDraft ? spec.merge_first_paragraph : undefined,
      }, { timeout: 300000, retries: false })
      const data = response.data as { summary?: string; proposal?: Proposal; agent_steps?: AgentStep[] }
      const steps = (data.agent_steps || []).filter((step) => step.summary)
      const proposal = data.proposal
        ? { ...data.proposal, client_context: { range: (writingContext as { range?: unknown } | undefined)?.range }, client_context_id: target.id }
        : undefined
      setMessages((current) => [
        ...current,
        ...steps.map<ChatMessage>((step) => ({ id: crypto.randomUUID(), role: 'assistant', kind: 'agent_step', agentName: step.agent || 'Writer', content: step.summary || '' })),
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.summary || 'Ho preparato il testo.',
          proposal,
          beforePreview: target.beforePreview,
          status: 'pending',
          writeInfo: { prompt, plan: { ...plan, write: (proposal as { spec?: WriteSpec } | undefined)?.spec ?? spec }, target },
        },
      ])
    } catch (error: any) {
      pushAssistant(failureText(error))
    } finally {
      setRetryNotice('')
      setLoading(false)
    }
  }

  const REFINEMENTS: Array<{ label: string; instruction: string; factor: number }> = [
    { label: 'Più lungo', instruction: 'Rendi il testo più lungo e sviluppato: aggiungi spiegazioni, esempi concreti e collegamenti, senza ripetere.', factor: 1.6 },
    { label: 'Più breve', instruction: 'Accorcia il testo mantenendo i punti essenziali.', factor: 0.6 },
    { label: 'Più formale', instruction: 'Riscrivi con un registro più formale e curato.', factor: 1 },
    { label: 'Più semplice', instruction: 'Riscrivi con parole e frasi più semplici e chiare, adatte a studenti.', factor: 1 },
    { label: 'Rigenera', instruction: 'Scrivi una versione diversa, con un taglio e degli esempi alternativi.', factor: 1 },
  ]

  const refineWrite = async (message: ChatMessage, refinement: (typeof REFINEMENTS)[number]) => {
    const info = message.writeInfo
    const proposal = message.proposal as { html?: string } | undefined
    if (!info?.plan.write || !proposal?.html || loading) return
    updateProposalStatus(message.id, 'rejected')
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: refinement.label }])
    const spec = { ...info.plan.write, target_words: Math.max(20, Math.min(2500, Math.round(info.plan.write.target_words * refinement.factor))) }
    await runWrite(refinement.instruction, info.plan, info.target, proposal.html, spec)
  }

  const send = async (override?: string) => {
    const prompt = (override ?? input).trim()
    if (!prompt || loading) return
    if (!activeContext) {
      pushAssistant(isDocument ? 'Il documento non è ancora disponibile.' : 'Prima seleziona un testo nel documento oppure una slide o un oggetto nella presentazione.')
      return
    }
    setInput('')
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: prompt }])
    if (isDocument && (activeContext.kind === 'document' || activeContext.kind === 'selected_text')) await interpret(prompt, activeContext)
    else await generate(prompt, activeContext)
  }

  const confirmPlan = async (message: ChatMessage) => {
    const { plan, planPrompt, planTarget } = message
    if (!plan || !planTarget || loading) return
    updateProposalStatus(message.id, 'applied')
    if (plan.approach === 'format' && onApplyOperations) {
      const lines = onApplyOperations(plan.operations, planTarget)
      pushAssistant(lines.length ? `Fatto: ${lines.join(' · ')}. Puoi annullare con Ctrl+Z.` : 'Non c’era nulla da cambiare: il documento era già così.')
      return
    }
    await generate(`${planPrompt}\n\nInterpretazione confermata dall'utente: ${plan.understanding}`, planTarget)
  }

  const correctPlan = (message: ChatMessage) => {
    updateProposalStatus(message.id, 'rejected')
    pushAssistant('Va bene, non applico nulla. Dimmi cosa vuoi correggere (es. «intendevo l’interlinea, non lo spazio tra paragrafi»).')
  }

  const updateProposalStatus = (id: string, status: 'applied' | 'rejected') => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, status } : message))
  }

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] shrink-0 flex-col border-l border-slate-200 bg-white shadow-2xl xl:static xl:z-auto xl:w-[360px] xl:shadow-sm"
      aria-label="Assistente documento"
    >
      <header className="flex min-h-16 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Bot className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black text-slate-950">Document Builder</h3>
          <p className="truncate text-[11px] font-medium text-slate-500">{isDocument ? 'Scrive, espande, riformula e impagina nel contesto del documento' : 'Modifiche contestuali con conferma'}</p>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi assistente"><X className="h-4 w-4" /></button>
      </header>

      <div className="border-b border-slate-100 bg-slate-50/80 p-3">
        {isDocument && (
          <div className="mb-2 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1 text-[11px] font-bold">
            <button type="button" onClick={() => setScope('current')} className={`rounded-lg px-2 py-1.5 transition ${scope === 'current' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>Tutto il documento</button>
            <button type="button" disabled={!selectionContext} onClick={() => setScope('selection')} className={`rounded-lg px-2 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${scope === 'selection' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`} title={selectionContext ? undefined : 'Seleziona del testo nel documento'}>Selezione</button>
          </div>
        )}
        {!isDocument && (selectionContext || presentationContext) && (
          <div className={`mb-2 grid ${selectionContext && presentationContext ? 'grid-cols-3' : 'grid-cols-2'} rounded-xl bg-slate-200/70 p-1 text-[11px] font-bold`}>
            <button type="button" onClick={() => setScope('current')} className={`rounded-lg px-2 py-1.5 transition ${scope === 'current' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>Slide / oggetto</button>
            {selectionContext && <button type="button" onClick={() => setScope('selection')} className={`rounded-lg px-2 py-1.5 transition ${scope === 'selection' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>Selezionate</button>}
            {presentationContext && <button type="button" onClick={() => setScope('presentation')} className={`rounded-lg px-2 py-1.5 transition ${scope === 'presentation' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>Intera presentazione</button>}
          </div>
        )}
        {activeContext ? (
          <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2.5">
            <MousePointer2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">{activeContext.label}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600">{activeContext.detail}</p>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-xs leading-5 text-slate-500">Seleziona testo, una slide o un oggetto per darmi un contesto preciso.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4 text-xs leading-5 text-violet-950">
            {isDocument
              ? 'Sono il tuo co-autore. Posso continuare un testo da dove si ferma, svilupparlo a partire da titolo e incipit, espandere o riassumere una selezione, riformulare e sistemare la formattazione: sempre tenendo conto di tutto il documento. Metti il cursore dove vuoi che scriva, oppure seleziona il testo da elaborare. Vedi la proposta prima che venga inserita.'
              : 'Seleziona ciò che vuoi cambiare: lo analizzerò e mostrerò la proposta prima di applicarla.'}
          </div>
        )}
        {messages.map((message) => {
          if (message.kind === 'agent_step') return (
            <div key={message.id} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
              <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-sky-700">{message.agentName || 'Agente'}</p>
              <p className="text-xs leading-5 text-slate-700">{message.content}</p>
            </div>
          )
          const isUser = message.role === 'user'
          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[92%] rounded-2xl px-3.5 py-3 text-xs leading-5 shadow-sm ${isUser ? 'rounded-br-md bg-slate-950 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-700'}`}>
                {(message.plan || message.understood) && !isUser && <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-violet-700">Ho capito così</p>}
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.plan && (
                  message.status === 'pending' ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-semibold text-slate-500">{message.plan.approach === 'format' ? 'Applico solo la formattazione, senza toccare le parole.' : 'Riscriverò il testo e vedrai la proposta prima di applicarla.'} Procedo?</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => correctPlan(message)} className="h-9 flex-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">No, correggo</button>
                        <button type="button" onClick={() => void confirmPlan(message)} disabled={loading} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"><Check className="h-3.5 w-3.5" />Sì, procedi</button>
                      </div>
                    </div>
                  ) : (
                    <p className={`mt-2 text-[10px] font-black uppercase tracking-wide ${message.status === 'applied' ? 'text-emerald-700' : 'text-slate-400'}`}>{message.status === 'applied' ? 'Confermato' : 'Non confermato'}</p>
                  )
                )}
                {message.proposal && message.proposal.kind === 'write' ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-violet-200 bg-white text-slate-700">
                    <div className="flex items-center justify-between gap-2 bg-violet-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-violet-700">
                      <span>{PLACEMENT_LABEL[message.proposal.placement as WritePlacement] ?? 'Testo proposto'}</span>
                      <span className="shrink-0">{String(message.proposal.words)} parole</span>
                    </div>
                    <div
                      className="max-h-72 overflow-y-auto px-3 py-2.5 text-[12px] leading-5 text-slate-800 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[13px] [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-bold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
                      dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(String(message.proposal.html || '')) }}
                    />
                    {message.beforePreview && message.proposal.placement === 'replace_selection' && (
                      <details className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
                        <summary className="cursor-pointer font-semibold">Testo originale</summary>
                        <p className="mt-1 whitespace-pre-wrap">{message.beforePreview}</p>
                      </details>
                    )}
                    {message.status === 'pending' ? (
                      <>
                        <div className="flex flex-wrap gap-1 border-t border-slate-100 bg-slate-50 px-2 py-1.5">
                          {REFINEMENTS.map((refinement) => (
                            <button key={refinement.label} type="button" disabled={loading} onClick={() => void refineWrite(message, refinement)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-violet-300 hover:text-violet-700 disabled:opacity-40">{refinement.label}</button>
                          ))}
                        </div>
                        <div className="flex gap-2 border-t border-slate-200 bg-white p-2">
                          <button type="button" onClick={() => updateProposalStatus(message.id, 'rejected')} className="h-9 flex-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Rifiuta</button>
                          <button type="button" onClick={() => { onApply(message.proposal!); updateProposalStatus(message.id, 'applied') }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-bold text-white hover:bg-slate-800"><Check className="h-3.5 w-3.5" />Inserisci</button>
                        </div>
                      </>
                    ) : (
                      <p className={`border-t border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wide ${message.status === 'applied' ? 'text-emerald-700' : 'text-slate-400'}`}>{message.status === 'applied' ? 'Testo inserito · Ctrl+Z per annullare' : 'Proposta scartata'}</p>
                    )}
                  </div>
                ) : message.proposal && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                    <div className="grid grid-cols-2 divide-x divide-slate-200">
                      <div className="min-w-0 p-2.5"><p className="mb-1 text-[9px] font-black uppercase tracking-wide text-red-600">Prima</p><p className="line-clamp-5 whitespace-pre-wrap text-[11px] leading-4">{message.beforePreview}</p></div>
                      <div className="min-w-0 p-2.5"><p className="mb-1 text-[9px] font-black uppercase tracking-wide text-sky-700">Proposta</p><p className="line-clamp-5 whitespace-pre-wrap text-[11px] leading-4">{proposalPreview(message.proposal)}</p></div>
                    </div>
                    {message.status === 'pending' ? (
                      <div className="flex gap-2 border-t border-slate-200 bg-white p-2">
                        <button type="button" onClick={() => updateProposalStatus(message.id, 'rejected')} className="h-9 flex-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Rifiuta</button>
                        <button type="button" onClick={() => { onApply(message.proposal!); updateProposalStatus(message.id, 'applied') }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-bold text-white hover:bg-slate-800"><Check className="h-3.5 w-3.5" />Applica</button>
                      </div>
                    ) : (
                      <p className={`border-t border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wide ${message.status === 'applied' ? 'text-emerald-700' : 'text-slate-400'}`}>{message.status === 'applied' ? 'Modifica applicata' : 'Proposta rifiutata'}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {loading && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900"><Loader2 className="h-4 w-4 animate-spin" />{retryNotice || (isDocument ? 'Sto lavorando sul documento… i testi lunghi richiedono un po’ di tempo' : 'Gli agenti stanno preparando la proposta…')}</div>}
        <div ref={bottomRef} />
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-slate-200 bg-white p-3 shadow-[0_-8px_18px_rgba(23,23,23,0.05)]">
        {isDocument && !loading && (
          <div className="mb-2 flex flex-wrap gap-1">
            {(selectionContext ? SELECTION_SUGGESTIONS : CURSOR_SUGGESTIONS).map(([label, prompt]) => (
              <button key={label} type="button" onClick={() => void send(prompt)} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50/60 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100">
                <Sparkles className="h-3 w-3" />{label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[22px] border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-violet-300">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
            rows={2}
            placeholder={activeContext ? (isDocument ? (selectionContext ? 'Es. «Espandi con un esempio concreto»' : 'Es. «Continua» o «Scrivi una conclusione»') : 'Chiedi una modifica…') : 'Seleziona prima un contenuto…'}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-snug text-slate-700 outline-none placeholder:text-slate-400"
          />
          <button type="button" onClick={() => void send()} disabled={loading || !input.trim()} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-violet-300 bg-violet-600 px-3 text-xs font-black text-white transition hover:bg-violet-700 disabled:opacity-40" title="Invia modifica">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{isDocument ? 'Invia' : 'Invia modifica'}</span>
          </button>
        </div>
      </footer>
    </aside>
  )
}
