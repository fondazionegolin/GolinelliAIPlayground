// 2D sketch editing operations: trim, corner fillet, midpoints. Pure functions over entity lists.
import {
  add, arcEnds, arcSweep, arcThrough, closestOnSegment, dist, dot, len, mul, norm, polar, polygonVertices, rectCorners, sub, tessellate, type P, type SketchEntity,
} from './geom2d'

const TAU = Math.PI * 2
const TOL = 1e-3
let seq = 0
const nid = () => `t${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`
const same = (a: P, b: P) => dist(a, b) <= TOL
const mod = (a: number) => ((a % TAU) + TAU) % TAU

export const isComposite = (e: SketchEntity) => e.type === 'rect' || e.type === 'polygon' || e.type === 'polyline'

/** Rectangles, polygons and polylines become independent lines (same geometry). */
export function explode(e: SketchEntity): SketchEntity[] {
  if (!isComposite(e)) return [e]
  const { pts, closed } = tessellate(e)
  const n = closed ? pts.length : pts.length - 1
  const out: SketchEntity[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    if (dist(a, b) > 1e-6) out.push({ id: nid(), type: 'line', a, b })
  }
  return out
}

function segmentsOf(others: SketchEntity[]): [P, P][] {
  const out: [P, P][] = []
  for (const e of others) {
    const { pts, closed } = tessellate(e)
    const n = closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) out.push([pts[i], pts[(i + 1) % pts.length]])
  }
  return out
}

/** Parameters t∈[0,1] along segment AB where other entities cross or touch it. */
function lineHits(a: P, b: P, others: SketchEntity[]): number[] {
  const r = sub(b, a), rl = len(r)
  if (rl < 1e-9) return []
  const out: number[] = []
  for (const [c, d] of segmentsOf(others)) {
    const s = sub(d, c), sl = len(s)
    if (sl < 1e-9) continue
    const den = r[0] * s[1] - r[1] * s[0]
    if (Math.abs(den) < 1e-9 * rl * sl) continue
    const q = sub(c, a)
    const t = (q[0] * s[1] - q[1] * s[0]) / den
    const u = (q[0] * r[1] - q[1] * r[0]) / den
    if (t >= -TOL / rl && t <= 1 + TOL / rl && u >= -TOL / sl && u <= 1 + TOL / sl) out.push(Math.max(0, Math.min(1, t)))
  }
  return out
}

/** Points where the circle (c, r) meets the other entities. */
function circleHits(c: P, r: number, others: SketchEntity[]): P[] {
  const out: P[] = []
  for (const [a, b] of segmentsOf(others)) {
    const d = sub(b, a), f = sub(a, c)
    const A = dot(d, d)
    if (A < 1e-12) continue
    const B = 2 * dot(f, d), C = dot(f, f) - r * r
    const disc = B * B - 4 * A * C
    if (disc < 0) continue
    const sq = Math.sqrt(disc)
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
      const e = TOL / Math.sqrt(A)
      if (t >= -e && t <= 1 + e) out.push(add(a, mul(d, Math.max(0, Math.min(1, t)))))
    }
  }
  return out
}

const angleOf = (c: P, p: P) => Math.atan2(p[1] - c[1], p[0] - c[0])

export interface TrimResult { entities: SketchEntity[]; removed: P[] }

/** Remove the part of `id` under `click` between its neighbouring intersections (the whole entity if it has none). */
export function trimEntity(entities: SketchEntity[], id: string, click: P): TrimResult | null {
  const e = entities.find(x => x.id === id)
  if (!e) return null
  const rest = entities.filter(x => x.id !== id)
  if (e.type === 'point') return { entities: rest, removed: [e.p] }

  if (isComposite(e)) {
    const pieces = explode(e)
    if (!pieces.length) return null
    let best = pieces[0], bd = Infinity
    for (const p of pieces) {
      const q = p as Extract<SketchEntity, { type: 'line' }>
      const d = closestOnSegment(click, q.a, q.b).d
      if (d < bd) { bd = d; best = p }
    }
    return trimEntity([...rest, ...pieces], best.id, click)
  }

  if (e.type === 'line') {
    const hits = lineHits(e.a, e.b, rest).filter(t => t > 1e-6 && t < 1 - 1e-6)
    const L = dist(e.a, e.b)
    const tc = Math.max(0, Math.min(1, closestOnSegment(click, e.a, e.b).t))
    const lo = Math.max(0, ...hits.filter(t => t < tc))
    const hi = Math.min(1, ...hits.filter(t => t > tc))
    const at = (t: number): P => add(e.a, mul(sub(e.b, e.a), t))
    const out = [...rest]
    if (lo * L > 1e-3) out.push({ id: nid(), type: 'line', a: e.a, b: at(lo) })
    if ((1 - hi) * L > 1e-3) out.push({ id: nid(), type: 'line', a: at(hi), b: e.b })
    return { entities: out, removed: [at(lo), at(hi)] }
  }

  if (e.type === 'arc') {
    const sweep = arcSweep(e.a0, e.a1)
    const hits = circleHits(e.c, e.r, rest).map(p => mod(angleOf(e.c, p) - e.a0)).filter(s => s > 1e-6 && s < sweep - 1e-6)
    let sc = mod(angleOf(e.c, click) - e.a0)
    if (sc > sweep) sc = sc - sweep < TAU - sc ? sweep : 0
    const lo = Math.max(0, ...hits.filter(s => s < sc))
    const hi = Math.min(sweep, ...hits.filter(s => s > sc))
    const out = [...rest]
    if (lo * e.r > 1e-3) out.push({ id: nid(), type: 'arc', c: e.c, r: e.r, a0: e.a0, a1: e.a0 + lo })
    if ((sweep - hi) * e.r > 1e-3) out.push({ id: nid(), type: 'arc', c: e.c, r: e.r, a0: e.a0 + hi, a1: e.a0 + sweep })
    const n = Math.max(2, Math.ceil((hi - lo) / 0.08))
    return { entities: out, removed: Array.from({ length: n + 1 }, (_, i) => polar(e.c, e.r, e.a0 + lo + ((hi - lo) * i) / n)) }
  }

  if (e.type === 'circle') {
    const hits = [...new Set(circleHits(e.c, e.r, rest).map(p => Math.round(mod(angleOf(e.c, p)) * 1e6) / 1e6))].sort((a, b) => a - b)
    const removedAll = () => ({ entities: rest, removed: tessellate(e).pts })
    if (hits.length < 2) return removedAll()
    const ac = mod(angleOf(e.c, click))
    const prev = [...hits].reverse().find(h => h <= ac) ?? hits[hits.length - 1]
    const next = hits.find(h => h > ac) ?? hits[0]
    if (prev === next) return removedAll()
    const span = mod(next - prev)
    const n = Math.max(2, Math.ceil(span / 0.08))
    return {
      entities: [...rest, { id: nid(), type: 'arc', c: e.c, r: e.r, a0: next, a1: prev }],
      removed: Array.from({ length: n + 1 }, (_, i) => polar(e.c, e.r, prev + (span * i) / n)),
    }
  }

  // Ellipse, Bézier, spline: trim along the tessellated outline.
  const { pts, closed: pathClosed } = tessellate(e)
  if (!pathClosed) return trimOpenPath(rest, pts, click)
  const m = pts.length
  const hits: number[] = []
  for (let i = 0; i < m; i++) for (const t of lineHits(pts[i], pts[(i + 1) % m], rest)) hits.push(i + t)
  const uniq = [...new Set(hits.map(h => Math.round((h % m) * 1e5) / 1e5))].sort((a, b) => a - b)
  const whole = () => ({ entities: rest, removed: [...pts, pts[0]] })
  if (uniq.length < 2) return whole()
  let ci = 0, cd = Infinity, ct = 0
  for (let i = 0; i < m; i++) {
    const c = closestOnSegment(click, pts[i], pts[(i + 1) % m])
    if (c.d < cd) { cd = c.d; ci = i; ct = c.t }
  }
  const sc = ci + ct
  const prev = [...uniq].reverse().find(h => h <= sc) ?? uniq[uniq.length - 1]
  const next = uniq.find(h => h > sc) ?? uniq[0]
  const at = (s: number): P => { const i = Math.floor(mod2(s, m)); const t = mod2(s, m) - i; return add(pts[i], mul(sub(pts[(i + 1) % m], pts[i]), t)) }
  const walk = (from: number, to: number): P[] => {
    const out: P[] = [at(from)]
    let s = Math.floor(from) + 1
    const end = to > from ? to : to + m
    for (; s < end; s++) out.push(pts[s % m])
    out.push(at(to))
    return out
  }
  return { entities: [...rest, { id: nid(), type: 'polyline', pts: walk(next, prev), closed: false }], removed: walk(prev, next) }
}
/** Open curves (Bézier, spline): the removed part becomes a gap, the rest stays as open polylines. */
function trimOpenPath(rest: SketchEntity[], pts: P[], click: P): TrimResult {
  const m = pts.length - 1
  const hits: number[] = []
  for (let i = 0; i < m; i++) for (const t of lineHits(pts[i], pts[i + 1], rest)) if (i + t > 1e-6 && i + t < m - 1e-6) hits.push(i + t)
  hits.sort((a, b) => a - b)
  let ci = 0, cd = Infinity, ct = 0
  for (let i = 0; i < m; i++) {
    const c = closestOnSegment(click, pts[i], pts[i + 1])
    if (c.d < cd) { cd = c.d; ci = i; ct = c.t }
  }
  const sc = ci + ct
  const lo = Math.max(0, ...hits.filter(h => h < sc))
  const hi = Math.min(m, ...hits.filter(h => h > sc))
  const at = (s: number): P => { const i = Math.min(m - 1, Math.floor(s)); return add(pts[i], mul(sub(pts[i + 1], pts[i]), s - i)) }
  const slice = (from: number, to: number): P[] => {
    const out: P[] = [at(from)]
    for (let k = Math.floor(from) + 1; k <= Math.ceil(to) - 1 && k < to; k++) out.push(pts[k])
    out.push(at(to))
    return out
  }
  const out = [...rest]
  if (lo > 1e-6) out.push({ id: nid(), type: 'polyline', pts: slice(0, lo), closed: false })
  if (hi < m - 1e-6) out.push({ id: nid(), type: 'polyline', pts: slice(hi, m), closed: false })
  return { entities: out, removed: slice(lo, hi) }
}
const mod2 = (a: number, m: number) => ((a % m) + m) % m

// ── Corner fillet ───────────────────────────────────────────────────────────

export interface FilletResult { entities: SketchEntity[]; count: number; clamped: boolean }

type Line = Extract<SketchEntity, { type: 'line' }>
const touches = (l: Line, p: P) => same(l.a, p) || same(l.b, p)

/** Vertices where at least two straight edges meet (candidates for a fillet). */
export function cornerCandidates(entities: SketchEntity[]): P[] {
  const pts: P[] = []
  const counts: number[] = []
  const bump = (p: P) => {
    const i = pts.findIndex(q => same(q, p))
    if (i >= 0) counts[i]++
    else { pts.push(p); counts.push(1) }
  }
  for (const e of entities) {
    if (e.type === 'line') { bump(e.a); bump(e.b) }
    else if (e.type === 'rect') rectCorners(e.a, e.b).forEach(p => { bump(p); bump(p) })
    else if (e.type === 'polygon') polygonVertices(e).forEach(p => { bump(p); bump(p) })
    else if (e.type === 'polyline') e.pts.forEach((p, i) => { bump(p); if (e.closed || (i > 0 && i < e.pts.length - 1)) bump(p) })
  }
  return pts.filter((_, i) => counts[i] >= 2)
}

function filletAt(list: SketchEntity[], P: P, r: number, maxFrac: number): { list: SketchEntity[]; clamped: boolean } | null {
  const lines = list.filter((l): l is Line => l.type === 'line' && touches(l, P))
  if (lines.length !== 2) return null
  const [l1, l2] = lines
  const far = (l: Line) => (same(l.a, P) ? l.b : l.a)
  const L1 = dist(far(l1), P), L2 = dist(far(l2), P)
  if (L1 < 1e-6 || L2 < 1e-6) return null
  const u1 = norm(sub(far(l1), P)), u2 = norm(sub(far(l2), P))
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))))
  if (phi < 0.02 || phi > Math.PI - 0.02) return null
  const t = Math.tan(phi / 2)
  let d = r / t
  const dmax = Math.min(L1, L2) * maxFrac
  let clamped = false
  if (d > dmax) { d = dmax; clamped = true }
  const rr = d * t
  if (rr < 1e-4) return null
  const T1 = add(P, mul(u1, d)), T2 = add(P, mul(u2, d))
  const C = add(P, mul(norm(add(u1, u2)), rr / Math.sin(phi / 2)))
  const a1 = angleOf(C, T1), a2 = angleOf(C, T2)
  const arc: SketchEntity = arcSweep(a1, a2) <= Math.PI + 1e-9
    ? { id: nid(), type: 'arc', c: C, r: rr, a0: a1, a1: a2 }
    : { id: nid(), type: 'arc', c: C, r: rr, a0: a2, a1: a1 }
  const move = (l: Line, T: P): Line => (same(l.a, P) ? { ...l, a: T } : { ...l, b: T })
  return { list: [...list.filter(x => x !== l1 && x !== l2), move(l1, T1), move(l2, T2), arc], clamped }
}

/**
 * Round the corner at `corner` with an exact radius. With `all`, every corner of the connected
 * outline of straight edges is rounded (the radius shrinks where an edge is too short).
 */
export function filletCorner(entities: SketchEntity[], corner: P, r: number, all = false): FilletResult | null {
  if (!(r > 0)) return null
  let list = entities
  const explodeAt = (p: P) => {
    const touching = (e: SketchEntity) => isComposite(e) && tessellate(e).pts.some(q => same(q, p))
    if (list.some(touching)) list = list.flatMap(e => (touching(e) ? explode(e) : [e]))
  }
  const queue: P[] = [corner]
  const seen: P[] = []
  let count = 0, clamped = false
  while (queue.length) {
    const p = queue.shift()!
    if (seen.some(q => same(q, p))) continue
    seen.push(p)
    explodeAt(p)
    const lines = list.filter((l): l is Line => l.type === 'line' && touches(l, p))
    const next = lines.map(l => (same(l.a, p) ? l.b : l.a))
    const res = filletAt(list, p, r, all ? 0.5 : 1)
    if (res) { list = res.list; count++; clamped = clamped || res.clamped }
    else if (!all) return null
    if (all) for (const n of next) { explodeAt(n); queue.push(n) }
  }
  return count ? { entities: list, count, clamped } : null
}

// ── Midpoints ───────────────────────────────────────────────────────────────

/** Midpoint of the straight edge or arc of `e` closest to `p` (null for circles and ellipses). */
export function segmentMidpoint(e: SketchEntity, p: P): P | null {
  switch (e.type) {
    case 'line': return mul(add(e.a, e.b), 0.5)
    case 'arc': { const [a, b] = arcEnds(e); void a; void b; return polar(e.c, e.r, e.a0 + arcSweep(e.a0, e.a1) / 2) }
    case 'rect': case 'polygon': case 'polyline': {
      const { pts, closed } = tessellate(e)
      const n = closed ? pts.length : pts.length - 1
      let best: P | null = null, bd = Infinity
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        const d = closestOnSegment(p, a, b).d
        if (d < bd) { bd = d; best = mul(add(a, b), 0.5) }
      }
      return best
    }
    default: return null
  }
}

// ── Mirror ──────────────────────────────────────────────────────────────────

export type MirrorAxis = { kind: 'line'; a: P; d: P } | { kind: 'point'; p: P }

const reflect = (p: P, ax: Extract<MirrorAxis, { kind: 'line' }>): P => {
  const d = norm(ax.d), v = sub(p, ax.a)
  const along = dot(v, d)
  const foot = add(ax.a, mul(d, along))
  return sub(mul(foot, 2), p)
}

/** Mirror image of one entity across a line, or its point reflection (180° turn) about a point. */
export function mirrorEntity(e: SketchEntity, ax: MirrorAxis, id = nid()): SketchEntity {
  const pt = (p: P): P => (ax.kind === 'line' ? reflect(p, ax) : sub(mul(ax.p, 2), p))
  const alpha = ax.kind === 'line' ? Math.atan2(ax.d[1], ax.d[0]) : 0
  const aligned = ax.kind === 'point' || Math.abs(Math.sin(2 * alpha)) < 1e-9 || Math.abs(Math.cos(2 * alpha)) < 1e-9
  switch (e.type) {
    case 'line': return { id, type: 'line', a: pt(e.a), b: pt(e.b) }
    case 'point': return { id, type: 'point', p: pt(e.p) }
    case 'circle': return { id, type: 'circle', c: pt(e.c), r: e.r }
    case 'polyline': return { id, type: 'polyline', pts: e.pts.map(pt), closed: e.closed }
    case 'bezier': return { id, type: 'bezier', pts: e.pts.map(pt) as [P, P, P, P] }
    case 'spline': return { id, type: 'spline', pts: e.pts.map(pt) }
    case 'rect':
      return aligned ? { id, type: 'rect', a: pt(e.a), b: pt(e.b) } : { id, type: 'polyline', pts: rectCorners(e.a, e.b).map(pt), closed: true }
    case 'arc': {
      if (ax.kind === 'point') return { id, type: 'arc', c: pt(e.c), r: e.r, a0: e.a0 + Math.PI, a1: e.a1 + Math.PI }
      // A reflection reverses orientation: the new arc runs from the image of the old end to the image of the old start.
      return { id, type: 'arc', c: pt(e.c), r: e.r, a0: 2 * alpha - e.a1, a1: 2 * alpha - e.a0 }
    }
    case 'ellipse':
      return { id, type: 'ellipse', c: pt(e.c), rx: e.rx, ry: e.ry, rot: ax.kind === 'line' ? 2 * alpha - e.rot : e.rot }
    case 'polygon':
      return { id, type: 'polygon', c: pt(e.c), r: e.r, n: e.n, rot: ax.kind === 'line' ? 2 * alpha - e.rot : e.rot + Math.PI }
  }
}

/** Mirror `ids` (or everything but the axis when empty); `keep` leaves the originals in place. */
export function mirrorEntities(entities: SketchEntity[], ids: string[], ax: MirrorAxis, keep = true, exclude: string[] = []): SketchEntity[] {
  const source = (ids.length ? entities.filter(e => ids.includes(e.id)) : entities).filter(e => !exclude.includes(e.id))
  const images = source.map(e => mirrorEntity(e, ax))
  return keep ? [...entities, ...images] : [...entities.filter(e => !source.includes(e)), ...images]
}

// ── Rectangle selection ─────────────────────────────────────────────────────

export interface Rect2 { min: P; max: P }

const segmentHitsRect = (a: P, b: P, r: Rect2): boolean => {
  // Liang-Barsky clip of the segment against the rectangle.
  let t0 = 0, t1 = 1
  const dx = b[0] - a[0], dy = b[1] - a[1]
  for (const [p, q] of [[-dx, a[0] - r.min[0]], [dx, r.max[0] - a[0]], [-dy, a[1] - r.min[1]], [dy, r.max[1] - a[1]]] as [number, number][]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return true
}

/** Window selection (`crossing` false): the whole entity inside; crossing selection: any part touches the rectangle. */
export function entityInRect(e: SketchEntity, r: Rect2, crossing: boolean): boolean {
  const { pts, closed } = tessellate(e)
  const inside = (p: P) => p[0] >= r.min[0] && p[0] <= r.max[0] && p[1] >= r.min[1] && p[1] <= r.max[1]
  if (!crossing) return pts.length > 0 && pts.every(inside)
  if (pts.some(inside)) return true
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) if (segmentHitsRect(pts[i], pts[(i + 1) % pts.length], r)) return true
  return false
}

// ── Parametric editing: drag a vertex or push / pull an edge ────────────────

const meet = (p0: P, w: P, p1: P, u: P): P | null => {
  const den = w[0] * u[1] - w[1] * u[0]
  if (Math.abs(den) < 1e-9) return null
  const q = sub(p1, p0)
  const t = (q[0] * u[1] - q[1] * u[0]) / den
  return add(p0, mul(w, t))
}

/** Vertices of an entity: line / arc ends, rectangle and polygon corners, polyline and spline points, Bézier ends. */
export function entityVertices(e: SketchEntity): P[] {
  switch (e.type) {
    case 'line': return [e.a, e.b]
    case 'arc': return arcEnds(e)
    case 'rect': return rectCorners(e.a, e.b)
    case 'polygon': return polygonVertices(e)
    case 'polyline': case 'spline': return e.pts
    case 'bezier': return [e.pts[0], e.pts[3]]
    case 'point': return [e.p]
    default: return []
  }
}

/** The entity with its vertex at `old` moved to `next` (null when it has no such vertex). Curves keep their shape. */
export function moveVertexInEntity(e: SketchEntity, old: P, next: P): SketchEntity | null {
  switch (e.type) {
    case 'line':
      if (same(e.a, old)) return { ...e, a: next }
      if (same(e.b, old)) return { ...e, b: next }
      return null
    case 'arc': {
      const [s, t] = arcEnds(e)
      const mid = polar(e.c, e.r, e.a0 + arcSweep(e.a0, e.a1) / 2)
      const moved = same(s, old) ? arcThrough(e.id, next, t, mid) : same(t, old) ? arcThrough(e.id, s, next, mid) : undefined
      return moved === undefined ? null : moved ?? e
    }
    case 'rect': {
      const c = rectCorners(e.a, e.b)
      const i = c.findIndex(p => same(p, old))
      return i < 0 ? null : { ...e, a: c[(i + 2) % 4], b: next }
    }
    case 'polygon': {
      const v = polygonVertices(e)
      const i = v.findIndex(p => same(p, old))
      if (i < 0) return null
      const n = Math.max(3, Math.round(e.n))
      return { ...e, r: Math.max(0.01, dist(e.c, next)), rot: Math.atan2(next[1] - e.c[1], next[0] - e.c[0]) - (i * TAU) / n }
    }
    case 'polyline': case 'spline':
      return e.pts.some(p => same(p, old)) ? { ...e, pts: e.pts.map(p => (same(p, old) ? next : p)) } : null
    case 'bezier': {
      const d = sub(next, old)
      if (same(e.pts[0], old)) return { ...e, pts: [next, add(e.pts[1], d), e.pts[2], e.pts[3]] }
      if (same(e.pts[3], old)) return { ...e, pts: [e.pts[0], e.pts[1], add(e.pts[2], d), next] }
      return null
    }
    case 'point':
      return same(e.p, old) ? { ...e, p: next } : null
    default:
      return null
  }
}

const moveEverywhere = (list: SketchEntity[], old: P, next: P, skip = ''): SketchEntity[] =>
  same(old, next) ? list : list.map(x => (x.id === skip ? x : moveVertexInEntity(x, old, next) ?? x))

/**
 * Drag the vertex at `old` to `next`: every entity sharing it follows. With `keepHV`, lines that were horizontal /
 * vertical stay so (their far end slides), which keeps rectangles drawn with lines rectangular.
 */
export function dragVertex(entities: SketchEntity[], old: P, next: P, keepHV = false): SketchEntity[] {
  let list = moveEverywhere(entities, old, next)
  if (!keepHV) return list
  for (const l of entities) {
    if (l.type !== 'line' || !(same(l.a, old) || same(l.b, old))) continue
    const q = same(l.a, old) ? l.b : l.a
    const horizontal = Math.abs(l.a[1] - l.b[1]) < 1e-6 && Math.abs(l.a[0] - l.b[0]) > 1e-6
    const vertical = Math.abs(l.a[0] - l.b[0]) < 1e-6 && Math.abs(l.a[1] - l.b[1]) > 1e-6
    const q2: P | null = horizontal ? [q[0], next[1]] : vertical ? [next[0], q[1]] : null
    if (q2) list = moveEverywhere(list, q, q2)
  }
  return list
}

const neighboursAt = (list: SketchEntity[], p: P, skip: string) => list.filter(x => x.id !== skip && entityVertices(x).some(v => same(v, p)))

/** New position of the end `p` of an edge pushed by `delta` along `u`: it slides along a straight neighbour, so angles are kept. */
function slideEnd(list: SketchEntity[], skip: string, p: P, delta: P, u: P, prev?: P): P {
  const moved = add(p, delta)
  const nb = neighboursAt(list, p, skip)
  const lineNb = nb.length === 1 && nb[0].type === 'line' ? nb[0] : null
  const far = prev ?? (lineNb ? (same(lineNb.a, p) ? lineNb.b : lineNb.a) : null)
  if (!far) return moved
  return meet(far, sub(p, far), moved, u) ?? moved
}

/**
 * Push / pull the edge of `id` grabbed at `grab` to `cur`: straight edges move parallel to themselves with their
 * neighbours keeping their direction; circles / polygons change size, arcs and Bézier curves bend through the cursor.
 */
export function pushEdge(entities: SketchEntity[], id: string, grab: P, cur: P): SketchEntity[] {
  const e = entities.find(x => x.id === id)
  if (!e) return entities
  const d = sub(cur, grab)
  const replace = (next: SketchEntity) => entities.map(x => (x.id === id ? next : x))
  switch (e.type) {
    case 'line': {
      const u = norm(sub(e.b, e.a)), nrm: P = [-u[1], u[0]]
      const connected = neighboursAt(entities, e.a, id).length + neighboursAt(entities, e.b, id).length > 0
      const delta = connected ? mul(nrm, dot(d, nrm)) : d
      const a2 = slideEnd(entities, id, e.a, delta, u), b2 = slideEnd(entities, id, e.b, delta, u)
      let list = replace({ ...e, a: a2, b: b2 })
      list = moveEverywhere(list, e.a, a2, id)
      return moveEverywhere(list, e.b, b2, id)
    }
    case 'rect': {
      const [lo, , hi] = rectCorners(e.a, e.b)
      const sides = [Math.abs(grab[0] - lo[0]), Math.abs(grab[0] - hi[0]), Math.abs(grab[1] - lo[1]), Math.abs(grab[1] - hi[1])]
      const k = sides.indexOf(Math.min(...sides))
      const a: P = [...lo], b: P = [...hi]
      if (k === 0) a[0] = lo[0] + d[0]; else if (k === 1) b[0] = hi[0] + d[0]; else if (k === 2) a[1] = lo[1] + d[1]; else b[1] = hi[1] + d[1]
      return replace({ ...e, a, b })
    }
    case 'circle':
      return replace({ ...e, r: Math.max(0.01, dist(e.c, cur)) })
    case 'arc': {
      const [s, t] = arcEnds(e)
      return replace(arcThrough(e.id, s, t, cur) ?? e)
    }
    case 'ellipse': {
      const c = Math.cos(e.rot), sn = Math.sin(e.rot)
      const local = (p: P): P => { const v = sub(p, e.c); return [v[0] * c + v[1] * sn, -v[0] * sn + v[1] * c] }
      const g = local(grab), q = local(cur)
      return replace(Math.abs(g[0]) / e.rx >= Math.abs(g[1]) / e.ry ? { ...e, rx: Math.max(0.01, Math.abs(q[0])) } : { ...e, ry: Math.max(0.01, Math.abs(q[1])) })
    }
    case 'polygon': {
      const g = dist(e.c, grab)
      return g < 1e-6 ? entities : replace({ ...e, r: Math.max(0.01, (e.r * dist(e.c, cur)) / g) })
    }
    case 'polyline': {
      const n = e.pts.length
      const segs = e.closed ? n : n - 1
      let i = 0, best = Infinity
      for (let k = 0; k < segs; k++) {
        const c = closestOnSegment(grab, e.pts[k], e.pts[(k + 1) % n]).d
        if (c < best) { best = c; i = k }
      }
      const j = (i + 1) % n
      const P0 = e.pts[i], P1 = e.pts[j]
      const u = norm(sub(P1, P0)), nrm: P = [-u[1], u[0]]
      const ip = e.closed ? (i - 1 + n) % n : i - 1
      const jn = e.closed ? (j + 1) % n : j + 1
      const hasPrev = ip >= 0 && ip !== j, hasNext = jn < n && jn !== i
      const delta = hasPrev || hasNext ? mul(nrm, dot(d, nrm)) : d
      const P0n = hasPrev ? meet(e.pts[ip], sub(P0, e.pts[ip]), add(P0, delta), u) ?? add(P0, delta) : add(P0, delta)
      const P1n = hasNext ? meet(e.pts[jn], sub(P1, e.pts[jn]), add(P1, delta), u) ?? add(P1, delta) : add(P1, delta)
      const pts = e.pts.map((p, k) => (k === i ? P0n : k === j ? P1n : p))
      let list = replace({ ...e, pts })
      list = moveEverywhere(list, P0, P0n, id)
      return moveEverywhere(list, P1, P1n, id)
    }
    case 'bezier': {
      // The curve midpoint moves by 3/4 of the control-point shift: move them so the curve follows the cursor.
      const k = mul(d, 4 / 3)
      return replace({ ...e, pts: [e.pts[0], add(e.pts[1], k), add(e.pts[2], k), e.pts[3]] })
    }
    case 'spline': {
      let i = 0, best = Infinity
      e.pts.forEach((p, k) => { const dd = dist(p, grab); if (dd < best) { best = dd; i = k } })
      return replace({ ...e, pts: e.pts.map((p, k) => (k === i ? add(p, d) : p)) })
    }
    case 'point':
      return replace({ ...e, p: add(e.p, d) })
  }
}

/** Entities forming the boundary of a closed region (click inside a shape to select / move all of it). */
export function entitiesOfRegion(entities: SketchEntity[], outer: P[], holes: P[][] = []): string[] {
  const loops = [outer, ...holes]
  const onBoundary = (p: P) => loops.some(l => l.some((a, i) => closestOnSegment(p, a, l[(i + 1) % l.length]).d < 2e-3))
  return entities.filter(e => {
    const pts = tessellate(e).pts
    return pts.filter(onBoundary).length >= Math.min(2, pts.length)
  }).map(e => e.id)
}
