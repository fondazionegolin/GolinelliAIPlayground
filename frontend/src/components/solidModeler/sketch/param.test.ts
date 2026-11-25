import { describe, expect, it } from 'vitest'
import { analyzeSketch, arcEnds, type SketchEntity } from './geom2d'
import { dragVertex, entitiesOfRegion, pushEdge } from './edit2d'

type L = Extract<SketchEntity, { type: 'line' }>
const line = (id: string, a: [number, number], b: [number, number]): SketchEntity => ({ id, type: 'line', a, b })
const box = (): SketchEntity[] => [line('b', [0, 0], [20, 0]), line('r', [20, 0], [20, 10]), line('t', [20, 10], [0, 10]), line('l', [0, 10], [0, 0])]
const area = (ents: SketchEntity[]) => analyzeSketch(ents).regions.reduce((s, r) => s + r.area, 0)

describe('parametric editing', () => {
  it('pushes the top edge of a rectangle made of lines: the shape stays closed and rectangular', () => {
    const out = pushEdge(box(), 't', [10, 10], [13, 15])
    const t = out.find(e => e.id === 't') as L
    expect(t.a).toEqual([20, 15])
    expect(t.b).toEqual([0, 15])
    expect(area(out)).toBeCloseTo(300, 6)
    expect(analyzeSketch(out).openEntityIds.size).toBe(0)
  })

  it('pushes a slanted edge keeping the neighbours direction (trapezoid)', () => {
    const tri: SketchEntity[] = [line('a', [0, 0], [10, 0]), line('b', [10, 0], [5, 10]), line('c', [5, 10], [0, 0])]
    const out = pushEdge(tri, 'a', [5, 0], [5, 2])
    const b = out.find(e => e.id === 'b') as L
    // b keeps its direction: its moved end lies on the original line from (5,10) to (10,0)
    expect(b.a[1]).toBeCloseTo(2, 9)
    expect(b.a[0]).toBeCloseTo(9, 9)
    expect(analyzeSketch(out).regions).toHaveLength(1)
  })

  it('drags a corner keeping horizontal / vertical lines straight', () => {
    const out = dragVertex(box(), [20, 10], [30, 18], true)
    expect(area(out)).toBeCloseTo(30 * 18, 6)
    const free = dragVertex(box(), [20, 10], [30, 18], false)
    expect(analyzeSketch(free).regions).toHaveLength(1)
    expect(area(free)).not.toBeCloseTo(30 * 18, 1)
  })

  it('resizes primitives and bends curves through the cursor', () => {
    const rect = pushEdge([{ id: 'r', type: 'rect', a: [0, 0], b: [10, 10] }], 'r', [10, 5], [14, 6])[0] as Extract<SketchEntity, { type: 'rect' }>
    expect(rect.b).toEqual([14, 10])
    const circle = pushEdge([{ id: 'c', type: 'circle', c: [0, 0], r: 5 }], 'c', [5, 0], [0, 8])[0] as Extract<SketchEntity, { type: 'circle' }>
    expect(circle.r).toBe(8)
    const arc = pushEdge([{ id: 'a', type: 'arc', c: [0, 0], r: 10, a0: 0, a1: Math.PI }], 'a', [0, 10], [0, 15])[0] as Extract<SketchEntity, { type: 'arc' }>
    const [s, t] = arcEnds(arc)
    expect([s, t].map(p => Math.round(p[0]))).toEqual(expect.arrayContaining([10, -10]))
    const poly = pushEdge([{ id: 'p', type: 'polyline', pts: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }], 'p', [5, 0], [5, -3])[0] as Extract<SketchEntity, { type: 'polyline' }>
    expect(poly.pts[0]).toEqual([0, -3])
    expect(poly.pts[1]).toEqual([10, -3])
  })

  it('moves a connected arc end with the line it is joined to', () => {
    const ents: SketchEntity[] = [line('l', [0, 0], [10, 0]), { id: 'a', type: 'arc', c: [10, 5], r: 5, a0: -Math.PI / 2, a1: Math.PI / 2 }]
    const out = dragVertex(ents, [10, 0], [12, 0])
    const [s] = arcEnds(out.find(e => e.id === 'a') as Extract<SketchEntity, { type: 'arc' }>)
    expect(Math.min(...[s].map(p => Math.hypot(p[0] - 12, p[1])))).toBeLessThan(1e-6)
  })

  it('finds every stroke bounding a clicked region', () => {
    const ents = [...box(), line('x', [40, 0], [50, 0])]
    const r = analyzeSketch(ents).regions[0]
    expect(entitiesOfRegion(ents, r.outer, r.holes).sort()).toEqual(['b', 'l', 'r', 't'])
  })
})
