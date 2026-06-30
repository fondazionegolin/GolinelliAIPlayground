import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, X, Users, Bot, Loader2, AtSign } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { collaborationApi } from '@/lib/api'

export interface SharedParticipant {
  id: string
  nickname: string
  avatar_url?: string | null
}

export interface SharedRoom {
  id: string
  kind: 'teacherbot' | 'assistant'
  teacherbot_id: string | null
  profile_key: string | null
  title: string | null
  owner_student_id: string
  is_active: boolean
  created_at: string
  participants: SharedParticipant[]
}

interface SharedMessage {
  id: string
  room_id: string
  role: 'user' | 'assistant'
  sender_student_id: string | null
  sender_nickname: string | null
  content: string
  is_peer: boolean
  created_at: string
}

interface SharedChatPanelProps {
  room: SharedRoom
  currentStudentId: string
  language: 'it' | 'en'
  accent: { accent: string; text: string; soft: string }
  onClose: () => void
}

// A short, deterministic colour per nickname so each speaker is visually distinct.
const NAME_COLORS = ['#e3004a', '#7b69c9', '#1278bd', '#0d9488', '#d97706', '#9333ea', '#0891b2']
function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

export default function SharedChatPanel({ room: initialRoom, currentStudentId, language, accent, onClose }: SharedChatPanelProps) {
  const isEnglish = language === 'en'
  const [room, setRoom] = useState<SharedRoom>(initialRoom)
  const [messages, setMessages] = useState<SharedMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [botThinking, setBotThinking] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const roomIdRef = useRef(initialRoom.id)
  roomIdRef.current = initialRoom.id

  const isOwner = room.owner_student_id === currentStudentId

  // Initial load of room detail + history.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    collaborationApi.getRoom(initialRoom.id)
      .then((res) => {
        if (cancelled) return
        const data = res.data as SharedRoom & { messages: SharedMessage[] }
        setRoom(data)
        setMessages(data.messages || [])
      })
      .catch(() => { /* keep optimistic room */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [initialRoom.id])

  // Realtime: the gateway emits to each participant's personal room, which the main
  // socket (window.socket) already joined — so we just listen here.
  useEffect(() => {
    const socket = (window as any).socket as { on: (e: string, cb: (d: any) => void) => void; off: (e: string, cb: (d: any) => void) => void } | undefined
    if (!socket) return

    const onMessage = (data: { room_id: string; message: SharedMessage }) => {
      if (data.room_id !== roomIdRef.current) return
      setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message])
      if (data.message.role === 'assistant') setBotThinking(false)
    }
    const onClosed = (data: { room_id: string }) => {
      if (data.room_id === roomIdRef.current) onClose()
    }
    socket.on('share_chat_message', onMessage)
    socket.on('share_chat_closed', onClosed)
    return () => {
      socket.off('share_chat_message', onMessage)
      socket.off('share_chat_closed', onClosed)
    }
  }, [onClose])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, botThinking])

  const send = useCallback(async () => {
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    setMentionOpen(false)
    const willCallBot = !content.startsWith('@')
    try {
      await collaborationApi.sendMessage(room.id, content)
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
      if (willCallBot) setBotThinking(true)
    } catch {
      // surfaced by the empty composer staying filled
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending, room.id])

  const insertMention = (nickname: string) => {
    setInput((prev) => `${prev.replace(/@[^\s]*$/, '')}@${nickname} `)
    setMentionOpen(false)
    inputRef.current?.focus()
  }

  const otherParticipants = room.participants.filter((p) => p.id !== currentStudentId)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-50">
        {/* Presence bar — connected users shown as named bubbles */}
        <div className="flex items-center gap-2 border-b border-slate-200/70 bg-white px-4 py-2.5">
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <Users className="h-3.5 w-3.5" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {room.participants.map((p) => {
              const me = p.id === currentStudentId
              return (
                <span
                  key={p.id}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
                  style={{
                    borderColor: me ? accent.accent : '#e2e8f0',
                    backgroundColor: me ? accent.soft : '#f8fafc',
                    color: me ? accent.text : colorFor(p.nickname),
                  }}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: me ? accent.accent : colorFor(p.nickname) }}>
                    {p.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  {me ? (isEnglish ? 'You' : 'Tu') : p.nickname}
                </span>
              )
            })}
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={async () => { try { await collaborationApi.closeRoom(room.id) } catch { /* noop */ } onClose() }}
              className="flex-shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600 hover:bg-rose-100"
            >
              {isEnglish ? 'End' : 'Termina'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label={isEnglish ? 'Close' : 'Chiudi'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4 md:px-8">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="mt-8 text-center text-xs text-slate-400">
              {isEnglish
                ? 'Write to the group. The bot replies to everyone — mention @name to talk to a peer only.'
                : 'Scrivi al gruppo. Il bot risponde a tutti — usa @nome per parlare solo con un compagno.'}
            </p>
          ) : (
            messages.map((m) => {
              const isBot = m.role === 'assistant'
              const isOwn = m.sender_student_id === currentStudentId
              return (
                <div key={m.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    isBot
                      ? 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800'
                      : isOwn
                        ? 'rounded-br-md text-white'
                        : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                  } ${m.is_peer ? 'opacity-90 ring-1 ring-amber-200' : ''}`}
                    style={isOwn && !isBot ? { backgroundColor: accent.accent } : undefined}
                  >
                    {!isOwn && (
                      <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold" style={{ color: isBot ? accent.text : colorFor(m.sender_nickname || '') }}>
                        {isBot ? <Bot className="h-3 w-3" /> : null}
                        {isBot ? (room.title || 'Bot') : m.sender_nickname}
                        {m.is_peer && <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600"><AtSign className="h-2.5 w-2.5" />{isEnglish ? 'private' : 'privato'}</span>}
                      </div>
                    )}
                    {isBot ? (
                      <div className="prose prose-sm max-w-none prose-p:my-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
          {botThinking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isEnglish ? 'The bot is replying…' : 'Il bot sta rispondendo…'}
              </div>
            </div>
          )}
        </div>

        {/* Mention suggestions */}
        {mentionOpen && otherParticipants.length > 0 && (
          <div className="mx-5 mb-1 flex flex-wrap gap-1.5">
            {otherParticipants.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(p.nickname) }}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <AtSign className="h-3 w-3" />{p.nickname}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div className="flex items-end gap-2 border-t border-slate-200/70 px-4 py-3">
          <button
            type="button"
            onClick={() => setMentionOpen((v) => !v)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title={isEnglish ? 'Mention a peer (private)' : 'Menziona un compagno (privato)'}
          >
            <AtSign className="h-4 w-4" />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`
              setMentionOpen(/(^|\s)@[^\s]*$/.test(e.target.value))
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder={isEnglish ? 'Message the group…' : 'Scrivi al gruppo…'}
            disabled={sending}
            className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white transition-all disabled:bg-slate-100 disabled:text-slate-300"
            style={input.trim() && !sending ? { backgroundColor: accent.accent } : undefined}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
    </div>
  )
}
