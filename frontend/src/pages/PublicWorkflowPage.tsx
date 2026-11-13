import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GitBranch, Loader2 } from '@/components/icons'
import SharedWorkflowRunner, { type SharedRunAdapter } from '@/components/agentic/SharedWorkflowRunner'
import { agenticSharingApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

/** Anonymous page behind a shared workflow's link / QR code: run it, no account needed. */
export default function PublicWorkflowPage() {
  const { token = '' } = useParams()
  const app = useQuery({ queryKey: ['public-workflow', token], queryFn: async () => (await agenticSharingApi.publicApp(token)).data, retry: false })
  const adapter = useMemo<SharedRunAdapter>(() => ({
    start: async () => (await agenticSharingApi.publicStart(token)).data,
    get: async (runId) => (await agenticSharingApi.publicRun(token, runId)).data,
    send: async (runId, content) => (await agenticSharingApi.publicInput(token, runId, content)).data,
  }), [token])

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--surface-base)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white"><GitBranch className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]">{tl("Golinelli.ai · Dataflow")}</p>
          <p className="truncate text-sm font-black text-[var(--text-primary)]">{app.data?.title ?? tl("Workflow condiviso")}</p>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {app.isLoading && <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {app.isError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-lg font-black text-[var(--text-primary)]">{tl("Link non valido")}</p>
            <p className="max-w-sm text-sm text-[var(--text-secondary)]">{tl("Il workflow non esiste più oppure il docente ha disattivato la condivisione.")}</p>
          </div>
        )}
        {app.data && <SharedWorkflowRunner key={app.data.id} app={app.data} adapter={adapter} allowDrive={false} />}
      </main>
    </div>
  )
}
