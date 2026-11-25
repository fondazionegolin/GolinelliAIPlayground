import * as THREE from 'three'
import { analyzeSketch, chainFrom, dist, dot, len, signedArea, sub, type P, type Region, type SketchEntity } from './geom2d'
import type { ProfileRegion } from '../types'

export interface RevolveAxis { a: P; d: P }

/** Signed distance of a sketch point from the axis (positive on the left of its direction) and its position along it. */
export function axisCoords(ax: RevolveAxis, p: P): { s: number; r: number } {
  const l = len(ax.d) || 1
  const d: P = [ax.d[0] / l, ax.d[1] / l]
  const v = sub(p, ax.a)
  return { s: dot(v, d), r: -v[0] * d[1] + v[1] * d[0] }
}

/** Which side(s) of the axis a profile touches: 'crosses' means it cannot be revolved. */
export function profileSide(profile: ProfileRegion[], ax: RevolveAxis): 'left' | 'right' | 'crosses' | 'empty' {
  let lo = Infinity, hi = -Infinity
  for (const reg of profile) for (const p of reg.outer) {
    const { r } = axisCoords(ax, p as P)
    lo = Math.min(lo, r); hi = Math.max(hi, r)
  }
  if (!Number.isFinite(lo)) return 'empty'
  if (lo < -1e-4 && hi > 1e-4) return 'crosses'
  return hi > 1e-4 ? 'left' : 'right'
}

/**
 * Solid of revolution of closed regions about an in-plane axis, in the sketch's local frame
 * (x = u, y = v, z = plane normal). `angle` in degrees (360 = full turn); partial turns get end caps.
 */
export function revolveGeometry(profile: ProfileRegion[], ax: RevolveAxis, angleDeg: number): THREE.BufferGeometry {
  const full = angleDeg >= 359.999
  const theta = Math.max(1, Math.min(360, angleDeg)) * (Math.PI / 180)
  const l = len(ax.d) || 1
  const d = new THREE.Vector3(ax.d[0] / l, ax.d[1] / l, 0)
  const n = new THREE.Vector3(0, 0, 1)
  const side = new THREE.Vector3().crossVectors(n, d) // in-plane, left of the axis
  const origin = new THREE.Vector3(ax.a[0], ax.a[1], 0)
  const sides = profileSide(profile, ax)
  const sign = sides === 'right' ? -1 : 1
  const steps = Math.max(8, Math.ceil(theta / (Math.PI / 24)))
  const at = (p: P, k: number): THREE.Vector3 => {
    const v = new THREE.Vector3(p[0] - ax.a[0], p[1] - ax.a[1], 0)
    const s = v.dot(d)
    const r = Math.max(0, sign * v.dot(side))
    const ang = (theta * k) / steps
    // Revolve from the sketch plane towards +normal.
    return origin.clone().addScaledVector(d, s).addScaledVector(side, sign * r * Math.cos(ang)).addScaledVector(n, r * Math.sin(ang))
  }
  const pos: number[] = []
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  const loops: P[][] = []
  for (const reg of profile) { loops.push(reg.outer as P[]); for (const h of reg.holes ?? []) loops.push(h as P[]) }
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length]
      const rp = Math.abs(axisCoords(ax, p).r), rq = Math.abs(axisCoords(ax, q).r)
      for (let k = 0; k < steps; k++) {
        const a0 = at(p, k), a1 = at(p, k + 1), b0 = at(q, k), b1 = at(q, k + 1)
        if (rp > 1e-9 || rq > 1e-9) {
          if (rp > 1e-9 && rq > 1e-9) { tri(a0, b0, b1); tri(a0, b1, a1) }
          else if (rp > 1e-9) tri(a0, b0, a1)
          else tri(a0, b0, b1)
        }
      }
    }
  }
  if (!full) {
    for (const reg of profile) {
      const shape = new THREE.Shape(reg.outer.map(([x, y]) => new THREE.Vector2(x, y)))
      for (const h of reg.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      const g = new THREE.ShapeGeometry(shape)
      const idx = g.index!, p = g.getAttribute('position')
      const v = (i: number, k: number) => at([p.getX(i), p.getY(i)], k)
      for (let i = 0; i < idx.count; i += 3) {
        tri(v(idx.getX(i), 0), v(idx.getX(i + 2), 0), v(idx.getX(i + 1), 0))
        tri(v(idx.getX(i), steps), v(idx.getX(i + 1), steps), v(idx.getX(i + 2), steps))
      }
      g.dispose()
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  // Consistent outward orientation: flip everything when the signed volume is negative.
  let vol = 0
  for (let i = 0; i < pos.length; i += 9) {
    const a = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]), b = new THREE.Vector3(pos[i + 3], pos[i + 4], pos[i + 5]), c = new THREE.Vector3(pos[i + 6], pos[i + 7], pos[i + 8])
    vol += a.dot(b.clone().cross(c)) / 6
  }
  if (vol < 0) {
    for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  }
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

// ── Profile from the segments the user picked ──────────────────────────────

const onAxis = (ax: RevolveAxis, p: P): P => {
  const l = len(ax.d) || 1
  const d: P = [ax.d[0] / l, ax.d[1] / l]
  const s = dot(sub(p, ax.a), d)
  return [ax.a[0] + d[0] * s, ax.a[1] + d[1] * s]
}

export interface RevolveProfile {
  regions: Region[]
  /** Segments added to close open curves against the axis (drawn dashed so the user sees the real shape). */
  closing: [P, P][]
  /** Picked strokes that neither close a shape nor can be closed (e.g. isolated points). */
  ignored: number
}

/**
 * The shape that will be revolved: closed shapes among the picked segments / curves are used as they are, while an open
 * chain (e.g. the silhouette of a vase) is closed against the axis with perpendicular drops from its two ends.
 */
export function profileFromSelection(entities: SketchEntity[], ids: string[], axis: RevolveAxis): RevolveProfile {
  const picked = entities.filter(e => ids.includes(e.id) && e.type !== 'point')
  const analysis = analyzeSketch(picked)
  const regions: Region[] = [...analysis.regions]
  const closing: [P, P][] = []
  const seen = new Set<string>()
  let ignored = 0
  for (const id of analysis.openEntityIds) {
    if (seen.has(id)) continue
    const chain = chainFrom(picked, id)
    if (!chain) { ignored++; continue }
    chain.ids.forEach(i => seen.add(i))
    if (chain.closed) continue
    const pts = chain.pts
    const first = pts[0], last = pts[pts.length - 1]
    const q0 = onAxis(axis, first), qn = onAxis(axis, last)
    const poly: P[] = [...pts]
    if (dist(last, qn) > 1e-6) { poly.push(qn); closing.push([last, qn]) }
    if (dist(qn, q0) > 1e-6) { if (dist(first, q0) > 1e-6) poly.push(q0); closing.push([qn, q0]) }
    if (dist(first, q0) > 1e-6) closing.push([q0, first])
    const area = signedArea(poly)
    if (Math.abs(area) < 1e-6) { ignored++; continue }
    const outer = area > 0 ? poly : [...poly].reverse()
    let cx = 0, cy = 0
    for (const p of outer) { cx += p[0]; cy += p[1] }
    regions.push({ key: `axis:${(cx / outer.length).toFixed(2)},${(cy / outer.length).toFixed(2)}:${Math.abs(area).toFixed(1)}`, outer, holes: [], area: Math.abs(area) })
  }
  return { regions, closing, ignored }
}
