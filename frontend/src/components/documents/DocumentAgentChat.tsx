import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Loader2, MousePointer2, Send, X } from 'lucide-react'
import { llmApi } from '@/lib/api'
import { useServerHealth } from '@/components/ServerHealthIndicator'

export type DocumentAssistContext = {
  id: string
  kind: 'selected_text' | 'slide_block' | 'slide' | 'presentation'
  label: string
  detail: string
  target: Record<string, unknown>
  beforePreview: string
}

type AgentStep = { agent?: string; summary?: string }
type Proposal = Record<string, unknown> & { kind?: string }
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: 'message' | 'agent_step'
  agentName?: string
  proposal?: Proposal
  beforePreview?: string
  status?: 'pending' | 'applied' | 'rejected'
}

type Props = {
  context: DocumentAssistContext | null
  presentationContext?: DocumentAssistContext | null
  documentContext: Record<string, unknown>
  dims?: { width: number; height: number }
  onApply: (proposal: Proposal) => void
  onClose: () => void
}

function proposalPreview(proposal: Proposal) {
  if (typeof proposal.replacement_text === 'string') return proposal.replacement_text
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

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export default function DocumentAgentChat({ context, presentationContext, documentContext, dims, onApply, onClose }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [retryNotice, setRetryNotice] = useState('')
  const [wholePresentation, setWholePresentation] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const { data: serverHealth } = useServerHealth()
  const activeContext = wholePresentation && presentationContext ? presentationContext : context
  const lastContextId = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeContext || activeContext.id === lastContextId.current) return
    lastContextId.current = activeContext.id
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `Hai selezionato ${activeContext.label.toLowerCase()}: “${activeContext.detail}”. Vuoi chiedermi una modifica?`,
    }])
  }, [activeContext])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    const prompt = input.trim()
    if (!prompt || loading) return
    if (!activeContext) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Prima seleziona un testo nel documento oppure una slide o un oggetto nella presentazione.',
      }])
      return
    }

    setInput('')
    setLoading(true)
    setRetryNotice('')
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: prompt }])
    try {
      const maxAttempts = serverHealth?.status === 'red' ? 3 : 2
      let response
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          response = await llmApi.documentAssist({
            prompt,
            target: { kind: activeContext.kind, ...activeContext.target },
            document_context: documentContext,
            dims,
          })
          break
        } catch (error: any) {
          const status = error?.response?.status
          const retryable = !status || [502, 503, 504].includes(status)
          if (!retryable || attempt === maxAttempts) throw error
          const delay = attempt * 2000
          setRetryNotice(`Server ${serverHealth?.status === 'red' ? 'in aggiornamento o sotto carico' : 'temporaneamente occupato'}: nuovo tentativo ${attempt + 1}/${maxAttempts}…`)
          await wait(delay)
        }
      }
      if (!response) throw new Error('No response')
      const data = response.data as { summary?: string; proposal?: Proposal; agent_steps?: AgentStep[] }
      const steps = (data.agent_steps || []).filter((step) => step.summary)
      const contextualProposal = data.proposal
        ? { ...data.proposal, client_context: activeContext.target, client_context_id: activeContext.id }
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
          beforePreview: activeContext.beforePreview,
          status: 'pending',
        },
      ])
    } catch (error: any) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [502, 503, 504].includes(error?.response?.status)
          ? 'Il server non è ancora disponibile dopo i nuovi tentativi. Riprova tra poco: la presentazione non è stata modificata.'
          : error?.response?.data?.detail || 'Non riesco a preparare la modifica in questo momento.',
      }])
    } finally {
      setRetryNotice('')
      setLoading(false)
    }
  }

  const updateProposalStatus = (id: string, status: 'applied' | 'rejected') => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, status } : message))
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-sm">
      <header className="flex min-h-16 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><Bot className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black text-slate-950">Document Builder</h3>
          <p className="truncate text-[11px] font-medium text-slate-500">Modifiche contestuali con conferma</p>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi assistente"><X className="h-4 w-4" /></button>
      </header>

      <div className="border-b border-slate-100 bg-slate-50/80 p-3">
        {presentationContext && (
          <div className="mb-2 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1 text-[11px] font-bold">
            <button type="button" onClick={() => setWholePresentation(false)} className={`rounded-lg px-2 py-1.5 transition ${!wholePresentation ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>Slide / oggetto</button>
            <button type="button" onClick={() => setWholePresentation(true)} className={`rounded-lg px-2 py-1.5 transition ${wholePresentation ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>Intera presentazione</button>
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
            Seleziona ciò che vuoi cambiare: lo analizzerò e mostrerò la proposta prima di applicarla.
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
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.proposal && (
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
        {loading && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900"><Loader2 className="h-4 w-4 animate-spin" />{retryNotice || 'Gli agenti stanno preparando la proposta…'}</div>}
        <div ref={bottomRef} />
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-slate-200 bg-white p-3 shadow-[0_-8px_18px_rgba(15,23,42,0.05)]">
        <div className="flex items-end gap-2 rounded-[22px] border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-violet-300">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
            rows={2}
            placeholder={activeContext ? 'Chiedi una modifica…' : 'Seleziona prima un contenuto…'}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-snug text-slate-700 outline-none placeholder:text-slate-400"
          />
          <button type="button" onClick={() => void send()} disabled={loading || !input.trim()} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-violet-300 bg-violet-600 px-3 text-xs font-black text-white transition hover:bg-violet-700 disabled:opacity-40" title="Invia modifica">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">Invia modifica</span>
          </button>
        </div>
      </footer>
    </aside>
  )
}
