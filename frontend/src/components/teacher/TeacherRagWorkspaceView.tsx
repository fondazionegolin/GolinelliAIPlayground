import { lazy, Suspense, useCallback, useState } from 'react'
import { Loader2 } from '@/components/icons'
import type { AccentTheme } from '@/design/themes/roleThemes'
import { teacherRagApi } from '@/lib/api'
import { createRagSession, teacherRagSessionStore, type RagSession } from '@/lib/ragSessions'
import { tl } from '@/i18n/tl'

const RagWorkspace = lazy(() => import('@/components/student/StudentRagWorkspace'))

function ensureSessions(): RagSession[] {
  let sessions = teacherRagSessionStore.get()
  if (sessions.length === 0) {
    const first = { ...createRagSession(), name: 'Nuovo notebook' }
    teacherRagSessionStore.save(first)
    sessions = [first]
  }
  return sessions
}

/** Teacher RAG notebooks: same workspace as the student RAG, backed by /rag/teacher/*. */
export default function TeacherRagWorkspaceView({
  theme, onBack, initialSessionId, onChanged,
}: {
  theme: AccentTheme
  onBack: () => void
  initialSessionId?: string | null
  onChanged?: () => void
}) {
  const [sessions, setSessions] = useState<RagSession[]>(() => ensureSessions())
  const [activeId, setActiveId] = useState<string>(() => {
    const all = ensureSessions()
    return all.find((s) => s.id === initialSessionId)?.id ?? all[0].id
  })

  const refresh = useCallback(() => {
    setSessions(teacherRagSessionStore.get())
    onChanged?.()
  }, [onChanged])

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]

  const handleDelete = (id: string) => {
    teacherRagSessionStore.remove(id)
    const rest = ensureSessions()
    setSessions(rest)
    if (activeId === id) setActiveId(rest[0].id)
    onChanged?.()
  }

  if (!active) return null
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
      <RagWorkspace
        key={active.id}
        variant="teacher"
        api={teacherRagApi}
        store={teacherRagSessionStore}
        theme={theme}
        session={active}
        onBack={onBack}
        backLabel={tl("Chat")}
        onSessionUpdate={refresh}
        onNewSession={() => {
          const s = { ...createRagSession(), name: 'Nuovo notebook' }
          teacherRagSessionStore.save(s)
          setSessions(teacherRagSessionStore.get())
          setActiveId(s.id)
          onChanged?.()
        }}
        onSwitchSession={(id) => { setSessions(teacherRagSessionStore.get()); setActiveId(id) }}
        onDeleteSession={handleDelete}
      />
    </Suspense>
  )
}
