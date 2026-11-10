import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Video, X } from '@/components/icons'
import { Button, IconButton } from '@/design'
import { PLATFORM_REALTIME_EVENT, type PlatformRealtimeDetail } from '@/lib/realtimeEvents'
import { tl } from '@/i18n/tl'
import { hhmm } from './calendarUtils'

type Reminder = {
  id: string
  title: string
  description?: string | null
  start: Date
  color: string
  voiceCallCode?: string | null
}

/**
 * Popup shown when a shared calendar event starts in 10 minutes (socket `calendar_reminder`).
 * Teachers only react to reminders that name them: a teacher sitting in a session room would otherwise
 * also receive the reminders meant for that session's students.
 */
export function CalendarReminderPopup({ role, userId }: { role: 'teacher' | 'student'; userId?: string }) {
  const [reminders, setReminders] = useState<Reminder[]>([])

  useEffect(() => {
    const seen = new Set<string>()
    const onRealtime = (event: Event) => {
      const { type, payload } = (event as CustomEvent<PlatformRealtimeDetail>).detail || {}
      if (type !== 'calendar_reminder' || !payload?.calendar_event_id) return
      if (role === 'teacher' && !(payload.teacher_ids || []).includes(userId)) return
      if (seen.has(payload.calendar_event_id)) return
      seen.add(payload.calendar_event_id)
      const reminder: Reminder = {
        id: payload.calendar_event_id,
        title: payload.title,
        description: payload.description,
        start: new Date(payload.starts_at),
        color: payload.color || '#6366f1',
        voiceCallCode: payload.voice_call_code || null,
      }
      setReminders((prev) => [...prev, reminder])
      // System notification too when the tab is in the background and the user already allowed it.
      try {
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(tl("Tra 10 minuti: {0}", reminder.title), { body: tl("Inizio alle {0}", hhmm(reminder.start)), tag: `calendar-${reminder.id}` })
        }
      } catch { /* notifications unavailable */ }
    }
    window.addEventListener(PLATFORM_REALTIME_EVENT, onRealtime)
    return () => window.removeEventListener(PLATFORM_REALTIME_EVENT, onRealtime)
  }, [role, userId])

  if (!reminders.length || typeof document === 'undefined') return null
  const dismiss = (id: string) => setReminders((prev) => prev.filter((r) => r.id !== id))

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 top-20 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end" aria-live="assertive">
      {reminders.map((reminder) => (
        <div key={reminder.id} role="alertdialog" aria-label={reminder.title} className="ds-popover pointer-events-auto w-full max-w-sm animate-in fade-in slide-in-from-top-2 rounded-[var(--ds-radius-panel)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: reminder.color }}>
              <Bell className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">{tl("Tra 10 minuti · ore {0}", hhmm(reminder.start))}</div>
              <div className="truncate text-sm font-bold text-[var(--text-primary)]">{reminder.title}</div>
              {reminder.description && <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)]">{reminder.description}</p>}
            </div>
            <IconButton tone="neutral" surface="ghost" size="sm" aria-label={tl("Chiudi")} onClick={() => dismiss(reminder.id)}><X className="h-4 w-4" /></IconButton>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {reminder.voiceCallCode ? (
              <>
                <Button tone="neutral" surface="ghost" density="compact" onClick={() => dismiss(reminder.id)}>{tl("Più tardi")}</Button>
                <Button tone="accent" surface="solid" density="compact" onClick={() => {
                  window.open(`/call/${reminder.voiceCallCode}`, '_blank', 'noopener')
                  dismiss(reminder.id)
                }}>
                  <Video className="mr-1.5 h-4 w-4" />{tl("Entra in videochiamata")}
                </Button>
              </>
            ) : (
              <Button tone="accent" surface="solid" density="compact" onClick={() => dismiss(reminder.id)}>{tl("Ok, ci sono")}</Button>
            )}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  )
}
