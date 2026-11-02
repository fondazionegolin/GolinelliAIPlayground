import { describe, expect, it } from 'vitest'
import { applyAiOps, describeDoc, diffDocs, findFreeRect, graphFromFormula, makePath, normalizePath, plotGeometry, shapePath, unaliasOps } from './canvasAi'
import type { CanvasDoc } from './CollaborativeCanvas'

const doc: CanvasDoc = { type: 'canvas_v1', items: [
  { id: 'a', type: 'postit', x: 0, y: 0, w: 200, h: 150, text: 'Domanda', color: '#fef9c3' },
] }
let counter = 0
const ids = () => `id${++counter}`

describe('applyAiOps', () => {
  it('creates items with real ids, nests them in a frame and connects by the model\'s names', () => {
    const { doc: next, created, idMap } = applyAiOps(doc, [
      { kind: 'frame', id: 'f', x: 300, y: 0, w: 600, h: 400, text: 'Schema' },
      { kind: 'shape', id: 's1', shape: 'ellipse', x: 340, y: 60, w: 200, h: 100, text: 'Uno' },
      { kind: 'connect', from_id: 'a', to_id: 's1' },
    ], ids)
    expect(created).toHaveLength(3)
    expect(idMap.s1).toBeTruthy()
    const shape = next.items.find((i) => i.id === idMap.s1)!
    expect(shape.parentFrameId).toBe(idMap.f)
    const connector = next.items.find((i) => i.type === 'connector')!
    expect(connector).toMatchObject({ fromId: 'a', toId: idMap.s1, fromAnchor: 'right', toAnchor: 'left' })
  })

  it('updates, deletes with their connectors and ignores unknown targets', () => {
    const withConnector = applyAiOps(doc, [{ kind: 'note', id: 'n', x: 400, y: 0 }, { kind: 'connect', from_id: 'a', to_id: 'n' }], ids).doc
    const updated = applyAiOps(withConnector, [{ kind: 'update', target: 'a', text: 'Risposta', fill: '#dcfce7' }, { kind: 'delete', target: 'missing' }], ids).doc
    expect(updated.items.find((i) => i.id === 'a')).toMatchObject({ text: 'Risposta', color: '#dcfce7', ai: true })
    const removed = applyAiOps(updated, [{ kind: 'delete', target: 'a' }], ids).doc
    expect(removed.items.some((i) => i.type === 'connector')).toBe(false)
  })
})

describe('scene + diff', () => {
  it('aliases ids and translates ops back', () => {
    const { items, fromAlias } = describeDoc(doc)
    expect(items[0]).toMatchObject({ id: 'n1', type: 'note', text: 'Domanda' })
    expect(unaliasOps([{ kind: 'update', target: 'n1' }], fromAlias)[0].target).toBe('a')
  })

  it('reports what the user changed but not what the AI added', () => {
    const after: CanvasDoc = { type: 'canvas_v1', items: [
      { ...doc.items[0], text: 'Altra domanda' } as CanvasDoc['items'][number],
      { id: 'b', type: 'text', x: 0, y: 300, w: 200, h: 40, text: 'Mio testo', color: '#000' },
      { id: 'c', type: 'text', x: 0, y: 400, w: 200, h: 40, text: 'Dell AI', color: '#000', ai: true },
    ] }
    const changes = diffDocs(doc, after)
    expect(changes.some((c) => c.includes('modificato il testo') && c.includes('Domanda'))).toBe(true)
    expect(changes.some((c) => c.includes('Mio testo'))).toBe(true)
    expect(changes.some((c) => c.includes('Dell AI'))).toBe(false)
  })

  it('draws every shape as a closed path', () => {
    for (const shape of ['rect', 'rounded-rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'parallelogram'] as const) {
      expect(shapePath(shape, 200, 100)).toMatch(/Z$/)
    }
  })
})

describe('plot and curve', () => {
  it('plots y = 3x^2 + 3 as one self-drawing item with the vertex at (0, 3)', () => {
    const { doc: next } = applyAiOps({ type: 'canvas_v1', items: [] }, [
      { kind: 'plot', id: 'g', x: 0, y: 0, w: 520, h: 420, expr: '3x^2+3', x_min: -3, x_max: 3, y_min: -2, y_max: 12, marks: [{ x: 0, y: 3, label: '(0, 3)' }, { x: 1, y: 6, label: '(1, 6)' }] },
    ], ids)
    expect(next.items).toHaveLength(1)
    const plot = next.items[0]
    expect(plot.type).toBe('plot')
    if (plot.type !== 'plot') return
    const geo = plotGeometry(plot)
    const points = geo.curves.flat()
    expect(points.length).toBeGreaterThan(100)
    const vertex = points.reduce((a, b) => (b.y > a.y ? b : a))
    expect(Math.abs(vertex.x - (40 + (520 - 70) / 2))).toBeLessThan(6)
    expect(geo.marks.map((m) => m.label)).toEqual(['(0, 3)', '(1, 6)'])
    expect(geo.ticks.some((t) => t.text === '2')).toBe(true)
  })

  it('refuses an unreadable expression instead of drawing an empty chart', () => {
    const { created } = applyAiOps({ type: 'canvas_v1', items: [] }, [{ kind: 'plot', id: 'g', expr: 'foo(', x_min: -1, x_max: 1, y_min: -1, y_max: 1 }], ids)
    expect(created).toHaveLength(0)
  })

  it('draws a smooth curve through points', () => {
    const { doc: next } = applyAiOps({ type: 'canvas_v1', items: [] }, [{ kind: 'curve', id: 'c', points: [[0, 0], [50, 40], [100, 0], [150, 40]] }], ids)
    const path = next.items[0]
    expect(path.type === 'path' && path.points.length).toBeGreaterThan(20)
  })
})

describe('formulas and placement', () => {
  it('creates and updates formula items and describes them to the model', () => {
    const { doc: next, created } = applyAiOps({ type: 'canvas_v1', items: [] }, [
      { kind: 'formula', id: 'f', x: 0, y: 0, text: '\\frac{a}{b}', expr: 'y=a/b' },
    ], ids)
    expect(created).toHaveLength(1)
    const updated = applyAiOps(next, [{ kind: 'update', target: created[0], text: 'x^2' }], ids).doc
    expect(updated.items[0]).toMatchObject({ type: 'formula', latex: 'x^2', ai: true })
    expect(describeDoc(updated).items[0]).toMatchObject({ type: 'formula', text: 'x^2' })
  })

  it('graphs a plain-text function beside its formula, linked with an arrow', () => {
    const formula = { id: 'F', type: 'formula', x: 100, y: 100, w: 380, h: 84, latex: 'y=3x^{2}+3', src: 'y = 3x^2 + 3', fontSize: 28, color: '#000' } as const
    const made = graphFromFormula({ type: 'canvas_v1', items: [formula] }, formula, ids)!
    const [plot, connector] = made
    expect(plot).toMatchObject({ type: 'plot', expr: '3x^2 + 3' })
    expect(plot.type === 'plot' && plot.x).toBeGreaterThanOrEqual(formula.x + formula.w)
    expect(connector).toMatchObject({ type: 'connector', fromId: 'F' })
    expect(graphFromFormula({ type: 'canvas_v1', items: [] }, { ...formula, src: 'x^2+y^2=4' }, ids)).toBeNull()
  })

  it('finds free space next to the anchor and skips occupied sides', () => {
    const doc: CanvasDoc = { type: 'canvas_v1', items: [
      { id: 'a', type: 'postit', x: 0, y: 0, w: 200, h: 150, text: '', color: '#fff' },
      { id: 'b', type: 'postit', x: 240, y: 0, w: 200, h: 150, text: '', color: '#fff' },
    ] }
    const spot = findFreeRect(doc, { x: 0, y: 0, w: 200, h: 150 }, 300, 200)
    expect(spot).toEqual({ x: 0, y: 190 })
  })
})

describe('pen strokes are positioned items', () => {
  it('makePath boxes the stroke and keeps its points local', () => {
    const p = makePath('s', [{ x: 100, y: 50 }, { x: 140, y: 90 }, { x: 180, y: 60 }], '#000', 3)
    expect(p).toMatchObject({ type: 'path', x: 100, y: 50, w: 80, h: 40, ow: 80, oh: 40 })
    expect(p.type === 'path' && p.points[0]).toEqual({ x: 0, y: 0 })
  })

  it('migrates old absolute strokes (no box) and leaves new ones alone', () => {
    const legacy = { id: 'o', type: 'path', points: [{ x: 10, y: 20 }, { x: 30, y: 60 }], color: '#f00', width: 2 } as unknown as CanvasDoc['items'][number]
    const migrated = normalizePath(legacy)
    expect(migrated).toMatchObject({ x: 10, y: 20, w: 20, h: 40, color: '#f00' })
    expect(normalizePath(migrated)).toBe(migrated)
  })

  it('curve ops produce a movable stroke', () => {
    const { doc: next } = applyAiOps({ type: 'canvas_v1', items: [] }, [{ kind: 'curve', id: 'c', points: [[0, 0], [50, 40], [100, 0]] }], ids)
    expect(next.items[0]).toMatchObject({ type: 'path', x: expect.any(Number), w: expect.any(Number) })
  })
})
