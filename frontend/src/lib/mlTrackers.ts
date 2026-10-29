/**
 * Generic, ready-made vision trackers for Vibe Lab apps (window.GolinelliAI.ml): faces + facial features, hands and body
 * pose, running locally in the visitor's browser with the platform's self-hosted MediaPipe wasm + models.
 * Landmarks are normalized 0..1 (x → right, y → down) relative to the analysed frame.
 */
import { assetUrl } from './mlAssets'
import { detectFacesFallback, fallbackFeatures, loadFaceFallback } from './mlFaceFallback'
import { tl } from '@/i18n/tl'

/** Tells the Vibe Lab host page what really went wrong (the generated app often hides the error behind a friendly message). */
function reportVisionError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[GolinelliAI.ml] ' + context + ':', error)
  try {
    window.parent.postMessage({ source: 'golinelli-coding-preview', id: 'ml_' + Date.now(), action: 'mlStatus', payload: { context, error: message.slice(0, 400) } }, '*')
  } catch { /* not embedded */ }
}
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch { return false }
}
const isGlError = (error: unknown) => /GLctx|WebGL|activeTexture|gl_context|GL context/i.test(error instanceof Error ? error.message : String(error))

export type TrackerKind = 'face' | 'hand' | 'pose'
type Point = { x: number; y: number; z: number }
type Source = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement

const MODEL_PATHS: Record<TrackerKind, string> = {
  face: '/models/face_landmarker/face_landmarker.task',
  hand: '/models/hand_landmarker/hand_landmarker.task',
  pose: '/models/pose_landmarker/pose_landmarker_lite.task',
}

const unwrap = (source: any): Source => source?.elt ?? source?.canvas ?? source

let filesetPromise: Promise<any> | null = null
function fileset() {
  if (!filesetPromise) {
    filesetPromise = (async () => {
      const { FilesetResolver } = await import('@mediapipe/tasks-vision')
      return FilesetResolver.forVisionTasks(assetUrl('/vendor/mediapipe/wasm'))
    })().catch((error) => { filesetPromise = null; throw error })
  }
  return filesetPromise
}

async function createLandmarker(kind: TrackerKind, options: TrackerOptions) {
  if (!hasWebGL()) {
    if (kind === 'face') { await loadFaceFallback(); return 'fallback' as const }
    throw new Error(tl("WebGL non è disponibile in questo browser: il riconoscimento di mani e corpo ne ha bisogno. Attiva l’accelerazione hardware / WebGL (Firefox: about:config → webgl.disabled = false) o usa Chrome/Edge."))
  }
  const vision = await import('@mediapipe/tasks-vision')
  const files = await fileset()
  const max = Math.max(1, Math.min(options.maxResults ?? (kind === 'hand' ? 2 : 1), 6))
  const build = (delegate: 'GPU' | 'CPU') => {
    const base = { baseOptions: { modelAssetPath: assetUrl(MODEL_PATHS[kind]), delegate }, runningMode: 'VIDEO' as const }
    if (kind === 'face') return vision.FaceLandmarker.createFromOptions(files, { ...base, numFaces: max, outputFaceBlendshapes: true })
    if (kind === 'hand') return vision.HandLandmarker.createFromOptions(files, { ...base, numHands: max })
    return vision.PoseLandmarker.createFromOptions(files, { ...base, numPoses: max })
  }
  try { return await build('GPU') } catch { return build('CPU') }
}

// ── face features ────────────────────────────────────────────────────────────
const FACE_IDX = { leftEye: 33, rightEye: 263, nose: 1, mouthLeft: 61, mouthRight: 291, mouthTop: 13, mouthBottom: 14, chin: 152, forehead: 10 }
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function faceFeatures(landmarks: Point[], blend: Record<string, number>) {
  const p = (i: number) => landmarks[i]
  const leftEye = p(FACE_IDX.leftEye), rightEye = p(FACE_IDX.rightEye)
  const faceWidth = dist(p(234), p(454))
  const faceHeight = dist(p(FACE_IDX.forehead), p(FACE_IDX.chin))
  const mouthOpen = blend.jawOpen ?? clamp01(dist(p(FACE_IDX.mouthTop), p(FACE_IDX.mouthBottom)) / (dist(p(FACE_IDX.mouthLeft), p(FACE_IDX.mouthRight)) * 0.6 || 1))
  const smile = ((blend.mouthSmileLeft ?? 0) + (blend.mouthSmileRight ?? 0)) / 2
  const leftEyeClosed = blend.eyeBlinkLeft ?? 0
  const rightEyeClosed = blend.eyeBlinkRight ?? 0
  // head turn: nose position between the two face edges (0.5 = frontal)
  const edgeL = p(234), edgeR = p(454)
  const span = edgeR.x - edgeL.x || 1
  const yaw = clamp01((p(FACE_IDX.nose).x - edgeL.x) / span) - 0.5
  return {
    leftEye, rightEye, nose: p(FACE_IDX.nose), mouthLeft: p(FACE_IDX.mouthLeft), mouthRight: p(FACE_IDX.mouthRight),
    mouthTop: p(FACE_IDX.mouthTop), mouthBottom: p(FACE_IDX.mouthBottom), chin: p(FACE_IDX.chin), forehead: p(FACE_IDX.forehead),
    eyeDistance: dist(leftEye, rightEye),
    faceWidth, faceHeight,
    /** head roll in radians (0 = upright) */
    roll: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
    /** -0.5 (turned to the left of the image) … 0.5 (right); about 0 when frontal */
    yaw,
    mouthOpen: clamp01(mouthOpen),
    smile: clamp01(smile),
    leftEyeClosed, rightEyeClosed,
    eyesClosed: (leftEyeClosed + rightEyeClosed) / 2,
    browUp: clamp01(blend.browInnerUp ?? 0),
  }
}

// ── hand features ────────────────────────────────────────────────────────────
function handFeatures(landmarks: Point[]) {
  const wrist = landmarks[0]
  const extended = (tip: number, pip: number) => dist(landmarks[tip], wrist) > dist(landmarks[pip], wrist) * 1.08
  const fingers = {
    thumb: dist(landmarks[4], landmarks[17]) > dist(landmarks[3], landmarks[17]) * 1.05 && dist(landmarks[4], landmarks[5]) > dist(landmarks[3], landmarks[5]),
    index: extended(8, 6), middle: extended(12, 10), ring: extended(16, 14), pinky: extended(20, 18),
  }
  const count = Object.values(fingers).filter(Boolean).length
  const others = fingers.index || fingers.middle || fingers.ring || fingers.pinky
  let gesture: string = 'unknown'
  if (count === 0 || (count === 1 && fingers.thumb && !others && landmarks[4].y > landmarks[3].y)) gesture = 'fist'
  if (count >= 4 && fingers.index && fingers.middle && fingers.ring && fingers.pinky) gesture = 'open'
  else if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) gesture = 'point'
  else if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) gesture = 'victory'
  else if (fingers.thumb && !others && landmarks[4].y < landmarks[3].y && landmarks[4].y < landmarks[0].y) gesture = 'thumbs_up'
  const pinch = dist(landmarks[4], landmarks[8]) / (dist(landmarks[0], landmarks[9]) || 1)
  return { fingers, fingerCount: count, gesture, pinch: clamp01(1 - pinch / 1.2), pinching: pinch < 0.25 }
}

const POSE_NAMES = ['nose', 'leftEyeInner', 'leftEye', 'leftEyeOuter', 'rightEyeInner', 'rightEye', 'rightEyeOuter', 'leftEar', 'rightEar', 'mouthLeft', 'mouthRight', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftPinky', 'rightPinky', 'leftIndex', 'rightIndex', 'leftThumb', 'rightThumb', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftFootIndex', 'rightFootIndex']

export interface TrackerOptions { maxResults?: number }
export interface TrackerResult {
  kind: TrackerKind
  detected: boolean
  /** analysed frame size in pixels */
  width: number
  height: number
  faces?: Array<{ landmarks: Point[]; blendshapes: Record<string, number>; features: ReturnType<typeof faceFeatures> }>
  hands?: Array<{ handedness: string; landmarks: Point[] } & ReturnType<typeof handFeatures>>
  poses?: Array<{ landmarks: Point[]; named: Record<string, Point> }>
}

function size(source: Source) {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight }
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight }
  return { width: source.width, height: source.height }
}

export class Tracker {
  private ready: Promise<any>
  private lastTs = 0
  private lastVideoTime = -1
  private lastResult: TrackerResult | null = null
  private useFallback = false
  private readonly max: number
  constructor(readonly kind: TrackerKind, options: TrackerOptions) {
    this.max = Math.max(1, Math.min(options.maxResults ?? (kind === 'hand' ? 2 : 1), 6))
    this.ready = createLandmarker(kind, options)
    this.ready.catch((error) => reportVisionError(tl("caricamento del modello ") + kind, error))
  }
  /** Resolves once the model is loaded. */
  warmUp() { return this.ready.then(() => this) }

  /** One analysis of a <video>, <canvas>, <img> or p5 element. Resolves to a result with detected=false when nothing is seen. */
  async detect(input: any): Promise<TrackerResult> {
    const source = unwrap(input)
    const landmarker = await this.ready
    const { width, height } = size(source)
    const empty: TrackerResult = { kind: this.kind, detected: false, width, height }
    if (!width || !height) return empty
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2) return empty
      // Same frame as last time: reuse the previous answer instead of re-running the model.
      if (source.currentTime === this.lastVideoTime && this.lastResult) return this.lastResult
      this.lastVideoTime = source.currentTime
    }
    const now = performance.now()
    this.lastTs = now > this.lastTs ? now : this.lastTs + 1
    let result: TrackerResult = empty
    if (this.kind === 'face' && (landmarker === 'fallback' || this.useFallback)) {
      const found = await detectFacesFallback(source, width, height, this.max)
      const faces = found.map((face) => ({ landmarks: face.landmarks, blendshapes: {} as Record<string, number>, features: fallbackFeatures(face.landmarks) }))
      result = { kind: 'face', detected: faces.length > 0, width, height, faces }
      this.lastResult = result
      return result
    }
    let raw: any
    try {
      raw = landmarker.detectForVideo(source, this.lastTs)
    } catch (error) {
      // WebGL context lost / refused after the model loaded: faces can still be tracked on the CPU engine.
      if (this.kind === 'face' && isGlError(error)) {
        reportVisionError(tl("MediaPipe senza WebGL, passo al motore CPU"), error)
        this.useFallback = true
        await loadFaceFallback()
        return this.detect(input)
      }
      throw error
    }
    if (this.kind === 'face') {
      const faces = (raw.faceLandmarks || []).map((landmarks: Point[], index: number) => {
        const blendshapes: Record<string, number> = {}
        for (const c of raw.faceBlendshapes?.[index]?.categories || []) blendshapes[c.categoryName] = c.score
        return { landmarks, blendshapes, features: faceFeatures(landmarks, blendshapes) }
      })
      result = { kind: 'face', detected: faces.length > 0, width, height, faces }
    } else if (this.kind === 'hand') {
      const hands = (raw.landmarks || []).map((landmarks: Point[], index: number) => ({
        // MediaPipe labels hands as if the image were a mirrored selfie.
        handedness: raw.handedness?.[index]?.[0]?.categoryName || 'Unknown',
        landmarks,
        ...handFeatures(landmarks),
      }))
      result = { kind: 'hand', detected: hands.length > 0, width, height, hands }
    } else {
      const poses = (raw.landmarks || []).map((landmarks: Point[]) => ({
        landmarks,
        named: Object.fromEntries(POSE_NAMES.map((name, i) => [name, landmarks[i]])) as Record<string, Point>,
      }))
      result = { kind: 'pose', detected: poses.length > 0, width, height, poses }
    }
    this.lastResult = result
    return result
  }

  /** Continuous analysis. Returns a function that stops it. Waits for the video to have frames. */
  start(input: any, options: { onResult?: (result: TrackerResult) => void; maxFps?: number } = {}): () => void {
    let stopped = false
    const gap = options.maxFps ? 1000 / options.maxFps : 0
    let last = 0
    let failures = 0
    const loop = async () => {
      if (stopped) return
      const now = performance.now()
      if (now - last >= gap) {
        last = now
        try {
          options.onResult?.(await this.detect(input))
          failures = 0
        } catch (error) {
          failures += 1
          if (failures === 5) reportVisionError(tl("analisi dei fotogrammi"), error)
        }
      }
      if (!stopped) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    return () => { stopped = true }
  }

  close() { this.ready.then((landmarker) => (typeof landmarker === 'object' ? landmarker.close?.() : undefined)).catch(() => undefined) }
}

export async function createTracker(kind: TrackerKind, options: TrackerOptions = {}): Promise<Tracker> {
  if (kind !== 'face' && kind !== 'hand' && kind !== 'pose') throw new Error(tl("Tipo di tracker non valido: usa \"face\", \"hand\" o \"pose\"."))
  const tracker = new Tracker(kind, options)
  await tracker.warmUp()
  return tracker
}
