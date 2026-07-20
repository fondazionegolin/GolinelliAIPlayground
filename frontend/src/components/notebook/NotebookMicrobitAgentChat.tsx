import { useEffect, useRef, useState } from 'react'
import { Bot, Check, GitCompare, History, Loader2, Send, X } from 'lucide-react'
import axios from 'axios'
import { notebooksApi } from '@/lib/api'
import type { NotebookCodeProposal, NotebookTutorMessage } from './types'

interface Props {
  notebookId: string
  device?: 'microbit' | 'circuitplayground' | 'python' | 'p5js'
  currentCellSource: string
  lastOutput?: string
  initialMessages?: NotebookTutorMessage[]
  pendingProposals?: NotebookCodeProposal[]
  onProposals: (summary: string, proposals: NotebookCodeProposal[]) => void
  onApplyProposal: (proposalId: string) => void
  onRejectProposal: (proposalId: string) => void
  onOpenVersions?: () => void
}

const CREDIT_EXHAUSTED_MESSAGE = 'Crediti AI esauriti. Attendi il rinnovo del plafond o contatta il docente/amministratore.'

function getRangeText(source: string, lineStart: number, lineEnd: number) {
  return source.split('\n').slice(Math.max(0, lineStart - 1), lineEnd).join('\n')
}

// Stesse bolle a stadi di Coding Lab (Prompt Analyst / Architetto / File Writer /
// Reviewer / Coding Builder), stessi toni per kind, adattati alla palette chiara di
// questo componente invece delle CSS var di Coding Lab.
function AgentMessageBubble({ message }: { message: NotebookTutorMessage }) {
  const isUser = message.role === 'user'
  const kind = message.metadata?.kind
  const isFeedback = kind === 'agent_progress' || kind === 'agent_reasoning' || kind === 'file_write_summary' || kind === 'agent_feedback'
  const label = isUser ? 'Tu' : message.agent_name || 'Agente'

  if (isFeedback) {
    const tone = kind === 'file_write_summary'
      ? { border: 'border-sky-200 bg-sky-50', label: 'text-sky-700' }
      : kind === 'agent_reasoning'
        ? { border: 'border-amber-200 bg-amber-50', label: 'text-amber-800' }
        : { border: 'border-slate-200 bg-slate-50', label: 'text-slate-500' }
    return (
      <div className={`rounded-xl border px-3 py-2.5 ${tone.border}`}>
        <div className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${tone.label}`}>{label}</div>
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
          {message.content}
        </p>
        {kind === 'file_write_summary' && (message.metadata?.files?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.metadata!.files!.map((file) => (
              <span
                key={file.path}
                className="rounded-full border border-sky-200 bg-white px-2 py-1 text-[11px] font-semibold text-sky-700"
              >
                {file.path} · {file.lines} righe
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${
        isUser
          ? 'rounded-tr-sm bg-slate-900 text-white'
          : 'rounded-tl-sm border border-slate-200 bg-slate-50 text-slate-700'
      }`}>
        <div className={`mb-0.5 text-[10px] font-bold uppercase tracking-wide ${isUser ? 'text-slate-300' : 'text-slate-500'}`}>
          {label}
        </div>
        <p className="whitespace-pre-wrap leading-6">{message.content}</p>
      </div>
    </div>
  )
}

function DiffBlock({ source, proposal }: { source: string; proposal: NotebookCodeProposal }) {
  const before = getRangeText(source, proposal.line_start, proposal.line_end)
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950 font-mono text-[11px]">
      <div className="border-b border-slate-800 px-3 py-1 text-slate-500">
        righe {proposal.line_start}{proposal.line_end !== proposal.line_start ? `-${proposal.line_end}` : ''}
      </div>
      {before.split('\n').map((line, index) => (
        <div key={`old-${index}`} className="flex gap-2 bg-red-950/30 px-3 py-0.5 text-red-200">
          <span className="text-red-500">-</span>
          <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
        </div>
      ))}
      {proposal.replacement.split('\n').map((line, index) => (
        <div key={`new-${index}`} className="flex gap-2 bg-emerald-950/30 px-3 py-0.5 text-emerald-200">
          <span className="text-emerald-500">+</span>
          <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
        </div>
      ))}
    </div>
  )
}

const DEVICE_COPY = {
  microbit: {
    label: 'micro:bit',
    title: 'Tutor agentico micro:bit',
    subtitle: 'Trasforma intenzioni creative in codice commentato',
    intro: 'Il tutor propone codice Python o JavaScript per micro:bit, aggiunge commenti in italiano e mostra il diff prima di applicare.',
    placeholder: 'Esempio: voglio accendere i LED quando inclino la scheda e mandare la temperatura al browser',
    emptyTitle: 'Descrivi cosa vuoi far fare alla scheda.',
  },
  circuitplayground: {
    label: 'Circuit Playground Express',
    title: 'Tutor agentico Circuit Playground',
    subtitle: 'Trasforma intenzioni creative in MakeCode TypeScript',
    intro: 'Il tutor propone codice MakeCode TypeScript per Circuit Playground Express, aggiunge commenti in italiano e mostra il diff prima di applicare.',
    placeholder: 'Esempio: voglio cambiare i NeoPixel con la luce e mandare temperatura e movimento al browser',
    emptyTitle: 'Descrivi cosa vuoi far fare alla scheda.',
  },
  python: {
    label: 'Python',
    title: 'Tutor agentico Python',
    subtitle: 'Trasforma richieste in codice Python commentato',
    intro: 'Il tutor propone modifiche al codice Python della cella, aggiunge commenti in italiano e mostra il diff prima di applicare.',
    placeholder: 'Esempio: voglio leggere un file CSV e stampare la media di una colonna',
    emptyTitle: 'Descrivi cosa vuoi che faccia il tuo codice.',
  },
  p5js: {
    label: 'p5.js',
    title: 'Tutor agentico p5.js',
    subtitle: 'Trasforma idee creative in sketch p5.js',
    intro: 'Il tutor propone codice p5.js per il tuo sketch, aggiunge commenti in italiano e mostra il diff prima di applicare.',
    placeholder: 'Esempio: voglio che i cerchi cambino colore quando muovo il mouse',
    emptyTitle: 'Descrivi cosa vuoi che faccia il tuo sketch.',
  },
} as const

export default function NotebookMicrobitAgentChat({
  notebookId,
  device = 'microbit',
  currentCellSource,
  lastOutput = '',
  initialMessages = [],
  pendingProposals = [],
  onProposals,
  onApplyProposal,
  onRejectProposal,
  onOpenVersions,
}: Props) {
  const copy = DEVICE_COPY[device]
  const beginnerSuggestions = device === 'python' ? [
    'Scrivi un esempio semplice che usa variabili, input e print, spiegandomi ogni riga.',
    'Aiutami a leggere una lista di numeri e calcolarne media, minimo e massimo.',
    'Controlla il mio codice, spiegami l’errore con parole semplici e proponi una correzione.',
  ] : []
  const [messages, setMessages] = useState<NotebookTutorMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages, notebookId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, pendingProposals])

  // python/p5js usano la pipeline agentica a due chiamate Sonnet (~140s totali): troppo
  // lunga per una POST JSON sincrona dietro Cloudflare (524). Per questi si usa lo stream
  // SSE, che manda subito il primo byte e fa comparire le bolle d'agente dal vivo. I device
  // (microbit/circuitplayground) restano sulla POST JSON: una sola chiamata veloce.
  const useStreaming = device === 'python' || device === 'p5js'

  const sendStreaming = async (text: string) => {
    // Auth: cookie per i docenti (credentials include), student-token per gli studenti —
    // stessa logica dell'interceptor axios (niente student-token se c'è auth docente).
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let hasTeacherAuth = false
    try {
      const raw = localStorage.getItem('eduai-auth')
      if (raw) {
        const parsed = JSON.parse(raw)
        hasTeacherAuth = Boolean(parsed?.state?.user && parsed?.state?.accessToken)
      }
    } catch { hasTeacherAuth = false }
    const studentToken = localStorage.getItem('student_token')
    if (studentToken && !hasTeacherAuth) headers['student-token'] = studentToken

    const response = await fetch(notebooksApi.assistStreamUrl(notebookId), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ message: text, current_cell_source: currentCellSource, last_output: lastOutput }),
    })
    if (response.status === 402) throw new Error('CREDIT_LIMIT_EXCEEDED')
    if (!response.ok || !response.body) throw new Error('stream non partito')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        let event: any
        try { event = JSON.parse(dataLine.slice(6)) } catch { continue }
        if (event.type === 'stage' && event.message) {
          // Ogni bolla d'agente compare appena lo stadio finisce.
          setMessages((prev) => [...prev, event.message as NotebookTutorMessage])
        } else if (event.type === 'done') {
          const summary = event.summary || 'Modifica pronta.'
          const proposals = (event.proposals || []) as NotebookCodeProposal[]
          onProposals(summary, proposals)
          if (Array.isArray(event.history)) setMessages(event.history as NotebookTutorMessage[])
          finished = true
        } else if (event.type === 'error') {
          throw new Error(event.message || 'Generazione non riuscita.')
        }
        // 'ping' (heartbeat) ignorato.
      }
    }
    if (!finished) throw new Error('stream interrotto')
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)

    const nextMessages: NotebookTutorMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)

    try {
      if (useStreaming) {
        await sendStreaming(text)
      } else {
        const response = await notebooksApi.assist(notebookId, {
          message: text,
          current_cell_source: currentCellSource,
          last_output: lastOutput,
        })
        const summary = response.data.summary || 'Ho preparato una proposta di modifica.'
        const proposals = (response.data.proposals || []) as NotebookCodeProposal[]
        onProposals(summary, proposals)
        const history = Array.isArray(response.data.history) ? response.data.history as NotebookTutorMessage[] : null
        setMessages(history ?? [...nextMessages, { role: 'assistant', content: summary }])
      }
    } catch (error) {
      const creditLimitExceeded =
        (axios.isAxiosError(error) && error.response?.status === 402)
        || (error instanceof Error && error.message === 'CREDIT_LIMIT_EXCEEDED')
      setMessages([...nextMessages, {
        role: 'assistant',
        content: creditLimitExceeded
          ? CREDIT_EXHAUSTED_MESSAGE
          : 'Non riesco a generare una proposta in questo momento.',
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900">{copy.title}</p>
          <p className="truncate text-[11px] text-slate-500">{copy.subtitle}</p>
        </div>
        {onOpenVersions && (
          <button
            onClick={onOpenVersions}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            title="Cronologia versioni / rollback"
          >
            <History className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">{copy.emptyTitle}</p>
            <p className="mt-2 text-xs leading-5">
              {copy.intro}
            </p>
            {beginnerSuggestions.length > 0 && (
              <div className="mt-3 space-y-2">
                {beginnerSuggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-left text-xs leading-5 text-indigo-800 transition hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {messages.map((message, index) => (
            <AgentMessageBubble key={index} message={message} />
          ))}

          {loading && (
            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs font-medium text-sky-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Prompt Analyst → Architetto → File Writer → Reviewer → Coding Builder…
            </div>
          )}

          {pendingProposals.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <GitCompare className="h-3.5 w-3.5" />
                Diff da approvare
              </div>
              {pendingProposals.map((proposal) => (
                <div key={proposal.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2">
                    <p className="text-sm font-semibold text-slate-900">{proposal.message}</p>
                    {proposal.explanation && <p className="mt-1 text-xs leading-5 text-slate-600">{proposal.explanation}</p>}
                    {proposal.required_libraries && proposal.required_libraries.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-indigo-600">
                        Richiede librerie: {proposal.required_libraries.join(', ')} (abilitate automaticamente all&apos;applicazione)
                      </p>
                    )}
                  </div>
                  <DiffBlock source={currentCellSource} proposal={proposal} />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onApplyProposal(proposal.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Applica
                    </button>
                    <button
                      onClick={() => onRejectProposal(proposal.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Scarta
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={copy.placeholder}
            className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            className="self-end flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
            title="Invia al tutor"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
