/**
 * Face tracking without WebGL (Firefox with hardware acceleration off / fingerprinting protection, locked-down school
 * PCs): MediaPipe needs a WebGL context even in CPU mode, so this engine runs the tiny face-api.js networks on tfjs' CPU
 * backend instead (68 landmarks, a few frames per second). It returns the same feature set as the MediaPipe path.
 */
import * as tf from '@tensorflow/tfjs'
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js'
import { assetUrl } from './mlAssets'

type Point = { x: number; y: number; z: number }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 })
const centroid = (pts: Point[]): Point => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length, z: 0 })

let engine: Promise<void> | null = null
export function loadFaceFallback(): Promise<void> {
  if (!engine) {
    engine = (async () => {
      await tf.setBackend('cpu')
      await tf.ready()
      const base = assetUrl('/models/face_api')
      await faceapi.nets.tinyFaceDetector.loadFromUri(base)
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(base)
    })().catch((error) => { engine = null; throw error })
  }
  return engine
}

function eyeClosedness(p: Point[], from: number): number {
  const ear = (dist(p[from + 1], p[from + 5]) + dist(p[from + 2], p[from + 4])) / (2 * dist(p[from], p[from + 3]) || 1)
  return clamp01((0.27 - ear) / 0.15)
}

/** Same shape as the MediaPipe `features` object, derived from the 68-point model. */
export function fallbackFeatures(p: Point[]) {
  const leftEye = centroid(p.slice(36, 42))
  const rightEye = centroid(p.slice(42, 48))
  const brows = mid(p[19], p[24])
  const chin = p[8]
  const forehead: Point = { x: brows.x + (brows.x - chin.x) * 0.3, y: brows.y + (brows.y - chin.y) * 0.3, z: 0 }
  const faceWidth = dist(p[0], p[16])
  const mouthWidth = dist(p[48], p[54])
  const gap = dist(p[62], p[66])
  const span = p[16].x - p[0].x || 1
  const leftEyeClosed = eyeClosedness(p, 36)
  const rightEyeClosed = eyeClosedness(p, 42)
  return {
    leftEye, rightEye, nose: p[30], mouthLeft: p[48], mouthRight: p[54], mouthTop: p[51], mouthBottom: p[57], chin, forehead,
    eyeDistance: dist(leftEye, rightEye),
    faceWidth,
    faceHeight: dist(forehead, chin),
    roll: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
    yaw: clamp01((p[30].x - p[0].x) / span) - 0.5,
    mouthOpen: clamp01((gap / (mouthWidth || 1) - 0.08) / 0.55),
    smile: clamp01((mouthWidth / (faceWidth || 1) - 0.36) / 0.16),
    leftEyeClosed, rightEyeClosed,
    eyesClosed: (leftEyeClosed + rightEyeClosed) / 2,
    browUp: 0,
  }
}

/** Faces of a frame, landmarks normalized 0..1. */
export async function detectFacesFallback(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement, width: number, height: number, max: number): Promise<Array<{ landmarks: Point[] }>> {
  await loadFaceFallback()
  const found = await faceapi
    .detectAllFaces(source as any, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
    .withFaceLandmarks(true)
  return found.slice(0, max).map((face: any) => ({
    landmarks: (face.landmarks.positions as Array<{ x: number; y: number }>).map((pt) => ({ x: pt.x / width, y: pt.y / height, z: 0 })),
  }))
}
