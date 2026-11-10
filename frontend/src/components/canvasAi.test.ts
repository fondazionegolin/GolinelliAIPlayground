import { describe, expect, it } from 'vitest'
import { applyAiOps, describeDoc, diffDocs, findFreeRect, graphFromFormula, makePath, normalizePath, plotGeometry, shapePath, unaliasOps } from './canvasAi'
import type { CanvasDoc } from './CollaborativeCanvas'
import { isToneStroke, shapeStrokeFor } from './canvasColors'

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

describe('brainstorming ops', () => {
  const note = (id: string, x: number, y: number, text: string, parentFrameId?: string) =>
    ({ id, type: 'postit' as const, x, y, w: 200, h: 150, text, color: '#fef9c3', ...(parentFrameId ? { parentFrameId } : {}) })

  it('regroups ideas into one section per theme without overlaps, where they were', () => {
    const board: CanvasDoc = { type: 'canvas_v1', items: [note('a', 0, 0, 'aule all’aperto'), note('b', 260, 0, 'orari flessibili'), note('c', 520, 0, 'angoli lettura'), note('d', 0, 200, 'pause lunghe')] }
    const { doc: next, created, idMap } = applyAiOps(board, [
      { kind: 'cluster', id: 'spazi', text: 'Spazi', summary: 'Ambienti più aperti', members: ['a', 'c', 'missing'] },
      { kind: 'cluster', id: 'tempo', text: 'Tempo', members: ['b', 'd', 'a'] },
      { kind: 'connect', from_id: 'spazi', to_id: 'tempo' },
    ], ids)
    const spazi = next.items.find((i) => i.id === idMap.spazi)!
    const tempo = next.items.find((i) => i.id === idMap.tempo)!
    expect(spazi).toMatchObject({ type: 'frame', text: 'Spazi', x: 0, y: 0 })
    expect(next.items.filter((i) => i.type === 'postit').map((i) => [i.id, i.parentFrameId])).toEqual([['a', idMap.spazi], ['b', idMap.tempo], ['c', idMap.spazi], ['d', idMap.tempo]])
    expect(next.items.some((i) => i.type === 'text' && i.text === 'Ambienti più aperti' && i.parentFrameId === idMap.spazi)).toBe(true)
    expect(next.items.some((i) => i.type === 'connector' && i.fromId === idMap.spazi && i.toId === idMap.tempo)).toBe(true)
    expect(created).toContain(idMap.tempo)
    // Members sit inside their section, below its title, and sections do not overlap.
    const inside = (child: { x: number; y: number; w: number; h: number }, f: { x: number; y: number; w: number; h: number }) =>
      child.x >= f.x && child.y >= f.y + 40 && child.x + child.w <= f.x + f.w && child.y + child.h <= f.y + f.h
    for (const n of next.items.filter((i) => i.type === 'postit')) {
      const frame = next.items.find((f) => f.id === n.parentFrameId)!
      if (n.type === 'postit' && frame.type === 'frame') expect(inside(n, frame)).toBe(true)
    }
    if (spazi.type === 'frame' && tempo.type === 'frame') expect(spazi.x + spazi.w).toBeLessThanOrEqual(tempo.x)
  })

  it('regroups inside the section the ideas came from, growing it when needed', () => {
    const board: CanvasDoc = { type: 'canvas_v1', items: [
      { id: 'box', type: 'frame', x: 1000, y: 1000, w: 300, h: 300, text: 'Idee', color: '#3ea9f4' },
      note('a', 1020, 1060, 'uno', 'box'), note('b', 1020, 1100, 'due', 'box'), note('c', 1040, 1120, 'tre', 'box'),
      note('far', -2000, 0, 'altro'),
    ] }
    const { doc: next, idMap } = applyAiOps(board, [{ kind: 'cluster', id: 'x', text: 'X', members: ['a', 'b'] }, { kind: 'cluster', id: 'y', text: 'Y', members: ['c'] }], ids)
    const box = next.items.find((i) => i.id === 'box')!
    const x = next.items.find((i) => i.id === idMap.x)!
    expect(x).toMatchObject({ parentFrameId: 'box', x: 1030, y: 1070 })
    if (box.type === 'frame' && x.type === 'frame') expect(box.x + box.w).toBeGreaterThanOrEqual(x.x + x.w)
    expect(next.items.find((i) => i.id === 'far')).toMatchObject({ x: -2000, y: 0 })
  })

  it('regrouping again reuses the existing theme sections instead of adding new ones', () => {
    const board: CanvasDoc = { type: 'canvas_v1', items: [note('a', 0, 0, 'aule all’aperto'), note('b', 260, 0, 'orari flessibili'), note('c', 520, 0, 'angoli lettura')] }
    const first = applyAiOps(board, [
      { kind: 'cluster', id: 'spazi', text: 'Spazi', summary: 'Ambienti aperti', members: ['a', 'c'] },
      { kind: 'cluster', id: 'tempo', text: 'Tempo', members: ['b'] },
    ], ids)
    const spaziId = first.idMap.spazi, tempoId = first.idMap.tempo
    const withNew: CanvasDoc = { ...first.doc, items: [...first.doc.items, note('d', 3000, 3000, 'giardino didattico'), note('e', 3300, 3000, 'pause lunghe'), note('f', 3600, 3000, 'laboratorio musica')] }
    const second = applyAiOps(withNew, [
      { kind: 'cluster', target: spaziId, text: 'Spazi', summary: 'Ambienti aperti e verdi', members: ['d'] },
      { kind: 'cluster', id: 'x', text: 'tempo', members: ['e'] },  // no target, same name: still reused
      { kind: 'cluster', id: 'arte', text: 'Arte', members: ['f'] },
    ], ids)
    const frames = second.doc.items.filter((i) => i.type === 'frame')
    expect(frames.map((f) => f.id).sort()).toEqual([spaziId, tempoId, second.idMap.arte].sort())
    expect(second.idMap.x).toBe(tempoId)
    const parentOf = (id: string) => second.doc.items.find((i) => i.id === id)!.parentFrameId
    expect(['a', 'c', 'd'].map(parentOf)).toEqual([spaziId, spaziId, spaziId])
    expect(['b', 'e'].map(parentOf)).toEqual([tempoId, tempoId])
    const summaries = second.doc.items.filter((i) => i.type === 'text')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ text: 'Ambienti aperti e verdi', parentFrameId: spaziId, role: 'cluster-summary' })
    expect(second.doc.items.find((i) => i.id === spaziId)).toMatchObject({ x: 0, y: 0 })
  })

  it('drops a theme section emptied by a regrouping', () => {
    const first = applyAiOps({ type: 'canvas_v1', items: [note('a', 0, 0, 'uno'), note('b', 260, 0, 'due')] },
      [{ kind: 'cluster', id: 'p', text: 'P', summary: 'sp', members: ['a'] }, { kind: 'cluster', id: 'q', text: 'Q', members: ['b'] }], ids)
    const second = applyAiOps(first.doc, [{ kind: 'cluster', target: first.idMap.q, text: 'Q', members: ['a', 'b'] }], ids)
    expect(second.doc.items.filter((i) => i.type === 'frame').map((f) => f.id)).toEqual([first.idMap.q])
    expect(second.doc.items.some((i) => i.type === 'text')).toBe(false)
  })

  it('places a generated illustration with its caption below; without an image nothing is added', () => {
    const { doc: next, idMap } = applyAiOps(doc, [
      { kind: 'illustration', id: 'ill', x: 400, y: 0, brief: 'un ponte', text: 'Collegare scuola e città', src: 'data:image/jpeg;base64,AAAA' },
      { kind: 'illustration', id: 'nope', x: 900, y: 0, brief: 'manca', text: 'x' },
    ], ids)
    expect(next.items.find((i) => i.id === idMap.ill)).toMatchObject({ type: 'image', x: 400, y: 0, w: 480, h: 320 })
    expect(next.items.find((i) => i.type === 'text')).toMatchObject({ text: 'Collegare scuola e città', x: 400, y: 332, w: 480 })
    expect(idMap.nope).toBeUndefined()
  })

  it('translates cluster members from aliases', () => {
    expect(unaliasOps([{ kind: 'cluster', id: 'c', text: 'T', members: ['n1', 'n2'] }], { n1: 'real1', n2: 'real2' })[0].members).toEqual(['real1', 'real2'])
  })
})

describe('interactive cards and tone-on-tone shapes', () => {
  it('builds quiz, flashcard and check cards and drops a quiz without a valid answer', () => {
    const { doc: out, created } = applyAiOps({ type: 'canvas_v1', items: [] }, [
      { kind: 'quiz', id: 'q', x: 0, y: 0, text: 'Quanto fa 2+2?', options: ['3', '4'], correct: [1], explanation: 'Somma' },
      { kind: 'quiz', id: 'bad', x: 0, y: 0, text: '?', options: ['a', 'b'], correct: [5] },
      { kind: 'flashcard', id: 'f', x: 400, y: 0, text: 'Fotosintesi', back: 'Luce → zuccheri' },
      { kind: 'check', id: 'c', x: 800, y: 0, text: 'Perché?', expected: 'Perché sì' },
    ], ids)
    expect(created).toHaveLength(3)
    expect(out.items.map((i) => i.type)).toEqual(['quiz', 'flashcard', 'check'])
    const quiz = out.items[0]
    expect(quiz.type === 'quiz' && quiz.correct).toEqual([1])
    expect(describeDoc(out).items[0].detail).toContain('B) 4 [giusta]')
  })

  it('gives AI shapes a border in the tone of their fill unless one is given', () => {
    const { doc: out } = applyAiOps({ type: 'canvas_v1', items: [] }, [
      { kind: 'shape', id: 's', x: 0, y: 0, fill: '#dbeafe' },
      { kind: 'shape', id: 't', x: 0, y: 0, fill: '#facc15', stroke: '#dc2626', opacity: 0.2 },
    ], ids)
    const [a, b] = out.items
    expect(a.type === 'shape' && a.stroke).toBe(shapeStrokeFor('#dbeafe'))
    expect(b.type === 'shape' && b.stroke).toBe('#dc2626')
  })

  it('derives a darker border of the same hue', () => {
    const stroke = shapeStrokeFor('#bae6fd')
    expect(stroke).not.toBe('#bae6fd')
    const lum = (hex: string) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0)
    expect(lum(stroke)).toBeLessThan(lum('#bae6fd'))
    expect(isToneStroke(stroke, '#bae6fd')).toBe(true)
    expect(isToneStroke('#ff0000', '#bae6fd')).toBe(false)
  })
})
