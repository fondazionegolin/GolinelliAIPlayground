import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Square, X } from '@/components/icons'
import { jobsApi, type BackgroundJob } from '@/lib/api'
import { cancelJob, JOBS_CHANGED_EVENT, useTicker } from '@/lib/backgroundJobs'
import { useToast } from '@/components/ui/use-toast'
import { ProgressPie } from '@/components/ui/ProgressGlyph'

const QUERY_KEY = ['background-jobs']

function elapsedLabel(job: BackgroundJob) {
  const start = new Date(job.created_at).getTime()
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** Estimated progress between polls: the server value, nudged forward by elapsed time. */
function displayProgress(job: BackgroundJob) {
  if (job.status === 'succeeded') return 1
  return Math.max(0, Math.min(0.99, job.progress_display ?? job.progress ?? 0))
}

const PieProgress = ProgressPie

const STATUS_TEXT: Record<BackgroundJob['status'], string> = {
  running: 'In corso',
  succeeded: 'Completato',
  failed: 'Non riuscito',
  cancelled: 'Annullato',
  interrupted: 'Interrotto',
}

/** Navbar reminder of long AI generations running in the background (next to the credits pill). */
export default function BackgroundJobsIndicator({ accentColor, student = false }: { accentColor: string; student?: boolean }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const previousStatus = useRef<Map<string, BackgroundJob['status']>>(new Map())

  const { data: jobs = [] } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await jobsApi.list()).data,
    refetchInterval: (query) => ((query.state.data as BackgroundJob[] | undefined)?.some((job) => job.status === 'running') ? 2500 : 30000),
    refetchOnWindowFocus: true,
  })

  const running = useMemo(() => jobs.filter((job) => job.status === 'running'), [jobs])
  useTicker(running.length > 0, 1000)

  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: QUERY_KEY }) }
    window.addEventListener(JOBS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, refresh)
  }, [queryClient])

  // Tell the user when a job they may have walked away from finishes.
  useEffect(() => {
    const seen = previousStatus.current
    for (const job of jobs) {
      const before = seen.get(job.id)
      if (before === 'running' && job.status !== 'running') {
        toast({
          title: job.status === 'succeeded' ? `Pronto: ${job.title}` : `${STATUS_TEXT[job.status]}: ${job.title}`,
          description: job.status === 'succeeded' ? (job.progress_label || undefined) : (job.error || undefined),
          variant: job.status === 'succeeded' ? undefined : 'destructive',
        })
      }
      seen.set(job.id, job.status)
    }
  }, [jobs, toast])

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const dismiss = async (ids: string[]) => {
    if (!ids.length) return
    queryClient.setQueryData<BackgroundJob[]>(QUERY_KEY, (current) => current?.filter((job) => !ids.includes(job.id)))
    try { await jobsApi.markSeen(ids) } catch { /* shown again on next poll */ }
  }

  const openJob = (job: BackgroundJob) => {
    setOpen(false)
    if (job.status !== 'running') void dismiss([job.id])
    const route = job.route || ''
    if (route.startsWith('module:')) {
      const moduleKey = route.slice('module:'.length)
      try { window.sessionStorage.setItem('student_active_module', moduleKey) } catch { /* private mode */ }
      window.dispatchEvent(new CustomEvent('student-open-module', { detail: moduleKey }))
      navigate('/student')
    } else if (route) {
      navigate(route)
    }
  }

  if (!jobs.length) return null

  const finished = jobs.filter((job) => job.status !== 'running')
  const failed = finished.some((job) => job.status !== 'succeeded')
  const lead = running[0]
  const aggregate = running.length ? running.reduce((sum, job) => sum + displayProgress(job), 0) / running.length : 1
  const color = running.length ? accentColor : failed ? '#dc2626' : '#059669'
  const title = running.length
    ? `${running.length === 1 ? lead.title : `${running.length} generazioni in corso`} · ${Math.round(aggregate * 100)}%`
    : failed ? 'Una generazione non è riuscita' : 'Generazioni completate'

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="navbar-inline-control relative flex h-8 min-w-[40px] items-center justify-center gap-1 rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2"
        style={{ color, '--btn-tone': accentColor, '--tw-ring-color': accentColor } as CSSProperties}
        aria-label={title}
        title={title}
        aria-expanded={open}
      >
        {running.length ? (
          <PieProgress value={aggregate} color={color} size={13} />
        ) : failed ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        {running.length > 1 && <span className="text-[10px] font-black tabular-nums">{running.length}</span>}
        {!running.length && finished.length > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-black text-slate-900">Generazioni in background</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Continuano anche se cambi pagina o ricarichi{student ? '' : ' il browser'}.
              </p>
            </div>
            {finished.length > 0 && (
              <button type="button" onClick={() => void dismiss(finished.map((job) => job.id))} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100">
                Pulisci
              </button>
            )}
          </div>
          <ul className="max-h-96 space-y-1 overflow-y-auto p-2">
            {jobs.map((job) => {
              const value = displayProgress(job)
              const isRunning = job.status === 'running'
              const tone = isRunning ? accentColor : job.status === 'succeeded' ? '#059669' : '#dc2626'
              return (
                <li key={job.id} className="rounded-lg px-3 py-2.5 hover:bg-slate-50">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {isRunning ? <PieProgress value={value} color={tone} size={20} /> : job.status === 'succeeded'
                        ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        : <AlertTriangle className="h-5 w-5 text-red-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-black text-slate-900" title={job.title}>{job.title}</p>
                        <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-400">
                          {isRunning ? `${Math.round(value * 100)}% · ` : ''}{elapsedLabel(job)}
                        </span>
                      </div>
                      {job.description && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{job.description}</p>}
                      {isRunning && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${value * 100}%`, backgroundColor: tone }} />
                        </div>
                      )}
                      <p className={`mt-1 truncate text-[11px] ${isRunning ? 'text-slate-600' : job.status === 'succeeded' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {isRunning
                          ? (job.progress_label || 'Elaborazione in corso…')
                          : job.status === 'succeeded' ? (job.progress_label || STATUS_TEXT[job.status]) : `${STATUS_TEXT[job.status]}${job.error ? `: ${job.error}` : ''}`}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1">
                        {job.route && (
                          <button type="button" onClick={() => openJob(job)} className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-700 hover:bg-slate-100">
                            <ExternalLink className="h-3 w-3" /> Apri
                          </button>
                        )}
                        {isRunning && (
                          <button
                            type="button"
                            onClick={() => { if (window.confirm(`Annullare "${job.title}"?`)) void cancelJob(job.id) }}
                            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-500 hover:bg-red-50 hover:text-red-600"
                          >
                            <Square className="h-3 w-3" /> Annulla
                          </button>
                        )}
                        {!isRunning && (
                          <button type="button" onClick={() => void dismiss([job.id])} className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Rimuovi dall'elenco">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {running.length > 0 && (
            <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Aggiornamento automatico
            </p>
          )}
        </div>
      )}
    </div>
  )
}
