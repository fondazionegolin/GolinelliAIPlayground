import * as tf from '@tensorflow/tfjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { headFromJSON, headToJSON, packVector, predict, trainHead, unpackVector, type TrainingSample } from './imageClassifier'

const DIM = 16

/** Two well-separated clusters of noisy unit vectors. */
function clusters(perClass: number): TrainingSample[] {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
  const samples: TrainingSample[] = []
  for (let c = 0; c < 2; c++) {
    for (let n = 0; n < perClass; n++) {
      const vector = new Float32Array(DIM)
      for (let i = 0; i < DIM; i++) vector[i] = (i % 2 === c ? 1 : 0) + rand() * 0.3
      samples.push({ classIndex: c, group: c * perClass + n, vector })
    }
  }
  return samples
}

beforeAll(async () => { await tf.setBackend('cpu') })

describe('ML Lab classifier head', () => {
  it('separates two classes and survives a JSON round trip', async () => {
    for (const kind of ['cosine', 'zscore'] as const) {
      const samples = clusters(8)
      const head = await trainHead(samples, 2, 30, kind)
      expect(head.weights.every(Number.isFinite)).toBe(true)
      const restored = headFromJSON(headToJSON(head, ['a', 'b']))
      for (const sample of samples) {
        const probs = predict(restored, sample.vector)
        expect(probs.indexOf(Math.max(...probs))).toBe(sample.classIndex)
      }
    }
  })

  it('does not leak tensors', async () => {
    const before = tf.memory().numTensors
    await trainHead(clusters(4), 2, 10)
    expect(tf.memory().numTensors).toBe(before)
  })

  it('packs embeddings to int8 without changing their direction', () => {
    const vector = new Float32Array(Array.from({ length: DIM }, (_, i) => Math.sin(i)))
    const restored = unpackVector(packVector(vector))
    const norm = Math.hypot(...vector)
    const cos = vector.reduce((sum, value, i) => sum + (value / norm) * restored[i], 0)
    expect(cos).toBeGreaterThan(0.999)
  })
})
