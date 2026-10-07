import { packFloats, packVector, unpackFloats, unpackVector } from '@/lib/imageClassifier'
import { ENGINE_BY_MODE, type Mode } from '@/lib/mlFeatures'
import type { MLLabProjectSummary } from '@/lib/api'

export interface SampleState { id: string; thumb: string; vectors: Float32Array[] }
export interface ClassState { id: string; name: string; color: string; samples: SampleState[] }

export const MAX_CLASSES = 10
export const MAX_SAMPLES_PER_CLASS = 120
/** Platform colours, one per class. */
export const CLASS_PALETTE = ['#7b69c9', '#3ea9f4', '#e85c8d', '#0d9488', '#5b5bd6', '#d97706', '#16a34a', '#dc2626', '#0891b2', '#a855f7']

let counter = 0
export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const emptyClass = (index: number, name: string): ClassState => ({ id: uid(), name, color: CLASS_PALETTE[index % CLASS_PALETTE.length], samples: [] })

/** Image samples keep MobileNet embeddings (int8); landmark samples keep their geometric features (float32). */
export function serializeClasses(classes: ClassState[], mode: Mode = 'image', model?: unknown) {
  const pack = mode === 'image' ? packVector : packFloats
  return {
    version: 2,
    mode,
    engine: ENGINE_BY_MODE[mode],
    classes: classes.map((c) => ({ id: c.id, name: c.name, color: c.color, samples: c.samples.map((s) => ({ t: s.thumb, e: s.vectors.map((vector) => pack(vector)) })) })),
    ...(model ? { model } : {}),
  }
}

export function summarize(classes: ClassState[]): MLLabProjectSummary['classes'] {
  return classes.map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.samples.length, thumbs: c.samples.slice(0, 3).map((s) => s.thumb) }))
}

export function deserializeClasses(data: any): ClassState[] {
  const unpack = (data?.mode ?? 'image') === 'image' ? unpackVector : unpackFloats
  const classes = Array.isArray(data?.classes) ? data.classes : []
  return classes.map((c: any, index: number) => ({
    id: String(c.id || uid()),
    name: String(c.name || `Classe ${index + 1}`),
    color: String(c.color || CLASS_PALETTE[index % CLASS_PALETTE.length]),
    samples: (Array.isArray(c.samples) ? c.samples : []).map((s: any) => ({ id: uid(), thumb: String(s.t || ''), vectors: (s.e || []).map(unpack) })),
  }))
}
