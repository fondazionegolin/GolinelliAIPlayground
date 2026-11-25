import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { objectGeometry, objectMatrix, worldBox } from '../geometry'
import type { SceneObject } from '../types'
import { isPendingFeature, materializeFeatures } from './plane'
import pen from './__fixtures__/agent-pen.json'

const volume = (o: SceneObject) => {
  const g = objectGeometry(o)
  const mesh = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(objectMatrix(o))
  const p = mesh.getAttribute('position')
  let sum = 0
  for (let i = 0; i < p.count; i += 3) {
    const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, i + j))
    sum += v[0].dot(v[1].cross(v[2])) / 6
  }
  return Math.abs(sum)
}

describe('scene built by the AI agent with sketches', () => {
  it('rebuilds the exact revolved pen body, its carved reservoir and the extruded clip', () => {
    const scene = pen as unknown as SceneObject[]
    const before = scene.filter(o => o.kind === 'group' ? o.children.some(isPendingFeature) : isPendingFeature(o)).length
    expect(before).toBe(2)
    const out = materializeFeatures(scene)
    expect(out.some(o => (o.kind === 'group' ? o.children.some(isPendingFeature) : isPendingFeature(o)))).toBe(false)
    const body = out.find(o => o.id === 'penna')!
    const box = worldBox(body)
    expect(box.min.z).toBeCloseTo(0, 0)
    expect(box.max.z).toBeCloseTo(130, 0)
    expect(box.max.x).toBeLessThan(7.6)
    expect(box.max.x).toBeGreaterThan(6.4)
    // reservoir (r = 3, h = 100) carved from the body
    const solid = out.find(o => o.id === 'penna')!
    const children = solid.kind === 'group' ? solid.children : []
    const outer = volume({ ...children.find(c => c.id === 'corpo')!, position: children.find(c => c.id === 'corpo')!.position })
    expect(outer - volume(solid)).toBeGreaterThan(Math.PI * 9 * 100 * 0.85)
    const clip = out.find(o => o.id === 'clip')!
    const cb = worldBox(clip)
    expect(cb.min.x).toBeGreaterThan(5)
    expect(cb.max.z).toBeCloseTo(125, 0)
    expect(volume(clip)).toBeCloseTo(3 * 45 * 2, -1)
  })
})
