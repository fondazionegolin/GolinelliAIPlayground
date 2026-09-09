import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Bell, Users, AtSign, Check, KanbanSquare, ClipboardList, FileText, MessageSquare, Bot } from 'lucide-react'
import { PLATFORM_REALTIME_EVENT, type PlatformRealtimeDetail } from '@/lib/realtimeEvents'

interface RoomLite {
  id: string
  title: string | null
  participants: { id: string; nickname: string }[]
  [k: string]: unknown
}

interface Notif {
  id: string
  type: 'invite' | 'mention' | 'board' | 'task' | 'document' | 'correction' | 'feedback' | 'teacherbot'
  from: string
  preview?: string
  room: RoomLite
  payload?: Record<string, any>
  ts: number
  read: boolean
}

/**
 * Personal and classroom notifications for students, surfaced as a bell with a
 * dropdown. Realtime socket sources publish onto one deduplicated browser event,
 * so the navbar does not need to poll for a socket reference.
 */
export function StudentNotificationBell({
  accentColor,
  onNavigate,
}: {
  accentColor: string
  onNavigate?: (module: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const unread = notifs.filter((n) => !n.read).length

  useEffect(() => {
    const emptyRoom = (title: string): RoomLite => ({ id: '', title, participants: [] })
    const push = (notification: Notif) => setNotifs((previous) => {
      if (previous.some((item) => item.id === notification.id)) return previous
      return [notification, ...previous].slice(0, 30)
    })
    const handleRealtime = (event: Event) => {
      const { type, payload } = (event as CustomEvent<PlatformRealtimeDetail>).detail || {}
      if (!type || !payload) return
      const now = Date.now()

      if (type === 'share_chat_invite' && payload.room?.id) {
        push({ id: `invite-${payload.room.id}`, type: 'invite', from: payload.invited_by || '—', room: payload.room, ts: now, read: false })
      } else if (type === 'share_chat_mention' && payload.room?.id) {
        push({ id: `mention-${payload.room.id}-${payload.message_id || payload.timestamp || now}`, type: 'mention', from: payload.from_nickname || '—', preview: payload.preview, room: payload.room, ts: now, read: false })
      } else if (type === 'board_shared') {
        push({ id: `board-${payload.board_id}`, type: 'board', from: 'Docente', preview: payload.title || 'Nuova board condivisa', room: emptyRoom(payload.title || 'Board condivisa'), payload, ts: now, read: false })
      } else if (type === 'task_published' || (type === 'platform_change' && payload.entity === 'task' && payload.action === 'published')) {
        const taskId = payload.task_id || payload.entity_id
        const taskData = payload.data || payload
        const documentTypes = ['lesson', 'presentation', 'document', 'document_v1', 'presentation_v2']
        const isDocument = documentTypes.includes(String(taskData.task_type || '').toLowerCase())
        push({ id: `task-${taskId}`, type: isDocument ? 'document' : 'task', from: 'Docente', preview: taskData.title || payload.title || 'Nuova attività', room: emptyRoom('Attività'), payload: { ...payload, ...taskData, task_id: taskId }, ts: now, read: false })
      } else if (type === 'document_uploaded') {
        push({ id: `document-${payload.document_id}`, type: 'document', from: 'Docente', preview: payload.filename || 'Nuovo documento', room: emptyRoom('Documenti'), payload, ts: now, read: false })
      } else if (type === 'task_correction') {
        push({ id: `correction-${payload.submission_id}`, type: 'correction', from: 'Docente', preview: 'Hai ricevuto una correzione', room: emptyRoom('Correzione'), payload, ts: now, read: false })
      } else if (type === 'task_feedback_published') {
        push({ id: `feedback-${payload.submission_id}`, type: 'feedback', from: 'Docente', preview: 'È disponibile un nuovo feedback', room: emptyRoom('Feedback'), payload, ts: now, read: false })
      } else if (type === 'chat_message' && payload.message?.is_notification && payload.message.notification_type === 'teacherbot_published') {
        const notificationData = payload.message.notification_data || {}
        push({ id: `teacherbot-${notificationData.teacherbot_id || payload.message.id}`, type: 'teacherbot', from: 'Docente', preview: payload.message.text || 'Nuovo Teacherbot disponibile', room: emptyRoom('Teacherbot'), payload: notificationData, ts: now, read: false })
      }
    }

    window.addEventListener(PLATFORM_REALTIME_EVENT, handleRealtime)
    return () => window.removeEventListener(PLATFORM_REALTIME_EVENT, handleRealtime)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const openShared = (room: RoomLite) => {
    try { localStorage.setItem('pending_shared_chat', JSON.stringify(room)) } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent('golinelli:open-shared-chat', { detail: { room } }))
    onNavigate?.('chatbot')
    setOpen(false)
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const openNotification = (notification: Notif) => {
    if (notification.type === 'board') {
      onNavigate?.('boards')
      setOpen(false)
      setNotifs((prev) => prev.map((item) => item.id === notification.id ? { ...item, read: true } : item))
      return
    }
    if (notification.type === 'document') {
      onNavigate?.('documents')
      setOpen(false)
      setNotifs((prev) => prev.map((item) => item.id === notification.id ? { ...item, read: true } : item))
      return
    }
    if (notification.type === 'task' || notification.type === 'correction' || notification.type === 'feedback') {
      onNavigate?.('self_assessment')
      setOpen(false)
      setNotifs((prev) => prev.map((item) => item.id === notification.id ? { ...item, read: true } : item))
      return
    }
    if (notification.type === 'teacherbot') {
      onNavigate?.('chatbot')
      setOpen(false)
      setNotifs((prev) => prev.map((item) => item.id === notification.id ? { ...item, read: true } : item))
      return
    }
    openShared(notification.room)
  }

  const markAllRead = () => setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) markAllRead() }}
        className="navbar-inline-control relative flex h-9 w-9 items-center justify-center rounded-[var(--selection-radius)] p-0"
        style={{ '--btn-tone': accentColor } as CSSProperties}
        title="Notifiche"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white" style={{ backgroundColor: accentColor }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-50 px-4 py-2.5">
            <span className="text-sm font-bold text-slate-800">Notifiche</span>
            {notifs.length > 0 && (
              <button onClick={markAllRead} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600">
                <Check className="h-3 w-3" /> Segna lette
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifs.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">Nessuna notifica.</p>
            ) : (
              notifs.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.read ? '' : 'bg-slate-50/60'}`}
                >
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${accentColor}1a`, color: accentColor }}>
                    {n.type === 'mention' ? <AtSign className="h-4 w-4" /> : n.type === 'board' ? <KanbanSquare className="h-4 w-4" /> : n.type === 'task' ? <ClipboardList className="h-4 w-4" /> : n.type === 'document' ? <FileText className="h-4 w-4" /> : n.type === 'correction' || n.type === 'feedback' ? <MessageSquare className="h-4 w-4" /> : n.type === 'teacherbot' ? <Bot className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">
                      {n.type === 'mention'
                        ? `${n.from} ti ha menzionato`
                        : n.type === 'board' ? 'Nuova board condivisa'
                        : n.type === 'task' ? 'Nuova attività assegnata'
                        : n.type === 'document' ? 'Nuovo documento disponibile'
                        : n.type === 'correction' ? 'Nuova correzione'
                        : n.type === 'feedback' ? 'Nuovo feedback'
                        : n.type === 'teacherbot' ? 'Nuovo Teacherbot disponibile'
                        : `${n.from} ti ha incluso in una chat`}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {n.preview || n.room.title || 'Chat condivisa'}
                    </span>
                  </span>
                  {!n.read && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
