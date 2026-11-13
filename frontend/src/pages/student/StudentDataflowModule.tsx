import { useState } from 'react'
import AgenticWorkflowLibraryPage from '@/pages/teacher/AgenticWorkflowLibraryPage'
import AgenticWorkflowStudioPage from '@/pages/teacher/AgenticWorkflowStudioPage'

/**
 * Dataflow Studio for a student: the teacher's library and canvas, driven by local state instead of router paths
 * (the student dashboard picks modules by state). Workflows are private to the student; the backend hides the nodes
 * that reach teacher data and bills AI nodes to the session's student pool. A workflow the teacher shared with the
 * session/class shows up in the library as the student's own copy (tag «Condiviso dal docente»), fully editable.
 */
type View = { kind: 'library' } | { kind: 'editor'; workflowId: string | null; key: number }

export default function StudentDataflowModule({ sessionId }: { sessionId?: string }) {
  const [view, setView] = useState<View>({ kind: 'library' })
  const go = (target: string) => {
    if (target === 'library') setView({ kind: 'library' })
    else setView({ kind: 'editor', workflowId: target === 'new' ? null : target, key: Date.now() })
  }
  if (view.kind === 'editor') {
    return <AgenticWorkflowStudioPage key={view.key} sessionId={sessionId} embedded={{ workflowId: view.workflowId, go }} />
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <AgenticWorkflowLibraryPage sessionId={sessionId} embedded={{ go }} />
    </div>
  )
}
