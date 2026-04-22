import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Send, Loader2, GraduationCap, ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownCodeComponents } from '@/components/CodeBlock'
import { notebooksApi } from '@/lib/api'
import type { NotebookCodeProposal, NotebookProjectType, NotebookTutorMessage } from './types'

interface Props {
  notebookId: string
  notebookTitle: string
  projectType: NotebookProjectType
  currentCellSource?: string
  lastOutput?: string
  pendingProposals?: NotebookCodeProposal[]
  initialMessages?: NotebookTutorMessage[]
  variant?: 'docked' | 'floating' | 'sidebar'
  className?: string
}

export default function NotebookTutorChat({
  notebookId,
  notebookTitle,
  projectType,
  currentCellSource,
  lastOutput,
  pendingProposals = [],
  initialMessages = [],
  variant = 'docked',
  className = '',
}: Props) {
  const isFloating = variant === 'floating'
  const isSidebar = variant === 'sidebar'

  // Accent palette — teal for p5js, indigo for python
  const accent = projectType === 'p5js'
    ? { iconBg: 'bg-teal-100', iconText: 'text-teal-700', bubble: 'bg-teal-600', avatar: 'bg-teal-600', spinner: 'text-teal-400', prose: 'prose-code:text-teal-700' }
    : { iconBg: 'bg-indigo-100', iconText: 'text-indigo-700', bubble: 'bg-indigo-600', avatar: 'bg-indigo-600', spinner: 'text-indigo-400', prose: 'prose-code:text-indigo-700' }

  const [collapsed, setCollapsed] = useState(false)
  const [messages, setMessages] = useState<NotebookTutorMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!isFloating) return
    e.preventDefault()
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startElemX = rect.left
    const startElemY = rect.top
    setIsDragging(true)

    const onMove = (ev: MouseEvent) => {
      setDragPos({
        x: startElemX + (ev.clientX - startMouseX),
        y: startElemY + (ev.clientY - startMouseY),
      })
    }
    const onUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [isFloating])

  useEffect(() => {
    if (!collapsed) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, collapsed])

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus()
  }, [collapsed])

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages, notebookId])

  const send = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    const newMessages: NotebookTutorMessage[] = [...messages, { role: 'user', content: msg }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const res = await notebooksApi.tutorChat(notebookId, {
        message: msg,
        current_cell_source: currentCellSource,
        last_output: lastOutput,
        pending_proposals: pendingProposals,
      })
      const history = Array.isArray(res.data.history) ? res.data.history as NotebookTutorMessage[] : null
      setMessages(history ?? [...newMessages, { role: 'assistant', content: res.data.response }])
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Errore nella risposta del tutor. Riprova.' }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ── Root container classes ────────────────────────────────────────────────
  let rootClass = `flex flex-col overflow-hidden bg-white/95 backdrop-blur-xl `

  if (isFloating) {
    rootClass += `${isDragging ? '' : 'transition-[height,width] duration-200'} `
    rootClass += `${collapsed ? 'h-[56px] w-[320px]' : 'h-[640px] w-[400px]'} `
    rootClass += `rounded-[24px] border border-slate-200 shadow-[0_18px_50px_rgba(15,23,42,0.24)] pointer-events-auto `
  } else if (isSidebar) {
    rootClass += `h-full rounded-[24px] border border-slate-200 shadow-[0_4px_24px_rgba(15,23,42,0.12)] `
  } else {
    // docked
    rootClass += `${collapsed ? 'h-[58px]' : 'h-[300px] md:h-[340px]'} border-t border-slate-200 `
  }

  rootClass += className

  return (
    <div
      ref={rootRef}
      className={rootClass}
      style={isFloating ? {
        position: 'fixed',
        zIndex: 50,
        userSelect: isDragging ? 'none' : undefined,
        ...(dragPos ? { left: dragPos.x, top: dragPos.y } : { bottom: '2rem', right: '2rem' }),
      } : undefined}
    >
      {/* Drag handle — floating only, hidden when collapsed */}
      {isFloating && !collapsed && (
        <div
          onMouseDown={handleDragStart}
          className="flex shrink-0 cursor-grab items-center justify-center border-b border-slate-100 bg-slate-50 py-1.5 active:cursor-grabbing"
          title="Trascina per spostare"
        >
          <GripHorizontal className="h-3.5 w-3.5 text-slate-300" />
        </div>
      )}

      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent.iconBg}`}>
          <GraduationCap className={`h-4 w-4 ${accent.iconText}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Tutor {projectType === 'python' ? 'Python' : 'p5.js'}</p>
          <p className="truncate text-[10px] text-slate-500">
            {isFloating ? 'Supporto AI' : notebookTitle}
          </p>
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-slate-500 transition-colors hover:text-slate-900"
          title={collapsed ? 'Espandi tutor' : 'Nascondi tutor'}
        >
          {collapsed ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
      </div>

      {/* Body */}
      {!collapsed && (
        <>
          {currentCellSource && (
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
              <p className="truncate font-mono text-[10px] text-slate-500">
                Cella corrente: <span className="text-emerald-700">{currentCellSource.split('\n')[0].slice(0, 70)}</span>
              </p>
              {pendingProposals.length > 0 && (
                <p className="mt-1 text-[10px] text-amber-600">
                  {pendingProposals.length} proposta/e in attesa di approvazione: posso spiegarti il perché.
                </p>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-3 px-3 py-3">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-500">
                <Bot className={`h-10 w-10 ${accent.iconText} opacity-40`} />
                <div>
                  <p className="text-sm font-medium text-slate-700">Sono il tutor {projectType === 'python' ? 'Python' : 'p5.js'}</p>
                  <p className="mt-1 text-xs">Spiego errori e proposte di modifica lasciando allo studente il controllo del codice.</p>
                </div>
                <div className="mt-2 grid w-full grid-cols-1 gap-1.5">
                  {(projectType === 'python'
                    ? [
                      'Perché questa proposta migliora il codice?',
                      'Che cosa ho sbagliato in questa funzione?',
                      'Mostrami il ragionamento dietro la correzione',
                    ]
                    : [
                      'Perché questa modifica migliora lo sketch?',
                      'Che ruolo ha setup() in questo caso?',
                      'Come posso evitare questo errore di canvas?',
                    ]).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className={`mr-2 mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${accent.avatar}`}>
                    <Bot className="h-3 w-3 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? `rounded-tr-sm ${accent.bubble} text-white`
                      : 'rounded-tl-sm border border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className={`prose prose-sm max-w-none prose-p:my-1 ${accent.prose}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownCodeComponents(false)}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className={`mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${accent.avatar}`}>
                  <Bot className="h-3 w-3 text-white" />
                </div>
                <div className="rounded-xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3">
                  <Loader2 className={`h-4 w-4 animate-spin ${accent.spinner}`} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 px-3 pb-3">
            <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Chiedi al tutor perché una proposta è utile o cosa non ti è chiaro"
                rows={2}
                className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-400"
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className={`self-end flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${accent.bubble} transition-colors hover:opacity-90 disabled:opacity-40`}
              >
                <Send className="h-3.5 w-3.5 text-white" />
              </button>
            </div>
            <p className="mt-1 text-center text-[10px] text-slate-400">
              Supporto didattico: spiega, non sostituisce il ragionamento dello studente.
            </p>
          </div>
        </>
      )}

      {collapsed && variant === 'docked' && (
        <div className="px-4 py-2 text-xs text-slate-500">
          Tutor nascosto. Usa la freccia per riaprirlo.
        </div>
      )}
    </div>
  )
}
