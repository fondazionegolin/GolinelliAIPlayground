import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildNet, buildSolid, faceMatrices, faceNormal, flatNet, netOverlaps } from './solids'
import type { SolidShape } from './types'

const SHAPES: Array<[SolidShape, number, number]> = [  // shape, sides, faces
  ['cube', 4, 6], ['cuboid', 4, 6], ['tetrahedron', 3, 4], ['octahedron', 3, 8], ['dodecahedron', 3, 12], ['icosahedron', 3, 20],
  ['prism', 3, 5], ['prism', 6, 8], ['pyramid', 4, 5], ['pyramid', 8, 9], ['cylinder', 4, 50], ['cone', 4, 49],
]

describe('solids of the Lab', () => {
  it.each(SHAPES)('%s (%i sides) is a closed convex solid with outward faces', (shape, sides, count) => {
    const poly = buildSolid({ shape, sides, a: 2, b: 3, c: 4 })!
    expect(poly.faces).toHaveLength(count)
    const edges = new Set(poly.faces.flatMap(f => f.map((a, k) => [a, f[(k + 1) % f.length]].sort((x, y) => x - y).join('-'))))
    expect(poly.vertices.length - edges.size + poly.faces.length).toBe(2)  // Euler
    const center = new Vector3()
    poly.faces.forEach((f, i) => {
      const mid = f.reduce((s, idx) => s.add(new Vector3(...poly.vertices[idx])), new Vector3()).divideScalar(f.length)
      expect(faceNormal(poly, i).dot(mid.sub(center))).toBeGreaterThan(0)
    })
  })

  it.each(SHAPES)('%s (%i sides) opens into a flat net without overlaps', (shape, sides) => {
    const poly = buildSolid({ shape, sides, a: 2, b: 3, c: 4 })!
    const net = buildNet(poly, shape)
    expect(net.order).toHaveLength(poly.faces.length)
    expect(faceMatrices(poly, net, 0).every(m => m.equals(m.clone().identity()))).toBe(true)
    const flat = faceMatrices(poly, net, 1), root = faceNormal(poly, net.root)
    const rootPoint = new Vector3(...poly.vertices[poly.faces[net.root][0]])
    poly.faces.forEach((f, i) => f.forEach(idx => {
      const p = new Vector3(...poly.vertices[idx]).applyMatrix4(flat[i])
      expect(Math.abs(p.sub(rootPoint).dot(root))).toBeLessThan(1e-6)
    }))
    expect(netOverlaps(poly, net)).toBe(false)
    // Hinges keep lengths: every face keeps its shape on the plane.
    const before = poly.faces.map(f => new Vector3(...poly.vertices[f[0]]).distanceTo(new Vector3(...poly.vertices[f[1]])))
    flatNet(poly, net).forEach((p, i) => expect(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1])).toBeCloseTo(before[i], 6))
  })

  it('sizes are the ones asked for', () => {
    const edge = (shape: SolidShape) => { const p = buildSolid({ shape, sides: 3, a: 5, b: 1, c: 1 })!; const f = p.faces[0]
      return new Vector3(...p.vertices[f[0]]).distanceTo(new Vector3(...p.vertices[f[1]])) }
    for (const shape of ['tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron', 'cube'] as SolidShape[]) expect(edge(shape)).toBeCloseTo(5, 6)
    const pyramid = buildSolid({ shape: 'pyramid', sides: 4, a: 2, b: 1, c: 7 })!
    const ys = pyramid.vertices.map(v => v[1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(7, 6)
    expect(buildSolid({ shape: 'sphere', sides: 3, a: 1, b: 1, c: 1 })).toBeNull()
  })
})
