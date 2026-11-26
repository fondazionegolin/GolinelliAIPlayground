import { uid } from '../sceneOps'
import { entitiesBounds, rectCorners, sub, translateEntity, type P, type SketchEntity } from './geom2d'

/** Rectangular / circular repetition of sketch entities (the originals are kept by the caller). */

export type PatternMode = 'rect' | 'circ'

const rot = (p: P, c: P, a: number): P => {
  const d = sub(p, c), cs = Math.cos(a), sn = Math.sin(a)
  return [c[0] + d[0] * cs - d[1] * sn, c[1] + d[0] * sn + d[1] * cs]
}

/** Copy of `e` turned by `a` radians (counter-clockwise) about `c`, with a fresh id. */
export function rotateEntity(e: SketchEntity, c: P, a: number): SketchEntity {
  const id = uid('e')
  const pt = (p: P) => rot(p, c, a)
  switch (e.type) {
    case 'line': return { id, type: 'line', a: pt(e.a), b: pt(e.b) }
    case 'point': return { id, type: 'point', p: pt(e.p) }
    case 'circle': return { id, type: 'circle', c: pt(e.c), r: e.r }
    case 'polyline': return { id, type: 'polyline', pts: e.pts.map(pt), closed: e.closed }
    case 'bezier': return { id, type: 'bezier', pts: e.pts.map(pt) as [P, P, P, P] }
    case 'spline': return { id, type: 'spline', pts: e.pts.map(pt) }
    case 'rect': {
      const quarter = Math.abs(Math.sin(2 * a)) < 1e-9
      return quarter ? { id, type: 'rect', a: pt(e.a), b: pt(e.b) } : { id, type: 'polyline', pts: rectCorners(e.a, e.b).map(pt), closed: true }
    }
    case 'arc': return { id, type: 'arc', c: pt(e.c), r: e.r, a0: e.a0 + a, a1: e.a1 + a }
    case 'ellipse': return { id, type: 'ellipse', c: pt(e.c), rx: e.rx, ry: e.ry, rot: e.rot + a }
    case 'polygon': return { id, type: 'polygon', c: pt(e.c), r: e.r, n: e.n, rot: e.rot + a }
  }
}

export const MAX_COPIES = 400

/** Centre of the source's bounding box (where the arrows of the rectangular pattern start). */
export function sourceCenter(src: SketchEntity[]): P {
  const b = entitiesBounds(src)
  return b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [0, 0]
}

/** Default step: the object's size plus a little air. */
export function defaultStep(src: SketchEntity[]): P {
  const b = entitiesBounds(src)
  const w = b ? b.max[0] - b.min[0] : 0, h = b ? b.max[1] - b.min[1] : 0
  const step = (s: number) => Math.round(Math.max(s * 1.25, s + 2, 10) * 100) / 100
  return [step(w), step(h)]
}

/** nx × ny grid, columns spaced by `dx` (negative = to the left), rows by `dy` (negative = down). The original cell is skipped. */
export function rectPattern(src: SketchEntity[], nx: number, ny: number, dx: number, dy: number): SketchEntity[] {
  const out: SketchEntity[] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!i && !j) continue
    if (out.length / Math.max(src.length, 1) >= MAX_COPIES) return out
    const d: P = [i * dx, j * dy]
    for (const e of src) out.push({ ...translateEntity(e, d), id: uid('e') })
  }
  return out
}

/** `count` equal turns about `centre`: a full circle (≥ 360°) is divided evenly, a partial arc spans first to last. */
export function circularPattern(src: SketchEntity[], centre: P, count: number, totalDeg: number): SketchEntity[] {
  const out: SketchEntity[] = []
  if (count < 2) return out
  const full = Math.abs(totalDeg) >= 360 - 1e-9
  const step = ((full ? Math.sign(totalDeg || 1) * 360 / count : totalDeg / (count - 1)) * Math.PI) / 180
  for (let i = 1; i < count; i++) for (const e of src) out.push(rotateEntity(e, centre, step * i))
  return out
}
