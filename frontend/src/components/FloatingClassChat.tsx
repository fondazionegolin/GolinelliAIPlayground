import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare } from 'lucide-react'
import ChatSidebar, { type ChatMessage } from '@/components/ChatSidebar'
import { useSocket } from '@/hooks/useSocket'
import { useDraggableFloating } from '@/hooks/useDraggableFloating'
import { type StudentAccentId } from '@/lib/studentAccent'

interface FloatingClassChatProps {
  sessionId: string
  userType: 'teacher' | 'student'
  currentUserId: string
  currentUserName: string
  teacherTarget?: { id: string; name: string }
  privateChatEnabled?: boolean
  studentAccent?: StudentAccentId
  onNotificationClick?: (notification: ChatMessage) => void
}

export function FloatingClassChat({
  sessionId,
  userType,
  currentUserId,
  currentUserName,
  teacherTarget,
  privateChatEnabled = true,
  studentAccent,
  onNotificationClick,
}: FloatingClassChatProps) {
  const [open, setOpen] = useState(false)
  const readStorageKey = `class-chat:last-read:${userType}:${sessionId}`
  const [readAt, setReadAt] = useState(() => Number(localStorage.getItem(readStorageKey) || 0))
  const { messages, privateChats, currentUserId: socketUserId, loadingInitialMessages } = useSocket(sessionId)
  const { position, dragProps, consumeDragClick } = useDraggableFloating(`floating-class-chat:${userType}`, 'top-right', 48)

  const incomingMessages = useMemo(() => {
    const all = [
      ...messages,
      ...Object.values(privateChats).flatMap((chat) => chat.messages),
    ]
    const seen = new Set<string>()
    return all.filter((message) => {
      if (!message?.id || seen.has(message.id)) return false
      seen.add(message.id)
      return message.sender_id !== (socketUserId || currentUserId)
    })
  }, [currentUserId, messages, privateChats, socketUserId])

  const latestTimestamp = incomingMessages.reduce((latest, message) => Math.max(latest, Date.parse(message.created_at) || 0), 0)
  const unreadCount = incomingMessages.filter((message) => (Date.parse(message.created_at) || 0) > readAt).length

  useEffect(() => {
    setReadAt(Number(localStorage.getItem(readStorageKey) || 0))
  }, [readStorageKey])

  useEffect(() => {
    if (loadingInitialMessages || readAt || !latestTimestamp) return
    setReadAt(latestTimestamp)
    localStorage.setItem(readStorageKey, String(latestTimestamp))
  }, [latestTimestamp, loadingInitialMessages, readAt, readStorageKey])

  useEffect(() => {
    if (!open || !latestTimestamp || latestTimestamp <= readAt) return
    setReadAt(latestTimestamp)
    localStorage.setItem(readStorageKey, String(latestTimestamp))
  }, [latestTimestamp, open, readAt, readStorageKey])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [open])

  return createPortal(
    <>
      <button
        type="button"
        {...dragProps}
        onClick={() => {
          if (consumeDragClick()) return
          setOpen(true)
        }}
        className="fixed z-[65] flex h-12 w-12 touch-none select-none items-center justify-center rounded-2xl bg-slate-950 text-white shadow-xl shadow-slate-950/25 ring-1 ring-white/20 transition-transform hover:scale-105 active:scale-95"
        style={{ left: position.x, top: position.y }}
        aria-label="Apri chat di classe"
        title="Chat di classe · trascina in alto o in basso"
      >
        <MessageSquare className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-2 -top-2 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-black text-white ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] h-[100dvh] w-screen overflow-hidden bg-white" role="dialog" aria-modal="true" aria-label="Chat di classe">
          <section className="absolute inset-0 flex min-h-0 w-full flex-col overflow-hidden bg-white">
            <ChatSidebar
              sessionId={sessionId}
              userType={userType}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              teacherTarget={teacherTarget}
              privateChatEnabled={privateChatEnabled}
              studentAccent={studentAccent}
              isMobileView
              onToggle={setOpen}
              className="h-[100dvh] min-h-0 w-full"
              onNotificationClick={onNotificationClick}
            />
          </section>
        </div>
      )}
    </>,
    document.body,
  )
}
