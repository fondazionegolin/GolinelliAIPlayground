import { useEffect, useRef, useState } from 'react'
import { Bot, Check, GitCompare, Loader2, Send, Sparkles, Wrench, X } from 'lucide-react'
import { notebooksApi } from '@/lib/api'
import type { NotebookCodeProposal, NotebookTutorMessage } from './types'

interface Props {
  notebookId: string
  device?: 'microbit' | 'circuitplayground'
  currentCellSource: string
  lastOutput?: string
  initialMessages?: NotebookTutorMessage[]
  pendingProposals?: NotebookCodeProposal[]
  onProposals: (summary: string, proposals: NotebookCodeProposal[]) => void
  onApplyProposal: (proposalId: string) => void
  onRejectProposal: (proposalId: string) => void
}

function getRangeText(source: string, lineStart: number, lineEnd: number) {
  return source.split('\n').slice(Math.max(0, lineStart - 1), lineEnd).join('\n')
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
  },
  circuitplayground: {
    label: 'Circuit Playground Express',
    title: 'Tutor agentico Circuit Playground',
    subtitle: 'Trasforma intenzioni creative in MakeCode TypeScript',
    intro: 'Il tutor propone codice MakeCode TypeScript per Circuit Playground Express, aggiunge commenti in italiano e mostra il diff prima di applicare.',
    placeholder: 'Esempio: voglio cambiare i NeoPixel con la luce e mandare temperatura e movimento al browser',
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
}: Props) {
  const copy = DEVICE_COPY[device]
  const [messages, setMessages] = useState<NotebookTutorMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [agentSteps, setAgentSteps] = useState<string[]>([])
  const [finalBrief, setFinalBrief] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages, notebookId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, pendingProposals, agentSteps])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)
    setFinalBrief('')
    setAgentSteps([
      'Leggo l intenzione creativa dello studente.',
      'Controllo il codice attuale e la comunicazione seriale.',
      'Preparo una modifica minima con commenti in italiano.',
    ])

    const nextMessages: NotebookTutorMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)

    try {
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
      setFinalBrief(proposals.length
        ? `${proposals.length} modifica/e pronte da applicare. Controlla il diff prima di approvare.`
        : 'Nessuna modifica necessaria: posso guidarti con una domanda o un esempio piu piccolo.')
    } catch {
      setMessages([...nextMessages, { role: 'assistant', content: 'Non riesco a generare una proposta in questo momento.' }])
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Descrivi cosa vuoi far fare alla scheda.</p>
            <p className="mt-2 text-xs leading-5">
              {copy.intro}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((message, index) => (
            <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'rounded-tr-sm bg-slate-900 text-white'
                  : 'rounded-tl-sm border border-slate-200 bg-slate-50 text-slate-700'
              }`}>
                <p className="whitespace-pre-wrap leading-6">{message.content}</p>
              </div>
            </div>
          ))}

          {(loading || agentSteps.length > 0) && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-sky-700">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Azioni dell agente
              </div>
              <div className="space-y-1.5">
                {agentSteps.map((step, index) => (
                  <div key={step} className="flex items-center gap-2 text-xs text-slate-700">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                      !loading || index < agentSteps.length - 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                    }`}>
                      {!loading || index < agentSteps.length - 1 ? <Check className="h-2.5 w-2.5" /> : index + 1}
                    </span>
                    {step}
                  </div>
                ))}
              </div>
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
                  </div>
                  <DiffBlock source={currentCellSource} proposal={proposal} />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        onApplyProposal(proposal.id)
                        setFinalBrief('Modifica applicata al codice. Rileggi i commenti: spiegano cosa fa ogni blocco e a cosa serve.')
                      }}
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

          {finalBrief && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                <Wrench className="h-3.5 w-3.5" />
                Brief finale
              </div>
              <p className="text-xs leading-5 text-emerald-900">{finalBrief}</p>
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
