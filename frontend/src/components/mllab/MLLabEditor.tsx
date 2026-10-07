import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, Check, Download, Loader2, Plus, Share2, Square, Trash2, Upload, X } from '@/components/icons'
import * as tf from '@tensorflow/tfjs'
import {
  AUGMENTED_VARIANTS, CONFIDENCE_THRESHOLD, ENGINE, INPUT_SIZE, cosine, crossValidate, embedImage, headToJSON, loadEmbedder, predict, smooth, thin, trainHead,
  type Head, type TrainingSample,
} from '@/lib/imageClassifier'
import {
  ENGINE_BY_MODE, MODE_LABEL, augmentLandmarks, drawOverlay, extractFeatures, loadLandmarkEngine, modeOfEngine, skeletonThumbnail,
  type Mode, type Overlay,
} from '@/lib/mlFeatures'
import { chatApi, mlLabApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import {
  MAX_CLASSES, MAX_SAMPLES_PER_CLASS, deserializeClasses, emptyClass, serializeClasses, summarize, uid,
  type ClassState, type SampleState,
} from './types'

const MIN_SAMPLES = 2
const RECOMMENDED = 10
const DUPLICATE_SIMILARITY = 0.992
const MAX_PENDING_FRAMES = 2 // frames waiting to be processed; beyond this new ones are skipped, so recording never falls behind
const MAX_TRAIN_PER_CLASS = 60 // more recordings than this add no accuracy but make every retrain slower
const MAX_CV_VECTORS = 1500

interface TrainedHead { head: Head; classIds: string[] }
type Landmark = Exclude<Mode, 'image'>

/** Work waiting for the recogniser: a new frame first, augmented variants (image mode only) later, in idle time. */
type Job =
  | { kind: 'new'; classId: string; canvas: HTMLCanvasElement; dedupe: boolean }
  | { kind: 'aug'; classId: string; sampleId: string; canvas: HTMLCanvasElement }

/** Centre-crops any image source to the model's input size on a fresh canvas (image mode: cheap and synchronous). */
function frameCanvas(source: HTMLVideoElement | ImageBitmap | HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  const width = 'videoWidth' in source ? source.videoWidth : source.width
  const height = 'videoHeight' in source ? source.videoHeight : source.height
  const side = Math.min(width, height)
  canvas.getContext('2d')!.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, INPUT_SIZE, INPUT_SIZE)
  return canvas
}

/** Whole frame, downscaled: landmark models need the full field of view (people and hands are not centred). */
function wholeFrame(source: HTMLVideoElement | ImageBitmap | HTMLImageElement, maxSide = 320): HTMLCanvasElement {
  const width = 'videoWidth' in source ? source.videoWidth : source.width
  const height = 'videoHeight' in source ? source.videoHeight : source.height
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function thumbnailOf(canvas: HTMLCanvasElement): string {
  const small = document.createElement('canvas')
  small.width = 72
  small.height = 72
  const side = Math.min(canvas.width, canvas.height)
  small.getContext('2d')!.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, 72, 72)
  return small.toDataURL('image/jpeg', 0.62)
}

function qualityOf(count: number) {
  if (count < MIN_SAMPLES) return { label: `Servono almeno ${MIN_SAMPLES} esempi`, tone: 'bg-rose-100 text-rose-700' }
  if (count < 5) return { label: 'Pochi esempi', tone: 'bg-amber-100 text-amber-700' }
  if (count < RECOMMENDED) return { label: 'Buono, meglio di più', tone: 'bg-sky-100 text-sky-700' }
  return { label: 'Ottimo', tone: 'bg-emerald-100 text-emerald-700' }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// ── one class card (memoised: recording into one class does not re-render the others) ───────────────

interface ClassCardProps {
  cls: ClassState
  isCapturing: boolean
  canRemove: boolean
  recordDisabled: boolean
  uploading: boolean
  hint: string | null
  onToggleCapture: (classId: string) => void
  onRename: (classId: string, value: string) => void
  onRemoveClass: (classId: string) => void
  onClear: (classId: string) => void
  onRemoveSample: (classId: string, sampleId: string) => void
  onUpload: (classId: string, files: FileList) => void
}

const ClassCard = memo(function ClassCard(props: ClassCardProps) {
  const { cls, isCapturing } = props
  const quality = qualityOf(cls.samples.length)
  const input = useRef<HTMLInputElement>(null)
  return (
    <article className="ui-card overflow-hidden p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="ds-squircle h-9 w-9 shrink-0" style={{ background: cls.color }} />
        <input value={cls.name} onChange={(event) => props.onRename(cls.id, event.target.value)} maxLength={40} aria-label="Nome della classe" className="min-w-[8rem] flex-1 bg-transparent text-base font-bold text-slate-900" />
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${quality.tone}`}>{cls.samples.length} · {quality.label}</span>
        {props.canRemove && <button type="button" onClick={() => props.onRemoveClass(cls.id)} aria-label="Elimina classe" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => props.onToggleCapture(cls.id)} disabled={props.recordDisabled && !isCapturing}
          className={`flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white transition disabled:opacity-40 ${isCapturing ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[var(--app-accent,#7c3aed)] hover:opacity-90'}`}>
          {isCapturing ? <><Square className="h-4 w-4" /> Ferma</> : <><Camera className="h-4 w-4" /> Registra con la webcam</>}
        </button>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { if (event.target.files?.length) props.onUpload(cls.id, event.target.files); event.target.value = '' }} />
        <Button tone="neutral" surface="outline" density="compact" onClick={() => input.current?.click()} disabled={props.uploading || cls.samples.length >= MAX_SAMPLES_PER_CLASS}>
          {props.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Carica foto
        </Button>
        {cls.samples.length > 0 && <button type="button" onClick={() => props.onClear(cls.id)} className="text-xs font-semibold text-slate-400 hover:text-red-600">Svuota</button>}
        {isCapturing && props.hint && <span className="text-xs font-semibold text-amber-600">{props.hint}</span>}
      </div>

      {cls.samples.length > 0 && (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
          {cls.samples.slice(-40).map((sample) => (
            <div key={sample.id} className="group relative aspect-square overflow-hidden rounded-lg">
              <img src={sample.thumb} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => props.onRemoveSample(cls.id, sample.id)} aria-label="Rimuovi" className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition group-hover:opacity-100"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      {cls.samples.length > 40 && <p className="mt-1.5 text-[11px] text-slate-400">Mostro le ultime 40 di {cls.samples.length}.</p>}
    </article>
  )
})

export default function MLLabEditor({ projectId, newMode, sessionId, onBack }: { projectId: string | null; newMode?: Mode; sessionId?: string; onBack: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>(newMode ?? 'image')
  const [id, setId] = useState<string | null>(projectId)
  const [name, setName] = useState('Nuovo progetto')
  const [classes, setClasses] = useState<ClassState[]>(() => [emptyClass(0, 'Classe 1'), emptyClass(1, 'Classe 2')])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [engineReady, setEngineReady] = useState(false)
  const [engineError, setEngineError] = useState(false)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [pending, setPending] = useState(0) // all jobs waiting (frames + augmentations)
  const [pendingNew, setPendingNew] = useState(0) // only frames waiting for their plain features
  const [migration, setMigration] = useState<{ done: number; total: number } | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [busyUpload, setBusyUpload] = useState<string | null>(null)
  const [trained, setTrained] = useState<TrainedHead | null>(null)
  const [trainVersion, setTrainVersion] = useState(0)
  const [training, setTraining] = useState(false)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const [live, setLive] = useState<number[] | null>(null)
  const [detected, setDetected] = useState(true)
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting')
  const [testResult, setTestResult] = useState<{ thumb: string; probs: number[]; classIds: string[] } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const classesRef = useRef(classes)
  classesRef.current = classes
  const modeRef = useRef(mode)
  modeRef.current = mode
  const trainedRef = useRef<TrainedHead | null>(null)
  trainedRef.current = trained
  const smoothRef = useRef<number[] | null>(null)
  const idRef = useRef(id)
  idRef.current = id
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureSession = useRef(0) // bumped on every start/stop: a loop belonging to an older session can never add or reschedule anything
  const capturingRef = useRef<string | null>(null)
  capturingRef.current = capturing
  const queue = useRef<Job[]>([])
  const workerRunning = useRef(false)
  const needsMigration = useRef(false)
  const lastVector = useRef<Record<string, Float32Array>>({})
  const trainRun = useRef(0)
  const loadedRef = useRef(!projectId)
  const testInput = useRef<HTMLInputElement>(null)
  const inferMs = useRef(60) // smoothed duration of one recognition: drives how often we sample and classify
  const augBuffer = useRef<Map<string, { classId: string; vectors: Float32Array[] }>>(new Map())
  const augTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLandmark = mode !== 'image'

  const timed = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    const started = performance.now()
    const value = await work()
    inferMs.current = inferMs.current * 0.8 + (performance.now() - started) * 0.2
    return value
  }, [])

  // ── load an existing project ──
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    mlLabApi.get(projectId).then(({ data }) => {
      if (cancelled) return
      const projectMode: Mode = (data.data as any)?.mode ?? modeOfEngine(data.engine)
      const restored = deserializeClasses(data.data)
      setMode(projectMode)
      setName(data.name)
      setClasses(restored.length >= 2 ? restored : [...restored, ...[0, 1].slice(restored.length).map((i) => emptyClass(i, `Classe ${i + 1}`))])
      setAccuracy(data.accuracy)
      needsMigration.current = projectMode === 'image' && (data.data as any)?.engine !== ENGINE && restored.some((c) => c.samples.length > 0)
      loadedRef.current = true
      setLoading(false)
    }).catch(() => { toast({ variant: 'destructive', title: 'Progetto non trovato' }); onBack() })
    return () => { cancelled = true }
  }, [projectId, onBack, toast])

  // ── recognition engine for this mode (loaded once, on demand) ──
  useEffect(() => {
    if (loading) return
    setEngineReady(false)
    setEngineError(false)
    const load = mode === 'image' ? loadEmbedder() : loadLandmarkEngine(mode)
    load.then(() => setEngineReady(true)).catch((error) => { console.error('Engine load failed', error); setEngineError(true) })
  }, [mode, loading])

  // ── webcam ──
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    navigator.mediaDevices?.getUserMedia({ video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' } })
      .then((media) => {
        if (stopped) { media.getTracks().forEach((track) => track.stop()); return }
        stream = media
        if (videoRef.current) { videoRef.current.srcObject = media; void videoRef.current.play().catch(() => undefined) }
        setCamera('on')
      })
      .catch(() => setCamera('off'))
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
      if (captureTimer.current) clearTimeout(captureTimer.current)
      if (augTimer.current) clearTimeout(augTimer.current)
    }
  }, [])

  // ── projects saved with an older image engine: re-embed their thumbnails once ──
  useEffect(() => {
    if (!engineReady || loading || !needsMigration.current || mode !== 'image') return
    needsMigration.current = false
    let cancelled = false
    ;(async () => {
      const targets = classesRef.current.flatMap((c) => c.samples.map((sample) => ({ classId: c.id, sample })))
      setMigration({ done: 0, total: targets.length })
      for (let index = 0; index < targets.length; index++) {
        if (cancelled) return
        const { classId, sample } = targets[index]
        try {
          const image = new Image()
          image.src = sample.thumb
          await image.decode()
          const [vector] = await embedImage(frameCanvas(image))
          setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, samples: c.samples.map((x) => (x.id === sample.id ? { ...x, vectors: [vector] } : x)) } : c)))
        } catch { /* a broken thumbnail just keeps its old vector */ }
        setMigration({ done: index + 1, total: targets.length })
        await tf.nextFrame()
      }
      setMigration(null)
    })()
    return () => { cancelled = true }
  }, [engineReady, loading, mode])

  // ── training: instant, automatic, re-runs whenever classes or samples change ──
  const countSignature = useMemo(() => classes.map((c) => `${c.id}:${c.samples.length}`).join('|'), [classes])
  const idle = !capturing && pendingNew === 0 && !migration // train on the plain features as soon as recording ends…
  const augmentationsDone = pending === 0 // …and once more when the augmented variants are in
  useEffect(() => {
    if (!engineReady || loading || !idle) return
    const ready = classesRef.current.filter((c) => c.samples.length >= MIN_SAMPLES)
    if (ready.length < 2) { setTrained(null); setAccuracy(null); setLive(null); return }
    const run = ++trainRun.current
    const timer = setTimeout(async () => {
      setTraining(true)
      try {
        let group = 0
        const samples: TrainingSample[] = []
        ready.forEach((cls, classIndex) => thin(cls.samples, MAX_TRAIN_PER_CLASS).forEach((sample) => {
          group += 1
          const variants = isLandmark ? augmentLandmarks(sample.vectors[0], mode as Landmark) : sample.vectors.slice(1)
          ;[sample.vectors[0], ...variants].forEach((vector) => samples.push({ classIndex, group, vector }))
        }))
        const kind = isLandmark ? 'zscore' : 'cosine'
        const head = await trainHead(samples, ready.length, samples.length > 1200 ? 40 : isLandmark ? 60 : 90, kind)
        if (run !== trainRun.current) return
        setTrained({ head, classIds: ready.map((c) => c.id) })
        setTrainVersion((v) => v + 1)
        smoothRef.current = null
        // Cross-validation is the expensive part: skipped for big sets (the estimate would barely change anyway).
        const score = samples.length <= MAX_CV_VECTORS ? await crossValidate(samples, ready.length, kind) : null
        if (run === trainRun.current) setAccuracy((previous) => (score === null && samples.length > MAX_CV_VECTORS ? previous : score))
      } catch (error) {
        console.error('Training failed', error)
      } finally {
        if (run === trainRun.current) setTraining(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [countSignature, engineReady, loading, idle, augmentationsDone, isLandmark, mode])

  // ── live recognition: adaptive rate, only when nothing else competes for the processor ──
  useEffect(() => {
    if (!trained || camera !== 'on' || !engineReady) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const video = videoRef.current
      const head = trainedRef.current
      const busy = capturingRef.current || queue.current.some((item) => item.kind === 'new')
      if (!stopped && video && head && !busy && video.readyState >= 2 && video.videoWidth) {
        try {
          if (modeRef.current === 'image') {
            const [vector] = await timed(() => embedImage(frameCanvas(video)))
            const probs = smooth(smoothRef.current, predict(head.head, vector))
            smoothRef.current = probs
            setLive(probs)
            setDetected(true)
          } else {
            const found = await timed(() => extractFeatures(modeRef.current as Landmark, video))
            if (overlayRef.current) drawOverlay(overlayRef.current, found?.overlay ?? null)
            setDetected(Boolean(found))
            if (found) { const probs = smooth(smoothRef.current, predict(head.head, found.vector)); smoothRef.current = probs; setLive(probs) }
            else { smoothRef.current = null; setLive(null) }
          }
        } catch (error) { console.error('Live recognition failed', error) }
      }
      if (!stopped) timer = setTimeout(tick, clamp(inferMs.current * 2.2, 150, 900))
    }
    timer = setTimeout(tick, 200)
    return () => { stopped = true; clearTimeout(timer) }
  }, [trained, camera, engineReady, timed])

  // ── autosave (not while recording or processing) ──
  const model = useMemo(() => (trained ? {
    version: 1, mode, threshold: CONFIDENCE_THRESHOLD,
    classes: classes.filter((c) => trained.classIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name, color: c.color })),
    head: headToJSON(trained.head, trained.classIds),
  } : undefined), [trained, mode, classes])
  const modelRef = useRef(model)
  modelRef.current = model
  const saveSignature = `${name}|${countSignature}|${accuracy}|${classes.map((c) => c.name).join('|')}|${trainVersion}|${augmentationsDone}`
  const firstSave = useRef(true)
  useEffect(() => {
    if (!loadedRef.current) return
    if (firstSave.current) { firstSave.current = false; return }
    const total = classesRef.current.reduce((sum, c) => sum + c.samples.length, 0)
    if (total === 0 && !idRef.current) return
    setSaveState('dirty')
    if (capturing || pending > 0) return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      const payload = {
        name: name.trim() || 'Progetto senza nome', engine: ENGINE_BY_MODE[modeRef.current], accuracy, summary: summarize(classesRef.current),
        data: serializeClasses(classesRef.current, modeRef.current, modelRef.current) as Record<string, unknown>, session_id: sessionId ?? null,
      }
      try {
        if (idRef.current) await mlLabApi.update(idRef.current, payload)
        else { const created = (await mlLabApi.create(payload)).data; setId(created.id); idRef.current = created.id }
        setSaveState('saved')
        void qc.invalidateQueries({ queryKey: ['ml-lab', 'projects'] })
      } catch (error: any) {
        setSaveState('error')
        toast({ variant: 'destructive', title: 'Salvataggio non riuscito', description: error?.response?.data?.detail || 'Riprovo alla prossima modifica.' })
      }
    }, 3000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSignature, capturing, pending])

  // ── samples ──
  const addSample = useCallback((classId: string, sample: SampleState) => {
    setClasses((prev) => prev.map((c) => (c.id === classId && c.samples.length < MAX_SAMPLES_PER_CLASS ? { ...c, samples: [...c.samples, sample] } : c)))
  }, [])

  /** Augmented embeddings arrive one by one: apply them to the state in batches, not one render per photo. */
  const flushAugmentations = useCallback(() => {
    augTimer.current = null
    const batch = augBuffer.current
    if (batch.size === 0) return
    augBuffer.current = new Map()
    setClasses((prev) => prev.map((c) => {
      let touched = false
      const samples = c.samples.map((x) => {
        const extra = batch.get(x.id)
        if (!extra) return x
        touched = true
        return { ...x, vectors: [x.vectors[0], ...extra.vectors] }
      })
      return touched ? { ...c, samples } : c
    }))
  }, [])

  /** Single consumer of the queue: one recognition at a time, yielding to the browser between jobs. */
  const pump = useCallback(async () => {
    if (workerRunning.current) return
    workerRunning.current = true
    try {
      while (queue.current.length > 0) {
        const index = Math.max(0, queue.current.findIndex((job) => job.kind === 'new')) // new frames first, augmentations when idle
        const [job] = queue.current.splice(index, 1)
        setPending(queue.current.length + 1)
        setPendingNew(queue.current.filter((item) => item.kind === 'new').length + (job.kind === 'new' ? 1 : 0))
        try {
          const currentMode = modeRef.current
          if (job.kind === 'new') {
            const target = classesRef.current.find((c) => c.id === job.classId)
            if (!target || target.samples.length >= MAX_SAMPLES_PER_CLASS) continue
            let vector: Float32Array
            let thumb: string
            if (currentMode === 'image') {
              ;[vector] = await timed(() => embedImage(job.canvas))
              thumb = thumbnailOf(job.canvas)
            } else {
              const found = await timed(() => extractFeatures(currentMode as Landmark, job.canvas, !job.dedupe))
              if (!found) { setHint(currentMode === 'pose' ? 'Non vedo le spalle: mettiti più indietro' : 'Non vedo la mano: mostrala alla webcam'); continue }
              vector = found.vector
              thumb = skeletonThumbnail(job.canvas, found.overlay as Overlay)
            }
            const previous = lastVector.current[job.classId]
            if (job.dedupe && previous && currentMode === 'image' && cosine(previous, vector) > DUPLICATE_SIMILARITY) { setHint('Muovi o ruota l’oggetto: i fotogrammi uguali non servono'); continue }
            if (job.dedupe && previous && currentMode !== 'image' && previous.every((value, i) => Math.abs(value - vector[i]) < 0.03)) { setHint('Cambia leggermente posizione: i fotogrammi uguali non servono'); continue }
            setHint(null)
            lastVector.current[job.classId] = vector
            const sample: SampleState = { id: uid(), thumb, vectors: [vector] }
            addSample(job.classId, sample)
            if (currentMode === 'image') queue.current.push({ kind: 'aug', classId: job.classId, sampleId: sample.id, canvas: job.canvas })
          } else {
            const variants = await embedImage(job.canvas, AUGMENTED_VARIANTS)
            augBuffer.current.set(job.sampleId, { classId: job.classId, vectors: variants })
            if (!augTimer.current) augTimer.current = setTimeout(flushAugmentations, 600)
          }
        } catch (error) { console.error('Recognition job failed', error) }
        await tf.nextFrame() // let the page paint and handle clicks (this is what keeps «Ferma» responsive)
      }
    } finally {
      workerRunning.current = false
      if (augTimer.current) { clearTimeout(augTimer.current); flushAugmentations() }
      setPending(0)
      setPendingNew(0)
    }
  }, [addSample, flushAugmentations, timed])

  const stopCapture = useCallback(() => {
    captureSession.current += 1 // invalidates any loop still in flight
    if (captureTimer.current) { clearTimeout(captureTimer.current); captureTimer.current = null }
    setCapturing(null)
    setHint(null)
  }, [])

  const startCapture = useCallback((classId: string) => {
    stopCapture() // switching class: the previous recording ends first, for good
    const session = captureSession.current
    setCapturing(classId)
    delete lastVector.current[classId]
    const grab = () => {
      if (session !== captureSession.current) return
      const video = videoRef.current
      const cls = classesRef.current.find((c) => c.id === classId)
      const queued = queue.current.filter((job) => job.kind === 'new' && job.classId === classId).length
      if (!cls || cls.samples.length + queued >= MAX_SAMPLES_PER_CLASS) { stopCapture(); return }
      // The grab itself is synchronous and cheap; when the recogniser is busy the frame is simply skipped.
      if (video && video.readyState >= 2 && video.videoWidth && queue.current.filter((job) => job.kind === 'new').length < MAX_PENDING_FRAMES) {
        queue.current.push({ kind: 'new', classId, canvas: modeRef.current === 'image' ? frameCanvas(video) : wholeFrame(video), dedupe: true })
        void pump()
      }
      captureTimer.current = setTimeout(grab, clamp(inferMs.current * 1.8, 180, 800)) // slower machines sample less often instead of lagging
    }
    captureTimer.current = setTimeout(grab, 80)
  }, [pump, stopCapture])

  const toggleCapture = useCallback((classId: string) => {
    if (capturingRef.current === classId) stopCapture()
    else startCapture(classId)
  }, [startCapture, stopCapture])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') stopCapture() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stopCapture])

  const uploadImages = useCallback(async (classId: string, files: FileList) => {
    const current = classesRef.current.find((c) => c.id === classId)
    if (!current) return
    const room = MAX_SAMPLES_PER_CLASS - current.samples.length
    setBusyUpload(classId)
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        const bitmap = await createImageBitmap(file)
        queue.current.push({ kind: 'new', classId, canvas: modeRef.current === 'image' ? frameCanvas(bitmap) : wholeFrame(bitmap), dedupe: false })
        bitmap.close()
      }
      void pump()
    } catch { toast({ variant: 'destructive', title: 'Immagine non leggibile', description: 'Usa file JPG, PNG o WebP.' }) } finally { setBusyUpload(null) }
  }, [pump, toast])

  const testPhoto = async (file: File) => {
    const head = trainedRef.current
    if (!head) { toast({ title: 'Prima aggiungi almeno due classi con qualche esempio' }); return }
    const bitmap = await createImageBitmap(file)
    try {
      if (mode === 'image') {
        const canvas = frameCanvas(bitmap)
        const [vector] = await embedImage(canvas)
        setTestResult({ thumb: thumbnailOf(canvas), probs: predict(head.head, vector), classIds: head.classIds })
      } else {
        const canvas = wholeFrame(bitmap)
        const found = await extractFeatures(mode as Landmark, canvas, true)
        if (!found) { toast({ title: mode === 'pose' ? 'Non trovo una persona nella foto' : 'Non trovo una mano nella foto' }); return }
        setTestResult({ thumb: skeletonThumbnail(canvas, found.overlay), probs: predict(head.head, found.vector), classIds: head.classIds })
      }
    } finally { bitmap.close() }
  }

  const addClass = () => { if (classes.length < MAX_CLASSES) setClasses((prev) => [...prev, emptyClass(prev.length, `Classe ${prev.length + 1}`)]) }
  const removeClass = useCallback((classId: string) => setClasses((prev) => (prev.length > 2 ? prev.filter((c) => c.id !== classId) : prev)), [])
  const renameClass = useCallback((classId: string, value: string) => setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, name: value } : c))), [])
  const clearClass = useCallback((classId: string) => setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, samples: [] } : c))), [])
  const removeSample = useCallback((classId: string, sampleId: string) => setClasses((prev) => prev.map((c) => (c.id === classId ? { ...c, samples: c.samples.filter((s) => s.id !== sampleId) } : c))), [])

  const exportData = () => ({ app: 'goliai-mllab', name, engine: ENGINE_BY_MODE[mode], accuracy, summary: summarize(classes), data: serializeClasses(classes, mode, model) })
  const exportProject = () => {
    const blob = new Blob([JSON.stringify(exportData())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `${name.replace(/[^\w-]+/g, '-')}.mlproject.json`; link.click()
    URL.revokeObjectURL(url)
  }
  const shareToChat = async () => {
    if (!sessionId) return
    try {
      const file = new File([JSON.stringify(exportData())], `${name.replace(/[^\w-]+/g, '-')}.mlproject.json`, { type: 'application/json' })
      const upload = await chatApi.uploadFiles(sessionId, [file])
      await chatApi.sendSessionMessage(sessionId, `🤖 Progetto Lab ML condiviso: *${name}* (${classes.map((c) => c.name).join(' / ')})\nScaricalo e importalo nel Lab ML per continuare ad addestrarlo.`, [{ url: upload.data.urls?.[0], name: file.name, type: 'application/json' }])
      toast({ title: 'Progetto condiviso nella chat di classe' })
    } catch { toast({ variant: 'destructive', title: 'Condivisione non riuscita' }) }
  }

  // ── derived view ──
  const liveEntries = useMemo(() => {
    if (!trained || !live) return null
    const byId = new Map(trained.classIds.map((classId, index) => [classId, live[index] ?? 0]))
    const entries = classes.map((c) => ({ cls: c, prob: byId.get(c.id) ?? 0, trained: byId.has(c.id) }))
    const top = entries.reduce((best, entry) => (entry.prob > best.prob ? entry : best), entries[0])
    return { entries, top, sure: top.prob >= CONFIDENCE_THRESHOLD }
  }, [trained, live, classes])
  const readyClasses = classes.filter((c) => c.samples.length >= MIN_SAMPLES).length
  const totalSamples = classes.reduce((sum, c) => sum + c.samples.length, 0)
  const smallest = classes.reduce((min, c) => Math.min(min, c.samples.length), Infinity)
  const recordDisabled = !engineReady || camera !== 'on'
  const noun = mode === 'pose' ? 'persona' : mode === 'hand' ? 'mano' : 'oggetto'
  const tip = mode === 'pose' ? 'Mettiti a una distanza in cui si vedano spalle e braccia. Cambia posizione tra uno scatto e l’altro.'
    : mode === 'hand' ? 'Mostra una mano alla volta e cambia leggermente posizione e distanza.'
    : 'Usa angolazioni, sfondi e luci diversi.'

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* top bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => { stopCapture(); onBack() }} className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-white/10"><ArrowLeft className="h-4 w-4" /> Progetti</button>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} aria-label="Nome del progetto" className="h-10 min-w-[12rem] flex-1 rounded-xl bg-transparent px-2 text-xl font-bold text-slate-900 sm:max-w-md" />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-white/10">{MODE_LABEL[mode]}</span>
        <span className="flex items-center gap-1.5 text-xs text-slate-400" role="status">
          {saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvataggio…</>}
          {saveState === 'saved' && <><Check className="h-3.5 w-3.5 text-emerald-500" /> Salvato nella libreria</>}
          {saveState === 'dirty' && 'Modifiche non ancora salvate'}
          {saveState === 'error' && <span className="text-rose-500">Salvataggio non riuscito</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {sessionId && <Button tone="neutral" surface="outline" density="compact" onClick={() => void shareToChat()} disabled={totalSamples === 0}><Share2 className="h-3.5 w-3.5" /> Condividi in chat</Button>}
          <Button tone="neutral" surface="outline" density="compact" onClick={exportProject} disabled={totalSamples === 0}><Download className="h-3.5 w-3.5" /> Esporta</Button>
        </div>
      </div>

      {migration && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-sky-50 p-4 text-sm text-sky-800" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Aggiorno il progetto al nuovo motore di riconoscimento ({migration.done}/{migration.total})…
        </p>
      )}
      {engineError && <p className="mb-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">Non riesco a caricare il motore di riconoscimento. Ricarica la pagina e riprova.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* classes */}
        <section className="space-y-4">
          {classes.map((cls) => (
            <ClassCard
              key={cls.id} cls={cls} isCapturing={capturing === cls.id} canRemove={classes.length > 2} recordDisabled={recordDisabled}
              uploading={busyUpload === cls.id} hint={hint} onToggleCapture={toggleCapture} onRename={renameClass} onRemoveClass={removeClass}
              onClear={clearClass} onRemoveSample={removeSample} onUpload={uploadImages}
            />
          ))}
          <button type="button" onClick={addClass} disabled={classes.length >= MAX_CLASSES} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-bold text-slate-500 transition hover:border-[var(--app-accent,#7c3aed)] hover:text-[var(--app-accent,#7c3aed)] disabled:opacity-40 dark:border-white/20">
            <Plus className="h-4 w-4" /> Aggiungi classe {classes.length >= MAX_CLASSES ? `(massimo ${MAX_CLASSES})` : ''}
          </button>
        </section>

        {/* live test */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="ui-card overflow-hidden p-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-900">
              <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
              {isLandmark && <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-cover" />}
              {camera !== 'on' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white/80"><Camera className="h-8 w-8" />{camera === 'starting' ? 'Avvio della webcam…' : 'Webcam non disponibile: puoi comunque caricare foto'}</div>}
              {capturing && <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />Registrazione…</span>}
              {isLandmark && trained && !detected && !capturing && camera === 'on' && <span className="absolute bottom-3 left-3 right-3 rounded-2xl bg-slate-800/80 px-4 py-2 text-center text-sm font-bold text-white backdrop-blur">Nessuna {noun} rilevata</span>}
              {liveEntries && camera === 'on' && !capturing && detected && (
                <span className={`absolute bottom-3 left-3 right-3 rounded-2xl px-4 py-2 text-center text-sm font-black text-white backdrop-blur ${liveEntries.sure ? '' : 'bg-slate-800/80'}`} style={liveEntries.sure ? { background: liveEntries.top.cls.color } : undefined}>
                  {liveEntries.sure ? `${liveEntries.top.cls.name} · ${Math.round(liveEntries.top.prob * 100)}%` : 'Non sono sicuro'}
                </span>
              )}
            </div>
          </div>

          <div className="ui-card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-700">Cosa vede ora</h2>
              {pending > 0 && !capturing ? <span className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Elaboro gli esempi…</span>
                : training && <span className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aggiorno il modello…</span>}
            </div>
            {!engineReady && !engineError && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Preparo il motore di riconoscimento (solo la prima volta)…</p>}
            {engineReady && readyClasses < 2 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-white/5">Aggiungi almeno {MIN_SAMPLES} esempi in due classi: il modello si addestra da solo e potrai provarlo qui. {isLandmark ? tip : ''}</p>}
            {liveEntries && (
              <ul className="space-y-2">
                {liveEntries.entries.map(({ cls, prob, trained: isTrained }) => (
                  <li key={cls.id}>
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600"><span className="truncate">{cls.name}</span><span className="tabular-nums">{isTrained ? `${Math.round(prob * 100)}%` : 'servono esempi'}</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${isTrained ? prob * 100 : 0}%`, background: cls.color }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ui-card space-y-2 p-4 text-sm">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-700">Qualità del modello</h2>
            {accuracy !== null
              ? <p className="text-slate-600"><b className={accuracy >= 0.85 ? 'text-emerald-600' : accuracy >= 0.65 ? 'text-amber-600' : 'text-rose-600'}>~{Math.round(accuracy * 100)}%</b> di risposte giuste stimate su esempi non usati per addestrare.</p>
              : <p className="text-slate-500">La stima compare quando ogni classe ha almeno 3 esempi.</p>}
            {totalSamples > 0 && smallest < RECOMMENDED && <p className="text-xs text-slate-500">Consiglio: porta ogni classe ad almeno {RECOMMENDED} esempi. {tip} Sbilanciare le classi peggiora i risultati.</p>}
            <div>
              <input ref={testInput} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void testPhoto(file); event.target.value = '' }} />
              <Button tone="neutral" surface="outline" density="compact" onClick={() => testInput.current?.click()} disabled={!trained}><Upload className="h-3.5 w-3.5" /> Prova con una foto</Button>
            </div>
            {testResult && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 dark:bg-white/5">
                <img src={testResult.thumb} alt="" className="h-14 w-14 rounded-lg object-cover" />
                <div className="min-w-0 text-xs">
                  {(() => {
                    const best = testResult.probs.indexOf(Math.max(...testResult.probs))
                    const cls = classes.find((c) => c.id === testResult.classIds[best])
                    const sure = testResult.probs[best] >= CONFIDENCE_THRESHOLD
                    return <p className="font-bold text-slate-800">{sure ? `${cls?.name ?? '?'} · ${Math.round(testResult.probs[best] * 100)}%` : `Non sono sicuro (forse ${cls?.name ?? '?'}, ${Math.round(testResult.probs[best] * 100)}%)`}</p>
                  })()}
                  <button type="button" onClick={() => setTestResult(null)} className="mt-1 text-slate-400 hover:text-slate-600">Chiudi</button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
