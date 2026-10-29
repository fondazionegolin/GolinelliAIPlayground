import { Matrix4, Quaternion, Vector3 } from 'three'
import type { SolidWidget } from './types'

/**
 * Solids of the Lab and their nets. A net is a spanning tree of the faces: every face but the root hangs from its parent
 * on a shared edge (the hinge) and turns around it until it lies in the parent's plane. Turning every hinge by the same
 * fraction `t` of its angle animates the solid opening flat (t = 0 folded, t = 1 the net).
 */
export type Vec = [number, number, number]
export type Polyhedron = {
  vertices: Vec[]
  /** Vertex indices of each face, counter-clockwise seen from outside. */
  faces: number[][]
  /** Bases, coloured apart from the lateral faces. */
  bases: number[]
  /** Lateral faces approximate a curved surface (cylinder, cone): their edges are not real edges. */
  smooth: boolean
}
export type Net = {
  root: number
  /** Faces in tree order (parents before children). */
  order: number[]
  parent: number[]
  hinge: Array<[number, number] | null>
  /** Signed angle (radians) that lays each face flat on its parent. */
  angle: number[]
}

const PHI = (1 + Math.sqrt(5)) / 2
const SMOOTH_SIDES = 48

const vec = (p: Vec) => new Vector3(p[0], p[1], p[2])
const centroid = (pts: Vector3[]) => pts.reduce((s, p) => s.add(p), new Vector3()).divideScalar(pts.length)
const cross = (a: Vector3, b: Vector3, c: Vector3) => b.clone().sub(a).cross(c.clone().sub(a))

export function faceNormal(poly: Polyhedron, f: number): Vector3 {
  const [a, b, c] = poly.faces[f].map(i => vec(poly.vertices[i]))
  return cross(a, b, c).normalize()
}

/** Makes every face counter-clockwise from outside (the solids are convex: outside = away from the centre). */
function oriented(vertices: Vec[], faces: number[][]): number[][] {
  const center = centroid(vertices.map(vec))
  return faces.map(face => {
    const pts = face.map(i => vec(vertices[i]))
    return cross(pts[0], pts[1], pts[2]).dot(centroid(pts).sub(center)) < 0 ? [...face].reverse() : face
  })
}

/** Faces of the convex hull of points that are all hull vertices (the Platonic solids), each in order around its centre. */
function hullFaces(vertices: Vec[]): number[][] {
  const pts = vertices.map(vec), faces = new Map<string, number[]>()
  const eps = 1e-6 * Math.max(...pts.map(p => p.length()))
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
    const n = cross(pts[i], pts[j], pts[k])
    if (n.length() < eps) continue
    n.normalize()
    const d = n.dot(pts[i]), side = pts.map(p => n.dot(p) - d)
    if (side.some(s => s > eps) && side.some(s => s < -eps)) continue
    const on = side.flatMap((s, idx) => Math.abs(s) <= eps ? [idx] : [])
    faces.set(on.join(','), on)
  }
  return [...faces.values()].map(face => {
    const p = face.map(i => pts[i]), c = centroid(p)
    const n = cross(p[0], p[1], p[2]).normalize(), u = p[0].clone().sub(c).normalize(), w = n.clone().cross(u)
    const angle = (q: Vector3) => Math.atan2(q.clone().sub(c).dot(w), q.clone().sub(c).dot(u))
    return face.map((idx, k) => ({ idx, a: angle(p[k]) })).sort((x, y) => x.a - y.a).map(e => e.idx)
  })
}

/** Centres the bounding box on the origin. */
function centred(poly: Polyhedron): Polyhedron {
  const mid = [0, 1, 2].map(k => (Math.min(...poly.vertices.map(p => p[k])) + Math.max(...poly.vertices.map(p => p[k]))) / 2)
  return { ...poly, vertices: poly.vertices.map(p => [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]] as Vec) }
}

/** A Platonic solid scaled to the requested edge, resting on a face. */
function platonic(vertices: Vec[], edge: number): Polyhedron {
  const faces = oriented(vertices, hullFaces(vertices))
  let pts = vertices.map(vec)
  const shortest = Math.min(...faces.flatMap(f => f.map((idx, k) => pts[idx].distanceTo(pts[f[(k + 1) % f.length]]))))
  const n = cross(pts[faces[0][0]], pts[faces[0][1]], pts[faces[0][2]]).normalize()
  const rest = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(n, new Vector3(0, -1, 0)))
  pts = pts.map(p => p.multiplyScalar(edge / shortest).applyMatrix4(rest))
  return centred({ vertices: pts.map(p => p.toArray() as Vec), faces, bases: [], smooth: false })
}

/** Every sign combination of the generating points (the usual coordinates of the Platonic solids). */
function signs(points: Vec[]): Vec[] {
  const all = new Map<string, Vec>()
  for (const p of points) for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const q: Vec = [p[0] * sx, p[1] * sy, p[2] * sz]
    all.set(q.map(c => (c + 0).toFixed(6)).join(','), q)
  }
  return [...all.values()]
}

function ring(sides: number, radius: number, y: number): Vec[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = Math.PI / 2 - Math.PI / sides + i * 2 * Math.PI / sides  // a side faces the viewer
    return [radius * Math.cos(angle), y, radius * Math.sin(angle)] as Vec
  })
}

/** Prism-like solid: faces are bottom, top, then the lateral faces in order around. */
function prism(sides: number, radius: number, height: number, smooth = false): Polyhedron {
  const vertices = [...ring(sides, radius, 0), ...ring(sides, radius, height)]
  const lateral = Array.from({ length: sides }, (_, i) => [i, (i + 1) % sides, sides + (i + 1) % sides, sides + i])
  const faces = oriented(vertices, [[...Array(sides).keys()], [...Array(sides).keys()].map(i => sides + i), ...lateral])
  return centred({ vertices, faces, bases: [0, 1], smooth })
}

/** Pyramid-like solid: faces are the base, then the lateral triangles in order around. */
function pyramid(sides: number, radius: number, height: number, smooth = false): Polyhedron {
  const vertices = [...ring(sides, radius, 0), [0, height, 0] as Vec]
  const lateral = Array.from({ length: sides }, (_, i) => [i, (i + 1) % sides, sides])
  return centred({ vertices, faces: oriented(vertices, [[...Array(sides).keys()], ...lateral]), bases: [0], smooth })
}

/** null for a sphere: it has no faces to unfold, the card draws it directly. */
export function buildSolid(w: Pick<SolidWidget, 'shape' | 'sides' | 'a' | 'b' | 'c'>): Polyhedron | null {
  const sides = Math.min(12, Math.max(3, Math.round(w.sides || 4)))
  switch (w.shape) {
    case 'cube': case 'cuboid': {
      const [x, z, y] = w.shape === 'cube' ? [w.a, w.a, w.a] : [w.a, w.b, w.c]
      const vertices: Vec[] = [[0, 0, z], [x, 0, z], [x, 0, 0], [0, 0, 0], [0, y, z], [x, y, z], [x, y, 0], [0, y, 0]]
      const faces = oriented(vertices, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]])
      return centred({ vertices, faces, bases: [0, 1], smooth: false })
    }
    case 'prism': return prism(sides, w.a / (2 * Math.sin(Math.PI / sides)), w.c)
    case 'pyramid': return pyramid(sides, w.a / (2 * Math.sin(Math.PI / sides)), w.c)
    case 'cylinder': return prism(SMOOTH_SIDES, w.a, w.c, true)
    case 'cone': return pyramid(SMOOTH_SIDES, w.a, w.c, true)
    case 'tetrahedron': return platonic([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], w.a)
    case 'octahedron': return platonic(signs([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), w.a)
    case 'icosahedron': return platonic(signs([[0, 1, PHI], [1, PHI, 0], [PHI, 0, 1]]), w.a)
    case 'dodecahedron': return platonic(signs([[1, 1, 1], [0, 1 / PHI, PHI], [1 / PHI, PHI, 0], [PHI, 0, 1 / PHI]]), w.a)
    default: return null
  }
}

const edgeKey = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`

/** Faces sharing each edge. */
function adjacency(poly: Polyhedron): Map<number, Array<{ face: number; edge: [number, number] }>> {
  const byEdge = new Map<string, number[]>()
  poly.faces.forEach((f, i) => f.forEach((a, k) => {
    const key = edgeKey(a, f[(k + 1) % f.length])
    byEdge.set(key, [...(byEdge.get(key) ?? []), i])
  }))
  const out = new Map<number, Array<{ face: number; edge: [number, number] }>>(poly.faces.map((_, i) => [i, []]))
  for (const [key, faces] of byEdge) {
    if (faces.length !== 2) continue
    const edge = key.split('-').map(Number) as [number, number]
    out.get(faces[0])!.push({ face: faces[1], edge }); out.get(faces[1])!.push({ face: faces[0], edge })
  }
  return out
}

/** Builds the hinge angles for a tree given as parent links. */
function withAngles(poly: Polyhedron, root: number, parent: number[], hinge: Array<[number, number] | null>): Net {
  const order = [root], angle = poly.faces.map(() => 0)
  for (let i = 0; i < order.length; i++) poly.faces.forEach((_, f) => { if (parent[f] === order[i] && f !== root) order.push(f) })
  for (const f of order.slice(1)) {
    const [a, b] = hinge[f]!.map(i => vec(poly.vertices[i]))
    const axis = b.clone().sub(a).normalize(), nf = faceNormal(poly, f), np = faceNormal(poly, parent[f])
    const theta = Math.acos(Math.min(1, Math.max(-1, nf.dot(np))))
    // Of the two turns that make the face coplanar, the one that aligns the normals opens it outward.
    angle[f] = nf.clone().applyAxisAngle(axis, theta).dot(np) > nf.clone().applyAxisAngle(axis, -theta).dot(np) ? theta : -theta
  }
  return { root, order, parent, hinge, angle }
}

/** Spanning tree by breadth (a flower around the root) or depth (a strip), from `root`, neighbours in the given order. */
function tree(poly: Polyhedron, root: number, depth: boolean, adj = adjacency(poly)): Net {
  const parent = poly.faces.map(() => -1), hinge: Array<[number, number] | null> = poly.faces.map(() => null)
  const seen = new Set([root]), frontier = [root]
  while (frontier.length) {
    const f = depth ? frontier.pop()! : frontier.shift()!
    for (const { face, edge } of adj.get(f)!) {
      if (seen.has(face)) continue
      seen.add(face); parent[face] = f; hinge[face] = edge; frontier.push(face)
    }
  }
  return withAngles(poly, root, parent, hinge)
}

/** The classic nets: a strip of lateral faces with the bases on its first face (prisms), a fan (cones), a flower (pyramids). */
function classic(poly: Polyhedron, kind: 'strip' | 'fan'): Net {
  const adj = adjacency(poly), n = poly.faces.length
  const parent = poly.faces.map(() => -1), hinge: Array<[number, number] | null> = poly.faces.map(() => null)
  const lateral = kind === 'strip' ? [...Array(n - 2).keys()].map(i => i + 2) : [...Array(n - 1).keys()].map(i => i + 1)
  const link = (child: number, to: number) => { parent[child] = to; hinge[child] = adj.get(child)!.find(e => e.face === to)!.edge }
  link(lateral[0], 0)
  lateral.slice(1).forEach((f, i) => link(f, lateral[i]))
  if (kind === 'strip') link(1, lateral[0])
  return withAngles(poly, 0, parent, hinge)
}

/** Placement of every face after turning each hinge by `t` of its angle. */
export function faceMatrices(poly: Polyhedron, net: Net, t: number): Matrix4[] {
  const out = poly.faces.map(() => new Matrix4())
  for (const f of net.order.slice(1)) {
    const [a, b] = net.hinge[f]!.map(i => vec(poly.vertices[i]))
    const turn = new Matrix4().makeTranslation(a.x, a.y, a.z)
      .multiply(new Matrix4().makeRotationAxis(b.clone().sub(a).normalize(), net.angle[f] * t))
      .multiply(new Matrix4().makeTranslation(-a.x, -a.y, -a.z))
    out[f] = out[net.parent[f]].clone().multiply(turn)
  }
  return out
}

/** The opened net as 2D polygons in the root's plane. */
export function flatNet(poly: Polyhedron, net: Net): Array<Array<[number, number]>> {
  const m = faceMatrices(poly, net, 1)
  const rootPts = poly.faces[net.root].map(i => vec(poly.vertices[i]))
  const origin = rootPts[0], u = rootPts[1].clone().sub(origin).normalize(), w = faceNormal(poly, net.root).cross(u)
  return poly.faces.map((face, f) => face.map(i => {
    const p = vec(poly.vertices[i]).applyMatrix4(m[f]).sub(origin)
    return [p.dot(u), p.dot(w)] as [number, number]
  }))
}

/** Two convex polygons overlap (more than touching): separating axis test on slightly shrunk copies. */
function overlap(p: Array<[number, number]>, q: Array<[number, number]>): boolean {
  const shrink = (poly: Array<[number, number]>) => {
    const cx = poly.reduce((s, a) => s + a[0], 0) / poly.length, cy = poly.reduce((s, a) => s + a[1], 0) / poly.length
    return poly.map(([x, y]) => [cx + (x - cx) * .98, cy + (y - cy) * .98] as [number, number])
  }
  const a = shrink(p), b = shrink(q)
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length], nx = y1 - y2, ny = x2 - x1
    const range = (s: Array<[number, number]>) => s.map(([x, y]) => x * nx + y * ny)
    const ra = range(a), rb = range(b)
    if (Math.max(...ra) <= Math.min(...rb) || Math.max(...rb) <= Math.min(...ra)) return false
  }
  return true
}

export function netOverlaps(poly: Polyhedron, net: Net): boolean {
  const flat = flatNet(poly, net)
  return flat.some((p, i) => flat.slice(i + 1).some(q => overlap(p, q)))
}

/** A net that opens without faces landing on each other: the classic one when the solid has it, else the first good tree. */
export function buildNet(poly: Polyhedron, shape: SolidWidget['shape']): Net {
  if (shape === 'prism' || shape === 'cylinder' || shape === 'cube' || shape === 'cuboid') return classic(poly, 'strip')
  if (shape === 'cone') return classic(poly, 'fan')
  const roots = [0, ...poly.faces.keys()].filter((f, i, all) => all.indexOf(f) === i)
  let fallback: Net | null = null
  for (const depth of [false, true]) for (const root of roots) {
    const net = tree(poly, root, depth)
    fallback ??= net
    if (!netOverlaps(poly, net)) return net
  }
  return fallback!
}
