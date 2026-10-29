import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { editableEdges, edgeLength, objectGeometry, resizeEdge, unitGeometry, worldBox } from './geometry'
import type { PrimitiveObject } from './types'
const box = (): PrimitiveObject => ({ id: 'test', kind: 'box', name: 'Box', color: '#ffffff', hole: false, size: [20, 30, 40], position: [0, 0, 20], rotation: [0, 0, 0], params: {} })
const volume = (g: THREE.BufferGeometry) => {
  const mesh = g.index ? g.toNonIndexed() : g
  const p = mesh.getAttribute('position')
  let sum = 0
  for (let i = 0; i < p.count; i += 3) {
    const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, i + j))
    sum += v[0].dot(v[1].cross(v[2])) / 6
  }
  return Math.abs(sum)
}
describe('edge modeling', () => {
  it('creates the requested number of planar faces', () => {
    for (const faces of [4, 5, 7, 24, 64]) {
      const g = unitGeometry('polyhedron', { faces })
      const p = g.getAttribute('position')
      const planes = new Set<string>()
      for (let i = 0; i < p.count; i += 3) {
        const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, i + j))
        const n = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize()
        planes.add([...n.toArray(), n.dot(v[0])].map(x => (Math.abs(x) < 1e-4 ? 0 : x).toFixed(3)).join(','))
      }
      expect(planes.size).toBe(faces)
    }
  })
  it('updates the full axis dimension, preserves the floor and respects rotation', () => {
    const obj = box(); obj.rotation = [15, 25, 35]
    const edge = editableEdges(obj).find(e => Math.abs(e.a.z - e.b.z) > 0.9)!
    const next = resizeEdge(obj, edge, 80) as PrimitiveObject
    expect(edgeLength(next, edge)).toBeCloseTo(80)
    expect(next.size[0]).toBe(20)
    expect(next.size[1]).toBe(30)
    expect(next.size[2]).toBeCloseTo(80)
    expect(worldBox(next).min.z).toBeCloseTo(worldBox(obj).min.z)
  })
  it('scales oblique polyhedron edges proportionally', () => {
    const obj: PrimitiveObject = { ...box(), kind: 'polyhedron', params: { faces: 7 } }
    const edge = editableEdges(obj).find(e => Math.abs(e.a.z - e.b.z) > 0.9)!
    expect((resizeEdge(obj, edge, edgeLength(obj, edge) * 2) as PrimitiveObject).size).toEqual([40, 60, 80])
  })
  it.each(['polyhedron', 'pyramid', 'wedge', 'cylinder', 'cone'] as const)('keeps %s fillets finite, closed and inside the original solid', kind => {
    const obj: PrimitiveObject = { ...box(), kind, params: { faces: 7, sides: 8 } }
    const edge = editableEdges(obj)[0]
    const g = objectGeometry({ ...obj, params: { ...obj.params, edgeFillets: { [edge.id]: 1 } } })
    expect([...g.getAttribute('position').array].every(Number.isFinite)).toBe(true)
    expect(volume(g)).toBeGreaterThan(0)
    expect(volume(g)).toBeLessThan(volume(objectGeometry(obj)))
    const counts = new Map<string, number>()
    const positions = g.getAttribute('position')
    const key = (i: number) => [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => v.toFixed(5)).join(',')
    for (let i = 0; i < positions.count; i += 3) for (let j = 0; j < 3; j++) {
      const id = [key(i + j), key(i + (j + 1) % 3)].sort().join('|')
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect([...counts.values()].every(n => n === 2)).toBe(true)
  })
  it('rounds only the selected edge and keeps the other corners and stable identities', () => {
    const obj = box()
    const edge = editableEdges(obj).find(e => e.a.x === 0.5 && e.b.x === 0.5 && e.a.y === 0.5 && e.b.y === 0.5)!
    const next = { ...obj, params: { edgeFillets: { [edge.id]: 2 } } }
    const g = objectGeometry(next)
    expect(volume(g)).toBeLessThan(1)
    expect(volume(g)).toBeGreaterThan(0.98)
    const p = g.getAttribute('position')
    const vertices = Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i))
    expect(vertices.some(v => v.distanceTo(new THREE.Vector3(-0.5, -0.5, -0.5)) < 1e-5)).toBe(true)
    expect(vertices.some(v => v.distanceTo(new THREE.Vector3(0.5, 0.5, 0.5)) < 1e-5)).toBe(false)
    expect(editableEdges(next).map(e => e.id)).toEqual(editableEdges(obj).map(e => e.id))
    expect(volume(unitGeometry('box', {}))).toBeCloseTo(1)
  })
})
