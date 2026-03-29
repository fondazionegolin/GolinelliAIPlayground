import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Loader2, GraduationCap, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownCodeComponents } from '@/components/CodeBlock'
import { notebooksApi } from '@/lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  notebookId: string
  notebookTitle: string
  currentCellSource?: string
  lastOutput?: string
}

export default function NotebookTutorChat({ notebookId, notebookTitle, currentCellSource, lastOutput }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    const newMessages: Message[] = [...messages, { role: 'user', content: msg }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const res = await notebooksApi.tutorChat(notebookId, {
        message: msg,
        history: messages.slice(-10),
        current_cell_source: currentCellSource,
        last_output: lastOutput,
      })
      setMessages([...newMessages, { role: 'assistant', content: res.data.response }])
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: '⚠️ Errore nella risposta del tutor. Riprova.' }])
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

  // Floating button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 shadow-2xl flex items-center justify-center group animate-gentle-bounce hover:[animation-play-state:paused]"
        title="Apri tutor AI"
      >
        <GraduationCap className="h-6 w-6 text-white" />
        <span className="absolute right-16 bg-slate-900 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          Tutor Python
        </span>
      </button>
    )
  }

  return (
    <div className="absolute bottom-6 right-6 z-30 w-[380px] h-[520px] bg-[#1a1d23] rounded-2xl shadow-2xl border border-[#2a2d36] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-indigo-700 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
          <GraduationCap className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Tutor Python</p>
          <p className="text-[10px] text-indigo-200 truncate">{notebookTitle}</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
          <ChevronDown className="h-5 w-5" />
        </button>
      </div>

      {/* Context strip */}
      {currentCellSource && (
        <div className="px-3 py-1.5 bg-[#21242c] border-b border-[#2a2d36] flex-shrink-0">
          <p className="text-[10px] text-slate-400 font-mono truncate">
            📍 Cella corrente: <span className="text-emerald-400">{currentCellSource.split('\n')[0].slice(0, 50)}</span>
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-slate-500">
            <Bot className="h-10 w-10 text-indigo-500/50" />
            <div>
              <p className="text-sm font-medium text-slate-400">Ciao! Sono il tuo tutor Python 🐍</p>
              <p className="text-xs mt-1">Dimmi dove sei bloccato e ti aiuterò a capire senza darti la soluzione direttamente.</p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 w-full mt-2">
              {[
                'Come faccio a leggere un CSV con pandas?',
                'Perché questo errore non va via?',
                'Spiegami come funziona questa funzione',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs text-left bg-[#21242c] hover:bg-[#2a2d36] text-slate-300 px-3 py-2 rounded-lg transition-colors border border-[#2a2d36]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                <Bot className="h-3 w-3 text-white" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-sm'
                  : 'bg-[#21242c] text-slate-200 rounded-tl-sm border border-[#2a2d36]'
              }`}
            >
              {m.role === 'assistant' ? (
                <div className="prose prose-sm prose-invert max-w-none prose-p:my-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownCodeComponents(true)}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center mr-2 flex-shrink-0">
              <Bot className="h-3 w-3 text-white" />
            </div>
            <div className="bg-[#21242c] border border-[#2a2d36] rounded-xl rounded-tl-sm px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 flex-shrink-0">
        <div className="flex gap-2 bg-[#21242c] rounded-xl border border-[#2a2d36] p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Chiedi al tutor… (Invio per inviare)"
            rows={2}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 resize-none outline-none leading-relaxed"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="self-end w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <Send className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
        <p className="text-[10px] text-slate-600 mt-1 text-center">
          Il tutor suggerisce, non scrive il codice per te 🎓
        </p>
      </div>
    </div>
  )
}
