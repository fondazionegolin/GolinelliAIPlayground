import { solidModelerApi } from '@/lib/api'
import { exportGLB } from './geometry'
import type { SceneObject } from './types'

const pending = new Map<string, Promise<void>>()

/**
 * Upload the GLB snapshot phones open in AR from the public link. Call it right after the scene
 * was saved: the server pairs the file with the saved scene and drops it once the scene changes.
 * Failures are silent — the public page then builds the model in the browser (WebXR / Quick Look only).
 */
export function publishArModel(modelId: string, objects: SceneObject[]): Promise<void> {
  const previous = pending.get(modelId) ?? Promise.resolve()
  const run = previous
    .then(async () => {
      if (!objects.some(o => !o.hole)) return
      await solidModelerApi.uploadAr(modelId, await exportGLB(objects))
    })
    .catch(err => console.warn('AR model upload failed', err))
  pending.set(modelId, run)
  return run
}
