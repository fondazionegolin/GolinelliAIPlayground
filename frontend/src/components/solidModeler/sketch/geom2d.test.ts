import { describe, expect, it } from 'vitest'
import { analyzeSketch, arcThrough, arcWithRadius, chainFrom, offsetLoop, signedArea, thickenPath, type P, type SketchEntity } from './geom2d'

const line = (id: string, a: [number, number], b: [number, number]): SketchEntity => ({ id, type: 'line', a, b })

describe('closed profile detection', () => {
  it('finds a rectangle drawn with four lines and no open strokes', () => {
    const a = analyzeSketch([line('1', [0, 0], [10, 0]), line('2', [10, 0], [10, 5]), line('3', [10, 5], [0, 5]), line('4', [0, 5], [0, 0])])
    expect(a.regions).toHaveLength(1)
    expect(a.regions[0].area).toBeCloseTo(50, 6)
    expect(a.openEntityIds.size).toBe(0)
    expect(a.openPoints).toHaveLength(0)
  })

  it('refuses open shapes and reports their free ends', () => {
    const a = analyzeSketch([line('1', [0, 0], [10, 0]), line('2', [10, 0], [10, 5]), line('3', [10, 5], [0, 5])])
    expect(a.regions).toHaveLength(0)
    expect(a.openEntityIds.size).toBe(3)
    expect(a.openPoints).toHaveLength(2)
  })

  it('treats a circle inside a rectangle as a hole of the outer region', () => {
    const a = analyzeSketch([{ id: 'r', type: 'rect', a: [-20, -10], b: [20, 10] }, { id: 'c', type: 'circle', c: [0, 0], r: 4 }])
    expect(a.regions).toHaveLength(2)
    const outer = a.regions.find(r => r.holes.length === 1)!
    expect(outer.area).toBeCloseTo(800 - Math.PI * 16, 0)
  })

  it('splits overlapping shapes into minimal regions (two crossing circles = 3 regions)', () => {
    const a = analyzeSketch([{ id: 'a', type: 'circle', c: [0, 0], r: 10 }, { id: 'b', type: 'circle', c: [10, 0], r: 10 }])
    expect(a.regions).toHaveLength(3)
  })

  it('closes a region with a line crossing a rectangle and keeps the dangling tail open', () => {
    const a = analyzeSketch([{ id: 'r', type: 'rect', a: [0, 0], b: [10, 10] }, line('l', [5, -5], [5, 15])])
    expect(a.regions).toHaveLength(2)
    expect(a.regions.map(r => r.area).sort()).toEqual([50, 50].map(v => expect.closeTo(v, 6)) as unknown as number[])
    expect(a.openPoints).toHaveLength(2)
  })

  it('accepts a profile made of lines and an arc', () => {
    const arc = arcThrough('a', [10, 0], [0, 0], [5, -5])!
    const a = analyzeSketch([line('1', [0, 0], [0, 10]), line('2', [0, 10], [10, 10]), line('3', [10, 10], [10, 0]), arc])
    expect(a.regions).toHaveLength(1)
    expect(a.regions[0].area).toBeCloseTo(100 + (Math.PI * 25) / 2, 0)
  })
})

describe('arcs', () => {
  it('builds an arc with an exact radius on the requested side', () => {
    const arc = arcWithRadius('a', [0, 0], [10, 0], [5, 3], 8)!
    expect(arc.r).toBeCloseTo(8, 9)
    const mid = (arc.a0 + ((arc.a1 - arc.a0 + Math.PI * 4) % (Math.PI * 2)) / 2)
    expect(arc.c[1] + arc.r * Math.sin(mid)).toBeGreaterThan(0)
  })
})

describe('offset', () => {
  it('grows a square keeping sharp corners', () => {
    const loops = offsetLoop([[0, 0], [10, 0], [10, 10], [0, 10]], 2)
    expect(loops).toHaveLength(1)
    expect(Math.abs(signedArea(loops[0]))).toBeCloseTo(196, 6)
  })

  it('shrinks a square and drops it when the offset is too large', () => {
    expect(Math.abs(signedArea(offsetLoop([[0, 0], [10, 0], [10, 10], [0, 10]], -2)[0]))).toBeCloseTo(36, 6)
    expect(offsetLoop([[0, 0], [10, 0], [10, 10], [0, 10]], -6)).toHaveLength(0)
  })

  it('shrinks an L shape without self-intersections', () => {
    const L: [number, number][] = [[0, 0], [20, 0], [20, 4], [4, 4], [4, 20], [0, 20]]
    const loops = offsetLoop(L, -1)
    expect(loops).toHaveLength(1)
    const outer = offsetLoop(L, 1)
    expect(outer).toHaveLength(1)
    expect(Math.abs(signedArea(outer[0]))).toBeGreaterThan(Math.abs(signedArea(L)))
  })

  it('thickens an open path into a closed band', () => {
    const loops = thickenPath([[0, 0], [10, 0], [10, 10]], 2)
    expect(loops).toHaveLength(1)
    expect(Math.abs(signedArea(loops[0]))).toBeCloseTo(40, 0)
  })
})

describe('chains', () => {
  it('follows connected lines in both directions and detects closure', () => {
    const ents = [line('1', [0, 0], [10, 0]), line('2', [10, 0], [10, 5]), line('3', [0, 5], [10, 5]), line('4', [0, 5], [0, 0])]
    const c = chainFrom(ents, '2')!
    expect(c.closed).toBe(true)
    expect(c.ids.sort()).toEqual(['1', '2', '3', '4'])
    const open = chainFrom(ents.slice(0, 3), '1')!
    expect(open.closed).toBe(false)
    expect(open.pts).toHaveLength(4)
  })
})

describe('analyzeSketch with face boundary', () => {
  // Face 40 x 100 (the box top); two arcs rounding the top and bottom, ending on the sides.
  const face: [P, P][] = [[[-20, -50], [20, -50]], [[20, -50], [20, 50]], [[20, 50], [-20, 50]], [[-20, 50], [-20, -50]]]
  const r = 25
  const top: SketchEntity = { id: 'a1', type: 'arc', c: [0, 24], r, a0: Math.acos(20 / r), a1: Math.PI - Math.acos(20 / r) }
  const bottom: SketchEntity = { id: 'a2', type: 'arc', c: [0, -24], r, a0: Math.PI + Math.acos(20 / r), a1: 2 * Math.PI - Math.acos(20 / r) }

  it('open arcs alone close nothing', () => {
    expect(analyzeSketch([top, bottom]).regions).toHaveLength(0)
  })

  it('arcs plus the face edges give the rounded body and the cut-off corners, never the bare face', () => {
    const an = analyzeSketch([top, bottom], face)
    expect(an.regions.length).toBeGreaterThanOrEqual(3)
    expect(an.openEntityIds.size).toBe(0)
    const areas = an.regions.map(x => x.area).sort((a, b) => b - a)
    expect(areas[0]).toBeGreaterThan(2500)
    // The whole face (4000 mm²) is not a region of the sketch: it contains no stroke of its own.
    expect(an.regions.every(x => x.area < 4000 - 1)).toBe(true)
  })
})
