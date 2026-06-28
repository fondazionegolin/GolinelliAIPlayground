/**
 * Toy Language Model Lab — server-side training
 *
 * Training runs on the server (GPU 4090). Only 1 job at a time globally;
 * others wait in queue. Real-time metrics arrive via SSE (EventSource).
 * Disconnecting does NOT stop training — reconnect any time to resume streaming.
 *
 * Layout: a left sidebar lists the trained models (with inline rename); the main
 * area is a compact single-page dashboard styled with the shared design-system
 * primitives (Card / Button) and the violet lab accent.
 */

import { useState, useRef, useCallback, useEffect, type CSSProperties, type ReactNode } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Upload, Play, Pause, Square, Brain, FileText,
  Zap, RefreshCw, FlaskConical,
  Trash2, Plus, Pencil, X, Share2,
} from 'lucide-react'
import { Card } from '@/design/primitives/Card'
import { Button } from '@/components/ui/button'
import { teacherApi } from '@/lib/api'
import { PASTEL_SURFACES } from '@/design/themes/pastelSurfaces'
import ToyLMInferencePanel, { type ToyLMGeneratePayload } from '@/components/toy-lm/ToyLMInferencePanel'
import ToyLMEmbeddingPanel, { type ToyLMEmbeddingPayload } from '@/components/toy-lm/ToyLMEmbeddingPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HyperParams {
  tokenMode: 'word' | 'char'
  seqLen: number
  batchSize: number
  embedDim: number
  hiddenSize: number
  numLayers: number
  learningRate: number
  totalEpochs: number
  metricEvery: number
}

interface TrainingPoint {
  type: string
  globalStep: number
  epoch: number
  loss: number        // per-batch metric key
  avgLoss?: number    // epoch-done metric key (renamed to loss in chartData)
  perplexity: number
}

interface Job {
  id: string
  name: string
  status: string
  corpusCharCount: number
  hyperparams: HyperParams
  vocabSize: number
  savedEpoch: number
  paramCount: number
  metrics: TrainingPoint[]
  tokenMode?: 'word' | 'char'
  errorMessage: string | null
  queuePosition: number
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
}

interface TeacherClassOption {
  id: string
  name: string
}

interface SessionOption {
  id: string
  title: string
  status?: string
}

const DEFAULT_PARAMS: HyperParams = {
  tokenMode: 'word',
  seqLen: 40,
  batchSize: 64,
  embedDim: 32,
  hiddenSize: 128,
  numLayers: 2,
  learningRate: 0.002,
  totalEpochs: 20,
  metricEvery: 20,
}

const MAX_CORPUS_CHARS = 200_000

// Lab accent — violet, applied via CSS vars so the design-system Button/Card pick it up.
const LAB_ACCENT: CSSProperties = {
  ['--app-accent' as string]: 'var(--logo-violet)',
  ['--app-accent-text' as string]: 'var(--logo-violet-strong)',
} as CSSProperties

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = '/api/v1/toy-lm'

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).detail ?? msg } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ToyLMPage() {
  // Job list
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)

  // Rename
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const renameCancelRef = useRef(false)

  // New job form
  const [newJobName, setNewJobName] = useState('Modello 1')
  const [newCorpus, setNewCorpus] = useState('')
  const [fileNames, setFileNames] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Params for new / selected job
  const [params, setParams] = useState<HyperParams>(DEFAULT_PARAMS)

  // Live training state (for selected job)
  const [liveMetrics, setLiveMetrics] = useState<TrainingPoint[]>([])
  const [currentLoss, setCurrentLoss] = useState<number | null>(null)
  const [currentEpoch, setCurrentEpoch] = useState(0)
  const [currentBatch, setCurrentBatch] = useState(0)
  const [nBatches, setNBatches] = useState(0)
  const [deviceInfo, setDeviceInfo] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const sseRef = useRef<EventSource | null>(null)

  // UI
  const [showCreate, setShowCreate] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [isPausedLocally, setIsPausedLocally] = useState(false)

  // Share to class chat
  const [shareOpen, setShareOpen] = useState(false)
  const [shareClasses, setShareClasses] = useState<TeacherClassOption[]>([])
  const [shareSessions, setShareSessions] = useState<SessionOption[]>([])
  const [shareClassId, setShareClassId] = useState('')
  const [shareSessionId, setShareSessionId] = useState('')
  const [isLoadingShareTargets, setIsLoadingShareTargets] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [shareStatus, setShareStatus] = useState('')

  const selectedJob = jobs.find(j => j.id === selectedJobId) ?? null

  // ── Load jobs on mount ────────────────────────────────────────────────────

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true)
    try {
      const data: Job[] = await apiFetch('/jobs')
      setJobs(data)
      setSelectedJobId(current => {
        if (current && data.some(job => job.id === current)) return current
        return data[0]?.id ?? null
      })
    } catch (e) {
      setStatusMsg('Errore caricamento jobs: ' + (e as Error).message)
    } finally {
      setIsLoadingJobs(false)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  // Refresh selected job status every 5s when training
  useEffect(() => {
    if (!selectedJobId) return
    const job = jobs.find(j => j.id === selectedJobId)
    if (!job || !['running', 'queued'].includes(job.status)) return
    const timer = setInterval(() => {
      apiFetch(`/jobs/${selectedJobId}`).then((j: Job) => {
        setJobs(prev => prev.map(x => x.id === j.id ? j : x))
      }).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [selectedJobId, jobs])

  // ── SSE subscription ──────────────────────────────────────────────────────

  const connectSSE = useCallback((jobId: string) => {
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }
    setIsStreaming(true)
    setLiveMetrics([])
    setCurrentLoss(null)

    const es = new EventSource(`${BASE}/jobs/${jobId}/stream`, { withCredentials: true })
    sseRef.current = es

    es.onmessage = (e) => {
      let event: Record<string, unknown>
      try { event = JSON.parse(e.data) } catch { return }

      const type = event.type as string

      if (type === 'started') {
        setDeviceInfo(String(event.device ?? ''))
        setNBatches(Number(event.nBatches ?? 0))
      } else if (type === 'metric') {
        const point: TrainingPoint = {
          type,
          globalStep: Number(event.globalStep),
          epoch: Number(event.epoch),
          loss: Number(event.loss),
          perplexity: Number(event.perplexity),
        }
        setCurrentLoss(point.loss)
        setCurrentEpoch(Number(event.epoch))
        setCurrentBatch(Number(event.batch ?? 0))
        setLiveMetrics(prev => {
          const next = [...prev, point]
          return next.length > 300 ? next.slice(-300) : next
        })
      } else if (type === 'epoch_done') {
        setCurrentEpoch(Number(event.epoch) + 1)
        setCurrentLoss(Number(event.avgLoss))
        loadJobs()
      } else if (type === 'done' || type === 'error') {
        setIsStreaming(false)
        es.close()
        loadJobs()
        if (type === 'error') setStatusMsg('Errore training: ' + String(event.message ?? ''))
      } else if (type === 'queued') {
        setStatusMsg(`In coda — posizione ${event.queuePosition}`)
        setIsStreaming(false)
        es.close()
      }
    }

    es.onerror = () => {
      setIsStreaming(false)
      es.close()
    }
  }, [loadJobs])

  useEffect(() => {
    return () => { sseRef.current?.close() }
  }, [])

  // Auto-connect SSE when selecting a running job
  useEffect(() => {
    if (!selectedJobId) return
    const job = jobs.find(j => j.id === selectedJobId)
    if (job?.status === 'running' && !isStreaming) {
      connectSSE(selectedJobId)
    }
  }, [selectedJobId, jobs, isStreaming, connectSSE])

  // ── File upload ───────────────────────────────────────────────────────────

  const readFiles = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files).filter(f =>
      ['txt','md','json','csv','js','ts','py','html','xml'].includes(f.name.split('.').pop()?.toLowerCase() ?? '')
    )
    if (!fileList.length) { setStatusMsg('Nessun file di testo valido'); return }
    const texts = await Promise.all(fileList.map(f => f.text()))
    const combined = texts.join('\n\n').slice(0, MAX_CORPUS_CHARS)
    setNewCorpus(combined)
    setFileNames(fileList.map(f => f.name))
    setStatusMsg(`${fileList.length} file caricati — ${combined.length.toLocaleString()} caratteri`)
  }, [])

  // ── Create new job ────────────────────────────────────────────────────────

  const handleCreateJob = useCallback(async () => {
    if (!newCorpus) { setStatusMsg('Inserisci o carica un corpus prima'); return }
    setIsWorking(true)
    try {
      const job: Job = await apiFetch('/jobs', {
        method: 'POST',
        body: JSON.stringify({ name: newJobName, corpus: newCorpus, hyperparams: params }),
      })
      setJobs(prev => [job, ...prev])
      setSelectedJobId(job.id)
      setParams(job.hyperparams)
      setNewCorpus('')
      setFileNames([])
      setShowCreate(false)
      setStatusMsg(`Job "${job.name}" creato — vocab: ${job.vocabSize} caratteri, ${job.paramCount.toLocaleString()} parametri`)
    } catch (e) {
      setStatusMsg('Errore creazione job: ' + (e as Error).message)
    } finally {
      setIsWorking(false)
    }
  }, [newJobName, newCorpus, params])

  // ── Start training ────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!selectedJobId) return
    setIsWorking(true)
    setIsPausedLocally(false)
    try {
      const res = await apiFetch(`/jobs/${selectedJobId}/start`, { method: 'POST' })
      setStatusMsg(res.message ?? 'Avviato')
      await loadJobs()
      if (res.queuePosition === 0) {
        connectSSE(selectedJobId)
      }
    } catch (e) {
      setStatusMsg('Errore: ' + (e as Error).message)
    } finally {
      setIsWorking(false)
    }
  }, [selectedJobId, loadJobs, connectSSE])

  const handlePause = useCallback(async () => {
    if (!selectedJobId) return
    await apiFetch(`/jobs/${selectedJobId}/pause`, { method: 'POST' }).catch(() => {})
    setIsPausedLocally(true)
    setStatusMsg('Training in pausa…')
  }, [selectedJobId])

  const handleResume = useCallback(async () => {
    if (!selectedJobId) return
    await apiFetch(`/jobs/${selectedJobId}/resume`, { method: 'POST' }).catch(() => {})
    setIsPausedLocally(false)
    setStatusMsg('Training ripreso')
  }, [selectedJobId])

  const handleStop = useCallback(async () => {
    if (!selectedJobId) return
    sseRef.current?.close()
    setIsStreaming(false)
    setIsPausedLocally(false)
    await apiFetch(`/jobs/${selectedJobId}/stop`, { method: 'POST' }).catch(() => {})
    setStatusMsg('Training fermato — checkpoint salvato')
    await loadJobs()
  }, [selectedJobId, loadJobs])

  // ── Hyperparams update ────────────────────────────────────────────────────

  const handleParamsChange = useCallback(async (newParams: HyperParams) => {
    setParams(newParams)
    if (!selectedJobId) return
    try {
      await apiFetch(`/jobs/${selectedJobId}/hyperparams`, {
        method: 'POST',
        body: JSON.stringify({ hyperparams: newParams }),
      })
      await loadJobs()
    } catch {}
  }, [selectedJobId, loadJobs])

  // ── Select / rename / delete job ───────────────────────────────────────────

  const handleSelectJob = useCallback((job: Job) => {
    sseRef.current?.close()
    setIsStreaming(false)
    setShowCreate(false)
    setSelectedJobId(job.id)
    setParams({ ...DEFAULT_PARAMS, ...job.hyperparams })
    setLiveMetrics((job.metrics ?? []).map(m => ({ ...m, loss: m.avgLoss ?? m.loss })))
    const lastMetric = job.metrics?.slice(-1)[0]
    setCurrentLoss(lastMetric ? (lastMetric.avgLoss ?? lastMetric.loss ?? null) : null)
    setCurrentEpoch(job.savedEpoch)
    setIsPausedLocally(false)
  }, [])

  useEffect(() => {
    if (!selectedJob || showCreate) return
    setParams({ ...DEFAULT_PARAMS, ...selectedJob.hyperparams })
    if (!isStreaming) {
      const storedMetrics = (selectedJob.metrics ?? []).map(m => ({ ...m, loss: m.avgLoss ?? m.loss }))
      setLiveMetrics(storedMetrics)
      const lastMetric = storedMetrics.slice(-1)[0]
      setCurrentLoss(lastMetric ? lastMetric.loss : null)
      setCurrentEpoch(selectedJob.savedEpoch)
    }
  }, [selectedJob?.id, selectedJob?.savedEpoch, selectedJob?.metrics, selectedJob?.hyperparams, showCreate, isStreaming])

  const handleRename = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim()
    setEditingId(null)
    const current = jobs.find(j => j.id === id)
    if (!trimmed || !current || trimmed === current.name) return
    setJobs(prev => prev.map(j => j.id === id ? { ...j, name: trimmed } : j)) // optimistic
    try {
      await apiFetch(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify({ name: trimmed }) })
    } catch (e) {
      setStatusMsg('Errore rinomina: ' + (e as Error).message)
      loadJobs()
    }
  }, [jobs, loadJobs])

  const commitRename = useCallback((id: string) => {
    if (renameCancelRef.current) { renameCancelRef.current = false; setEditingId(null); return }
    handleRename(id, editingName)
  }, [editingName, handleRename])

  const handleDeleteJob = useCallback(async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Eliminare questo job e il suo checkpoint?')) return
    try {
      await apiFetch(`/jobs/${jobId}`, { method: 'DELETE' })
      setJobs(prev => prev.filter(j => j.id !== jobId))
      if (selectedJobId === jobId) setSelectedJobId(null)
    } catch (err) {
      setStatusMsg('Errore eliminazione: ' + (err as Error).message)
    }
  }, [selectedJobId])

  // ── Generate / share ──────────────────────────────────────────────────────

  const generateSelectedJob = useCallback(async (payload: ToyLMGeneratePayload) => {
    if (!selectedJobId) return ''
    const res = await apiFetch(`/jobs/${selectedJobId}/generate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return res.generated ?? ''
  }, [selectedJobId])

  const loadSelectedJobEmbeddings = useCallback(async (): Promise<ToyLMEmbeddingPayload> => {
    if (!selectedJobId) return { embeddingDim: 0, tokens: [] }
    return apiFetch(`/jobs/${selectedJobId}/embeddings`)
  }, [selectedJobId])

  const loadShareSessions = useCallback(async (classId: string) => {
    if (!classId) {
      setShareSessions([])
      setShareSessionId('')
      return
    }
    const res = await teacherApi.getSessions(classId)
    const sessions: SessionOption[] = Array.isArray(res.data) ? res.data : []
    setShareSessions(sessions)
    const active = sessions.find(s => s.status === 'active') ?? sessions[0]
    setShareSessionId(active?.id ?? '')
  }, [])

  const openShareDialog = useCallback(async () => {
    if (!selectedJob) return
    setShareOpen(true)
    setShareStatus('')
    if (shareClasses.length > 0) return
    setIsLoadingShareTargets(true)
    try {
      const res = await teacherApi.getClasses()
      const classes: TeacherClassOption[] = Array.isArray(res.data) ? res.data : []
      setShareClasses(classes)
      const firstClass = classes[0]
      if (firstClass) {
        setShareClassId(firstClass.id)
        await loadShareSessions(firstClass.id)
      }
    } catch (err) {
      setShareStatus('Errore caricamento classi: ' + (err as Error).message)
    } finally {
      setIsLoadingShareTargets(false)
    }
  }, [loadShareSessions, selectedJob, shareClasses.length])

  const handleShareClassChange = useCallback(async (classId: string) => {
    setShareClassId(classId)
    setShareStatus('')
    setIsLoadingShareTargets(true)
    try {
      await loadShareSessions(classId)
    } catch (err) {
      setShareStatus('Errore caricamento sessioni: ' + (err as Error).message)
    } finally {
      setIsLoadingShareTargets(false)
    }
  }, [loadShareSessions])

  const handlePublishSharedModel = useCallback(async () => {
    if (!selectedJobId || !shareSessionId) return
    setIsSharing(true)
    setShareStatus('')
    try {
      await apiFetch(`/jobs/${selectedJobId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ session_id: shareSessionId }),
      })
      setShareStatus('Modello condiviso nella chat di classe.')
      setStatusMsg('Modello condiviso nella chat di classe.')
    } catch (err) {
      setShareStatus('Errore condivisione: ' + (err as Error).message)
    } finally {
      setIsSharing(false)
    }
  }, [selectedJobId, shareSessionId])

  // ── Chart data ────────────────────────────────────────────────────────────
  // Live metrics have `loss`; stored epoch metrics have `avgLoss` → normalize to `loss`
  const chartData: TrainingPoint[] = liveMetrics.length > 0
    ? liveMetrics
    : (selectedJob?.metrics ?? []).map(m => ({
        ...m,
        loss: m.avgLoss ?? m.loss,
      }))

  // ── Status helpers ────────────────────────────────────────────────────────

  const progress = selectedJob
    ? Math.round((selectedJob.savedEpoch / Math.max(params.totalEpochs, 1)) * 100)
    : 0

  const isRunning = selectedJob?.status === 'running'
  const isQueued = selectedJob?.status === 'queued'
  const canStart = selectedJob && !['running', 'queued'].includes(selectedJob.status ?? '')
  // A paused job (running in the backend, but paused locally) has a usable
  // epoch checkpoint, so generation is allowed while paused.
  const canGenerate = (selectedJob?.status !== 'running' || isPausedLocally) && !!selectedJob?.savedEpoch

  const openCreate = useCallback(() => {
    setShowCreate(true)
    setSelectedJobId(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-[var(--surface-page)] text-[var(--text-primary)]" style={LAB_ACCENT}>

      {/* ══ Left sidebar: models ══ */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-white/55 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--logo-violet-10)] ring-1 ring-[var(--logo-violet-22)]">
            <Brain className="h-4.5 w-4.5 text-[var(--logo-violet)]" style={{ width: 18, height: 18 }} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black leading-tight">Toy LM Lab</p>
            <p className="text-[10px] text-[var(--text-muted)]">LSTM token lab</p>
          </div>
        </div>

        <div className="px-3 pt-3">
          <Button tone="accent" surface={showCreate ? 'soft' : 'solid'} density="compact" fullWidth onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Nuovo modello
          </Button>
        </div>

        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Modelli</span>
          <button onClick={loadJobs} className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--logo-violet)]" title="Aggiorna">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {isLoadingJobs && jobs.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-[var(--text-muted)]">Caricamento…</p>
          ) : jobs.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs leading-5 text-[var(--text-muted)]">Nessun modello.<br />Creane uno con <strong>Nuovo modello</strong>.</p>
          ) : (
            jobs.map(job => {
              const selected = selectedJobId === job.id
              const editing = editingId === job.id
              return (
                <div
                  key={job.id}
                  onClick={() => !editing && handleSelectJob(job)}
                  className={`group flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 transition-colors ${
                    selected ? 'bg-[var(--logo-violet-10)] ring-1 ring-[var(--logo-violet-22)]' : 'hover:bg-[var(--surface-elevated)]'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor(job.status)}`} />
                  {editing ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                        else if (e.key === 'Escape') { renameCancelRef.current = true; (e.target as HTMLInputElement).blur() }
                      }}
                      onBlur={() => commitRename(job.id)}
                      className="min-w-0 flex-1 rounded-md border border-[var(--logo-violet)] bg-white px-1.5 py-0.5 text-[13px] font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-tight">{job.name}</p>
                      <p className="truncate text-[10px] text-[var(--text-muted)]">{job.savedEpoch}/{job.hyperparams?.totalEpochs ?? '?'} epoch · {tokenModeLabel(job.tokenMode ?? job.hyperparams?.tokenMode)} · {job.status}</p>
                    </div>
                  )}
                  {!editing && (
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={e => { e.stopPropagation(); setEditingName(job.name); setEditingId(job.id) }}
                        className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-white hover:text-[var(--logo-violet)]"
                        title="Rinomina"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={e => handleDeleteJob(job.id, e)}
                        className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Elimina"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* ══ Main ══ */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Top bar */}
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-header)] px-5 py-2.5 backdrop-blur-md">
          <h1 className="truncate text-sm font-black tracking-tight">
            {showCreate ? 'Nuovo modello' : selectedJob ? selectedJob.name : 'Toy Language Model Lab'}
          </h1>
          {deviceInfo && <span className="font-mono text-[11px] text-[var(--logo-violet-strong)]">{deviceInfo}</span>}
          <div className="ml-auto flex items-center gap-2">
            {selectedJob && !showCreate && (
              <>
                <Button tone="neutral" surface="outline" density="compact" disabled={!canGenerate} onClick={openShareDialog}>
                  <Share2 className="h-3.5 w-3.5" />
                  Condividi
                </Button>
                <StatusPill job={selectedJob} isRunning={isRunning} isQueued={isQueued} currentEpoch={currentEpoch} />
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          {statusMsg && (
            <div className="mb-4 rounded-xl border border-[var(--logo-violet-22)] bg-[var(--logo-violet-06)] px-3.5 py-2 text-xs text-[var(--text-secondary)]">
              <span className="mr-2 font-bold text-[var(--logo-violet)]">›</span>{statusMsg}
            </div>
          )}

          {/* ── Create model ── */}
          {showCreate ? (
            <Card className="mx-auto max-w-2xl space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-[var(--logo-violet)]" />
                  <span className="text-sm font-black">Nuovo modello</span>
                </div>
                <button onClick={() => setShowCreate(false)} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]" title="Annulla">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <FieldLabel>Nome del modello</FieldLabel>
                <input
                  value={newJobName}
                  onChange={e => setNewJobName(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--logo-violet)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
                  placeholder="es. Modello italiano, LM Shakespeare…"
                />
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); readFiles(e.dataTransfer.files) }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 transition-all ${
                  isDragging ? 'border-[var(--logo-violet)] bg-[var(--logo-violet-10)]' : 'border-[var(--border-subtle)] bg-white hover:border-[var(--logo-violet)]'
                }`}
              >
                <Upload className="h-6 w-6 text-[var(--logo-violet)]" />
                <p className="text-sm font-semibold">Trascina i documenti qui</p>
                <p className="text-[11px] text-[var(--text-muted)]">.txt .md .json .csv .js .ts .py .html — max {(MAX_CORPUS_CHARS/1000).toFixed(0)}k caratteri</p>
                <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.json,.csv,.js,.ts,.py,.html,.xml" className="hidden" onChange={e => e.target.files && readFiles(e.target.files)} />
              </div>

              {fileNames.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {fileNames.map((n, i) => (
                    <span key={i} className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-white px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                      <FileText className="h-3 w-3 text-[var(--logo-violet)]" />{n}
                    </span>
                  ))}
                </div>
              )}

              <div>
                <FieldLabel>Oppure incolla il testo direttamente</FieldLabel>
                <textarea
                  value={newCorpus}
                  onChange={e => setNewCorpus(e.target.value.slice(0, MAX_CORPUS_CHARS))}
                  rows={5}
                  placeholder="Incolla qui il testo del corpus…"
                  className="w-full resize-none rounded-xl border border-[var(--border-subtle)] bg-white p-3 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--logo-violet)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
                />
                <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">{newCorpus.length.toLocaleString()} / {MAX_CORPUS_CHARS.toLocaleString()} chars</p>
              </div>

              <div className="rounded-2xl border border-[var(--border-subtle)] bg-white/60 p-4">
                <SubLabel>Iperparametri iniziali</SubLabel>
                <div className="mt-3">
                  <FieldLabel>Tokenizzazione</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setParams(p => ({ ...p, tokenMode: 'word' }))}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                        params.tokenMode === 'word'
                          ? 'border-[var(--logo-violet)] bg-[var(--logo-violet-10)] text-[var(--logo-violet-strong)]'
                          : 'border-[var(--border-subtle)] bg-white text-[var(--text-secondary)] hover:border-[var(--logo-violet)]'
                      }`}
                    >
                      <span className="block font-black">Parole</span>
                      <span className="mt-0.5 block text-[10px] opacity-75">embedding di parole e punteggiatura</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setParams(p => ({ ...p, tokenMode: 'char' }))}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                        params.tokenMode === 'char'
                          ? 'border-[var(--logo-violet)] bg-[var(--logo-violet-10)] text-[var(--logo-violet-strong)]'
                          : 'border-[var(--border-subtle)] bg-white text-[var(--text-secondary)] hover:border-[var(--logo-violet)]'
                      }`}
                    >
                      <span className="block font-black">Caratteri</span>
                      <span className="mt-0.5 block text-[10px] opacity-75">modalità character-level classica</span>
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3">
                  <ParamSlider label="Seq len" value={params.seqLen} min={20} max={120} step={5} onChange={v => setParams(p => ({...p, seqLen: v}))} />
                  <ParamSlider label="Batch size" value={params.batchSize} min={16} max={256} step={16} onChange={v => setParams(p => ({...p, batchSize: v}))} />
                  <ParamSlider label="Embed dim" value={params.embedDim} min={8} max={64} step={8} onChange={v => setParams(p => ({...p, embedDim: v}))} />
                  <ParamSlider label="Hidden size" value={params.hiddenSize} min={32} max={512} step={32} onChange={v => setParams(p => ({...p, hiddenSize: v}))} />
                  <ParamSlider label="Num layers" value={params.numLayers} min={1} max={4} step={1} onChange={v => setParams(p => ({...p, numLayers: v}))} />
                  <ParamSlider label="Epoche" value={params.totalEpochs} min={1} max={100} step={1} onChange={v => setParams(p => ({...p, totalEpochs: v}))} />
                  <ParamSlider label="Learning rate" value={params.learningRate} min={0.0001} max={0.01} step={0.0001} onChange={v => setParams(p => ({...p, learningRate: v}))} displayFn={v => v.toFixed(4)} />
                </div>
              </div>

              <Button tone="accent" surface="solid" fullWidth disabled={!newCorpus || isWorking} onClick={handleCreateJob}>
                {isWorking ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Crea modello
              </Button>
            </Card>

          /* ── Selected job dashboard ── */
          ) : selectedJob ? (
            <div className="space-y-4">

              {/* Training overview: metrics + progress + controls */}
              <Card className={`space-y-3 rounded-[24px] p-4 shadow-sm ${PASTEL_SURFACES.violet}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-[var(--logo-violet)]" />
                    <span className="text-sm font-black">Training</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!isRunning && !isQueued && (
                      <Button tone="accent" surface="solid" density="compact" disabled={!canStart || isWorking} onClick={handleStart}>
                        <Play className="h-3.5 w-3.5" />
                        {selectedJob.savedEpoch > 0 ? `Riprendi · epoch ${selectedJob.savedEpoch}` : 'Avvia training'}
                      </Button>
                    )}
                    {isRunning && (isPausedLocally ? (
                      <Button tone="accent" surface="solid" density="compact" onClick={handleResume}><Play className="h-3.5 w-3.5" /> Riprendi</Button>
                    ) : (
                      <Button tone="neutral" surface="outline" density="compact" onClick={handlePause}><Pause className="h-3.5 w-3.5" /> Pausa</Button>
                    ))}
                    {isRunning && (
                      <Button tone="danger" surface="outline" density="compact" onClick={handleStop}><Square className="h-3.5 w-3.5" /> Stop</Button>
                    )}
                    {isQueued && (
                      <Button tone="danger" surface="outline" density="compact" onClick={handleStop}><Square className="h-3.5 w-3.5" /> Rimuovi</Button>
                    )}
                    {isRunning && (isStreaming ? (
                      <Button tone="neutral" surface="ghost" density="compact" onClick={() => { sseRef.current?.close(); setIsStreaming(false) }}>Disconnetti</Button>
                    ) : (
                      <Button tone="accent" surface="ghost" density="compact" onClick={() => connectSSE(selectedJobId!)}>Riconnetti</Button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <MetricBox label="Epoch" value={isRunning ? `${currentEpoch + 1}/${params.totalEpochs}` : `${selectedJob.savedEpoch}/${params.totalEpochs}`} color="violet" />
                  <MetricBox label="Batch" value={isRunning ? `${currentBatch + 1}/${nBatches}` : '—'} color="slate" />
                  <MetricBox label="Loss" value={currentLoss !== null ? currentLoss.toFixed(4) : (selectedJob.metrics?.slice(-1)[0]?.avgLoss?.toFixed(4) ?? '—')} color="rose" />
                  <MetricBox label="Perplexity" value={currentLoss !== null ? Math.exp(currentLoss).toFixed(2) : (selectedJob.metrics?.slice(-1)[0]?.perplexity?.toFixed(2) ?? '—')} color="violet" />
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-[var(--text-muted)]">
                    <span>{progress}% completato</span>
                    <span>{selectedJob.savedEpoch}/{params.totalEpochs} epoch salvate</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--logo-violet-10)]">
                    <div className="h-full rounded-full bg-[var(--logo-violet)] transition-all duration-700" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                {isQueued && (
                  <div className="rounded-xl border border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] px-3 py-2 text-xs text-[#1278bd]">
                    In coda per la GPU — posizione {selectedJob.queuePosition}. Il training partirà automaticamente.
                  </div>
                )}
                {selectedJob.errorMessage && (
                  <div className="rounded-xl border border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] px-3 py-2 text-xs text-[var(--logo-pink)]">Errore: {selectedJob.errorMessage}</div>
                )}
              </Card>

              {/* Charts */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ChartPanel title="Loss" dataKey="loss" data={chartData} color="#7b69c9" height={150} tone="violet" />
                <ChartPanel title="Perplexity" dataKey="perplexity" data={chartData} color="#fe004d" height={150} tone="rose" />
              </div>

              <Card className={`rounded-[24px] p-4 shadow-sm ${PASTEL_SURFACES.indigo}`}>
                <ToyLMEmbeddingPanel
                  key={`embeddings-${selectedJob.id}`}
                  canLoad={!!canGenerate}
                  unavailableMessage="Completa almeno una epoch (o metti in pausa) prima di esplorare gli embedding."
                  loadEmbeddings={loadSelectedJobEmbeddings}
                />
              </Card>

              {/* Bottom: architecture + hyperparams | generate */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

                <Card className={`space-y-3 rounded-[24px] p-4 shadow-sm ${PASTEL_SURFACES.slate}`}>
                  <div>
                    <SubLabel>Architettura</SubLabel>
                    <div className="mt-2 space-y-1 font-mono text-[11px]">
                      <ArchRow label="Tokenizzazione" val={tokenModeLabel(selectedJob.tokenMode ?? params.tokenMode)} />
                      <ArchRow label="Vocab" val={`${selectedJob.vocabSize} token`} />
                      <ArchRow label="Embedding" val={`${selectedJob.vocabSize} → ${params.embedDim}`} />
                      <ArchRow label={`LSTM ×${params.numLayers}`} val={`→ ${params.hiddenSize}`} />
                      <ArchRow label="Dense" val={`→ ${selectedJob.vocabSize}`} />
                      <div className="mt-1.5 border-t border-[var(--border-subtle)] pt-1.5 font-bold text-[var(--logo-violet)]">
                        {selectedJob.paramCount.toLocaleString()} parametri totali
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-[var(--border-subtle)] pt-3">
                    <SubLabel>Iperparametri {isRunning && <span className="text-amber-500">· bloccati</span>}</SubLabel>
                    <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-2.5">
                      <ParamSlider label="Epoche" value={params.totalEpochs} min={1} max={100} step={1} disabled={isRunning} onChange={v => handleParamsChange({...params, totalEpochs: v})} />
                      <ParamSlider label="Batch size" value={params.batchSize} min={16} max={256} step={16} disabled={isRunning} onChange={v => handleParamsChange({...params, batchSize: v})} />
                      <ParamSlider label="Learning rate" value={params.learningRate} min={0.0001} max={0.01} step={0.0001} disabled={isRunning} onChange={v => handleParamsChange({...params, learningRate: v})} displayFn={v => v.toFixed(4)} />
                      <ParamSlider label="Log ogni N batch" value={params.metricEvery} min={5} max={100} step={5} disabled={isRunning} onChange={v => handleParamsChange({...params, metricEvery: v})} />
                    </div>
                  </div>
                </Card>

                <Card className={`space-y-3 rounded-[24px] p-4 shadow-sm ${PASTEL_SURFACES.cyan}`}>
                  <ToyLMInferencePanel
                    key={selectedJob.id}
                    canGenerate={!!canGenerate}
                    unavailableMessage="Completa almeno una epoch (o metti in pausa) prima di generare."
                    onGenerate={generateSelectedJob}
                  />
                </Card>
              </div>
            </div>

          ) : (
            <Card className="p-10 text-center text-sm text-[var(--text-secondary)]">
              Seleziona un modello dalla barra a sinistra, oppure creane uno nuovo.
            </Card>
          )}
        </main>
      </div>

      {shareOpen && selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={() => setShareOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-black text-[var(--text-primary)]">Condividi modello</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Pubblica "{selectedJob.name}" nella chat di classe.</p>
              </div>
              <button onClick={() => setShareOpen(false)} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]" title="Chiudi">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <FieldLabel>Classe</FieldLabel>
                <select
                  value={shareClassId}
                  disabled={isLoadingShareTargets}
                  onChange={e => void handleShareClassChange(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--logo-violet)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
                >
                  <option value="">Seleziona una classe</option>
                  {shareClasses.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel>Chat di sessione</FieldLabel>
                <select
                  value={shareSessionId}
                  disabled={isLoadingShareTargets || !shareClassId}
                  onChange={e => setShareSessionId(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--logo-violet)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
                >
                  <option value="">Seleziona una sessione</option>
                  {shareSessions.map(session => (
                    <option key={session.id} value={session.id}>
                      {session.title}{session.status ? ` · ${session.status}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {shareStatus && (
                <div className="rounded-xl border border-[var(--logo-violet-22)] bg-[var(--logo-violet-06)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  {shareStatus}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button tone="neutral" surface="ghost" onClick={() => setShareOpen(false)}>Chiudi</Button>
                <Button tone="accent" surface="solid" disabled={!shareSessionId || isSharing || isLoadingShareTargets} onClick={handlePublishSharedModel}>
                  {isSharing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                  Condividi
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function dotColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-[var(--logo-blue)] animate-pulse'
    case 'queued': return 'bg-[var(--logo-blue)]'
    case 'completed': return 'bg-[var(--logo-violet)]'
    case 'paused': return 'bg-[var(--logo-violet)]'
    case 'failed': return 'bg-[var(--logo-pink)]'
    default: return 'bg-slate-300'
  }
}

function tokenModeLabel(mode?: string): string {
  return mode === 'char' ? 'caratteri' : 'parole'
}

function StatusPill({ job, isRunning, isQueued, currentEpoch }: {
  job: Job; isRunning: boolean; isQueued: boolean; currentEpoch: number
}) {
  const { cls, text } =
    isRunning ? { cls: 'border-[rgba(62,169,244,0.22)] bg-[rgba(62,169,244,0.075)] text-[#1278bd]', text: `in training · epoch ${currentEpoch}` } :
    isQueued ? { cls: 'border-[rgba(62,169,244,0.22)] bg-[rgba(62,169,244,0.075)] text-[#1278bd]', text: `in coda · pos. ${job.queuePosition}` } :
    job.status === 'completed' ? { cls: 'border-[var(--logo-violet-22)] bg-[var(--logo-violet-06)] text-[var(--logo-violet-strong)]', text: 'completato' } :
    job.status === 'paused' ? { cls: 'border-[var(--logo-violet-22)] bg-[var(--logo-violet-06)] text-[var(--logo-violet-strong)]', text: 'in pausa' } :
    { cls: 'border-[var(--border-subtle)] bg-white text-[var(--text-secondary)]', text: job.status }
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls} ${isRunning ? 'animate-pulse' : ''}`}>
      {text}
    </span>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{children}</label>
}

function SubLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{children}</p>
}

function MetricBox({ label, value, color }: { label: string; value: string; color: 'violet'|'rose'|'amber'|'slate' }) {
  const cls = {
    violet: 'text-[var(--logo-violet)]',
    rose: 'text-[var(--logo-pink)]',
    amber: 'text-orange-500',
    slate: 'text-slate-700',
  }[color]
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-white p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-black ${cls}`}>{value}</div>
    </div>
  )
}

function ArchRow({ label, val }: { label: string; val: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-primary)]">{val}</span>
    </div>
  )
}

function ChartPanel({ title, dataKey, data, color, height = 190, tone = 'slate' }: {
  title: string; dataKey: string; data: unknown[]; color: string; height?: number; tone?: keyof typeof PASTEL_SURFACES
}) {
  return (
    <Card className={`rounded-[24px] p-4 shadow-sm ${PASTEL_SURFACES[tone]}`}>
      <SubLabel>{title}</SubLabel>
      <div className="mt-2">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="globalStep" tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#cbd5e1" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#cbd5e1" domain={['auto','auto']} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 11, boxShadow: '0 8px 22px rgba(23,21,27,0.06)' }} labelStyle={{ color: '#64748b' }} />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center text-sm text-[var(--text-muted)]" style={{ height }}>Grafico disponibile durante il training</div>
        )}
      </div>
    </Card>
  )
}

function ParamSlider({
  label, value, min, max, step, onChange, disabled, description, displayFn,
}: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; disabled?: boolean; description?: string; displayFn?: (v: number) => string
}) {
  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
        <span className="font-mono text-xs font-bold text-[var(--logo-violet)]">{displayFn ? displayFn(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--logo-violet-10)] accent-[var(--logo-violet)]"
      />
      {description && <p className="mt-1 text-[10px] text-[var(--text-muted)]">{description}</p>}
    </div>
  )
}
