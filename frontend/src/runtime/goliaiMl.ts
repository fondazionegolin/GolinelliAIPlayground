/**
 * Vibe Lab runtime for ML Lab models (built as a standalone script, /lib/goliai-ml.js).
 *
 * Generated apps and p5.js sketches call it through window.GolinelliML (a tiny stub the platform injects, which loads this
 * script on first use):
 *
 *   const model = await GolinelliML.load('Gesti della mano')       // name or id of a model attached to the project
 *   const r = await model.classify(videoElement)                    // one shot
 *   const stop = model.start(videoElement, { onResult: (r) => … })  // continuous
 *   model.on('Pugno', () => …, { minConfidence: 0.75, holdMs: 250 })// event when a class becomes active
 *
 * Everything runs in the visitor's browser (tfjs / MediaPipe): the camera never leaves the device.
 */
import { CONFIDENCE_THRESHOLD, INPUT_SIZE, embedImage, headFromJSON, loadEmbedder, predict, smooth, type Head, type HeadJSON } from '../lib/imageClassifier'
import { setAssetBase } from '../lib/mlAssets'
import { extractFeatures, loadLandmarkEngine, type Mode } from '../lib/mlFeatures'

interface RuntimeModel {
  id: string
  name: string
  mode: Mode
  threshold?: number
  classes: Array<{ id: string; name: string; color?: string }>
  head: HeadJSON
}

export interface MlResult {
  /** The recognised class, or null when the model is not sure enough (or nothing was detected). */
  label: string | null
  /** The most likely class regardless of confidence (null when nothing was detected). */
  best: string | null
  confidence: number
  sure: boolean
  detected: boolean
  /** Probability of every class, by name (0..1). */
  probs: Record<string, number>
  ranking: Array<{ label: string; confidence: number }>
  mode: Mode
  /** pose models: 17 keypoints in source pixels */
  pose?: Array<{ x: number; y: number; score?: number }>
  /** hand models: 21 landmarks in source pixels */
  hand?: Array<{ x: number; y: number }>
  /** size in pixels of the analysed frame: scale landmarks with p.x / r.width * canvasWidth */
  width?: number
  height?: number
}

interface StartOptions {
  onResult?: (result: MlResult) => void
  minConfidence?: number
  /** Smoothing of consecutive results, 0 (none) … 1. Default 0.55. */
  smoothing?: number
  /** Upper bound on the classification rate. Default: as fast as the device allows. */
  maxFps?: number
}
interface OnOptions { minConfidence?: number; holdMs?: number; once?: boolean }

const unwrap = (source: any): HTMLVideoElement | HTMLCanvasElement | HTMLImageElement => source?.elt ?? source?.canvas ?? source // p5 elements / graphics
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function squareFrame(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLCanvasElement).width
  const height = source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLCanvasElement).height
  const side = Math.min(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  canvas.getContext('2d')!.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, INPUT_SIZE, INPUT_SIZE)
  return canvas
}

class MlModel {
  readonly id: string
  readonly name: string
  readonly mode: Mode
  readonly labels: string[]
  private readonly head: Head
  private readonly classIds: string[]
  private readonly names: Map<string, string>
  private readonly threshold: number
  private ready: Promise<unknown> | null = null
  private listeners: Array<{ label: string; callback: (result: MlResult) => void; options: OnOptions; since: number | null; fired: boolean; lostSince: number | null }> = []
  private changeListeners: Array<(label: string | null, result: MlResult) => void> = []
  private stableLabel: string | null = null

  constructor(definition: RuntimeModel) {
    this.id = definition.id
    this.name = definition.name
    this.mode = definition.mode
    this.head = headFromJSON(definition.head)
    this.classIds = definition.head.classIds
    this.names = new Map(definition.classes.map((c) => [c.id, c.name]))
    this.labels = this.classIds.map((id) => this.names.get(id) ?? id)
    this.threshold = definition.threshold ?? CONFIDENCE_THRESHOLD
  }

  /** Loads the recognition engine (first call only). Called automatically by load(). */
  warmUp() {
    if (!this.ready) this.ready = this.mode === 'image' ? loadEmbedder() : loadLandmarkEngine(this.mode)
    return this.ready
  }

  private build(probs: number[] | null, extras: Partial<MlResult> = {}, minConfidence = this.threshold): MlResult {
    if (!probs) return { label: null, best: null, confidence: 0, sure: false, detected: false, probs: {}, ranking: [], mode: this.mode, ...extras }
    const ranking = probs.map((confidence, index) => ({ label: this.labels[index], confidence })).sort((a, b) => b.confidence - a.confidence)
    const top = ranking[0]
    const sure = top.confidence >= minConfidence
    return {
      label: sure ? top.label : null, best: top.label, confidence: top.confidence, sure, detected: true,
      probs: Object.fromEntries(this.labels.map((label, index) => [label, probs[index]])), ranking, mode: this.mode, ...extras,
    }
  }

  private async probabilities(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<{ probs: number[] | null; extras: Partial<MlResult> }> {
    await this.warmUp()
    if (this.mode === 'image') {
      const [vector] = await embedImage(squareFrame(source))
      return { probs: predict(this.head, vector), extras: {} }
    }
    const found = await extractFeatures(this.mode, source)
    if (!found) return { probs: null, extras: {} }
    const key = this.mode === 'pose' ? 'pose' : 'hand'
    return { probs: predict(this.head, found.vector), extras: { [key]: found.overlay.points, width: found.overlay.width, height: found.overlay.height } as Partial<MlResult> }
  }

  /** One recognition of a video, canvas, image or p5 element. */
  async classify(source: any, options: { minConfidence?: number } = {}): Promise<MlResult> {
    const { probs, extras } = await this.probabilities(unwrap(source))
    return this.build(probs, extras, options.minConfidence)
  }

  /** Continuous recognition. Returns a function that stops it. */
  start(source: any, options: StartOptions = {}): () => void {
    const element = unwrap(source)
    const alpha = 1 - clamp(options.smoothing ?? 0.55, 0, 0.95)
    let stopped = false
    let previous: number[] | null = null
    let durations = 60
    const minGap = options.maxFps ? 1000 / options.maxFps : 0
    const loop = async () => {
      if (stopped) return
      const started = performance.now()
      try {
        const ready = element instanceof HTMLVideoElement ? element.readyState >= 2 && element.videoWidth > 0 : true
        if (ready) {
          const { probs, extras } = await this.probabilities(element)
          previous = probs ? smooth(previous, probs, alpha) : null
          const result = this.build(previous, extras, options.minConfidence)
          this.dispatch(result)
          options.onResult?.(result)
        }
      } catch (error) {
        console.error('[GolinelliML]', error)
      }
      durations = durations * 0.8 + (performance.now() - started) * 0.2
      if (!stopped) setTimeout(loop, Math.max(minGap - (performance.now() - started), clamp(durations * 0.6, 10, 400)))
    }
    void loop()
    return () => { stopped = true }
  }

  /** Calls back when the class stays active for ``holdMs`` (default 200 ms); re-arms once the class goes away. */
  on(label: string, callback: (result: MlResult) => void, options: OnOptions = {}): () => void {
    const entry = { label, callback, options, since: null as number | null, fired: false, lostSince: null as number | null }
    this.listeners.push(entry)
    return () => { this.listeners = this.listeners.filter((item) => item !== entry) }
  }

  /** Calls back whenever the recognised class changes (label or null). */
  onChange(callback: (label: string | null, result: MlResult) => void): () => void {
    this.changeListeners.push(callback)
    return () => { this.changeListeners = this.changeListeners.filter((item) => item !== callback) }
  }

  private dispatch(result: MlResult) {
    const now = performance.now()
    for (const entry of this.listeners) {
      const confident = result.detected && result.best === entry.label && result.confidence >= (entry.options.minConfidence ?? this.threshold)
      if (confident) {
        entry.lostSince = null
        entry.since ??= now
        if (!entry.fired && now - entry.since >= (entry.options.holdMs ?? 200)) {
          entry.fired = true
          entry.callback(result)
          if (entry.options.once) this.listeners = this.listeners.filter((item) => item !== entry)
        }
      } else {
        entry.lostSince ??= now
        if (now - entry.lostSince > 150) { entry.since = null; entry.fired = false } // re-arm only after a real change
      }
    }
    const label = result.label
    if (label !== this.stableLabel) {
      this.stableLabel = label
      this.changeListeners.forEach((callback) => callback(label, result))
    }
  }
}

function models(): RuntimeModel[] {
  return ((window as any).__GOLIAI_ML_MODELS__ as RuntimeModel[] | undefined) ?? []
}

async function load(key?: string): Promise<MlModel> {
  const all = models()
  if (all.length === 0) throw new Error('Nessun modello ML collegato a questo progetto.')
  const wanted = (key ?? '').trim().toLowerCase()
  const found = wanted ? all.find((m) => m.id.toLowerCase() === wanted || m.name.toLowerCase() === wanted) : all.length === 1 ? all[0] : undefined
  if (!found) throw new Error(`Modello «${key}» non trovato. Disponibili: ${all.map((m) => m.name).join(', ')}`)
  const model = new MlModel(found)
  await model.warmUp()
  return model
}

const runtime = {
  setAssetBase,
  load,
  models: () => models().map((m) => ({ id: m.id, name: m.name, mode: m.mode, labels: m.classes.map((c) => c.name) })),
}

;(window as any).GolinelliMLRuntime = runtime
