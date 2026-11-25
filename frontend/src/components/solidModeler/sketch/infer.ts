// "Constrained" drawing: inferred anchor points from alignment with other vertices, edges and the previous point.
import { tl } from '@/i18n/tl'
import { add, closestOnSegment, cross, dist, dot, keyPoints, len, mul, norm, sub, tessellate, type P, type SketchEntity } from './geom2d'

export interface Inference {
  p: P
  label: string
  guides: [P, P][]
  /** Vertices / edges that produced the inference (highlighted on the canvas). */
  sources: P[]
}

interface RefLine { p: P; d: P; label: string; prio: number; src: P }

const EPS = 1e-9

function straightSegments(entities: SketchEntity[]): [P, P][] {
  const out: [P, P][] = []
  for (const e of entities) {
    if (e.type !== 'line' && e.type !== 'rect' && e.type !== 'polygon' && e.type !== 'polyline') continue
    const { pts, closed } = tessellate(e)
    const n = closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) if (dist(pts[i], pts[(i + 1) % pts.length]) > 1e-6) out.push([pts[i], pts[(i + 1) % pts.length]])
  }
  return out
}

const lineDistance = (raw: P, l: RefLine) => Math.abs(cross(sub(raw, l.p), l.d))
const project = (raw: P, l: RefLine): P => add(l.p, mul(l.d, dot(sub(raw, l.p), l.d)))

/**
 * Best inferred point near `raw` and the anchor points worth suggesting. `tol` is in mm (the caller converts the
 * pixel tolerance with the current zoom). Priority: two alignments (a corner), perpendicular foot, parallel /
 * perpendicular to an edge, alignment with a vertex, extension of an edge.
 */
export function inferPoint(raw: P, anchor: P | null, entities: SketchEntity[], tol: number): { best: Inference | null; suggestions: P[] } {
  const kps: P[] = []
  for (const e of entities) for (const kp of keyPoints(e)) { if (kps.length < 500) kps.push(kp.p) }
  const segs = straightSegments(entities)
  const lines: RefLine[] = []
  const reach = tol * 6
  for (const q of kps) {
    if (Math.abs(raw[0] - q[0]) < reach) lines.push({ p: q, d: [0, 1], label: tl("Allineato in X con un vertice"), prio: 3, src: q })
    if (Math.abs(raw[1] - q[1]) < reach) lines.push({ p: q, d: [1, 0], label: tl("Allineato in Y con un vertice"), prio: 3, src: q })
  }
  if (anchor) {
    lines.push({ p: anchor, d: [1, 0], label: tl("Orizzontale"), prio: 4, src: anchor }, { p: anchor, d: [0, 1], label: tl("Verticale"), prio: 4, src: anchor })
    for (const [a, b] of segs) {
      const d = norm(sub(b, a))
      lines.push({ p: anchor, d, label: tl("Parallelo a un lato"), prio: 2, src: add(a, mul(sub(b, a), 0.5)) })
      lines.push({ p: anchor, d: [-d[1], d[0]], label: tl("Perpendicolare a un lato"), prio: 2, src: add(a, mul(sub(b, a), 0.5)) })
    }
  }
  for (const [a, b] of segs) lines.push({ p: a, d: norm(sub(b, a)), label: tl("Sul prolungamento di un lato"), prio: 1, src: a })

  // Identical lines from different rules collapse into the most meaningful one.
  const unique: RefLine[] = []
  for (const l of lines) {
    const twin = unique.findIndex(u => Math.abs(cross(u.d, l.d)) < 1e-6 && lineDistance(l.p, u) < 1e-6)
    if (twin < 0) unique.push(l)
    else if (l.prio > unique[twin].prio) unique[twin] = l
  }
  const near = unique.filter(l => lineDistance(raw, l) < tol).sort((x, y) => lineDistance(raw, x) - lineDistance(raw, y) - (y.prio - x.prio) * tol * 0.25)
  let best: Inference | null = null

  // Perpendicular foot of the anchor on an edge.
  if (anchor) {
    for (const [a, b] of segs) {
      const c = closestOnSegment(anchor, a, b)
      if (c.t > 1e-6 && c.t < 1 - 1e-6 && dist(c.point, raw) < tol && dist(c.point, anchor) > 1e-6) {
        best = { p: c.point, label: tl("Perpendicolare al lato"), guides: [[anchor, c.point]], sources: [c.point] }
        break
      }
    }
  }
  if (!best && near.length >= 2) {
    // Two reference lines meeting near the cursor: a corner anchored on both.
    for (let i = 0; i < near.length && !best; i++) for (let j = i + 1; j < near.length && !best; j++) {
      const l1 = near[i], l2 = near[j]
      const den = cross(l1.d, l2.d)
      if (Math.abs(den) < 1e-6) continue
      const t = cross(sub(l2.p, l1.p), l2.d) / den
      const p = add(l1.p, mul(l1.d, t))
      if (dist(p, raw) > tol * 2) continue
      best = { p, label: `${l1.label} + ${l2.label.toLowerCase()}`, guides: [[l1.src, p], [l2.src, p]], sources: [l1.src, l2.src] }
    }
  }
  if (!best && near.length) {
    const l = near[0]
    const p = project(raw, l)
    best = { p, label: l.label, guides: [[l.src, p]], sources: [l.src] }
  }

  // Suggested anchors: crossings of the X / Y alignment lines of nearby vertices (and of the previous point).
  const xs = kps.filter(q => Math.abs(raw[0] - q[0]) < reach * 2 && len(sub(q, raw)) > EPS)
  const ys = kps.filter(q => Math.abs(raw[1] - q[1]) < reach * 2 && len(sub(q, raw)) > EPS)
  if (anchor) { xs.push(anchor); ys.push(anchor) }
  const suggestions: P[] = []
  for (const qx of xs) for (const qy of ys) {
    if (qx === qy) continue
    const p: P = [qx[0], qy[1]]
    if (suggestions.length < 10 && !suggestions.some(s => dist(s, p) < 1e-6) && !kps.some(k => dist(k, p) < 1e-6)) suggestions.push(p)
  }
  for (const [a, b] of segs) {
    if (!anchor) break
    const c = closestOnSegment(anchor, a, b)
    if (c.t > 1e-6 && c.t < 1 - 1e-6 && dist(c.point, raw) < reach * 2 && suggestions.length < 12) suggestions.push(c.point)
  }
  return { best, suggestions }
}
