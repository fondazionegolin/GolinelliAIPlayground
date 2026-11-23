import { describe, expect, it } from 'vitest'
import { areaContext, inPolygon, layoutAreaCallouts, pointsBox, thin } from './canvasArea'
import type { CanvasDoc, CanvasItem } from './CollaborativeCanvas'

const square = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }]
let n = 0
const id = () => `c${++n}`

describe('canvasArea', () => {
  it('box and point-in-polygon', () => {
    expect(pointsBox(square)).toEqual({ x: 100, y: 100, w: 200, h: 200 })
    expect(inPolygon({ x: 200, y: 200 }, square)).toBe(true)
    expect(inPolygon({ x: 350, y: 200 }, square)).toBe(false)
    expect(thin([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }], 5)).toHaveLength(2)
  })

  it('lays flags in the side margins, ordered by height, never overlapping', () => {
    const box = pointsBox(square)
    const labels = [{ name: 'A', note: 'x', x: 10, y: 10 }, { name: 'B', note: 'y', x: 15, y: 12 }, { name: 'C', x: 90, y: 50 }]
    const { items, created } = layoutAreaCallouts([], box, labels, id)
    expect(created).toHaveLength(3)
    const flags = items.filter((i) => i.type === 'callout')
    for (const f of flags) expect(f.x + f.w <= box.x - 40 || f.x >= box.x + box.w + 40).toBe(true)
    const left = flags.filter((f) => f.x < box.x).sort((a, b) => a.y - b.y)
    for (let i = 1; i < left.length; i += 1) expect(left[i].y).toBeGreaterThanOrEqual(left[i - 1].y + left[i - 1].h)
    const a = flags.find((f) => f.type === 'callout' && f.text.startsWith('A'))!
    expect(a.type === 'callout' && a.tx).toBeCloseTo(120)
    expect(a.type === 'callout' && a.ty).toBeCloseTo(120)
  })

  it('attaches a flag to the image under its point', () => {
    const image: CanvasItem = { id: 'img', type: 'image', x: 100, y: 100, w: 200, h: 200, src: 'x' }
    const { items } = layoutAreaCallouts([image], pointsBox(square), [{ name: 'P', x: 50, y: 25 }], id)
    const flag = items.find((i) => i.type === 'callout')!
    expect(flag.type === 'callout' && flag.imageId).toBe('img')
    expect(flag.type === 'callout' && flag.rx).toBeCloseTo(0.5)
    expect(flag.type === 'callout' && flag.ry).toBeCloseTo(0.25)
  })

  it('describes nearby elements for the model', () => {
    const doc: CanvasDoc = { type: 'canvas_v1', items: [{ id: 'p', type: 'postit', x: 150, y: 150, w: 100, h: 80, text: 'Resistenza da 220 ohm', color: '#fff' } as CanvasItem] }
    expect(areaContext(doc, pointsBox(square), square)).toContain('Resistenza da 220 ohm')
  })
})
