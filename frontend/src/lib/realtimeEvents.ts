import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'

export const PLATFORM_REALTIME_EVENT = 'golinelli:realtime'

export interface PlatformChangePayload {
  event_id?: string
  entity: 'class' | 'session' | 'task' | 'document' | 'board' | 'invitation' | string
  action: string
  entity_id: string
  class_id?: string | null
  session_id?: string | null
  occurred_at?: string
  data?: Record<string, unknown>
}

export interface PlatformRealtimeDetail {
  id: string
  type: string
  payload: Record<string, any>
  receivedAt: number
}

const recentlyPublished = new Map<string, number>()
const DEDUPE_WINDOW_MS = 5_000

const eventFingerprint = (type: string, payload: Record<string, any>) => {
  if (payload.event_id) return String(payload.event_id)
  const entityId = payload.entity_id || payload.task_id || payload.submission_id || payload.document_id || payload.board_id || payload.session_id || payload.class_id || payload.module_key || payload.room?.id || payload.message?.id || ''
  const actorId = payload.student_id || payload.teacher_id || payload.sender_id || payload.message?.sender_id || ''
  const timestamp = payload.occurred_at || payload.timestamp || payload.created_at || payload.message?.created_at || ''
  const action = payload.action ?? payload.status ?? payload.is_enabled ?? ''
  return `${type}:${entityId}:${actorId}:${action}:${timestamp}`
}

export function publishRealtimeEvent(type: string, payload: Record<string, any> = {}) {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const fingerprint = eventFingerprint(type, payload)
  const lastPublishedAt = recentlyPublished.get(fingerprint) || 0
  if (now - lastPublishedAt < DEDUPE_WINDOW_MS) return
  recentlyPublished.set(fingerprint, now)

  if (recentlyPublished.size > 250) {
    for (const [key, publishedAt] of recentlyPublished) {
      if (now - publishedAt > DEDUPE_WINDOW_MS) recentlyPublished.delete(key)
    }
  }

  const detail: PlatformRealtimeDetail = { id: fingerprint, type, payload, receivedAt: now }
  window.dispatchEvent(new CustomEvent<PlatformRealtimeDetail>(PLATFORM_REALTIME_EVENT, { detail }))
}

export function usePlatformRealtimeSync(queryClient: QueryClient) {
  useEffect(() => {
    const invalidate = (queryKey: unknown[]) => queryClient.invalidateQueries({ queryKey })
    const handleRealtime = (event: Event) => {
      const { type, payload } = (event as CustomEvent<PlatformRealtimeDetail>).detail || {}
      if (!type || !payload) return

      const change = type === 'platform_change' ? payload as PlatformChangePayload : null
      const sessionId = change?.session_id || payload.session_id
      const classId = change?.class_id || payload.class_id
      const entity = change?.entity

      if (entity === 'class') {
        invalidate(['classes'])
        invalidate(['teacher-classes-docs'])
        invalidate(['admin-classes'])
        if (classId) invalidate(['sessions', classId])
      }
      if (entity === 'session' || type === 'session_status_changed') {
        invalidate(['classes'])
        if (classId) invalidate(['sessions', classId])
        if (sessionId) invalidate(['session-live', sessionId])
      }
      if (entity === 'task' || ['task_published', 'task_submission', 'task_submitted', 'quiz_completed', 'task_correction', 'task_feedback_published'].includes(type)) {
        invalidate(['student-tasks'])
        if (sessionId) {
          invalidate(['session-live', sessionId])
          invalidate(['session-documents', sessionId])
        }
        window.dispatchEvent(new CustomEvent('golinelli:documents-refresh', { detail: payload }))
      }
      if (entity === 'document' || type === 'document_uploaded' || type === 'student_document') {
        invalidate(['student-tasks'])
        window.dispatchEvent(new CustomEvent('golinelli:documents-refresh', { detail: payload }))
      }
      if (entity === 'board' || type === 'board_shared') invalidate(['student-shared-boards'])
      if (entity === 'invitation' || type === 'collaboration_invitation' || type === 'school_invitation') {
        invalidate(['invitations'])
        invalidate(['classes'])
        invalidate(['admin-platform-invitations'])
      }
    }

    window.addEventListener(PLATFORM_REALTIME_EVENT, handleRealtime)
    return () => window.removeEventListener(PLATFORM_REALTIME_EVENT, handleRealtime)
  }, [queryClient])
}
