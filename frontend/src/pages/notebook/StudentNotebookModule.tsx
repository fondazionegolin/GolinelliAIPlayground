import { useState, Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'

const NotebookListPage = lazy(() => import('./NotebookListPage'))
const NotebookPage     = lazy(() => import('./NotebookPage'))

const fallback = (
  <div className="flex items-center justify-center h-full">
    <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
  </div>
)

/**
 * Self-contained notebook module for the student dashboard.
 * Manages list ↔ detail navigation via local state (no React Router needed).
 */
export default function StudentNotebookModule() {
  const [notebookId, setNotebookId] = useState<string | null>(null)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Suspense fallback={fallback}>
        {notebookId ? (
          <NotebookPage
            notebookIdOverride={notebookId}
          />
        ) : (
          <NotebookListPage onOpen={(id) => setNotebookId(id)} />
        )}
      </Suspense>
    </div>
  )
}
