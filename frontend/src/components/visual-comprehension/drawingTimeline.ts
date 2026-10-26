import type { DrawingMark, DrawingScene } from './blackboard'
import { dist, rectAt, type SceneGeometry, type XY } from './sceneGeometry'

export type Timing = { delay: number; duration: number }
export type Timeline = { timings: Map<string, Timing>; total: number; pen: { x: number[]; y: number[]; times: number[] } | null }

const GAP = .14
const WIDGETS = new Set(['plot', 'diagram', 'fretboard', 'rhythm', 'numberline', 'lens'])
const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v))

function polylineLength(points: XY[]) {
  return points.slice(1).reduce((sum, p, i) => sum + dist(points[i], p), 0)
}

/** Where the teacher's pen starts and ends while drawing a mark (in layout units, shifts applied). */
export function penRoute(m: DrawingMark, g: SceneGeometry, shift: XY = { x: 0, y: 0 }): [XY, XY] {
  const move = (p: XY) => ({ x: p.x + shift.x, y: p.y + shift.y })
  const b = g.bounds(m)
  if (m.kind === 'callout' && m.target) return [g.point(m.target), rectAt(b, 'right')]
  if (['text', 'number', 'formula', 'highlight'].includes(m.kind) || WIDGETS.has(m.kind)) return [move(rectAt(b, 'left')), move(rectAt(b, 'right'))]
  const pts = g.markPoints(m)
  if (pts.length >= 2) return m.kind === 'polygon' ? [pts[0], pts[0]] : [pts[0], pts[pts.length - 1]]
  return [rectAt(b, 'top_left'), rectAt(b, 'bottom_right')]
}

/** Seconds a teacher would take: strokes by length, writing by characters, widgets by a fixed beat. */
export function markDuration(m: DrawingMark, g: SceneGeometry): number {
  const width = g.layout.width
  if (m.kind === 'text' || m.kind === 'number') return clamp(.3, 1.6, .15 + m.text.length * .05)
  if (m.kind === 'callout') return clamp(.6, 1.8, .35 + m.text.length * .04)
  if (m.kind === 'formula') return clamp(.6, 1.6, .3 + m.text.length * .025)
  if (m.kind === 'highlight') return .55
  if (WIDGETS.has(m.kind)) return 1
  const pts = g.markPoints(m)
  const length = m.kind === 'polygon' && pts.length > 2 ? polylineLength([...pts, pts[0]]) : pts.length >= 2 ? polylineLength(pts) : Math.hypot(g.bounds(m).width, g.bounds(m).height)
  return clamp(.35, 1.4, .25 + length / width * 1.3)
}

/** Sequential schedule for the marks of one step: each mark starts when the previous one is finished. */
export function buildTimeline(scene: DrawingScene, g: SceneGeometry, step: number, shifts: Map<string, XY> = new Map()): Timeline {
  const timings = new Map<string, Timing>()
  const x: number[] = [], y: number[] = [], at: number[] = []
  let clock = .2
  for (const m of scene.elements.filter(e => e.step === step)) {
    if (m.kind === 'spotlight') { timings.set(m.id, { delay: clock, duration: .5 }); clock += .5; continue }  // a light change, not a pen stroke
    const duration = markDuration(m, g)
    const [start, end] = penRoute(m, g, shifts.get(m.id))
    x.push(start.x, end.x); y.push(start.y, end.y); at.push(clock, clock + duration)
    timings.set(m.id, { delay: clock, duration })
    clock += duration + GAP
  }
  const total = clock
  const pen = at.length ? { x: [x[0], ...x, x[x.length - 1]], y: [y[0], ...y, y[y.length - 1]], times: [0, ...at, total].map(t => t / total) } : null
  return { timings, total, pen }
}
