/**
 * Landmark-based recognisers for the ML Lab: body pose (MoveNet) and hand gestures (MediaPipe Hand Landmarker).
 *
 * Both turn a camera frame into a small geometric feature vector (positions relative to the body / the wrist, scaled by
 * body / palm size), so a classifier trained on a few examples works whatever the distance from the camera. Training
 * variety comes from cheap *geometric* augmentation (rotation, scale, jitter) of the stored features, with no extra
 * inference. Mirroring is deliberately not used: "right arm up" and "left arm up" must stay different classes.
 */
import * as tf from '@tensorflow/tfjs'
import type { PoseDetector } from '@tensorflow-models/pose-detection'
import { assetUrl } from './mlAssets'

export type Mode = 'image' | 'pose' | 'hand'
export const MODE_LABEL: Record<Mode, string> = { image: 'Immagini', pose: 'Pose del corpo', hand: 'Gesti delle mani' }
export const ENGINE_BY_MODE: Record<Mode, string> = { image: 'mobilenet-v1-050-160/1', pose: 'movenet-lightning/1', hand: 'mediapipe-hand/1' }
export const modeOfEngine = (engine?: string | null): Mode => (engine?.startsWith('movenet') ? 'pose' : engine?.startsWith('mediapipe-hand') ? 'hand' : 'image')

export interface Overlay { kind: 'pose' | 'hand'; points: Array<{ x: number; y: number; score?: number }>; width: number; height: number }
export interface Extracted { vector: Float32Array; overlay: Overlay }

// ── connections used to draw the skeletons ───────────────────────────────────

export const POSE_EDGES: Array<[number, number]> = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [0, 1], [0, 2], [1, 3], [2, 4]]
export const HAND_EDGES: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]]

type Source = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement

// ── body pose ────────────────────────────────────────────────────────────────

let poseDetector: Promise<PoseDetector> | null = null

export function loadPoseDetector(): Promise<PoseDetector> {
  if (!poseDetector) {
    poseDetector = (async () => {
      await tf.ready()
      const poseDetection = await import('@tensorflow-models/pose-detection')
      const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        modelUrl: assetUrl('/models/movenet_lightning/model.json'),
        enableSmoothing: true,
      })
      return detector
    })().catch((error) => { poseDetector = null; throw error })
  }
  return poseDetector
}

const MIN_JOINT_SCORE = 0.25

function dims(source: Source) {
  return {
    width: source instanceof HTMLVideoElement ? source.videoWidth : (source as HTMLCanvasElement).width,
    height: source instanceof HTMLVideoElement ? source.videoHeight : (source as HTMLCanvasElement).height,
  }
}

/** Positions relative to the shoulder midpoint, in shoulder-widths; missing joints are 0. Null if no usable body. */
export function poseFeatures(points: Array<{ x: number; y: number; score?: number }>): Float32Array | null {
  const ok = (index: number) => (points[index]?.score ?? 0) >= MIN_JOINT_SCORE
  if (!ok(5) || !ok(6)) return null
  const cx = (points[5].x + points[6].x) / 2
  const cy = (points[5].y + points[6].y) / 2
  const scale = Math.hypot(points[5].x - points[6].x, points[5].y - points[6].y)
  if (scale < 8) return null
  const out = new Float32Array(34)
  for (let i = 0; i < 17; i++) {
    if (!ok(i)) continue
    out[i * 2] = (points[i].x - cx) / scale
    out[i * 2 + 1] = (points[i].y - cy) / scale
  }
  return out
}

export async function detectPose(source: Source, fresh = false): Promise<Extracted | null> {
  const detector = await loadPoseDetector()
  if (fresh) detector.reset() // unrelated still image: forget the tracking state of the previous frame
  const poses = await detector.estimatePoses(source as HTMLVideoElement, { flipHorizontal: false })
  const keypoints = poses[0]?.keypoints
  if (!keypoints || keypoints.length < 17) return null
  const points = keypoints.map((k) => ({ x: k.x, y: k.y, score: k.score ?? 0 }))
  const vector = poseFeatures(points)
  if (!vector) return null
  const { width, height } = dims(source)
  return { vector, overlay: { kind: 'pose', points, width, height } }
}

// ── hand gestures ────────────────────────────────────────────────────────────

let handLandmarker: Promise<import('@mediapipe/tasks-vision').HandLandmarker> | null = null

export function loadHandLandmarker() {
  if (!handLandmarker) {
    handLandmarker = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(assetUrl('/vendor/mediapipe/wasm'))
      const create = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: assetUrl('/models/hand_landmarker/hand_landmarker.task'), delegate },
        runningMode: 'IMAGE',
        numHands: 1,
      })
      try { return await create('GPU') } catch { return create('CPU') }
    })().catch((error) => { handLandmarker = null; throw error })
  }
  return handLandmarker
}

/** Wrist-relative 3-D landmarks in palm-sizes; left hands are mirrored so one gesture is one gesture for both hands. */
export function handFeatures(landmarks: Array<{ x: number; y: number; z: number }>, width: number, height: number, mirror: boolean): Float32Array {
  const pts = landmarks.map((p) => ({ x: p.x * width, y: p.y * height, z: p.z * width }))
  const wrist = pts[0]
  const scale = Math.hypot(pts[9].x - wrist.x, pts[9].y - wrist.y, (pts[9].z - wrist.z) * 0.5) || 1
  const out = new Float32Array(63)
  pts.forEach((p, i) => {
    out[i * 3] = ((p.x - wrist.x) / scale) * (mirror ? -1 : 1)
    out[i * 3 + 1] = (p.y - wrist.y) / scale
    out[i * 3 + 2] = (p.z - wrist.z) / scale
  })
  return out
}

export async function detectHand(source: Source): Promise<Extracted | null> {
  const landmarker = await loadHandLandmarker()
  const { width, height } = dims(source)
  if (!width || !height) return null
  const result = landmarker.detect(source as HTMLCanvasElement)
  const landmarks = result.landmarks?.[0]
  if (!landmarks || landmarks.length < 21) return null
  const label = result.handedness?.[0]?.[0]?.categoryName // MediaPipe assumes a mirrored image, so only consistency matters
  return {
    vector: handFeatures(landmarks, width, height, label === 'Left'),
    overlay: { kind: 'hand', points: landmarks.map((p) => ({ x: p.x * width, y: p.y * height })), width, height },
  }
}

// ── dispatch + augmentation + drawing ────────────────────────────────────────

export async function extractFeatures(mode: Exclude<Mode, 'image'>, source: Source, fresh = false): Promise<Extracted | null> {
  return mode === 'pose' ? detectPose(source, fresh) : detectHand(source)
}

export function loadLandmarkEngine(mode: Exclude<Mode, 'image'>) {
  return mode === 'pose' ? loadPoseDetector() : loadHandLandmarker()
}

function gaussian(): number {
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random())
}

/**
 * Geometric variants of one landmark feature vector: small rotation, scale change and jitter. They teach the head that a
 * pose / gesture stays the same when the person tilts, moves nearer or shakes a little.
 */
export function augmentLandmarks(vector: Float32Array, mode: Exclude<Mode, 'image'>, copies = 6): Float32Array[] {
  const stride = mode === 'pose' ? 2 : 3
  const points = vector.length / stride
  return Array.from({ length: copies }, () => {
    const angle = (gaussian() * 5 * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const scale = 1 + gaussian() * 0.05
    const out = new Float32Array(vector.length)
    for (let p = 0; p < points; p++) {
      const x = vector[p * stride]
      const y = vector[p * stride + 1]
      const present = mode === 'hand' || x !== 0 || y !== 0 // missing pose joints stay missing
      if (!present) continue
      out[p * stride] = (x * cos - y * sin) * scale + gaussian() * 0.015
      out[p * stride + 1] = (x * sin + y * cos) * scale + gaussian() * 0.015
      if (stride === 3) out[p * stride + 2] = vector[p * stride + 2] * scale + gaussian() * 0.015
    }
    return out
  })
}

/** Draws a skeleton over a canvas that covers the (unmirrored) source frame. */
export function drawOverlay(canvas: HTMLCanvasElement, overlay: Overlay | null, color = '#ffffff') {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (!overlay) { ctx.clearRect(0, 0, canvas.width, canvas.height); return }
  if (canvas.width !== overlay.width || canvas.height !== overlay.height) { canvas.width = overlay.width; canvas.height = overlay.height }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const edges = overlay.kind === 'pose' ? POSE_EDGES : HAND_EDGES
  const visible = (i: number) => overlay.kind === 'hand' || (overlay.points[i]?.score ?? 0) >= MIN_JOINT_SCORE
  const unit = Math.max(2, overlay.width / 160)
  ctx.lineWidth = unit
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.85
  for (const [a, b] of edges) {
    if (!visible(a) || !visible(b)) continue
    ctx.beginPath()
    ctx.moveTo(overlay.points[a].x, overlay.points[a].y)
    ctx.lineTo(overlay.points[b].x, overlay.points[b].y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  overlay.points.forEach((point, i) => {
    if (!visible(i)) return
    ctx.beginPath()
    ctx.arc(point.x, point.y, unit * 1.3, 0, Math.PI * 2)
    ctx.fill()
  })
}

/** A thumbnail with the skeleton drawn on it, so landmark samples are recognisable in the grid. */
export function skeletonThumbnail(frame: HTMLCanvasElement, overlay: Overlay, size = 72): string {
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const ctx = out.getContext('2d')!
  const side = Math.min(frame.width, frame.height)
  const sx = (frame.width - side) / 2
  const sy = (frame.height - side) / 2
  ctx.drawImage(frame, sx, sy, side, side, 0, 0, size, size)
  const layer = document.createElement('canvas')
  layer.width = overlay.width
  layer.height = overlay.height
  drawOverlay(layer, overlay, '#ffffff')
  ctx.drawImage(layer, sx, sy, side, side, 0, 0, size, size)
  return out.toDataURL('image/jpeg', 0.62)
}
