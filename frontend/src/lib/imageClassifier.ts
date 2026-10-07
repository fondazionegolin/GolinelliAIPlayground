/**
 * Few-shot image classifier for the ML Lab.
 *
 * Why this replaces the old pixel MLP: a network trained from raw 64×64 pixels has nothing to generalise from when a
 * student records 10–20 photos, and the real-time test compared raw pixels with nearest neighbours, so any change of
 * light or position broke it. Here a frozen MobileNet turns every image into a 512-d embedding that already encodes
 * "what is in the picture"; only a tiny softmax head on top is trained. That means:
 *   - good accuracy with a handful of examples per class,
 *   - training takes a fraction of a second, so it re-runs every time classes or samples change (adding a class
 *     never requires starting over),
 *   - the head can say "not sure" instead of always naming a class.
 */
import * as tf from '@tensorflow/tfjs'
import { assetUrl } from './mlAssets'

export const ENGINE = 'mobilenet-v1-050-160/1'
export const EMBED_DIM = 512
const MODEL_PATH = '/models/mobilenet_v1_050_224/model.json'
/** 160 px instead of MobileNet's native 224: half the compute for ~3 points of accuracy, which keeps capture and live view smooth. */
export const INPUT_SIZE = 160
const INPUT = INPUT_SIZE

// ── embedder ──────────────────────────────────────────────────────────────────

let embedderPromise: Promise<tf.LayersModel> | null = null

/** Loads (once) the self-hosted MobileNet truncated at its global-average-pooling layer. */
export function loadEmbedder(): Promise<tf.LayersModel> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      await tf.ready()
      // The stored topology is fixed at 224×224: patch the input layer to the smaller size (the network is fully convolutional).
      const artifacts = await (tf.io.http(assetUrl(MODEL_PATH)) as tf.io.IOHandler).load!()
      const layers = (artifacts.modelTopology as any).model_config.config.layers
      layers[0].config.batch_input_shape = [null, INPUT, INPUT, 3]
      const base = await tf.loadLayersModel({ load: async () => artifacts })
      const pooled = base.getLayer('global_average_pooling2d_1').output as tf.SymbolicTensor
      const embedder = tf.model({ inputs: base.inputs, outputs: pooled })
      tf.tidy(() => { embedder.predict(tf.zeros([1, INPUT, INPUT, 3])) }) // warm-up: compiles the WebGL programs
      return embedder
    })().catch((error) => { embedderPromise = null; throw error })
  }
  return embedderPromise
}

export interface Augmentation { flip?: boolean; zoom?: number; brightness?: number }
/** Variants stored next to every captured sample: they teach invariance to mirroring, framing and light. */
export const AUGMENTATIONS: Augmentation[] = [{}, { flip: true }, { zoom: 0.82, brightness: 0.14 }]
/** Embedded in idle time after the plain view, so recording never waits for them. */
export const AUGMENTED_VARIANTS = AUGMENTATIONS.slice(1)

type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap

function preprocess(pixels: tf.Tensor3D, aug: Augmentation): tf.Tensor4D {
  const [height, width] = pixels.shape
  const side = Math.floor(Math.min(height, width) * (aug.zoom ?? 1))
  const top = Math.floor((height - side) / 2)
  const left = Math.floor((width - side) / 2)
  let x = tf.image.resizeBilinear(pixels.slice([top, left, 0], [side, side, 3]), [INPUT, INPUT]).toFloat().div(127.5).sub(1)
  if (aug.flip) x = x.reverse(1)
  if (aug.brightness) x = x.add(aug.brightness).clipByValue(-1, 1)
  return x.expandDims(0) as tf.Tensor4D
}

function l2(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm
  return out
}

/** Embeddings of one image: the plain view plus the augmented variants (L2-normalised). */
export async function embedImage(source: Source, augmentations: Augmentation[] = [{}]): Promise<Float32Array[]> {
  const embedder = await loadEmbedder()
  const out: Float32Array[] = []
  for (const aug of augmentations) {
    const data = tf.tidy(() => {
      const pixels = tf.browser.fromPixels(source as HTMLCanvasElement)
      return (embedder.predict(preprocess(pixels, aug)) as tf.Tensor).squeeze()
    })
    out.push(l2(await data.data() as Float32Array))
    data.dispose()
  }
  return out
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// ── compact storage of embeddings (int8 + scale) ─────────────────────────────

export function packVector(vector: Float32Array): string {
  let max = 0
  for (let i = 0; i < vector.length; i++) max = Math.max(max, Math.abs(vector[i]))
  const scale = max / 127 || 1
  const bytes = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) bytes[i] = Math.round(vector[i] / scale)
  let binary = ''
  const view = new Uint8Array(bytes.buffer)
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return `${scale.toPrecision(6)}:${btoa(binary)}`
}

export function unpackVector(packed: string): Float32Array {
  const [scaleText, payload] = packed.split(':')
  const scale = Number(scaleText)
  const binary = atob(payload)
  const out = new Float32Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    const byte = binary.charCodeAt(i)
    out[i] = (byte > 127 ? byte - 256 : byte) * scale
  }
  return l2(out)
}

// ── the classifier head ──────────────────────────────────────────────────────

export interface TrainingSample { classIndex: number; group: number; vector: Float32Array }
/**
 * ``cosine``: mean-centred, L2-normalised features (MobileNet embeddings).
 * ``zscore``: per-dimension standardised features (pose / hand landmarks, which are already geometric).
 */
export type HeadKind = 'cosine' | 'zscore'
export interface Head { kind: HeadKind; dim: number; numClasses: number; mean: Float32Array; std: Float32Array | null; weights: Float32Array; bias: Float32Array; classCounts: number[] }

/** Float32 ↔ base64 (used for landmark features and for the exported model head, where int8 would lose precision). */
export function packFloats(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(new Float32Array(values as ArrayLike<number> as number[]).buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function unpackFloats(text: string): Float32Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export interface HeadJSON { kind: HeadKind; dim: number; numClasses: number; classIds: string[]; mean: string; std: string | null; weights: string; bias: string }

/** Compact JSON form of a trained head: this is what the Vibe Lab runtime loads. */
export function headToJSON(head: Head, classIds: string[]): HeadJSON {
  return {
    kind: head.kind, dim: head.dim, numClasses: head.numClasses, classIds,
    mean: packFloats(head.mean), std: head.std ? packFloats(head.std) : null, weights: packFloats(head.weights), bias: packFloats(head.bias),
  }
}

const SCALE = 12 // temperature of the cosine logits

function center(vector: Float32Array, mean: Float32Array): Float32Array {
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] - mean[i]
  return l2(out)
}

/**
 * Trains the softmax head. It starts from the class prototypes (so even 2–3 examples per class already give a sensible
 * classifier) and refines them with a few class-balanced gradient steps.
 * Embeddings are mean-centred first: raw MobileNet features are all positive, which makes every image look alike in
 * cosine terms. Landmark features are standardised per dimension instead.
 */
export async function trainHead(samples: TrainingSample[], numClasses: number, epochs = 90, kind: HeadKind = 'cosine'): Promise<Head> {
  const dim = samples[0].vector.length
  const mean = new Float32Array(dim)
  for (const sample of samples) for (let i = 0; i < dim; i++) mean[i] += sample.vector[i] / samples.length
  let std: Float32Array | null = null
  if (kind === 'zscore') {
    std = new Float32Array(dim)
    for (const sample of samples) for (let i = 0; i < dim; i++) std[i] += (sample.vector[i] - mean[i]) ** 2 / samples.length
    for (let i = 0; i < dim; i++) std[i] = Math.max(Math.sqrt(std[i]), 0.02)
  }
  const prepare = (vector: Float32Array) => {
    if (kind === 'cosine') return center(vector, mean)
    const out = new Float32Array(dim)
    for (let i = 0; i < dim; i++) out[i] = (vector[i] - mean[i]) / std![i]
    return out
  }
  const prepared = samples.map((sample) => prepare(sample.vector))
  const counts = new Array<number>(numClasses).fill(0)
  samples.forEach((sample) => { counts[sample.classIndex] += 1 })

  // prototype initialisation
  const init = new Float32Array(dim * numClasses)
  const initBias = new Float32Array(numClasses)
  const means = Array.from({ length: numClasses }, () => new Float32Array(dim))
  prepared.forEach((vector, row) => { const c = samples[row].classIndex; for (let i = 0; i < dim; i++) means[c][i] += vector[i] / counts[c] })
  if (kind === 'cosine') {
    for (let c = 0; c < numClasses; c++) {
      let norm = 0
      for (let i = 0; i < dim; i++) norm += means[c][i] ** 2
      norm = Math.sqrt(norm) || 1
      for (let i = 0; i < dim; i++) init[i * numClasses + c] = (means[c][i] / norm) * SCALE
    }
  } else {
    // Gaussian prototype classifier: logit_c = x·m_c/σ² − |m_c|²/2σ² (σ² = mean within-class variance, shrunk)
    let within = 0
    prepared.forEach((vector, row) => { const m = means[samples[row].classIndex]; for (let i = 0; i < dim; i++) within += (vector[i] - m[i]) ** 2 })
    const sigma2 = Math.max(within / (prepared.length * dim), 0.08)
    for (let c = 0; c < numClasses; c++) {
      let norm2 = 0
      for (let i = 0; i < dim; i++) { init[i * numClasses + c] = means[c][i] / sigma2; norm2 += means[c][i] ** 2 }
      initBias[c] = -norm2 / (2 * sigma2)
    }
  }

  const classWeight = counts.map((count) => (count ? samples.length / (numClasses * count) : 0))
  const result = tf.tidy(() => ({
    x: tf.tensor2d(prepared.map((v) => Array.from(v))),
    y: tf.oneHot(tf.tensor1d(samples.map((s) => s.classIndex), 'int32'), numClasses),
    w: tf.tensor1d(samples.map((s) => classWeight[s.classIndex])),
  }))
  const W = tf.variable(tf.tensor2d(init, [dim, numClasses]))
  const b = tf.variable(tf.tensor1d(initBias))
  const optimizer = tf.train.adam(kind === 'cosine' ? 0.05 : 0.02)
  const reg = kind === 'cosine' ? 2e-4 : 5e-5
  try {
    for (let epoch = 0; epoch < epochs; epoch++) {
      optimizer.minimize(() => {
        const logits = result.x.matMul(W).add(b)
        const loss = tf.losses.softmaxCrossEntropy(result.y, logits, result.w)
        return loss.add(W.square().sum().mul(reg)) as tf.Scalar
      })
      if (epoch % 15 === 14) await tf.nextFrame() // keep the UI responsive
    }
    return { kind, dim, numClasses, mean, std, weights: (await W.data()) as Float32Array, bias: (await b.data()) as Float32Array, classCounts: counts }
  } finally {
    result.x.dispose(); result.y.dispose(); result.w.dispose(); W.dispose(); b.dispose()
    optimizer.dispose()
  }
}

export function headFromJSON(json: HeadJSON): Head {
  return { kind: json.kind, dim: json.dim, numClasses: json.numClasses, mean: unpackFloats(json.mean), std: json.std ? unpackFloats(json.std) : null, weights: unpackFloats(json.weights), bias: unpackFloats(json.bias), classCounts: [] }
}

/** Class probabilities (0..1) for one feature vector. */
export function predict(head: Head, vector: Float32Array): number[] {
  let x: Float32Array
  if (head.kind === 'cosine') x = center(vector, head.mean)
  else { x = new Float32Array(head.dim); for (let i = 0; i < head.dim; i++) x[i] = (vector[i] - head.mean[i]) / head.std![i] }
  const logits = new Array<number>(head.numClasses).fill(0)
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    for (let c = 0; c < head.numClasses; c++) logits[c] += xi * head.weights[i * head.numClasses + c]
  }
  let max = -Infinity
  for (let c = 0; c < head.numClasses; c++) { logits[c] += head.bias[c]; max = Math.max(max, logits[c]) }
  const exps = logits.map((l) => Math.exp(l - max))
  const total = exps.reduce((a, b) => a + b, 0) || 1
  return exps.map((e) => e / total)
}

/**
 * Cross-validated accuracy (0..1). Folds split the *original photos*; the augmented copies of a photo always follow
 * it, so a held-out photo is never seen in training through its mirror image.
 */
export async function crossValidate(samples: TrainingSample[], numClasses: number, kind: HeadKind = 'cosine'): Promise<number | null> {
  const byClass: number[][] = Array.from({ length: numClasses }, () => [])
  const groups = new Map<number, TrainingSample[]>()
  for (const sample of samples) {
    if (!groups.has(sample.group)) { groups.set(sample.group, []); byClass[sample.classIndex].push(sample.group) }
    groups.get(sample.group)!.push(sample)
  }
  const smallest = Math.min(...byClass.map((list) => list.length))
  if (!Number.isFinite(smallest) || smallest < 3) return null
  const folds = Math.min(4, smallest)
  let correct = 0
  let total = 0
  for (let fold = 0; fold < folds; fold++) {
    const held = new Set<number>()
    byClass.forEach((list) => list.forEach((group, index) => { if (index % folds === fold) held.add(group) }))
    const train = samples.filter((s) => !held.has(s.group))
    const head = await trainHead(train, numClasses, 40, kind)
    for (const group of held) {
      const base = groups.get(group)![0]
      const probs = predict(head, base.vector)
      if (probs.indexOf(Math.max(...probs)) === base.classIndex) correct += 1
      total += 1
    }
  }
  return total ? correct / total : null
}

/** Below this the live classifier says "not sure" instead of naming a class. */
export const CONFIDENCE_THRESHOLD = 0.6

/** Exponential smoothing of consecutive predictions, so the live bars stop flickering. */
export function smooth(previous: number[] | null, next: number[], alpha = 0.45): number[] {
  if (!previous || previous.length !== next.length) return next
  return next.map((value, index) => previous[index] * (1 - alpha) + value * alpha)
}

/** Evenly thins a class to at most ``max`` items (keeps the spread of what was recorded, drops near-duplicates). */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const step = items.length / max
  return Array.from({ length: max }, (_, index) => items[Math.floor(index * step)])
}
