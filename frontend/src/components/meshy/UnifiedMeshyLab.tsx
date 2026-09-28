import '@google/model-viewer'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Box, CheckCircle2, ChevronDown, Download, ImagePlus,
  Loader2, RotateCcw, Share2, Sparkles, Square, Trash2, X,
} from 'lucide-react'
import {
  jobsApi, meshyApi, type BackgroundJob,
  type MeshyAiModel, type MeshyGenerationOptions,
} from '@/lib/api'
import { cancelJob, notifyJobsChanged, useTicker } from '@/lib/backgroundJobs'
import { Button } from '@/design/primitives/Button'

type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'
type TaskType = 'text' | 'image'

interface Task3D {
  id: string
  status: TaskStatus
  progress: number
  model_urls?: Record<string, string | undefined>
  thumbnail_url?: string
  task_error?: { message?: string }
  error?: { message?: string }
}

interface ReferenceImage {
  base64: string
  mime: string
  preview: string
  name: string
}

interface Asset3D {
  id: string
  label: string
  mode: string
  glbUrl: string
  modelUrls?: Record<string, string | undefined>
  thumbnailUrl?: string
  createdAt: string
}

interface Props {
  sessionId?: string
  student?: boolean
}

const DEFAULT_OPTIONS: MeshyGenerationOptions = {
  ai_model: 'meshy-7.1',
  model_type: 'standard',
  geometry_resolution: 'standard',
  should_texture: true,
  enable_pbr: true,
  texture_resolution: '2k',
  should_remesh: false,
  topology: 'triangle',
  target_polycount: 30000,
  pose_mode: '',
  image_enhancement: true,
  auto_size: false,
  alpha_thumbnail: false,
  target_formats: ['glb', 'obj', 'fbx', 'stl', 'usdz'],
}

const MODEL_OPTIONS: Array<{ value: MeshyAiModel; label: string; note: string }> = [
  { value: 'meshy-7.1', label: 'Meshy 7.1', note: 'modello stabile selezionato' },
  { value: 'latest', label: 'Latest', note: 'oggi equivale a Meshy 7.1' },
  { value: 'meshy-6', label: 'Meshy 6', note: 'generazione standard' },
  { value: 'meshy-6-lite', label: 'Meshy 6 Lite', note: 'più rapido ed economico' },
]

const FORMAT_OPTIONS = ['glb', 'obj', 'fbx', 'stl', 'usdz', '3mf'] as const
const INPUT_CLASS = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:bg-slate-100 disabled:text-slate-400'

function loadAssets(key: string): Asset3D[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]') as Asset3D[]
    return Array.isArray(parsed) ? parsed.filter(asset => asset.glbUrl) : []
  } catch {
    return []
  }
}

function saveAssets(key: string, assets: Asset3D[]) {
  localStorage.setItem(key, JSON.stringify(assets))
}

function errorMessage(error: unknown) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Generazione non riuscita'
}

export default function UnifiedMeshyLab({ sessionId, student = false }: Props) {
  const assetKey = student ? `student_3d_assets_${sessionId || 'session'}` : 'teacher_3d_assets'
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [prompt, setPrompt] = useState('')
  const [reference, setReference] = useState<ReferenceImage | null>(null)
  const [options, setOptions] = useState<MeshyGenerationOptions>(DEFAULT_OPTIONS)
  const [task, setTask] = useState<Task3D | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskType, setTaskType] = useState<TaskType>('text')
  const [selectedModel, setSelectedModel] = useState('meshy-7.1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assets, setAssets] = useState<Asset3D[]>(() => loadAssets(assetKey))
  const [viewingAsset, setViewingAsset] = useState<Asset3D | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Background job following the Meshy task: phase label, elapsed time and the stop button.
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobInfo, setJobInfo] = useState<{ label?: string | null; startedAt: number } | null>(null)

  const actualModel = options.model_type === 'smart-topology' ? 'meshy-t2' : options.ai_model
  const estimatedCredits = (() => {
    let value = actualModel === 'meshy-6-lite' || actualModel === 'meshy-t2' ? 5 : 20
    if (reference && options.should_texture) value += options.texture_resolution === '8k' ? 15 : 10
    if (options.geometry_resolution !== 'standard') value += 5
    return value
  })()

  function setOption<K extends keyof MeshyGenerationOptions>(key: K, value: MeshyGenerationOptions[K]) {
    setOptions(current => ({ ...current, [key]: value }))
  }

  function resetResult() {
    if (pollRef.current) clearInterval(pollRef.current)
    setJobId(null)
    setJobInfo(null)
    setTask(null)
    setTaskId(null)
    setViewingAsset(null)
    setError(null)
  }

  function handleFile(file: File) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Carica un file JPG o PNG')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('L’immagine non può superare 10 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = event => {
      const preview = String(event.target?.result || '')
      setReference({ base64: preview.split(',')[1], mime: file.type, preview, name: file.name })
      setError(null)
    }
    reader.readAsDataURL(file)
  }

  function chooseModel(value: MeshyAiModel) {
    setOptions(current => ({
      ...current,
      ai_model: value,
      geometry_resolution: value === 'meshy-7.1' || value === 'latest' ? current.geometry_resolution : 'standard',
      texture_resolution: value === 'meshy-6-lite' ? '2k' : current.texture_resolution,
    }))
  }

  function chooseModelType(value: MeshyGenerationOptions['model_type']) {
    setOptions(current => ({
      ...current,
      model_type: value,
      geometry_resolution: value === 'smart-topology' ? 'standard' : current.geometry_resolution,
      topology: value === 'smart-topology' ? 'triangle' : current.topology,
      target_polycount: value === 'smart-topology' ? 4000 : Math.max(current.target_polycount, 30000),
      should_remesh: value === 'smart-topology' ? false : current.should_remesh,
    }))
  }

  async function generate() {
    if (!prompt.trim() && !reference) return
    resetResult()
    setLoading(true)
    try {
      const response = await meshyApi.generate3D({
        prompt: prompt.trim() || undefined,
        image_data: reference?.base64,
        image_mime: reference?.mime,
        options,
      })
      setTaskId(response.data.task_id)
      setTaskType(response.data.task_type)
      setSelectedModel(response.data.ai_model)
      setTask({ id: response.data.task_id, status: 'PENDING', progress: 0 })
      setJobId(response.data.job_id || null)
      setJobInfo({ startedAt: Date.now() })
      notifyJobsChanged()
    } catch (generationError) {
      setError(errorMessage(generationError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!taskId || ['SUCCEEDED', 'FAILED', 'EXPIRED'].includes(task?.status || '')) return
    const fetchStatus = taskType === 'image' ? meshyApi.getImageTo3DStatus : meshyApi.getTextTo3DStatus
    const poll = async () => {
      if (jobId) {
        void jobsApi.get(jobId).then((res) => setJobInfo((current) => ({ startedAt: current?.startedAt ?? new Date(res.data.created_at).getTime(), label: res.data.progress_label }))).catch(() => undefined)
      }
      try {
        const response = await fetchStatus(taskId)
        setTask(response.data as Task3D)
      } catch {
        // The navbar background job remains the source of truth if a poll is temporarily unavailable.
      }
    }
    void poll()
    pollRef.current = setInterval(poll, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [taskId, taskType, task?.status, jobId])

  useEffect(() => {
    if (task?.status !== 'SUCCEEDED' || !task.model_urls?.glb) return
    const asset: Asset3D = {
      id: task.id,
      label: prompt.trim() || reference?.name || 'Modello 3D',
      mode: taskType === 'image' ? 'img23d' : 'txt23d',
      glbUrl: task.model_urls.glb,
      modelUrls: task.model_urls,
      thumbnailUrl: task.thumbnail_url,
      createdAt: new Date().toISOString(),
    }
    setAssets(current => {
      if (current.some(item => item.id === asset.id)) return current
      const next = [asset, ...current]
      saveAssets(assetKey, next)
      return next
    })
  }, [task?.status, task?.id, assetKey, prompt, reference?.name, taskType])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const [kind, type] of [['meshy_text_to_3d', 'text'], ['meshy_image_to_3d', 'image']] as const) {
        let jobs: BackgroundJob[] = []
        try { jobs = (await jobsApi.list({ kind })).data } catch { continue }
        if (cancelled) return
        const running = jobs.find(job => job.status === 'running' && job.resource_id)
        const runningTaskId = running?.resource_id
        if (runningTaskId && !taskId) {
          setJobId(running.id)
          setJobInfo({ label: running.progress_label, startedAt: new Date(running.created_at).getTime() })
          setTaskId(runningTaskId)
          setTaskType(type)
          setTask({ id: runningTaskId, status: 'IN_PROGRESS', progress: Math.round((running.progress || 0) * 100) })
        }
        const finished: Asset3D[] = jobs
          .filter(job => job.status === 'succeeded' && job.result?.model_urls?.glb)
          .map(job => ({
            id: String(job.result?.task_id || job.resource_id),
            label: job.description || 'Modello 3D',
            mode: type === 'image' ? 'img23d' : 'txt23d',
            glbUrl: String(job.result!.model_urls.glb),
            modelUrls: job.result!.model_urls as Record<string, string | undefined>,
            thumbnailUrl: job.result?.thumbnail_url as string | undefined,
            createdAt: job.finished_at || job.created_at,
          }))
        if (finished.length) {
          setAssets(current => {
            const fresh = finished.filter(asset => !current.some(item => item.id === asset.id))
            if (!fresh.length) return current
            const next = [...fresh, ...current]
            saveAssets(assetKey, next)
            return next
          })
        }
      }
    })()
    return () => { cancelled = true }
  }, [assetKey, taskId])

  function deleteAsset(id: string) {
    setAssets(current => {
      const next = current.filter(asset => asset.id !== id)
      saveAssets(assetKey, next)
      return next
    })
    if (viewingAsset?.id === id) setViewingAsset(null)
  }

  async function shareAsset(asset: Asset3D) {
    if (!sessionId) {
      showToast('Nessuna sessione attiva')
      return
    }
    showToast('Condivisione in corso…')
    try {
      await meshyApi.shareToChat({ session_id: sessionId, label: asset.label, thumbnail_url: asset.thumbnailUrl, glb_url: asset.glbUrl })
      showToast('Condiviso nella chat di classe')
    } catch (shareError) {
      showToast(errorMessage(shareError) || 'Condivisione non riuscita')
    }
  }

  async function stopGeneration() {
    if (!window.confirm('Interrompere la generazione? Il modello non verrà completato.')) return
    await cancelJob(jobId)
    resetResult()
    showToast('Generazione interrotta')
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const activeUrls = viewingAsset?.modelUrls || (task?.status === 'SUCCEEDED' ? task.model_urls : undefined)
  const activeGlb = viewingAsset?.glbUrl || activeUrls?.glb
  const isRunning = loading || task?.status === 'PENDING' || task?.status === 'IN_PROGRESS'
  useTicker(isRunning, 1000)
  const elapsedSeconds = jobInfo ? Math.max(0, Math.round((Date.now() - jobInfo.startedAt) / 1000)) : 0
  const elapsedText = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
  const taskError = task?.task_error?.message || task?.error?.message

  return (
    <div className="h-full overflow-y-auto bg-slate-50/40">
      <div className="mx-auto max-w-6xl px-4 py-5 lg:px-6 lg:py-7">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-600">AI generativa 3D</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Crea un modello con Meshy</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Descrivi l’oggetto e, se vuoi, aggiungi un’immagine di riferimento.</p>
          </div>
          <div className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-800">
            Modello effettivo: {actualModel === 'latest' ? 'latest → Meshy 7.1' : actualModel}
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
            <label htmlFor="meshy-prompt" className="text-sm font-black text-slate-900">
              {reference ? 'Descrizione della texture (facoltativa)' : 'Descrivi il modello'}
            </label>
            <textarea
              id="meshy-prompt"
              value={prompt}
              maxLength={800}
              onChange={event => setPrompt(event.target.value)}
              placeholder={reference
                ? 'Es. ceramica blu opaca con dettagli dorati…'
                : 'Es. un piccolo robot educativo, forme morbide, vista completa…'}
              className="mt-2 min-h-32 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-400">
              <span>{reference ? 'Il testo guida la texture; l’immagine guida la geometria.' : 'Il testo viene inviato a Meshy Text-to-3D v2.'}</span>
              <span>{prompt.length}/800</span>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-black text-slate-900">Immagine di riferimento <span className="font-medium text-slate-400">opzionale</span></p>
                {reference && <button type="button" onClick={() => setReference(null)} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-rose-600"><X className="h-3.5 w-3.5" /> Rimuovi</button>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={event => event.target.files?.[0] && handleFile(event.target.files[0])} />
              {reference ? (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left">
                  <img src={reference.preview} alt="Reference" className="h-20 w-20 rounded-lg object-cover" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-slate-900">{reference.name}</span>
                    <span className="mt-1 block text-xs text-emerald-700">Image-to-3D · clicca per sostituire</span>
                  </span>
                </button>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex min-h-24 w-full items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-600 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700">
                  <ImagePlus className="h-5 w-5" /> Carica JPG o PNG
                </button>
              )}
            </div>

            <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50/70">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-black text-slate-700">
                Opzioni avanzate Meshy
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
                <Field label="Modello AI">
                  <select value={options.ai_model} disabled={options.model_type === 'smart-topology'} onChange={event => chooseModel(event.target.value as MeshyAiModel)} className={INPUT_CLASS}>
                    {MODEL_OPTIONS.map(model => <option key={model.value} value={model.value}>{model.label} — {model.note}</option>)}
                  </select>
                </Field>
                <Field label="Tipo di mesh">
                  <select value={options.model_type} onChange={event => chooseModelType(event.target.value as MeshyGenerationOptions['model_type'])} className={INPUT_CLASS}>
                    <option value="standard">Standard, alto dettaglio</option>
                    <option value="smart-topology">Smart Topology · Meshy T2</option>
                  </select>
                </Field>
                <Field label="Risoluzione geometria">
                  <select value={options.geometry_resolution} disabled={!['meshy-7.1', 'latest'].includes(options.ai_model) || options.model_type === 'smart-topology'} onChange={event => setOption('geometry_resolution', event.target.value as MeshyGenerationOptions['geometry_resolution'])} className={INPUT_CLASS}>
                    <option value="standard">Standard</option><option value="2k">2K Ultra (+5 crediti)</option><option value="4k">4K Ultra (+5 crediti)</option>
                  </select>
                </Field>
                <Field label="Posa">
                  <select value={options.pose_mode} onChange={event => setOption('pose_mode', event.target.value as MeshyGenerationOptions['pose_mode'])} className={INPUT_CLASS}>
                    <option value="">Automatica</option><option value="a-pose">A-pose</option><option value="t-pose">T-pose</option>
                  </select>
                </Field>

                {reference && <>
                  <Field label="Texture">
                    <select value={options.should_texture ? options.texture_resolution : 'off'} onChange={event => {
                      const value = event.target.value
                      setOptions(current => ({ ...current, should_texture: value !== 'off', texture_resolution: value === 'off' ? current.texture_resolution : value as MeshyGenerationOptions['texture_resolution'] }))
                    }} className={INPUT_CLASS}>
                      <option value="off">Nessuna texture</option><option value="2k">2K</option><option value="4k" disabled={options.ai_model === 'meshy-6-lite'}>4K</option><option value="8k" disabled={options.ai_model === 'meshy-6-lite'}>8K (+5 crediti)</option>
                    </select>
                  </Field>
                  <Check label="Mappe PBR" checked={options.enable_pbr} disabled={!options.should_texture} onChange={value => setOption('enable_pbr', value)} />
                  <Check label="Ottimizza immagine" checked={options.image_enhancement} onChange={value => setOption('image_enhancement', value)} />
                </>}

                {options.model_type === 'standard' ? <>
                  <Check label="Remesh" checked={options.should_remesh} onChange={value => setOption('should_remesh', value)} />
                  {options.should_remesh && <>
                    <Field label="Topologia"><select value={options.topology} onChange={event => setOption('topology', event.target.value as MeshyGenerationOptions['topology'])} className={INPUT_CLASS}><option value="triangle">Triangoli</option><option value="quad">Quad-dominant</option></select></Field>
                    <Field label="Numero poligoni"><input type="number" min={100} max={300000} value={options.target_polycount} onChange={event => setOption('target_polycount', Number(event.target.value))} className={INPUT_CLASS} /></Field>
                  </>}
                </> : <Field label="Numero facce Smart Topology"><input type="number" min={100} max={15000} value={options.target_polycount} onChange={event => setOption('target_polycount', Number(event.target.value))} className={INPUT_CLASS} /></Field>}
                <Check label="Dimensione reale automatica" checked={options.auto_size} onChange={value => setOption('auto_size', value)} />
                <Check label="Anteprima trasparente" checked={options.alpha_thumbnail} onChange={value => setOption('alpha_thumbnail', value)} />
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Formati di output</p>
                  <div className="flex flex-wrap gap-2">
                    {FORMAT_OPTIONS.map(format => {
                      const active = options.target_formats.includes(format)
                      return <button key={format} type="button" onClick={() => {
                        if (active && options.target_formats.length === 1) return
                        setOption('target_formats', active ? options.target_formats.filter(item => item !== format) : [...options.target_formats, format])
                      }} className={`rounded-lg border px-2.5 py-1.5 text-xs font-black uppercase ${active ? 'border-violet-300 bg-violet-100 text-violet-800' : 'border-slate-200 bg-white text-slate-500'}`}>{format}</button>
                    })}
                  </div>
                </div>
              </div>
            </details>

            {error && <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Costo Meshy stimato: <span className="font-black text-slate-800">{estimatedCredits} crediti</span></p>
              <Button onClick={generate} disabled={isRunning || (!prompt.trim() && !reference)} tone="accent" surface="solid" density="default">
                {isRunning ? <Loader2 className="animate-spin" /> : <Sparkles />}{isRunning ? 'Generazione…' : 'Genera modello 3D'}
              </Button>
            </div>
          </section>

          <section className="min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div><p className="text-sm font-black text-slate-900">Anteprima</p><p className="text-[11px] font-semibold text-slate-400">{selectedModel}</p></div>
              {(task || viewingAsset) && <button type="button" onClick={resetResult} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500"><RotateCcw className="h-3.5 w-3.5" /> Pulisci</button>}
            </div>
            <div className="relative flex min-h-[360px] items-center justify-center bg-gradient-to-br from-slate-50 to-violet-50/40">
              {!activeGlb && !isRunning && !taskError && <div className="max-w-xs px-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm"><Box className="h-7 w-7 text-violet-400" /></div><p className="mt-4 text-sm font-black text-slate-700">Il modello apparirà qui</p><p className="mt-1 text-xs leading-5 text-slate-400">Puoi continuare a usare la piattaforma: la generazione resta visibile anche nella navbar.</p></div>}
              {isRunning && (
                <div className="w-full max-w-sm px-6 text-center">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-violet-600" />
                  <p className="mt-3 text-sm font-black text-slate-800">Meshy sta creando il modello</p>
                  <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-700 transition-all duration-700" style={{ width: `${Math.max(6, task?.progress || 0)}%` }} />
                    {/* Moving sheen: Meshy can hold one percentage for minutes, the bar must not look frozen. */}
                    <div className="absolute inset-y-0 w-1/3 animate-[meshy-sheen_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                  </div>
                  <p className="mt-2 text-xs font-bold tabular-nums text-slate-500">{task?.progress || 0}% · {elapsedText}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">{jobInfo?.label || 'In coda su Meshy…'}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">Puoi cambiare pagina: la generazione continua in background.</p>
                  {(jobId || task) && (
                    <button type="button" onClick={() => void stopGeneration()} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100">
                      <Square className="h-3 w-3" /> Interrompi
                    </button>
                  )}
                  <style>{'@keyframes meshy-sheen { 0% { left: -35%; } 100% { left: 100%; } }'}</style>
                </div>
              )}
              {(task?.status === 'FAILED' || task?.status === 'EXPIRED') && <div className="max-w-sm p-6 text-center text-sm font-semibold text-rose-700"><AlertCircle className="mx-auto mb-2 h-7 w-7" />{taskError || 'Meshy non ha completato la generazione'}</div>}
              {activeGlb && <>
                {/* @ts-expect-error model-viewer is a registered custom element */}
                <model-viewer src={meshyApi.proxyAssetUrl(activeGlb)} camera-controls auto-rotate shadow-intensity="1" exposure="1" style={{ width: '100%', height: '420px', background: 'transparent' }} />
                <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
                  {Object.entries(activeUrls || { glb: activeGlb }).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([format, url]) => <a key={format} href={url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-black uppercase text-slate-700 shadow"><Download className="h-3.5 w-3.5" />{format}</a>)}
                </div>
              </>}
            </div>
          </section>
        </div>

        {assets.length > 0 && <section className="mt-7">
          <div className="mb-3 flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><h2 className="text-base font-black text-slate-900">I tuoi modelli</h2><span className="text-xs font-bold text-slate-400">{assets.length}</span></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {assets.map(asset => <article key={asset.id} onClick={() => setViewingAsset(asset)} className="group cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="aspect-[16/10] bg-slate-100">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Box className="h-7 w-7 text-slate-300" /></div>}</div>
              <div className="p-3"><p className="truncate text-sm font-black text-slate-900">{asset.label}</p><p className="mt-0.5 text-[11px] text-slate-400">{new Date(asset.createdAt).toLocaleDateString('it-IT')}</p><div className="mt-3 flex gap-1.5"><button type="button" onClick={event => { event.stopPropagation(); void shareAsset(asset) }} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-600"><Share2 className="h-3.5 w-3.5" />Chat</button><a href={asset.glbUrl} target="_blank" rel="noreferrer" download onClick={event => event.stopPropagation()} className="inline-flex items-center justify-center rounded-lg bg-violet-100 px-2 text-violet-700"><Download className="h-3.5 w-3.5" /></a><button type="button" onClick={event => { event.stopPropagation(); deleteAsset(asset.id) }} className="inline-flex items-center justify-center rounded-lg bg-rose-50 px-2 text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button></div></div>
            </article>)}
          </div>
        </section>}
      </div>
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-xl">{toast}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>{children}</label>
}

function Check({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 ${disabled ? 'opacity-50' : ''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-violet-600" />{label}</label>
}
