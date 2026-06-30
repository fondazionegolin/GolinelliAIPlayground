import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Bell, Users, AtSign, Check } from 'lucide-react'

interface RoomLite {
  id: string
  title: string | null
  participants: { id: string; nickname: string }[]
  [k: string]: unknown
}

interface Notif {
  id: string
  type: 'invite' | 'mention'
  from: string
  preview?: string
  room: RoomLite
  ts: number
  read: boolean
}

/**
 * Personal notifications for students (chatbot shares + @mentions), surfaced as a
 * bell with a dropdown. Listens on the global socket (window.socket, exposed by
 * useSocket) so it works without prop threading. Clicking a notification opens the
 * shared chat: it stores the room for ChatbotModule to pick up and navigates there.
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
    let socket: any = null
    const addNotif = (type: 'invite' | 'mention', room: RoomLite, from: string, preview?: string) => {
      if (!room?.id) return
      setNotifs((prev) => [
        { id: `${type}-${room.id}-${Date.now()}`, type, from: from || '—', preview, room, ts: Date.now(), read: false },
        ...prev,
      ].slice(0, 30))
    }
    const onInvite = (d: any) => addNotif('invite', d.room, d.invited_by)
    const onMention = (d: any) => addNotif('mention', d.room, d.from_nickname, d.preview)

    const attach = () => {
      const s = (window as any).socket
      if (s && s !== socket) {
        socket = s
        s.on('share_chat_invite', onInvite)
        s.on('share_chat_mention', onMention)
      }
    }
    attach()
    const iv = setInterval(attach, 1500)
    return () => {
      clearInterval(iv)
      if (socket) {
        socket.off('share_chat_invite', onInvite)
        socket.off('share_chat_mention', onMention)
      }
    }
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
                  onClick={() => openShared(n.room)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${n.read ? '' : 'bg-slate-50/60'}`}
                >
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${accentColor}1a`, color: accentColor }}>
                    {n.type === 'mention' ? <AtSign className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">
                      {n.type === 'mention'
                        ? `${n.from} ti ha menzionato`
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
