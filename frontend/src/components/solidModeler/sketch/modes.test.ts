import { describe, expect, it } from 'vitest'
import { DEFAULT_MODES, drawNeed, drawPreview } from './drawModes'
import { inferPoint } from './infer'
import { tessellate, type SketchEntity } from './geom2d'

const modes = (o: Partial<typeof DEFAULT_MODES>) => ({ ...DEFAULT_MODES, ...o })

describe('draw modes', () => {
  it('needs the right number of clicks per mode', () => {
    expect(drawNeed('rect', modes({}))).toBe(2)
    expect(drawNeed('rect', modes({ rect: 'three' }))).toBe(3)
    expect(drawNeed('circle', modes({ circle: 'three' }))).toBe(3)
    expect(drawNeed('arc', modes({}))).toBe(3)
    expect(drawNeed('curve', modes({}))).toBe(4)
    expect(drawNeed('curve', modes({ curve: 'spline' }))).toBe('chain')
  })
  it('previews a rectangle from the centre, a circle by diameter and by three points', () => {
    const r = drawPreview('rect', modes({ rect: 'center' }), [[0, 0]], [6, 4], [null, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'rect' }>
    expect(r.a).toEqual([-6, -4])
    expect(r.b).toEqual([6, 4])
    const c = drawPreview('circle', modes({ circle: 'diameter' }), [[0, 0]], [10, 0], [null, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'circle' }>
    expect(c.c).toEqual([5, 0])
    expect(c.r).toBe(5)
    const three = drawPreview('circle', modes({ circle: 'three' }), [[10, 0], [0, 10]], [-10, 0], [null, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'circle' }>
    expect(three.r).toBeCloseTo(10, 9)
    const fixed = drawPreview('circle', modes({}), [[0, 0]], [3, 4], [8, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'circle' }>
    expect(fixed.r).toBe(4)
  })
  it('tilted rectangle gets a typed width and arcs follow their mode', () => {
    const p = drawPreview('rect', modes({ rect: 'three' }), [[0, 0], [10, 0]], [3, 99], [5, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'polyline' }>
    expect(p.pts[2]).toEqual([10, 5])
    const through = drawPreview('arc', modes({ arc: 'through' }), [[0, 0], [5, 5]], [10, 0], [null, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'arc' }>
    expect(through.r).toBeCloseTo(5, 9)
    const pts = tessellate(through).pts
    expect(pts.some(q => Math.abs(q[0] - 5) < 0.05 && Math.abs(q[1] - 5) < 0.05)).toBe(true)
    const center = drawPreview('arc', modes({ arc: 'center' }), [[0, 0], [5, 0]], [0, 5], [null, null], 6)!.ents[0] as Extract<SketchEntity, { type: 'arc' }>
    expect(center.r).toBe(5)
    expect(center.a1 - center.a0).toBeCloseTo(Math.PI / 2, 9)
  })
  it('previews Bézier and spline curves with their control polygon', () => {
    const b = drawPreview('curve', modes({}), [[0, 0], [0, 10], [10, 10]], [10, 0], [null, null], 6)!
    expect((b.ents[0] as Extract<SketchEntity, { type: 'bezier' }>).pts[3]).toEqual([10, 0])
    expect(b.guides).toHaveLength(2)
    expect(drawPreview('curve', modes({ curve: 'spline' }), [[0, 0], [5, 5]], [10, 0], [null, null], 6)!.ents[0].type).toBe('spline')
  })
})

describe('constrained inference', () => {
  const rect: SketchEntity[] = [{ id: 'r', type: 'rect', a: [0, 0], b: [20, 10] }]
  it('aligns with a vertex in X and Y and returns the corner', () => {
    const r = inferPoint([20.3, 25.2], null, rect, 1)
    expect(r.best!.p).toEqual([20, 25.2]) // only the X alignment with the vertex applies
    expect(inferPoint([40, 25], null, rect, 1).best).toBeNull()
    const both = inferPoint([20.4, 10.5], [0, 30], rect, 1)
    expect(both.best!.p).toEqual([20, 10])
  })
  it('suggests horizontal / vertical from the previous point and the crossing with a vertex alignment', () => {
    const r = inferPoint([20.3, 29.8], [0, 30], rect, 1)
    expect(r.best!.p[0]).toBeCloseTo(20, 9)
    expect(r.best!.p[1]).toBeCloseTo(30, 9)
    expect(r.best!.label.toLowerCase()).toContain('orizzontale')
    expect(r.suggestions.some(p => p[0] === 20 && p[1] === 30)).toBe(true)
  })
  it('snaps parallel / perpendicular to an existing edge and to the perpendicular foot', () => {
    const edge: SketchEntity[] = [{ id: 'l', type: 'line', a: [0, 0], b: [10, 10] }]
    const par = inferPoint([10.2, 20.4], [0, 10], edge, 1)
    expect(par.best!.p[0]).toBeCloseTo(par.best!.p[1] - 10, 6)
    const foot = inferPoint([5.1, 4.9], [0, 10], edge, 1)
    expect(foot.best!.p[0]).toBeCloseTo(5, 9)
    expect(foot.best!.p[1]).toBeCloseTo(5, 9)
  })
})

import { entityInRect } from './edit2d'
describe('rectangle selection', () => {
  const r = { min: [0, 0] as [number, number], max: [10, 10] as [number, number] }
  it('window needs the whole entity inside, crossing only a touch', () => {
    const inside: SketchEntity = { id: 'i', type: 'line', a: [1, 1], b: [9, 9] }
    const cutting: SketchEntity = { id: 'c', type: 'line', a: [-5, 5], b: [5, 5] }
    const outside: SketchEntity = { id: 'o', type: 'line', a: [20, 20], b: [30, 30] }
    const through: SketchEntity = { id: 't', type: 'line', a: [-5, 5], b: [15, 5] }
    expect([inside, cutting, outside, through].map(e => entityInRect(e, r, false))).toEqual([true, false, false, false])
    expect([inside, cutting, outside, through].map(e => entityInRect(e, r, true))).toEqual([true, true, false, true])
    expect(entityInRect({ id: 'p', type: 'point', p: [5, 5] }, r, false)).toBe(true)
  })
})
