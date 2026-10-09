import { CONFIDENCE_THRESHOLD, ENGINE, headToJSON, thin, trainHead, type TrainingSample } from './imageClassifier'
import { augmentLandmarks, modeOfEngine, ENGINE_BY_MODE, type Mode } from './mlFeatures'
import { mlLabApi } from './api'
import { deserializeClasses } from '@/components/mllab/types'

/**
 * Projects saved before models were stored (or never reopened since) have their examples but no trained model.
 * This trains the head from the saved examples and stores it, so the project can be used from the Vibe Lab / p5.js.
 */
export async function prepareModel(projectId: string): Promise<void> {
  const full = (await mlLabApi.get(projectId)).data
  const data = full.data as Record<string, any>
  const mode: Mode = data.mode ?? modeOfEngine(full.engine)
  if (mode === 'image' && data.engine !== ENGINE) {
    throw new Error('Questo progetto è stato creato con una versione precedente: aprilo una volta nel Lab ML per aggiornarlo.')
  }
  const ready = deserializeClasses(data).filter((cls) => cls.samples.length >= 2)
  if (ready.length < 2) throw new Error('Servono almeno due classi con almeno 2 esempi ciascuna: aprilo nel Lab ML e aggiungi esempi.')

  const samples: TrainingSample[] = []
  let group = 0
  ready.forEach((cls, classIndex) => thin(cls.samples, 60).forEach((sample) => {
    group += 1
    const variants = mode === 'image' ? sample.vectors.slice(1) : augmentLandmarks(sample.vectors[0], mode)
    ;[sample.vectors[0], ...variants].forEach((vector) => samples.push({ classIndex, group, vector }))
  }))
  const head = await trainHead(samples, ready.length, samples.length > 1200 ? 40 : mode === 'image' ? 90 : 60, mode === 'image' ? 'cosine' : 'zscore')
  const model = {
    version: 1, mode, threshold: CONFIDENCE_THRESHOLD,
    classes: ready.map((cls) => ({ id: cls.id, name: cls.name, color: cls.color })),
    head: headToJSON(head, ready.map((cls) => cls.id)),
  }
  await mlLabApi.update(projectId, {
    name: full.name, engine: full.engine || ENGINE_BY_MODE[mode], accuracy: full.accuracy, summary: full.classes, data: { ...data, model },
  })
}
