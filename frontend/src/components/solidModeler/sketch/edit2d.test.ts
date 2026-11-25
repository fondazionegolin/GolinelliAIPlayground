import { describe, expect, it } from 'vitest'
import { analyzeSketch, type SketchEntity } from './geom2d'
import { cornerCandidates, filletCorner, segmentMidpoint, trimEntity } from './edit2d'

const line = (id: string, a: [number, number], b: [number, number]): SketchEntity => ({ id, type: 'line', a, b })
const area = (ents: SketchEntity[]) => analyzeSketch(ents).regions.reduce((s, r) => s + r.area, 0)

describe('trim', () => {
  it('trims a line between two crossings', () => {
    const ents = [line('h', [0, 0], [30, 0]), line('v1', [10, -5], [10, 5]), line('v2', [20, -5], [20, 5])]
    const r = trimEntity(ents, 'h', [15, 0])!
    const lines = r.entities.filter(e => e.type === 'line' && e.id !== 'v1' && e.id !== 'v2') as Extract<SketchEntity, { type: 'line' }>[]
    expect(lines).toHaveLength(2)
    expect(lines.map(l => [l.a[0], l.b[0]].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0])).toEqual([[0, 10], [20, 30]])
  })

  it('deletes a line without intersections and trims the end part of one with a single crossing', () => {
    expect(trimEntity([line('a', [0, 0], [5, 0])], 'a', [2, 0])!.entities).toHaveLength(0)
    const r = trimEntity([line('h', [0, 0], [30, 0]), line('v', [10, -5], [10, 5])], 'h', [25, 0])!
    const h = r.entities.find(e => e.type === 'line' && e.id !== 'v') as Extract<SketchEntity, { type: 'line' }>
    expect(Math.max(h.a[0], h.b[0])).toBeCloseTo(10, 6)
  })

  it('splits a rectangle into lines and trims the clicked side', () => {
    const ents: SketchEntity[] = [{ id: 'r', type: 'rect', a: [0, 0], b: [10, 10] }, line('x', [5, -5], [5, 5])]
    const r = trimEntity(ents, 'r', [2, 0])!
    expect(r.entities.filter(e => e.type === 'line')).toHaveLength(5)
    expect(analyzeSketch(r.entities).regions).toHaveLength(0)
  })

  it('trims a circle between two lines into an arc', () => {
    const ents: SketchEntity[] = [{ id: 'c', type: 'circle', c: [0, 0], r: 10 }, line('l1', [-20, 5], [20, 5]), line('l2', [-20, -5], [20, -5])]
    const r = trimEntity(ents, 'c', [10, 0])!
    const arcs = r.entities.filter(e => e.type === 'arc')
    expect(arcs).toHaveLength(1)
    expect(r.entities.some(e => e.type === 'circle')).toBe(false)
  })
})

describe('fillet', () => {
  const rect: SketchEntity[] = [{ id: 'r', type: 'rect', a: [0, 0], b: [10, 10] }]
  it('rounds one corner with the exact radius and tangent endpoints', () => {
    const f = filletCorner(rect, [0, 0], 2)!
    const arc = f.entities.find(e => e.type === 'arc') as Extract<SketchEntity, { type: 'arc' }>
    expect(arc.r).toBeCloseTo(2, 9)
    expect(arc.c[0]).toBeCloseTo(2, 9)
    expect(arc.c[1]).toBeCloseTo(2, 9)
    expect(area(f.entities)).toBeCloseTo(100 - 4 * (1 - Math.PI / 4), 1)
    expect(f.clamped).toBe(false)
  })
  it('rounds every corner of an outline and clamps radii that do not fit', () => {
    expect(area(filletCorner(rect, [0, 0], 2, true)!.entities)).toBeCloseTo(100 - 4 * 4 * (1 - Math.PI / 4), 0)
    const big = filletCorner(rect, [0, 0], 50, true)!
    expect(big.clamped).toBe(true)
    expect(big.count).toBe(4)
  })
  it('finds corners and midpoints', () => {
    expect(cornerCandidates(rect)).toHaveLength(4)
    expect(segmentMidpoint(rect[0], [5, 0.5])).toEqual([5, 0])
    expect(segmentMidpoint(line('l', [0, 0], [4, 2]), [0, 0])).toEqual([2, 1])
  })
})
