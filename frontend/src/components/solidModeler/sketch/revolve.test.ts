import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { revolveGeometry, profileSide } from './revolve'
import { mirrorEntities } from './edit2d'
import { analyzeSketch, cubicPoint, quadToCubic, splinePoints, tessellate, type SketchEntity } from './geom2d'
import type { ProfileRegion } from '../types'

const volume = (g: THREE.BufferGeometry) => {
  const p = g.getAttribute('position')
  let sum = 0
  for (let i = 0; i < p.count; i += 3) {
    const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, i + j))
    sum += v[0].dot(v[1].cross(v[2])) / 6
  }
  return sum
}
const ring: ProfileRegion = { outer: [[5, 0], [10, 0], [10, 4], [5, 4]] }

describe('revolve', () => {
  it('revolves a rectangle into a ring with the exact volume (Pappus)', () => {
    const v = volume(revolveGeometry([ring], { a: [0, 0], d: [0, 1] }, 360))
    expect(v).toBeCloseTo(Math.PI * (100 - 25) * 4, -1)
  })
  it('handles partial turns with caps, the other side of the axis and a different axis', () => {
    expect(Math.abs(volume(revolveGeometry([ring], { a: [0, 0], d: [0, 1] }, 180)))).toBeCloseTo((Math.PI * 75 * 4) / 2, -1)
    const mirrored: ProfileRegion = { outer: ring.outer.map(([x, y]) => [-x, y]) }
    expect(Math.abs(volume(revolveGeometry([mirrored], { a: [0, 0], d: [0, 1] }, 360)))).toBeCloseTo(Math.PI * 75 * 4, -1)
    expect(Math.abs(volume(revolveGeometry([ring], { a: [0, 0], d: [1, 0] }, 360)))).toBeCloseTo(Math.PI * 16 * 5, -1)
  })
  it('detects profiles that cross the axis', () => {
    expect(profileSide([ring], { a: [7, 0], d: [0, 1] })).toBe('crosses')
    expect(profileSide([ring], { a: [0, 0], d: [0, 1] })).toBe('right')
  })
})

describe('mirror and curves', () => {
  it('mirrors across a line and about a point, keeping or replacing the originals', () => {
    const ents: SketchEntity[] = [{ id: 'r', type: 'rect', a: [1, 1], b: [3, 2] }, { id: 'a', type: 'arc', c: [0, 5], r: 2, a0: 0, a1: Math.PI / 2 }]
    const m = mirrorEntities(ents, ['r', 'a'], { kind: 'line', a: [0, 0], d: [0, 1] })
    expect(m).toHaveLength(4)
    const r = m[2] as Extract<SketchEntity, { type: 'rect' }>
    expect(r.a).toEqual([-1, 1])
    const arc = m[3] as Extract<SketchEntity, { type: 'arc' }>
    const ends = tessellate(arc).pts
    expect(ends[0][0]).toBeCloseTo(0, 6) // old end (0,7) stays on the axis
    expect(ends[ends.length - 1][0]).toBeCloseTo(-2, 6)
    const pt = mirrorEntities(ents.slice(0, 1), [], { kind: 'point', p: [0, 0] }, false)
    expect(pt).toHaveLength(1)
    expect((pt[0] as Extract<SketchEntity, { type: 'rect' }>).a).toEqual([-1, -1])
  })
  it('mirrors a half profile into a closed shape', () => {
    const half: SketchEntity[] = [
      { id: 'a', type: 'line', a: [0, 0], b: [5, 0] }, { id: 'b', type: 'line', a: [5, 0], b: [5, 8] }, { id: 'c', type: 'line', a: [5, 8], b: [0, 8] },
    ]
    const full = mirrorEntities(half, [], { kind: 'line', a: [0, 0], d: [0, 1] })
    const regions = analyzeSketch(full).regions
    expect(regions).toHaveLength(1)
    expect(regions[0].area).toBeCloseTo(80, 6)
  })
  it('evaluates Bézier and spline curves through their end points', () => {
    const p: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [0, 10], [10, 10], [10, 0]]
    expect(cubicPoint(p, 0)).toEqual([0, 0])
    expect(cubicPoint(p, 1)).toEqual([10, 0])
    expect(cubicPoint(p, 0.5)[1]).toBeCloseTo(7.5, 9)
    const q = quadToCubic([0, 0], [5, 10], [10, 0])
    expect(cubicPoint(q, 0.5)[1]).toBeCloseTo(5, 9)
    const sp = splinePoints([[0, 0], [5, 4], [10, 0]])
    expect(sp[0]).toEqual([0, 0])
    expect(sp[sp.length - 1][0]).toBeCloseTo(10, 9)
    expect(sp.some(pt => Math.abs(pt[0] - 5) < 1e-6 && Math.abs(pt[1] - 4) < 1e-6)).toBe(true)
  })
})
