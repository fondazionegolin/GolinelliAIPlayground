import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Mic } from '@/components/icons'
import { useSocket } from '@/hooks/useSocket'
import { tl } from '@/i18n/tl'

const PREVIEW_COUNT = 4

/**
 * Slim bar docked to the right of the page frame while the class chat is collapsed.
 * Hover shows a miniature of the latest messages; click opens the full chat panel.
 */
export function ClassChatDock({
  sessionId,
  currentUserId,
  accentColor,
  chatOpen,
  onOpen,
}: {
  sessionId?: string | null
  currentUserId?: string
  accentColor: string
  chatOpen: boolean
  onOpen: () => void
}) {
  const readKey = `class-chat:last-read:teacher:${sessionId || 'none'}`
  const [readAt, setReadAt] = useState(() => Number(localStorage.getItem(readKey) || 0))
  const [hover, setHover] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const closeTimer = useRef<number>()
  const { messages, loadingInitialMessages } = useSocket(sessionId || '')

  const incoming = useMemo(
    () => messages.filter((m) => m.sender_id !== currentUserId),
    [messages, currentUserId],
  )
  const latestTs = incoming.reduce((latest, m) => Math.max(latest, Date.parse(m.created_at) || 0), 0)
  const unread = incoming.filter((m) => (Date.parse(m.created_at) || 0) > readAt).length
  const preview = messages.slice(-PREVIEW_COUNT)

  useEffect(() => { setReadAt(Number(localStorage.getItem(readKey) || 0)) }, [readKey])

  // First load: nothing is "new" yet. Afterwards, an open chat marks everything read.
  useEffect(() => {
    if (!latestTs || loadingInitialMessages) return
    if (readAt && !chatOpen) return
    if (latestTs <= readAt) return
    setReadAt(latestTs)
    try { localStorage.setItem(readKey, String(latestTs)) } catch { /* storage unavailable */ }
  }, [latestTs, loadingInitialMessages, readAt, chatOpen, readKey])

  useEffect(() => {
    setVoiceActive(false)
    if (!sessionId) return
    const onVoice = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; active?: boolean }>).detail
      if (detail?.sessionId === sessionId) setVoiceActive(Boolean(detail.active))
    }
    window.addEventListener('golinelli:voice-room-state', onVoice)
    return () => window.removeEventListener('golinelli:voice-room-state', onVoice)
  }, [sessionId])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const show = () => { window.clearTimeout(closeTimer.current); setHover(true) }
  const hide = () => { closeTimer.current = window.setTimeout(() => setHover(false), 120) }

  return (
    <div className="relative flex h-full w-full items-center justify-center" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => { setHover(false); onOpen() }}
        onFocus={show}
        onBlur={hide}
        className="ds-control relative flex h-40 w-9 flex-col items-center justify-center gap-3 !rounded-full transition-colors hover:bg-slate-200/60"
        aria-label={tl("Apri chat di classe")}
        title={tl("Chat di classe")}
      >
        <MessageSquare className="h-4 w-4 text-slate-600" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 [writing-mode:vertical-rl]">{tl("Chat di classe")}</span>
        {unread > 0 && (
          <span
            className="absolute -left-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-[var(--ds-shadow-1)]"
            style={{ backgroundColor: accentColor }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {voiceActive && unread === 0 && (
          <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-white shadow-[var(--ds-shadow-1)]" style={{ backgroundColor: accentColor }}>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ backgroundColor: accentColor }} />
            <Mic className="relative h-2.5 w-2.5" />
          </span>
        )}
      </button>

      {hover && (
        <button
          type="button"
          onClick={() => { setHover(false); onOpen() }}
          className="ds-popover nav-cluster-unroll absolute right-full top-1/2 z-50 mr-2 w-72 -translate-y-1/2 overflow-hidden rounded-[var(--ds-radius-panel)] text-left"
          aria-label={tl("Apri chat di classe")}
        >
          <div className="px-4 pb-2 pt-3 text-xs font-bold text-slate-800">{tl("Chat di classe")}</div>
          <div className="space-y-2 px-4 pb-3">
            {!sessionId ? (
              <p className="py-2 text-xs text-slate-400">{tl("Seleziona una sessione per vedere la chat.")}</p>
            ) : preview.length === 0 ? (
              <p className="py-2 text-xs text-slate-400">{tl("Nessun messaggio ancora.")}</p>
            ) : preview.map((m) => (
              <div key={m.id} className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-slate-700">{m.sender_name || (m.sender_type === 'TEACHER' ? tl("Docente") : tl("Studente"))}</p>
                <p className="line-clamp-2 text-[11px] leading-snug text-slate-500">{m.text || tl("Allegato")}</p>
              </div>
            ))}
          </div>
        </button>
      )}
    </div>
  )
}
