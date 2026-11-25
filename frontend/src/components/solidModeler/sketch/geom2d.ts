// Pure 2D sketch geometry: entities, tessellation, closed-profile detection (planar arrangement),
// offsets and snapping helpers. Units: millimetres in the sketch plane frame (u = x, v = y).

export type P = [number, number]

export type SketchEntity =
  | { id: string; type: 'line'; a: P; b: P }
  /** Counter-clockwise from a0 to a1 (radians). */
  | { id: string; type: 'arc'; c: P; r: number; a0: number; a1: number }
  | { id: string; type: 'circle'; c: P; r: number }
  | { id: string; type: 'ellipse'; c: P; rx: number; ry: number; rot: number }
  /** Axis-aligned rectangle given by two opposite corners. */
  | { id: string; type: 'rect'; a: P; b: P }
  /** Regular polygon: centre, circumradius, sides, rotation of the first vertex. */
  | { id: string; type: 'polygon'; c: P; r: number; n: number; rot: number }
  | { id: string; type: 'polyline'; pts: P[]; closed: boolean }
  /** Cubic Bézier: start, two control points, end. */
  | { id: string; type: 'bezier'; pts: [P, P, P, P] }
  /** Smooth curve through fit points (centripetal Catmull-Rom). */
  | { id: string; type: 'spline'; pts: P[] }
  /** Construction point (e.g. a midpoint): a snap target that never closes or opens a profile. */
  | { id: string; type: 'point'; p: P }

export type EntityType = SketchEntity['type']

export interface Region {
  key: string
  /** Counter-clockwise outer boundary. */
  outer: P[]
  /** Clockwise inner boundaries. */
  holes: P[][]
  area: number
}

export interface SketchAnalysis {
  regions: Region[]
  /** Entities that are not part of any closed profile. */
  openEntityIds: Set<string>
  /** Free ends (vertices touching a single segment): where a profile is not closed. */
  openPoints: P[]
  /** Every vertex of the arrangement, including intersections (snap targets). */
  vertices: P[]
}

const TAU = Math.PI * 2
const BOUNDARY_SRC = '__boundary'
const MERGE_TOL = 1e-3

export const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
export const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
export const mul = (a: P, s: number): P => [a[0] * s, a[1] * s]
export const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
export const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0]
export const len = (a: P) => Math.hypot(a[0], a[1])
export const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const norm = (a: P): P => { const l = len(a) || 1; return [a[0] / l, a[1] / l] }
export const polar = (c: P, r: number, a: number): P => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
export const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Normalised sweep of an arc, in (0, 2π]. */
export function arcSweep(a0: number, a1: number): number {
  let s = (a1 - a0) % TAU
  if (s <= 1e-9) s += TAU
  return s
}

export function arcEnds(e: Extract<SketchEntity, { type: 'arc' }>): [P, P] {
  return [polar(e.c, e.r, e.a0), polar(e.c, e.r, e.a0 + arcSweep(e.a0, e.a1))]
}

/** Angle step keeping the chord error under ~0.02 mm (between 2° and 10°). */
function angleStep(r: number): number {
  const ideal = 2 * Math.acos(Math.max(-1, 1 - 0.02 / Math.max(r, 0.01)))
  return Math.min(10 * Math.PI / 180, Math.max(2 * Math.PI / 180, ideal))
}

export function rectCorners(a: P, b: P): P[] {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

export function polygonVertices(e: Extract<SketchEntity, { type: 'polygon' }>): P[] {
  const n = Math.max(3, Math.min(64, Math.round(e.n)))
  return Array.from({ length: n }, (_, i) => polar(e.c, e.r, e.rot + (i * TAU) / n))
}

export function cubicPoint(p: [P, P, P, P], t: number): P {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]]
}

/** Quadratic Bézier (start, control, end) expressed as the equivalent cubic. */
export function quadToCubic(a: P, c: P, b: P): [P, P, P, P] {
  return [a, add(a, mul(sub(c, a), 2 / 3)), add(b, mul(sub(c, b), 2 / 3)), b]
}

/** Centripetal Catmull-Rom through the fit points, sampled. */
export function splinePoints(pts: P[], perSpan = 14): P[] {
  if (pts.length < 3) return pts
  const out: P[] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    const knot = (a: P, b: P) => Math.max(Math.sqrt(dist(a, b)), 1e-6)
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3)
    for (let k = 1; k <= perSpan; k++) {
      const t = t1 + ((t2 - t1) * k) / perSpan
      const lerp = (a: P, b: P, ta: number, tb: number): P => mul(add(mul(a, tb - t), mul(b, t - ta)), 1 / (tb - ta))
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3)
      out.push(lerp(b1, b2, t1, t2))
    }
  }
  return out
}

export function ellipsePoint(e: Extract<SketchEntity, { type: 'ellipse' }>, t: number): P {
  const x = e.rx * Math.cos(t), y = e.ry * Math.sin(t)
  const c = Math.cos(e.rot), s = Math.sin(e.rot)
  return [e.c[0] + x * c - y * s, e.c[1] + x * s + y * c]
}

/** Polyline approximation of an entity (closed entities do not repeat the first point). */
export function tessellate(e: SketchEntity): { pts: P[]; closed: boolean } {
  switch (e.type) {
    case 'line':
      return { pts: [e.a, e.b], closed: false }
    case 'arc': {
      const sweep = arcSweep(e.a0, e.a1)
      const n = Math.max(2, Math.ceil(sweep / angleStep(e.r)))
      const pts: P[] = []
      for (let i = 0; i <= n; i++) pts.push(polar(e.c, e.r, e.a0 + (sweep * i) / n))
      return { pts, closed: false }
    }
    case 'circle': {
      const n = Math.max(12, Math.ceil(TAU / angleStep(e.r)))
      return { pts: Array.from({ length: n }, (_, i) => polar(e.c, e.r, (i * TAU) / n)), closed: true }
    }
    case 'ellipse': {
      const n = Math.max(16, Math.ceil(TAU / angleStep(Math.max(e.rx, e.ry))))
      return { pts: Array.from({ length: n }, (_, i) => ellipsePoint(e, (i * TAU) / n)), closed: true }
    }
    case 'rect':
      return { pts: rectCorners(e.a, e.b), closed: true }
    case 'polygon':
      return { pts: polygonVertices(e), closed: true }
    case 'polyline':
      return { pts: e.pts, closed: e.closed }
    case 'bezier': {
      const len4 = dist(e.pts[0], e.pts[1]) + dist(e.pts[1], e.pts[2]) + dist(e.pts[2], e.pts[3])
      const n = Math.max(12, Math.min(160, Math.ceil(len4 / 1.2)))
      return { pts: Array.from({ length: n + 1 }, (_, i) => cubicPoint(e.pts, i / n)), closed: false }
    }
    case 'spline':
      return { pts: splinePoints(e.pts), closed: false }
    case 'point':
      return { pts: [e.p], closed: false }
  }
}

export function signedArea(pts: P[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

export function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

export function windingNumber(p: P, loops: P[][]): number {
  let w = 0
  for (const poly of loops) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && cross(sub(b, a), sub(p, a)) > 0) w++
      } else if (b[1] <= p[1] && cross(sub(b, a), sub(p, a)) < 0) w--
    }
  }
  return w
}

export function closestOnSegment(p: P, a: P, b: P): { point: P; t: number; d: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  const point: P = [a[0] + ab[0] * t, a[1] + ab[1] * t]
  return { point, t, d: dist(p, point) }
}

export function regionContains(r: Region, p: P): boolean {
  return pointInPolygon(p, r.outer) && !r.holes.some(h => pointInPolygon(p, h))
}

/** A point strictly inside a simple polygon (centroid of the largest ear-ish triangle fallback). */
export function interiorPoint(poly: P[]): P {
  let cx = 0, cy = 0
  for (const p of poly) { cx += p[0]; cy += p[1] }
  const centroid: P = [cx / poly.length, cy / poly.length]
  if (pointInPolygon(centroid, poly)) return centroid
  // Scan horizontal line through the vertical middle and take the midpoint of the widest inside span.
  let ymin = Infinity, ymax = -Infinity
  for (const p of poly) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]) }
  let best: P = centroid, bestW = -1
  for (const f of [0.5, 0.37, 0.63, 0.25, 0.75, 0.13, 0.87]) {
    const y = ymin + (ymax - ymin) * f
    const xs: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    }
    xs.sort((m, n) => m - n)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > bestW) { bestW = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y] }
    }
    if (bestW > 0) break
  }
  return best
}

// ── Planar arrangement ─────────────────────────────────────────────────────

interface Seg { a: P; b: P; src: string }

interface Arrangement {
  verts: P[]
  /** Undirected edges (vertex pairs) with their source entities. */
  edges: { u: number; v: number; src: Set<string> }[]
  originalDegree: number[]
}

class VertexIndex {
  verts: P[] = []
  private grid = new Map<string, number[]>()
  private cell(v: number) { return Math.floor(v / (MERGE_TOL * 4)) }
  get(p: P): number {
    const cx = this.cell(p[0]), cy = this.cell(p[1])
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(this.verts[i], p) <= MERGE_TOL) return i
    }
    const i = this.verts.length
    this.verts.push(p)
    const k = `${cx},${cy}`
    const list = this.grid.get(k)
    if (list) list.push(i)
    else this.grid.set(k, [i])
    return i
  }
}

function buildArrangement(segs: Seg[]): Arrangement {
  const splits: number[][] = segs.map(() => [0, 1])
  const boxes = segs.map(s => [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])])
  const order = segs.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0])
  const eps = 1e-9
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi]
    const bi = boxes[i]
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj]
      const bj = boxes[j]
      if (bj[0] > bi[1] + MERGE_TOL) break
      if (bj[2] > bi[3] + MERGE_TOL || bj[3] < bi[2] - MERGE_TOL) continue
      const p = segs[i].a, r = sub(segs[i].b, p)
      const q = segs[j].a, s = sub(segs[j].b, q)
      const rl = len(r), sl = len(s)
      if (rl < eps || sl < eps) continue
      const d = cross(r, s)
      const qp = sub(q, p)
      if (Math.abs(d) > 1e-9 * rl * sl) {
        const t = cross(qp, s) / d
        const u = cross(qp, r) / d
        const tt = MERGE_TOL / rl, tu = MERGE_TOL / sl
        if (t >= -tt && t <= 1 + tt && u >= -tu && u <= 1 + tu) {
          splits[i].push(Math.max(0, Math.min(1, t)))
          splits[j].push(Math.max(0, Math.min(1, u)))
        }
      } else if (Math.abs(cross(qp, r)) / rl < MERGE_TOL) {
        // Collinear: split each segment at the other one's endpoints.
        for (const pt of [segs[j].a, segs[j].b]) {
          const t = dot(sub(pt, p), r) / (rl * rl)
          if (t > 0 && t < 1) splits[i].push(t)
        }
        for (const pt of [segs[i].a, segs[i].b]) {
          const u = dot(sub(pt, q), s) / (sl * sl)
          if (u > 0 && u < 1) splits[j].push(u)
        }
      }
    }
  }
  // Endpoints lying on another segment's interior (T junctions within tolerance) are caught above
  // because the intersection test accepts t slightly outside [0, 1].
  const index = new VertexIndex()
  const edgeMap = new Map<string, { u: number; v: number; src: Set<string> }>()
  segs.forEach((seg, i) => {
    const ts = [...new Set(splits[i].map(t => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b)
    let prev = -1
    for (const t of ts) {
      const pt: P = [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t]
      const vi = index.get(pt)
      if (prev >= 0 && prev !== vi) {
        const key = prev < vi ? `${prev},${vi}` : `${vi},${prev}`
        const existing = edgeMap.get(key)
        if (existing) existing.src.add(seg.src)
        else edgeMap.set(key, { u: Math.min(prev, vi), v: Math.max(prev, vi), src: new Set([seg.src]) })
      }
      prev = vi
    }
  })
  const edges = [...edgeMap.values()]
  const originalDegree = new Array(index.verts.length).fill(0)
  for (const e of edges) { originalDegree[e.u]++; originalDegree[e.v]++ }
  return { verts: index.verts, edges, originalDegree }
}

interface Face { loop: number[]; area: number; halfEdges: number[] }

interface HalfEdgeGraph {
  verts: P[]
  from: number[]
  to: number[]
  edgeOf: number[]
  faceOf: number[]
  faces: Face[]
}

/** Remove dangling edges, then trace every face (bounded faces are CCW, positive area). */
function traceFaces(arr: Arrangement, alive: boolean[]): HalfEdgeGraph {
  const { verts, edges } = arr
  const from: number[] = [], to: number[] = [], edgeOf: number[] = []
  const out: number[][] = verts.map(() => [])
  edges.forEach((e, i) => {
    if (!alive[i]) return
    const h = from.length
    from.push(e.u, e.v); to.push(e.v, e.u); edgeOf.push(i, i)
    out[e.u].push(h); out[e.v].push(h + 1)
  })
  const angle = (h: number) => Math.atan2(verts[to[h]][1] - verts[from[h]][1], verts[to[h]][0] - verts[from[h]][0])
  const pos = new Array(from.length).fill(0)
  out.forEach(list => {
    list.sort((a, b) => angle(a) - angle(b))
    list.forEach((h, i) => { pos[h] = i })
  })
  const twin = (h: number) => h ^ 1
  const next = (h: number) => {
    const t = twin(h)
    const list = out[to[h]]
    return list[(pos[t] - 1 + list.length) % list.length]
  }
  const faceOf = new Array(from.length).fill(-1)
  const faces: Face[] = []
  for (let h0 = 0; h0 < from.length; h0++) {
    if (faceOf[h0] >= 0) continue
    const loop: number[] = []
    const hs: number[] = []
    let h = h0
    let guard = 0
    while (faceOf[h] < 0 && guard++ < from.length + 2) {
      faceOf[h] = faces.length
      hs.push(h)
      loop.push(from[h])
      h = next(h)
    }
    const area = signedArea(loop.map(i => verts[i]))
    faces.push({ loop, area, halfEdges: hs })
  }
  return { verts, from, to, edgeOf, faceOf, faces }
}

function pruneDangling(arr: Arrangement): boolean[] {
  const alive = arr.edges.map(() => true)
  const deg = [...arr.originalDegree]
  const incident: number[][] = arr.verts.map(() => [])
  arr.edges.forEach((e, i) => { incident[e.u].push(i); incident[e.v].push(i) })
  const queue = deg.map((d, i) => (d === 1 ? i : -1)).filter(i => i >= 0)
  while (queue.length) {
    const v = queue.pop()!
    for (const ei of incident[v]) {
      if (!alive[ei]) continue
      alive[ei] = false
      const e = arr.edges[ei]
      const other = e.u === v ? e.v : e.u
      deg[v]--
      deg[other]--
      if (deg[other] === 1) queue.push(other)
    }
  }
  return alive
}

function components(arr: Arrangement, alive: boolean[]): number[] {
  const parent = arr.verts.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  arr.edges.forEach((e, i) => { if (alive[i]) parent[find(e.u)] = find(e.v) })
  return arr.verts.map((_, i) => find(i))
}

function segmentsOf(entities: SketchEntity[]): Seg[] {
  const segs: Seg[] = []
  for (const e of entities) {
    const { pts, closed } = tessellate(e)
    const n = closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if (dist(a, b) > 1e-6) segs.push({ a, b, src: e.id })
    }
  }
  return segs
}

function regionKey(outer: P[], area: number): string {
  let cx = 0, cy = 0
  for (const p of outer) { cx += p[0]; cy += p[1] }
  return `${(cx / outer.length).toFixed(2)},${(cy / outer.length).toFixed(2)},${area.toFixed(1)}`
}

/** Closed profiles (minimal regions with their holes) and open strokes of a sketch. */
export function analyzeSketch(entities: SketchEntity[], boundary: [P, P][] = []): SketchAnalysis {
  const segs = segmentsOf(entities)
  // Edges of the face the sketch lies on close regions too (arcs ending on a side of the face), but a region made
  // only of those edges is not part of the sketch.
  for (const [a, b] of boundary) if (dist(a, b) > 1e-6) segs.push({ a, b, src: BOUNDARY_SRC })
  const arr = buildArrangement(segs)
  const alive = pruneDangling(arr)
  const graph = traceFaces(arr, alive)
  const comp = components(arr, alive)
  const bounded = graph.faces.filter(f => f.area > 1e-6)
  // The negative face of each connected component is its outer contour.
  const outerContours = graph.faces
    .filter(f => f.area < -1e-6)
    .map(f => ({ comp: comp[f.loop[0]], poly: f.loop.map(i => graph.verts[i]).reverse(), area: -f.area }))
  const regions: Region[] = []
  for (const f of bounded) {
    if (boundary.length && !f.halfEdges.some(h => [...arr.edges[graph.edgeOf[h]].src].some(id => id !== BOUNDARY_SRC))) continue
    const outer = f.loop.map(i => graph.verts[i])
    const myComp = comp[f.loop[0]]
    const candidates = outerContours.filter(c => c.comp !== myComp && c.area < f.area && pointInPolygon(c.poly[0], outer))
    const direct = candidates.filter(c => !candidates.some(o => o !== c && o.area > c.area && pointInPolygon(c.poly[0], o.poly)))
    const holes = direct.map(c => [...c.poly].reverse())
    const area = f.area - direct.reduce((s, c) => s + c.area, 0)
    regions.push({ key: regionKey(outer, area), outer, holes, area })
  }
  const used = new Set<string>()
  arr.edges.forEach((e, i) => { if (alive[i]) e.src.forEach(s => used.add(s)) })
  const openEntityIds = new Set(entities.filter(e => e.type !== 'point').map(e => e.id).filter(id => !used.has(id)))
  // Junctions where different entities meet or cross (not the tessellation points of a curve).
  const sources: Set<string>[] = arr.verts.map(() => new Set())
  for (const e of arr.edges) e.src.forEach(s => { sources[e.u].add(s); sources[e.v].add(s) })
  const openPoints = arr.verts.filter((_, i) => arr.originalDegree[i] === 1 && [...sources[i]].some(id => id !== BOUNDARY_SRC))
  const vertices = arr.verts.filter((_, i) => sources[i].size >= 2)
  return { regions, openEntityIds, openPoints, vertices }
}

/** Boundary loops of the union of the faces of `loops` whose interior satisfies `keep`. */
function unionBoundary(loops: P[][], keep: (p: P) => boolean): P[][] {
  const segs: Seg[] = []
  for (const loop of loops) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length]
    if (dist(a, b) > 1e-6) segs.push({ a, b, src: 'o' })
  }
  const arr = buildArrangement(segs)
  const alive = pruneDangling(arr)
  const g = traceFaces(arr, alive)
  const kept = g.faces.map(f => f.area > 1e-6 && keep(interiorPoint(f.loop.map(i => g.verts[i]))))
  const boundary = new Set<number>()
  g.faces.forEach((f, fi) => {
    if (!kept[fi]) return
    for (const h of f.halfEdges) if (!kept[g.faceOf[h ^ 1]]) boundary.add(h)
  })
  const byStart = new Map<number, number[]>()
  for (const h of boundary) {
    const list = byStart.get(g.from[h])
    if (list) list.push(h)
    else byStart.set(g.from[h], [h])
  }
  const result: P[][] = []
  const used = new Set<number>()
  for (const h0 of boundary) {
    if (used.has(h0)) continue
    const loop: P[] = []
    let h: number | undefined = h0
    while (h !== undefined && !used.has(h)) {
      used.add(h)
      loop.push(g.verts[g.from[h]])
      h = (byStart.get(g.to[h]) ?? []).find(x => !used.has(x))
    }
    if (loop.length >= 3) result.push(simplify(loop))
  }
  return result
}

/** Drop collinear vertices (keeps polylines light after offsets). */
function simplify(loop: P[]): P[] {
  const out: P[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i - 1 + loop.length) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length]
    const ab = sub(b, a), bc = sub(c, b)
    if (Math.abs(cross(ab, bc)) > 1e-7 * (len(ab) * len(bc) + 1e-12) || dot(ab, bc) < 0) out.push(b)
  }
  return out.length >= 3 ? out : loop
}

// ── Offset ────────────────────────────────────────────────────────────────

/** Raw offset to the right of the travel direction (outward for a CCW loop). */
function rawOffset(pts: P[], d: number, closed: boolean): P[] {
  const n = pts.length
  const out: P[] = []
  const dir = (i: number, j: number) => norm(sub(pts[j], pts[i]))
  const right = (t: P): P => [t[1], -t[0]]
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0
    const hasNext = closed || i < n - 1
    const p = pts[i]
    if (!hasPrev) { out.push(add(p, mul(right(dir(i, i + 1)), d))); continue }
    if (!hasNext) { out.push(add(p, mul(right(dir(i - 1, i)), d))); continue }
    const t1 = dir((i - 1 + n) % n, i), t2 = dir(i, (i + 1) % n)
    const n1 = right(t1), n2 = right(t2)
    const m = norm(add(n1, n2))
    const cosHalf = dot(m, n1)
    const turn = cross(t1, t2)
    // Convex for this side when the offset opens a gap: the corner turns away from the offset side.
    const opensGap = d > 0 ? turn > 1e-9 : turn < -1e-9
    if (cosHalf > 0.25 && len(add(n1, n2)) > 1e-9) {
      out.push(add(p, mul(m, d / cosHalf)))
    } else if (opensGap) {
      // Too sharp for a miter: round the corner.
      const a1 = Math.atan2(n1[1], n1[0])
      let sweep = Math.atan2(n2[1], n2[0]) - a1
      if (d > 0) { while (sweep > 0) sweep -= TAU } else { while (sweep < 0) sweep += TAU }
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / angleStep(Math.abs(d))))
      for (let k = 0; k <= steps; k++) {
        const a = a1 + (sweep * k) / steps
        out.push(add(p, [Math.cos(a) * d, Math.sin(a) * d]))
      }
    } else {
      out.push(add(p, mul(n1, d)), add(p, mul(n2, d)))
    }
  }
  return out
}

/** Parallel copy of an open path on its right (`d` > 0) or left (`d` < 0) side. */
export function offsetPath(path: P[], d: number): P[] {
  return rawOffset(path, d, false)
}

/**
 * Offset of a closed loop: `d` > 0 grows the shape, `d` < 0 shrinks it. Self-intersections are
 * resolved with a positive-winding union, so the result is always a set of valid closed loops.
 */
export function offsetLoop(loop: P[], d: number): P[][] {
  if (Math.abs(d) < 1e-6 || loop.length < 3) return []
  const ccw = signedArea(loop) >= 0 ? loop : [...loop].reverse()
  const raw = rawOffset(ccw, d, true)
  const ad = Math.abs(d) * 0.999
  return unionBoundary([raw], p => {
    if (windingNumber(p, [raw]) < 1) return false
    const inside = pointInPolygon(p, ccw)
    return d > 0 ? inside || distToPolyline(p, ccw, true) >= ad : inside && distToPolyline(p, ccw, true) >= ad
  })
}

function distToPolyline(p: P, pts: P[], closed: boolean): number {
  let best = Infinity
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) best = Math.min(best, closestOnSegment(p, pts[i], pts[(i + 1) % pts.length]).d)
  return best
}

/** Closed band of total width `width` centred on an open path ("spessore"). */
export function thickenPath(path: P[], width: number): P[][] {
  if (path.length < 2 || width <= 1e-6) return []
  const h = width / 2
  const right = rawOffset(path, h, false)
  const left = rawOffset(path, -h, false)
  const outline = [...right, ...left.reverse()]
  const loop = signedArea(outline) >= 0 ? outline : outline.reverse()
  return unionBoundary([loop], p => windingNumber(p, [loop]) !== 0 && distToPolyline(p, path, false) <= h * 1.001)
}

// ── Chains (entities joined end to end) ───────────────────────────────────

export function entityEnds(e: SketchEntity): [P, P] | null {
  if (e.type === 'line') return [e.a, e.b]
  if (e.type === 'arc') return arcEnds(e)
  if (e.type === 'polyline' && !e.closed && e.pts.length >= 2) return [e.pts[0], e.pts[e.pts.length - 1]]
  if (e.type === 'bezier') return [e.pts[0], e.pts[3]]
  if (e.type === 'spline' && e.pts.length >= 2) return [e.pts[0], e.pts[e.pts.length - 1]]
  return null
}

/** The run of open entities connected end-to-end through `start` (stops at branches). */
export function chainFrom(entities: SketchEntity[], startId: string): { pts: P[]; closed: boolean; ids: string[] } | null {
  const start = entities.find(e => e.id === startId)
  if (!start) return null
  const own = tessellate(start)
  if (!entityEnds(start)) return { pts: own.pts, closed: own.closed, ids: [start.id] }
  const tol = MERGE_TOL * 10
  const open = entities.filter(e => entityEnds(e))
  const at = (p: P) => open.filter(e => entityEnds(e)!.some(q => dist(p, q) <= tol))
  const used = new Set([start.id])
  let pts = [...own.pts]
  for (const forward of [true, false]) {
    for (;;) {
      const tip = forward ? pts[pts.length - 1] : pts[0]
      const here = at(tip)
      if (here.length !== 2) break
      const nextE = here.find(e => !used.has(e.id))
      if (!nextE) break
      used.add(nextE.id)
      let seg = tessellate(nextE).pts
      if (forward) {
        if (dist(seg[0], tip) > dist(seg[seg.length - 1], tip)) seg = [...seg].reverse()
        pts = [...pts, ...seg.slice(1)]
      } else {
        if (dist(seg[seg.length - 1], tip) > dist(seg[0], tip)) seg = [...seg].reverse()
        pts = [...seg.slice(0, -1), ...pts]
      }
    }
  }
  const closed = pts.length > 3 && dist(pts[0], pts[pts.length - 1]) <= tol
  if (closed) pts = pts.slice(0, -1)
  return { pts, closed, ids: [...used] }
}

// ── Snapping helpers ───────────────────────────────────────────────────────

export type SnapKind = 'end' | 'mid' | 'center' | 'quadrant' | 'intersection' | 'origin' | 'reference'

export interface KeyPoint { p: P; kind: SnapKind }

export function keyPoints(e: SketchEntity): KeyPoint[] {
  switch (e.type) {
    case 'line':
      return [{ p: e.a, kind: 'end' }, { p: e.b, kind: 'end' }, { p: mul(add(e.a, e.b), 0.5), kind: 'mid' }]
    case 'arc': {
      const [a, b] = arcEnds(e)
      return [{ p: a, kind: 'end' }, { p: b, kind: 'end' }, { p: e.c, kind: 'center' }, { p: polar(e.c, e.r, e.a0 + arcSweep(e.a0, e.a1) / 2), kind: 'mid' }]
    }
    case 'circle':
      return [{ p: e.c, kind: 'center' }, ...[0, 1, 2, 3].map(i => ({ p: polar(e.c, e.r, (i * Math.PI) / 2), kind: 'quadrant' as const }))]
    case 'ellipse':
      return [{ p: e.c, kind: 'center' }, ...[0, 1, 2, 3].map(i => ({ p: ellipsePoint(e, (i * Math.PI) / 2), kind: 'quadrant' as const }))]
    case 'rect': {
      const c = rectCorners(e.a, e.b)
      return [
        ...c.map(p => ({ p, kind: 'end' as const })),
        ...c.map((p, i) => ({ p: mul(add(p, c[(i + 1) % 4]), 0.5), kind: 'mid' as const })),
        { p: mul(add(c[0], c[2]), 0.5), kind: 'center' },
      ]
    }
    case 'polygon': {
      const v = polygonVertices(e)
      return [{ p: e.c, kind: 'center' }, ...v.map(p => ({ p, kind: 'end' as const })), ...v.map((p, i) => ({ p: mul(add(p, v[(i + 1) % v.length]), 0.5), kind: 'mid' as const }))]
    }
    case 'polyline':
      return e.pts.map(p => ({ p, kind: 'end' as const }))
    case 'bezier':
      return [{ p: e.pts[0], kind: 'end' }, { p: e.pts[3], kind: 'end' }, { p: cubicPoint(e.pts, 0.5), kind: 'mid' }]
    case 'spline':
      return e.pts.map(p => ({ p, kind: 'end' as const }))
    case 'point':
      return [{ p: e.p, kind: 'end' as const }]
  }
}

/** Closest point on an entity (via its tessellation). */
export function nearestOnEntity(e: SketchEntity, p: P): { point: P; d: number } {
  if (e.type === 'point') return { point: e.p, d: dist(p, e.p) }
  if (e.type === 'circle') {
    const v = sub(p, e.c)
    const point = add(e.c, mul(norm(len(v) < 1e-9 ? [1, 0] : v), e.r))
    return { point, d: dist(p, point) }
  }
  const { pts, closed } = tessellate(e)
  let best = { point: pts[0], d: Infinity }
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const c = closestOnSegment(p, pts[i], pts[(i + 1) % pts.length])
    if (c.d < best.d) best = { point: c.point, d: c.d }
  }
  return best
}

/** Circle through three points (null when collinear). */
export function circleFrom3(a: P, b: P, c: P): { c: P; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-9) return null
  const a2 = dot(a, a), b2 = dot(b, b), c2 = dot(c, c)
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  const center: P = [ux, uy]
  return { c: center, r: dist(center, a) }
}

/** Arc from start `a` to end `b` passing through `m`. */
export function arcThrough(id: string, a: P, b: P, m: P): Extract<SketchEntity, { type: 'arc' }> | null {
  const circ = circleFrom3(a, m, b)
  if (!circ || circ.r > 1e5) return null
  const ang = (p: P) => Math.atan2(p[1] - circ.c[1], p[0] - circ.c[0])
  const aa = ang(a), ab = ang(b), am = ang(m)
  const ccwHasM = arcSweep(aa, am) < arcSweep(aa, ab)
  return ccwHasM
    ? { id, type: 'arc', c: circ.c, r: circ.r, a0: aa, a1: ab }
    : { id, type: 'arc', c: circ.c, r: circ.r, a0: ab, a1: aa }
}

/** Arc with the same chord a→b and side as `m` but an exact radius (null if r < chord/2). */
export function arcWithRadius(id: string, a: P, b: P, m: P, r: number): Extract<SketchEntity, { type: 'arc' }> | null {
  const chord = dist(a, b)
  if (r < chord / 2 - 1e-9) return null
  const mid = mul(add(a, b), 0.5)
  const t = norm(sub(b, a))
  const nrm: P = [-t[1], t[0]]
  const side = Math.sign(dot(sub(m, mid), nrm)) || 1
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2))
  // Bulge point on the side of `m`; the shorter arc unless m sits beyond the circle centre.
  const bulgeFar = dist(m, mid) > h
  const centre = add(mid, mul(nrm, bulgeFar ? -side * h : side * h))
  const top = add(centre, mul(nrm, side * r))
  return arcThrough(id, a, b, top)
}

// ── Transforms ─────────────────────────────────────────────────────────────

export function translateEntity(e: SketchEntity, d: P): SketchEntity {
  switch (e.type) {
    case 'line': return { ...e, a: add(e.a, d), b: add(e.b, d) }
    case 'rect': return { ...e, a: add(e.a, d), b: add(e.b, d) }
    case 'polyline': return { ...e, pts: e.pts.map(p => add(p, d)) }
    case 'point': return { ...e, p: add(e.p, d) }
    case 'bezier': return { ...e, pts: e.pts.map(p => add(p, d)) as [P, P, P, P] }
    case 'spline': return { ...e, pts: e.pts.map(p => add(p, d)) }
    default: return { ...e, c: add(e.c, d) }
  }
}

/** Scale about the origin; non-uniform scales turn round entities into ellipses / polylines. */
export function scaleEntity(e: SketchEntity, sx: number, sy: number): SketchEntity {
  const sp = (p: P): P => [p[0] * sx, p[1] * sy]
  const uniform = Math.abs(sx - sy) < 1e-6
  switch (e.type) {
    case 'line': return { ...e, a: sp(e.a), b: sp(e.b) }
    case 'rect': return { ...e, a: sp(e.a), b: sp(e.b) }
    case 'polyline': return { ...e, pts: e.pts.map(sp) }
    case 'point': return { ...e, p: sp(e.p) }
    case 'bezier': return { ...e, pts: e.pts.map(sp) as [P, P, P, P] }
    case 'spline': return { ...e, pts: e.pts.map(sp) }
    case 'circle': return uniform ? { ...e, c: sp(e.c), r: e.r * sx } : { id: e.id, type: 'ellipse', c: sp(e.c), rx: e.r * sx, ry: e.r * sy, rot: 0 }
    case 'ellipse':
      if (uniform) return { ...e, c: sp(e.c), rx: e.rx * sx, ry: e.ry * sx }
      if (Math.abs(Math.sin(e.rot)) < 1e-9) return { ...e, c: sp(e.c), rx: e.rx * sx, ry: e.ry * sy }
      return { id: e.id, type: 'polyline', pts: tessellate(e).pts.map(sp), closed: true }
    case 'arc':
      return uniform ? { ...e, c: sp(e.c), r: e.r * sx } : { id: e.id, type: 'polyline', pts: tessellate(e).pts.map(sp), closed: false }
    case 'polygon':
      return uniform ? { ...e, c: sp(e.c), r: e.r * sx } : { id: e.id, type: 'polyline', pts: polygonVertices(e).map(sp), closed: true }
  }
}

export function entitiesBounds(entities: SketchEntity[]): { min: P; max: P } | null {
  let min: P = [Infinity, Infinity], max: P = [-Infinity, -Infinity]
  for (const e of entities) for (const p of tessellate(e).pts) {
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])]
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])]
  }
  return Number.isFinite(min[0]) ? { min, max } : null
}
