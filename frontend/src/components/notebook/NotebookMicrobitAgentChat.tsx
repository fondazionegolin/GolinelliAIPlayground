import { useEffect, useRef, useState } from 'react'
import { Bot, Check, GitCompare, History, Loader2, Send, X } from '@/components/icons'
import { Textarea } from '@/design/primitives/Textarea'
import { IconButton } from '@/design/primitives/IconButton'
import axios from 'axios'
import { notebooksApi } from '@/lib/api'
import { findActiveJob, followJobStream, notifyJobsChanged, readEventStream } from '@/lib/backgroundJobs'
import type { NotebookCodeProposal, NotebookTutorMessage } from './types'
import { tl } from '@/i18n/tl'

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

const CREDIT_EXHAUSTED_MESSAGE = tl("Crediti AI esauriti. Attendi il rinnovo del plafond o contatta il docente/amministratore.")

// Agent pipeline stages, in the order the backend runs them.
const PIPELINE_STEPS = ['Prompt Analyst', tl("Architetto"), tl("File Writer"), 'Reviewer', 'Coding Builder'] as const

interface ActiveStage { agent: string; label: string }

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/** Live progress of the agent pipeline: which agent has the baton, which ones are done, how long it has been. */
function PipelineProgress({ done, active, elapsed }: { done: string[]; active: ActiveStage | null; elapsed: number }) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-sky-700">
        <span>{tl("Agenti al lavoro")}</span>
        <span className="font-mono normal-case tabular-nums">{formatElapsed(elapsed)}</span>
      </div>
      <ol className="space-y-1">
        {PIPELINE_STEPS.map((step) => {
          const isDone = done.includes(step)
          const isActive = !isDone && active?.agent === step
          return (
            <li key={step} className={`flex items-start gap-2 text-xs ${isDone ? 'text-slate-500' : isActive ? 'font-semibold text-sky-800' : 'text-slate-400'}`}>
              <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {isDone
                  ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                  : isActive
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                    : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
              </span>
              <span className="min-w-0">
                {step}
                {isActive && active?.label && <span className="block font-normal leading-snug text-sky-700">{active.label}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[10px] leading-snug text-sky-700/80">
        {tl("Con sketch lunghi o modelli ML può richiedere uno o due minuti: puoi cambiare pagina, il lavoro continua in background.")}
      </p>
    </div>
  )
}

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
  const label = isUser ? 'Tu' : message.agent_name || tl("Agente")

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

function HunkDiff({ proposal }: { proposal: NotebookCodeProposal }) {
  const hunks = proposal.hunks ?? []
  const added = hunks.reduce((n, h) => n + h.rows.filter((r) => r.op === 'add').length, 0)
  const removed = hunks.reduce((n, h) => n + h.rows.filter((r) => r.op === 'del').length, 0)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
        <span>{hunks.length} {hunks.length === 1 ? tl("blocco modificato") : tl("blocchi modificati")}</span>
        <span className="text-emerald-600">+{added}</span>
        <span className="text-red-500">−{removed}</span>
      </div>
      {hunks.map((hunk, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950 font-mono text-[11px]">
          <div className="border-b border-slate-800 px-3 py-1 text-slate-500">
            riga {hunk.old_start}{hunk.old_end > hunk.old_start ? `–${hunk.old_end}` : ''}
          </div>
          {hunk.rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className={`flex gap-2 px-3 py-0.5 ${row.op === 'add' ? 'bg-emerald-950/40 text-emerald-200' : row.op === 'del' ? 'bg-red-950/40 text-red-200' : 'text-slate-500'}`}
            >
              <span className={row.op === 'add' ? 'text-emerald-500' : row.op === 'del' ? 'text-red-500' : 'text-transparent'}>
                {row.op === 'add' ? '+' : row.op === 'del' ? '-' : ' '}
              </span>
              <span className="whitespace-pre-wrap break-all">{row.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DiffBlock({ source, proposal }: { source: string; proposal: NotebookCodeProposal }) {
  if (proposal.hunks && proposal.hunks.length > 0) return <HunkDiff proposal={proposal} />
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
    title: tl("Tutor agentico micro:bit"),
    subtitle: tl("Trasforma intenzioni creative in codice commentato"),
    intro: tl("Il tutor propone codice Python o JavaScript per micro:bit, aggiunge commenti in italiano e mostra il diff prima di applicare."),
    placeholder: tl("Esempio: voglio accendere i LED quando inclino la scheda e mandare la temperatura al browser"),
    emptyTitle: tl("Descrivi cosa vuoi far fare alla scheda."),
  },
  circuitplayground: {
    label: 'Circuit Playground Express',
    title: tl("Tutor agentico Circuit Playground"),
    subtitle: tl("Trasforma intenzioni creative in MakeCode TypeScript"),
    intro: tl("Il tutor propone codice MakeCode TypeScript per Circuit Playground Express, aggiunge commenti in italiano e mostra il diff prima di applicare."),
    placeholder: tl("Esempio: voglio cambiare i NeoPixel con la luce e mandare temperatura e movimento al browser"),
    emptyTitle: tl("Descrivi cosa vuoi far fare alla scheda."),
  },
  python: {
    label: 'Python',
    title: tl("Tutor agentico Python"),
    subtitle: tl("Trasforma richieste in codice Python commentato"),
    intro: tl("Il tutor propone modifiche al codice Python della cella, aggiunge commenti in italiano e mostra il diff prima di applicare."),
    placeholder: tl("Esempio: voglio leggere un file CSV e stampare la media di una colonna"),
    emptyTitle: tl("Descrivi cosa vuoi che faccia il tuo codice."),
  },
  p5js: {
    label: 'p5.js',
    title: tl("Tutor agentico p5.js"),
    subtitle: tl("Trasforma idee creative in sketch p5.js"),
    intro: tl("Il tutor propone codice p5.js per il tuo sketch, aggiunge commenti in italiano e mostra il diff prima di applicare."),
    placeholder: tl("Esempio: voglio che i cerchi cambino colore quando muovo il mouse"),
    emptyTitle: tl("Descrivi cosa vuoi che faccia il tuo sketch."),
  },
} as const

interface SuggestionContext {
  device: Props['device']
  source: string
  lastOutput: string
  messages: NotebookTutorMessage[]
  hasPendingProposals: boolean
}

function getContextualSuggestions({
  device,
  source,
  lastOutput,
  messages,
  hasPendingProposals,
}: SuggestionContext): string[] {
  if (device !== 'python' && device !== 'p5js') return []

  const normalizedSource = source.trim().toLowerCase()
  const normalizedOutput = lastOutput.trim().toLowerCase()
  const hasError = /error|exception|traceback|syntaxerror|referenceerror|typeerror/.test(normalizedOutput)
  const hasConversation = messages.some(message => message.role === 'user')

  if (hasPendingProposals) {
    return [
      tl("Spiegami il diff proposto con parole semplici, senza applicare altre modifiche."),
      tl("Controlla se la modifica proposta può essere semplificata per un principiante."),
      tl("Suggeriscimi una prova pratica per verificare che la modifica funzioni."),
    ]
  }

  if (hasError) {
    return device === 'python'
      ? [
          tl("Spiegami l’errore nell’ultimo output con parole semplici e indicami la riga da controllare."),
          tl("Proponi la correzione minima per risolvere l’errore, commentando il codice."),
          tl("Aiutami ad aggiungere dei print di controllo per capire dove nasce il problema."),
        ]
      : [
          tl("Spiegami l’errore dello sketch con parole semplici e indicami dove intervenire."),
          tl("Proponi la correzione minima per far ripartire lo sketch p5.js."),
          tl("Aiutami a controllare i valori nel draw() usando console.log senza confondermi."),
        ]
  }

  if (!normalizedSource) {
    return device === 'python'
      ? [
          tl("Scrivi un esempio semplice con variabili, input e print, spiegandomi ogni riga."),
          tl("Creiamo insieme un piccolo programma che calcola media, minimo e massimo."),
          tl("Proponimi un esercizio Python facile e guidami un passaggio alla volta."),
        ]
      : [
          tl("Crea uno sketch semplice con setup() e draw() e spiegami a cosa servono."),
          tl("Disegna una forma che segue il mouse e spiegami il codice un passaggio alla volta."),
          tl("Proponimi un piccolo esercizio creativo p5.js adatto a chi inizia."),
        ]
  }

  if (device === 'python') {
    if (/\bdef\s+\w+\s*\(/.test(normalizedSource)) {
      return [
        tl("Spiegami come funziona questa funzione e fammi vedere un esempio di chiamata."),
        tl("Aiutami a provare questa funzione con tre casi semplici, incluso un caso limite."),
        tl("Suggerisci un nome e dei commenti più chiari senza cambiare il comportamento."),
      ]
    }
    if (/\b(for|while)\b/.test(normalizedSource)) {
      return [
        tl("Spiegami questo ciclo passo per passo mostrando come cambiano le variabili."),
        tl("Aiutami ad aggiungere una condizione al ciclo senza renderlo troppo complesso."),
        tl("Controlla se il ciclo può bloccarsi o saltare un elemento e spiegami perché."),
      ]
    }
    if (/\b(input|list|append)\b|\[[^\]]*\]/.test(normalizedSource)) {
      return [
        tl("Spiegami come vengono raccolti e usati i dati in questo codice."),
        tl("Aiutami a gestire un valore non valido inserito dall’utente."),
        tl("Aggiungi un risultato utile, come conteggio, media, minimo o massimo."),
      ]
    }
    return [
      tl("Spiegami questo codice riga per riga come se fosse la mia prima lezione di Python."),
      tl("Suggeriscimi una piccola modifica per sperimentare senza riscrivere tutto."),
      hasConversation
        ? tl("Riprendi la mia ultima richiesta e proponimi il prossimo passo più semplice.")
        : tl("Controlla il codice e indicami cosa potrei migliorare mantenendolo semplice."),
    ]
  }

  if (/\b(mouse|key|touch)/.test(normalizedSource)) {
    return [
      tl("Spiegami come questo sketch reagisce all’interazione dell’utente."),
      tl("Aiutami ad aggiungere una seconda interazione semplice con mouse o tastiera."),
      tl("Mostrami come evitare che la forma esca dai bordi del canvas."),
    ]
  }
  if (/\b(ellipse|circle|rect|line|triangle|image)\s*\(/.test(normalizedSource)) {
    return [
      tl("Spiegami come vengono disegnate e posizionate le forme in questo sketch."),
      tl("Aiutami ad animare una forma cambiando una sola variabile alla volta."),
      tl("Aggiungi colori o dimensioni variabili e spiegami ogni modifica."),
    ]
  }
  return [
    tl("Spiegami cosa succede in setup() e draw() durante l’esecuzione dello sketch."),
    tl("Suggeriscimi una piccola modifica visiva adatta a un principiante."),
    hasConversation
      ? tl("Riprendi la mia ultima idea e proponimi il prossimo passo più semplice.")
      : tl("Controlla lo sketch e indicami come renderlo interattivo passo per passo."),
  ]
}

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
  const [messages, setMessages] = useState<NotebookTutorMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [doneAgents, setDoneAgents] = useState<string[]>([])
  const [activeStage, setActiveStage] = useState<ActiveStage | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const contextualSuggestions = getContextualSuggestions({
    device,
    source: currentCellSource,
    lastOutput,
    messages,
    hasPendingProposals: pendingProposals.length > 0,
  })

  const selectSuggestion = (suggestion: string) => {
    setInput(suggestion)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages, notebookId])

  // Elapsed-time counter while a request runs; resets the stage tracker when it starts or ends.
  useEffect(() => {
    if (!loading) { setActiveStage(null); return }
    setElapsed(0)
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [loading])

  // The composer grows with the request (up to a cap), then scrolls.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [input])

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
    if (!response.ok || !response.body) throw new Error(tl("stream non partito"))
    notifyJobsChanged()
    await consumeAssistStream(response)
  }

  // Bubbles and proposals from the assistant stream (a new request or the replay of a background job).
  const consumeAssistStream = async (response: Response) => {
    let finished = false
    await readEventStream(response, 'sse', (event) => {
      if (event.type === 'stage' && event.message) {
        // Ogni bolla d'agente compare appena lo stadio finisce.
        const stageMessage = event.message as NotebookTutorMessage
        setMessages((prev) => [...prev, stageMessage])
        if (stageMessage.agent_name) setDoneAgents((prev) => (prev.includes(stageMessage.agent_name!) ? prev : [...prev, stageMessage.agent_name!]))
      } else if (event.type === 'active') {
        // The agent that has just taken over, and what it is doing right now.
        setActiveStage({ agent: String(event.agent_name || ''), label: String(event.label || '') })
      } else if (event.type === 'done') {
        const summary = event.summary || tl("Modifica pronta.")
        const proposals = (event.proposals || []) as NotebookCodeProposal[]
        onProposals(summary, proposals)
        if (Array.isArray(event.history)) setMessages(event.history as NotebookTutorMessage[])
        finished = true
        return true
      } else if (event.type === 'error') {
        throw new Error(event.message || tl("Generazione non riuscita."))
      }
      // 'ping' (heartbeat) ignorato.
    })
    if (!finished) throw new Error(tl("stream interrotto"))
  }

  // La pipeline gira sul server come job in background: tornando sul notebook si riaggancia
  // alla richiesta ancora in corso invece di perderla.
  useEffect(() => {
    if (!useStreaming) return
    let cancelled = false
    void findActiveJob('notebook_assist', notebookId).then(async (job) => {
      if (!job || cancelled) return
      setLoading(true)
      try {
        const response = await followJobStream(job.id)
        if (response.ok) await consumeAssistStream(response)
      } catch {
        // l'indicatore in navbar continua a seguire il job
      } finally {
        if (!cancelled) setLoading(false)
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, useStreaming])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setDoneAgents([])
    setActiveStage({ agent: 'Prompt Analyst', label: tl("Leggo la richiesta e il codice attuale…") })
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
        const summary = response.data.summary || tl("Ho preparato una proposta di modifica.")
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
          : tl("Non riesco a generare una proposta in questo momento."),
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
            title={tl("Cronologia versioni / rollback")}
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
          </div>
        )}

        <div className="space-y-3">
          {messages.map((message, index) => (
            <AgentMessageBubble key={index} message={message} />
          ))}

          {loading && (
            useStreaming
              ? <PipelineProgress done={doneAgents} active={activeStage} elapsed={elapsed} />
              : (
                <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs font-medium text-sky-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {tl("Il tutor sta preparando la proposta…")} {formatElapsed(elapsed)}
                </div>
              )
          )}

          {pendingProposals.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <GitCompare className="h-3.5 w-3.5" />
                {tl("Diff da approvare")}
              </div>
              {pendingProposals.map((proposal) => (
                <div key={proposal.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2">
                    <p className="text-sm font-semibold text-slate-900">{proposal.message}</p>
                    {proposal.explanation && <p className="mt-1 text-xs leading-5 text-slate-600">{proposal.explanation}</p>}
                    {proposal.required_libraries && proposal.required_libraries.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-indigo-600">
                        {tl("Richiede librerie:")} {proposal.required_libraries.join(', ')} {tl("(abilitate automaticamente all'applicazione)")}
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
                      {tl("Applica")}
                    </button>
                    <button
                      onClick={() => onRejectProposal(proposal.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      {tl("Scarta")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {contextualSuggestions.length > 0 && !loading && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                {tl("Puoi chiedere anche")}
              </p>
              <div className="space-y-2">
                {contextualSuggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => selectSuggestion(suggestion)}
                    className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-left text-xs leading-5 text-indigo-800 transition hover:border-indigo-300 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={1}
            resize="none"
            density="compact"
            surface="glass"
            placeholder={copy.placeholder}
            className="min-h-[40px] max-h-[220px] min-w-0 flex-1 overflow-y-auto"
          />
          <IconButton
            type="button"
            size="default"
            tone="accent"
            surface="solid"
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            className="shrink-0"
            title={tl("Invia al tutor (Invio) · Maiusc+Invio per andare a capo")}
          >
            {loading ? <Loader2 className="animate-spin" /> : <Send />}
          </IconButton>
        </div>
      </div>
    </div>
  )
}
