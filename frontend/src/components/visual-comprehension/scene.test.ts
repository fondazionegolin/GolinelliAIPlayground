import { describe, expect, it } from 'vitest'
import { getDrawingLayout, type DrawingMark, type DrawingScene, type ScenePoint } from './blackboard'
import { SceneGeometry, dist } from './sceneGeometry'
import { refineScene } from './sceneLint'
import type { Region } from './types'

const W = 1000, H = 800
const region = (id: string, x: number, y: number, width: number, height: number, text = 'x'): Region => ({ id, label: id, text, box: { x, y, width, height }, confidence: 'high' })
const pt = (id: string, over: Partial<ScenePoint>): ScenePoint => ({ id, kind: 'xy', space: 'image', x: null, y: null, region: null, element: null, at: 'center', refs: [], t: null, dx: 0, dy: 0, ...over })
const mark = (id: string, kind: DrawingMark['kind'], over: Partial<DrawingMark> = {}): DrawingMark => ({
  id, kind, space: 'image', box: null, points: [], text: '', color: 'ink', fill: 'none', font_size: 3.5, stroke_width: .3, step: 0,
  from_region_id: null, to_element_id: null, plot: null, diagram: null, fretboard: null, rhythm: null, ...over,
})
const scene = (points: ScenePoint[], elements: DrawingMark[]): DrawingScene => ({ title: 't', layout: 'overlay', steps: ['a', 'b'], points, elements })
const layout = getDrawingLayout(W, H, null)

describe('geometry resolver', () => {
  const regions = [region('base', 10, 70, 60, 10)]

  it('resolves region corners, midpoints and the foot of a perpendicular exactly', () => {
    const s = scene([
      pt('a', { kind: 'region', region: 'base', at: 'bottom_left' }), pt('b', { kind: 'region', region: 'base', at: 'bottom_right' }),
      pt('apex', { x: 40, y: 15 }), pt('h', { kind: 'foot', refs: ['apex', 'a', 'b'] }), pt('m', { kind: 'midpoint', refs: ['a', 'b'] }),
    ], [mark('l', 'line', { anchors: ['apex', 'h'] })])
    const g = new SceneGeometry(s, regions, layout)
    expect(g.point('a')).toEqual({ x: 100, y: 640 })
    expect(g.point('b')).toEqual({ x: 700, y: 640 })
    expect(g.point('h')).toEqual({ x: 400, y: 640 })
    expect(g.point('m')).toEqual({ x: 400, y: 640 })
  })

  it('intersects two lines and falls back when they are parallel', () => {
    const s = scene([
      pt('a', { x: 0, y: 0 }), pt('b', { x: 100, y: 100 }), pt('c', { x: 0, y: 100 }), pt('d', { x: 100, y: 0 }),
      pt('x', { kind: 'intersection', refs: ['a', 'b', 'c', 'd'] }),
      pt('p', { x: 0, y: 50 }), pt('q', { x: 100, y: 50 }), pt('par', { kind: 'intersection', refs: ['a', 'd', 'p', 'q'] }),
    ], [mark('l', 'line', { anchors: ['a', 'b'] })])
    const g = new SceneGeometry(s, [], layout)
    expect(g.point('x')).toEqual({ x: 500, y: 400 })
    expect(Number.isFinite(g.point('par').x)).toBe(true)
  })

  it('follows another element and survives circular references', () => {
    const s = scene([pt('top', { kind: 'element', element: 'box', at: 'top' }), pt('e', { kind: 'element', element: 'loop', at: 'center' })], [
      mark('box', 'rectangle', { box: { x: 20, y: 20, width: 20, height: 10 } }),
      mark('loop', 'line', { anchors: ['e', 'top'] }),
    ])
    const g = new SceneGeometry(s, [], layout)
    expect(g.point('top')).toEqual({ x: 300, y: 160 })
    expect(Number.isFinite(g.point('e').x)).toBe(true)
  })

  it('applies offsets in percent of the frame and cross-space anchors on the board', () => {
    const boardLayout = getDrawingLayout(W, H, { title: '', layout: 'side', steps: [''], elements: [] })
    const s = scene([pt('n', { kind: 'region', region: 'base', at: 'top_left', dx: 5, dy: -2 })], [mark('l', 'line', { anchors: ['n', 'n'] })])
    const g = new SceneGeometry(s, [region('base', 10, 70, 60, 10)], boardLayout)
    expect(g.point('n')).toEqual({ x: 150, y: 544 })
  })
})

describe('layout review', () => {
  it('places a callout label clear of source text instead of on it', () => {
    const regions = [region('r', 30, 30, 40, 10, 'testo sorgente')]
    const s = scene([pt('t', { kind: 'region', region: 'r', at: 'center' })], [mark('c', 'callout', { target: 't', text: 'qui' })])
    const { geometry } = refineScene(s, regions, layout, 1)
    const label = geometry.bounds(s.elements[0]), zone = geometry.regionRect('r')!
    const overlaps = label.x < zone.x + zone.width && zone.x < label.x + label.width && label.y < zone.y + zone.height && zone.y < label.y + label.height
    expect(overlaps).toBe(false)
    expect(dist({ x: label.x + label.width / 2, y: label.y + label.height / 2 }, geometry.point('t'))).toBeLessThan(W * .35)
  })

  it('keeps two callouts apart', () => {
    const s = scene([pt('a', { x: 50, y: 50 }), pt('b', { x: 52, y: 50 })], [
      mark('c1', 'callout', { target: 'a', text: 'primo valore' }), mark('c2', 'callout', { target: 'b', text: 'secondo valore' }),
    ])
    const { geometry, issues } = refineScene(s, [], layout, 1)
    const [a, b] = s.elements.map(e => geometry.bounds(e))
    expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false)
    expect(issues.filter(i => !i.fixed)).toEqual([])
  })

  it('moves text off source content and reports what it did', () => {
    const regions = [region('r', 10, 10, 50, 10, 'riga')]
    const s = scene([], [mark('t', 'text', { text: 'nota', box: { x: 12, y: 10, width: 20, height: 5 } }), mark('l', 'line', { points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] })])
    const { shifts, issues } = refineScene(s, regions, layout, 1)
    expect(shifts.has('t')).toBe(true)
    expect(issues.some(i => i.rule === 'overlap-text' && i.fixed)).toBe(true)
  })

  it('does not touch text that is already clear', () => {
    const s = scene([], [mark('t', 'text', { text: 'ok', box: { x: 50, y: 50, width: 20, height: 5 } })])
    expect(refineScene(s, [region('r', 0, 0, 10, 10)], layout, 1).shifts.size).toBe(0)
  })

  it('raises text that would be unreadable at the display scale', () => {
    const s = scene([], [mark('t', 'text', { text: 'piccolo', box: { x: 50, y: 50, width: 30, height: 10 }, font_size: 1 })])
    const { geometry, issues } = refineScene(s, [], layout, .5)
    expect(geometry.fontSize(s.elements[0]) * .5).toBeGreaterThanOrEqual(11)
    expect(issues.some(i => i.rule === 'too-small' && i.fixed)).toBe(true)
  })

  it('snaps near-miss left edges but leaves deliberate offsets alone', () => {
    const s = scene([], [
      mark('a', 'text', { text: 'uno', box: { x: 20, y: 20, width: 20, height: 4 } }),
      mark('b', 'text', { text: 'due', box: { x: 20.6, y: 40, width: 20, height: 4 } }),
      mark('c', 'text', { text: 'tre', box: { x: 45, y: 60, width: 20, height: 4 } }),
    ])
    const { shifts } = refineScene(s, [], layout, 1)
    expect(shifts.get('b')?.x).toBeCloseTo(-6, 5)
    expect(shifts.has('c')).toBe(false)
  })

  it('reports a crowded step it cannot fix', () => {
    const many = Array.from({ length: 12 }, (_, i) => mark(`t${i}`, 'text', { text: 'n', box: { x: 5 + (i % 4) * 22, y: 5 + Math.floor(i / 4) * 22, width: 10, height: 4 } }))
    expect(refineScene(scene([], many), [], layout, 1).issues.some(i => i.rule === 'dense-step')).toBe(true)
  })
})

describe('widgets over the source', () => {
  it('flags a widget box that hides source text, since only the author can move it', () => {
    const s = scene([], [mark('nl', 'numberline', { box: { x: 5, y: 5, width: 40, height: 20 } })])
    const { issues } = refineScene(s, [region('r', 0, 0, 50, 30, 'testo')], layout, 1)
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'covers-source', id: 'nl', fixed: false }))
  })
})

describe('text on a point', () => {
  it('centres the written text on its anchor, whatever the box position says', () => {
    const s = scene([pt('p', { x: 50, y: 50 })], [mark('t', 'number', { text: '1', anchors: ['p'], box: { x: 0, y: 0, width: 10, height: 5 } })])
    const g = new SceneGeometry(s, [], layout)
    expect(g.bounds(s.elements[0])).toEqual({ x: 450, y: 380, width: 100, height: 40 })
  })
})

describe('teacher timeline', () => {
  it('draws the marks of a step one after the other, with a pen that follows them', async () => {
    const { buildTimeline } = await import('./drawingTimeline')
    const s = scene([pt('a', { x: 10, y: 10 }), pt('b', { x: 90, y: 10 })], [
      mark('l', 'line', { anchors: ['a', 'b'] }), mark('t', 'text', { text: 'tre parole qui', box: { x: 10, y: 20, width: 40, height: 6 } }),
      mark('later', 'arrow', { anchors: ['a', 'b'], step: 1 }),
    ])
    const t = buildTimeline(s, new SceneGeometry(s, [], layout), 0)
    const [l, text] = [t.timings.get('l')!, t.timings.get('t')!]
    expect(t.timings.has('later')).toBe(false)
    expect(text.delay).toBeGreaterThanOrEqual(l.delay + l.duration)
    expect(t.total).toBeGreaterThan(text.delay + text.duration)
    const times = t.pen!.times
    expect(times[0]).toBe(0); expect(times[times.length - 1]).toBe(1)
    expect(times.every((v, i) => i === 0 || v >= times[i - 1])).toBe(true)
    expect(t.pen!.x[1]).toBe(100); expect(t.pen!.x[2]).toBe(900)
  })

  it('takes longer for a long stroke than for a short one', async () => {
    const { markDuration } = await import('./drawingTimeline')
    const s = scene([pt('a', { x: 0, y: 0 }), pt('b', { x: 100, y: 100 }), pt('c', { x: 2, y: 2 })], [
      mark('long', 'line', { anchors: ['a', 'b'] }), mark('short', 'line', { anchors: ['a', 'c'] })])
    const g = new SceneGeometry(s, [], layout)
    expect(markDuration(s.elements[0], g)).toBeGreaterThan(markDuration(s.elements[1], g))
  })
})

describe('function on the source axes', () => {
  it('uses the tick number read on the image and assumes a square grid without a y tick', async () => {
    const { calibratedPlot } = await import('./ExtraMarks')
    // origin at (500,400), tick "2" at (660,400): 80 px per unit
    const regions = [region('o', 49, 49, 2, 2, 'O'), region('t2', 65, 49, 2, 2, '2')]
    const s = scene([pt('O', { kind: 'region', region: 'o' }), pt('T', { kind: 'region', region: 't2' })], [
      mark('f', 'plot', { anchors: ['O', 'T', 'O'], plot: { x_min: -1, x_max: 1, y_min: -10, y_max: 10, x_label: 'x', y_label: 'y', x_ref: 1, y_ref: 1,
        curves: [{ kind: 'polynomial', coefficients: [0, 0, 1], a: 1, b: 1, c: 0, d: 0, color: 'blue', label: '' }], series: [] } }),
    ])
    const { curves } = calibratedPlot(s.elements[0], new SceneGeometry(s, regions, layout))
    // x=1 -> y=1: 80 px right and 80 px up from the origin
    expect(curves[0].end!.x).toBeCloseTo(580, 5)
    expect(curves[0].end!.y).toBeCloseTo(320, 5)
  })
})

describe('small source details', () => {
  it('moves a wide formula off a vertex it would hide, even though the vertex is tiny', () => {
    const vertex = region('C', 15, 18, 1.6, 2, '')
    const s = scene([], [mark('f', 'formula', { text: 'A=\\frac{7\\times 5}{2}=17{,}5', box: { x: 5, y: 12, width: 90, height: 18 }, font_size: 5 })])
    const { shifts } = refineScene(s, [vertex], layout, 1)
    expect(shifts.has('f')).toBe(true)
  })
})

describe('brace labels', () => {
  it('slide away from source text instead of covering it, staying near the tip', () => {
    // brace under a term; another source line sits right where the label would go
    const regions = [region('term', 30, 30, 20, 8, 'H'), region('below', 25, 40, 40, 8, 'altra riga')]
    const s = scene([pt('a', { kind: 'region', region: 'term', at: 'bottom_left' }), pt('b', { kind: 'region', region: 'term', at: 'bottom_right' })],
      [mark('br', 'brace', { anchors: ['a', 'b'], text: 'energia' })])
    const { geometry } = refineScene(s, regions, layout, 1)
    const label = geometry.braceLabel(s.elements[0])!.rect, zone = geometry.regionRect('below')!
    expect(label.y > zone.y + zone.height || label.y + label.height < zone.y || label.x > zone.x + zone.width || label.x + label.width < zone.x).toBe(true)
  })
})

describe('plain math for snapshots', () => {
  it('reads like the formula, not like LaTeX source', async () => {
    const { plainMath } = await import('./BlackboardDrawing')
    expect(plainMath('A = \\frac{b \\cdot h}{2}')).toBe('A = (b · h)/2')
    expect(plainMath('17{,}5\\ \\text{cm}^2')).toBe('17,5 cm²')
    expect(plainMath('i\\hbar \\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi')).toBe('iħ ∂/(∂ t)Ψ = ĤΨ')
  })
})

describe('explorable plots', () => {
  it('applies slider values without touching the scene, including polynomial coefficients', async () => {
    const { withParams, sliderDefault, curveValue } = await import('./blackboard')
    const plot = { x_min: -5, x_max: 5, y_min: -5, y_max: 5, x_label: 'x', y_label: 'y', series: [], formula: 'y = A·sin(kx)',
      curves: [{ kind: 'sin' as const, coefficients: [0, 1], a: 1, b: 1, c: 0, d: 0, color: 'blue' as const, label: '' },
               { kind: 'polynomial' as const, coefficients: [0, 0, 1], a: 1, b: 1, c: 0, d: 0, color: 'red' as const, label: '' }],
      sliders: [{ curve: 0, field: 'a' as const, label: 'A', min: 0, max: 3, step: .1 }, { curve: 1, field: 'c2' as const, label: 'p', min: -2, max: 2, step: .1 }] }
    const live = withParams(plot, { '0:a': 2, '1:c2': -1 })
    expect(curveValue(live.curves[0], Math.PI / 2)).toBeCloseTo(2)
    expect(curveValue(live.curves[1], 2)).toBeCloseTo(-4)
    expect(plot.curves[0].a).toBe(1)
    expect(sliderDefault(plot, plot.sliders[1])).toBe(1)
  })

  it('evaluates exp, log and abs, and has no value outside the domain', async () => {
    const { curveValue } = await import('./blackboard')
    const base = { coefficients: [0], a: 1, b: 1, c: 0, d: 0, color: 'blue' as const, label: '' }
    expect(curveValue({ ...base, kind: 'exp' }, 1)).toBeCloseTo(Math.E)
    expect(curveValue({ ...base, kind: 'log' }, -1)).toBeNull()
    expect(curveValue({ ...base, kind: 'abs', a: 2, d: 1 }, -3)).toBe(7)
  })
})

describe('live formula', () => {
  it('writes the equation with the current numbers, tidily', async () => {
    const { liveFormula } = await import('./blackboard')
    const base = { coefficients: [0], a: 1, b: 1, c: 0, d: 0, color: 'blue' as const, label: '' }
    expect(liveFormula({ ...base, kind: 'sin', a: 2, b: 3, c: .5 })).toBe('y = 2·sin(3x + 0,5)')
    expect(liveFormula({ ...base, kind: 'cos', c: -1, d: -2 })).toBe('y = cos(x − 1) − 2')
    expect(liveFormula({ ...base, kind: 'polynomial', coefficients: [-4, 0, 1] })).toBe('y = x² − 4')
  })
})
