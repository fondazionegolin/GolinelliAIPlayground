import * as THREE from 'three'
import { eulerDegFromQuaternion, objectGeometry, objectMatrix, worldBox } from '../geometry'
import { groupObjects, uid } from '../sceneOps'
import type { FeatureSource, GroupObject, PrimitiveObject, ProfileRegion, SceneObject, Vec3 } from '../types'
import { profileFromSelection, profileSide, revolveGeometry, type RevolveAxis } from './revolve'
import { analyzeSketch, closestOnSegment, dist, entitiesBounds, interiorPoint, pointInPolygon, regionContains, round4, tessellate, scaleEntity, translateEntity, type P, type Region, type SketchEntity } from './geom2d'
import { tl } from '@/i18n/tl'

/** Right-handed sketch frame in world space: u along `x`, v along `y`, `n` = x × y points to the viewer. */
export interface SketchPlane {
  origin: Vec3
  x: Vec3
  y: Vec3
  n: Vec3
  label: string
  /** Object whose face the sketch lies on (enables «Aggiungi» / «Scava»). */
  targetId?: string
}

export const STANDARD_PLANES: Record<'top' | 'front' | 'right', SketchPlane> = {
  top: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1], label: tl("Piano di lavoro (XY)") },
  front: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0], label: tl("Piano frontale (XZ)") },
  right: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0], label: tl("Piano laterale (YZ)") },
}

const v3 = (v: Vec3) => new THREE.Vector3(...v)
const arr = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]

export function toWorld(plane: SketchPlane, p: P, w = 0): THREE.Vector3 {
  return v3(plane.origin).addScaledVector(v3(plane.x), p[0]).addScaledVector(v3(plane.y), p[1]).addScaledVector(v3(plane.n), w)
}

export function toPlane(plane: SketchPlane, world: THREE.Vector3): { p: P; w: number } {
  const d = world.clone().sub(v3(plane.origin))
  return { p: [d.dot(v3(plane.x)), d.dot(v3(plane.y))], w: d.dot(v3(plane.n)) }
}

/**
 * Frame on a picked face: the normal comes from the face, the in-plane X axis follows the object's
 * own axes (so the grid lines up with its edges) and the origin is the centre of the planar face.
 */
export function faceFrame(obj: SceneObject, normal: THREE.Vector3, triangles: THREE.Vector3[]): SketchPlane {
  const n = normal.clone().normalize()
  const rot = new THREE.Matrix4().extractRotation(objectMatrix(obj))
  const candidates = [0, 1, 2].map(i => new THREE.Vector3().setFromMatrixColumn(rot, i).normalize())
  candidates.push(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0))
  const worldX = new THREE.Vector3(1, 0, 0)
  let x = candidates
    .map(a => ({ a, perp: Math.abs(a.dot(n)), wx: Math.abs(a.dot(worldX)) }))
    .sort((p, q) => (Math.abs(p.perp - q.perp) > 1e-3 ? p.perp - q.perp : q.wx - p.wx))[0].a.clone()
  x.addScaledVector(n, -x.dot(n)).normalize()
  if (x.lengthSq() < 0.5) x = new THREE.Vector3(1, 0, 0).cross(n).lengthSq() > 1e-6 ? new THREE.Vector3(0, 0, 1).cross(n).normalize() : new THREE.Vector3(1, 0, 0)
  if (x.dot(worldX) < -1e-6 || (Math.abs(x.dot(worldX)) <= 1e-6 && x.y < 0)) x.negate()
  const y = n.clone().cross(x).normalize()
  const anchor = triangles[0] ?? new THREE.Vector3()
  let min: P = [Infinity, Infinity], max: P = [-Infinity, -Infinity]
  for (const t of triangles) {
    const d = t.clone().sub(anchor)
    const u = d.dot(x), v = d.dot(y)
    min = [Math.min(min[0], u), Math.min(min[1], v)]
    max = [Math.max(max[0], u), Math.max(max[1], v)]
  }
  const origin = Number.isFinite(min[0])
    ? anchor.clone().addScaledVector(x, (min[0] + max[0]) / 2).addScaledVector(y, (min[1] + max[1]) / 2)
    : anchor
  const clean = (v: THREE.Vector3): Vec3 => arr(v).map(c => (Math.abs(c) < 1e-9 ? 0 : round4(c))) as Vec3
  return { origin: clean(origin), x: clean(x), y: clean(y), n: clean(n), label: tl("Faccia di {0}", obj.name), targetId: obj.id }
}

const edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>()

/** Edges of the scene lying on the sketch plane, as 2D reference segments (snap targets). */
export function planeReferences(objects: SceneObject[], plane: SketchPlane): [P, P][] {
  const out: [P, P][] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3()
  for (const obj of objects) {
    if (obj.kind === 'sketch') continue
    const g = objectGeometry(obj)
    let edges = edgeCache.get(g)
    if (!edges) { edges = new THREE.EdgesGeometry(g, 20); edgeCache.set(g, edges) }
    const m = objectMatrix(obj)
    const pos = edges.getAttribute('position')
    for (let i = 0; i < pos.count; i += 2) {
      a.fromBufferAttribute(pos, i).applyMatrix4(m)
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(m)
      const pa = toPlane(plane, a), pb = toPlane(plane, b)
      if (Math.abs(pa.w) < 0.05 && Math.abs(pb.w) < 0.05) out.push([pa.p, pb.p])
      if (out.length > 4000) return out
    }
  }
  return out
}

/** Distance from the sketch plane through the object, against the normal (for «passante»). */
export function depthThrough(obj: SceneObject, plane: SketchPlane): number {
  const g = objectGeometry(obj)
  const m = objectMatrix(obj)
  const pos = g.getAttribute('position')
  const v = new THREE.Vector3()
  let deepest = 0
  const stride = Math.max(1, Math.floor(pos.count / 6000))
  for (let i = 0; i < pos.count; i += stride) deepest = Math.max(deepest, -toPlane(plane, v.fromBufferAttribute(pos, i).applyMatrix4(m)).w)
  return Math.ceil((deepest + 1) * 10) / 10
}

function basisQuaternion(plane: SketchPlane): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(v3(plane.x), v3(plane.y), v3(plane.n))
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

export interface ExtrusionSpec {
  plane: SketchPlane
  regions: Region[]
  entities: SketchEntity[]
  /** Extent along the plane normal, from `lo` to `hi` (mm, lo < hi). */
  lo: number
  hi: number
  hole: boolean
  color: string
  name: string
  /** Parametric link to the sketch (then the sketch is not duplicated inside the object). */
  source?: FeatureSource
}

/** Scene object for the selected regions extruded between `lo` and `hi` along the plane normal. */
export function buildExtrusion(spec: ExtrusionSpec): PrimitiveObject {
  let min: P = [Infinity, Infinity], max: P = [-Infinity, -Infinity]
  for (const r of spec.regions) for (const p of r.outer) {
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])]
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])]
  }
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2
  const lo = Math.min(spec.lo, spec.hi), hi = Math.max(spec.lo, spec.hi, lo + 0.1)
  const zc = (lo + hi) / 2
  const size: Vec3 = [round4(max[0] - min[0]), round4(max[1] - min[1]), round4(hi - lo)]
  const shift = (p: P): [number, number] => [round4(p[0] - cx), round4(p[1] - cy)]
  const profile: ProfileRegion[] = spec.regions.map(r => ({ outer: r.outer.map(shift), holes: r.holes.map(h => h.map(shift)) }))
  const centre = toWorld(spec.plane, [cx, cy], zc)
  return {
    id: uid('extrusion'),
    name: spec.name,
    kind: 'extrusion',
    color: spec.color,
    hole: spec.hole,
    size,
    position: [round4(centre.x), round4(centre.y), round4(centre.z)],
    rotation: eulerDegFromQuaternion(basisQuaternion(spec.plane)),
    params: {
      profile,
      ...(spec.source
        ? { source: spec.source }
        : { sketch: { entities: spec.entities.map(e => translateEntity(e, [-cx, -cy])), z: round4(-zc), base: size } }),
    },
  }
}

export interface SketchEditTarget {
  plane: SketchPlane
  entities: SketchEntity[]
  /** Interior points of the extruded regions, to preselect them. */
  regionPoints: P[]
  lo: number
  hi: number
  objectId: string
  /** Group holding the object (edited in group-local coordinates). */
  groupId?: string
}

/** Reopen the sketch of an extrusion (optionally a child of an unscaled top-level group). */
export function sketchFromExtrusion(obj: PrimitiveObject, group?: GroupObject): SketchEditTarget | null {
  const sk = obj.params.sketch
  if (obj.kind !== 'extrusion' || !sk) return null
  const world = group ? objectMatrix(group).multiply(objectMatrix(obj, [1, 1, 1])) : objectMatrix(obj, [1, 1, 1])
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  world.decompose(pos, q, s)
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(q)
  const axis = (i: number): Vec3 => arr(new THREE.Vector3().setFromMatrixColumn(rot, i).normalize())
  const ratio: Vec3 = [obj.size[0] / (sk.base[0] || 1), obj.size[1] / (sk.base[1] || 1), obj.size[2] / (sk.base[2] || 1)]
  const z = sk.z * ratio[2]
  const plane: SketchPlane = {
    origin: arr(pos.clone().addScaledVector(new THREE.Vector3(...axis(2)), z)),
    x: axis(0), y: axis(1), n: axis(2),
    label: tl("Sketch di {0}", obj.name),
  }
  const half = obj.size[2] / 2
  return {
    plane,
    entities: sk.entities.map(e => scaleEntity(e, ratio[0], ratio[1])),
    regionPoints: (obj.params.profile ?? []).map(r => {
      const pt = interiorPoint(r.outer as P[])
      return [pt[0] * ratio[0], pt[1] * ratio[1]] as P
    }),
    lo: round4(-half - z),
    hi: round4(half - z),
    objectId: obj.id,
    groupId: group?.id,
  }
}

/** Put a rebuilt extrusion in place of the original one (inside its group when needed). */
export function replaceExtrusion(objects: SceneObject[], target: SketchEditTarget, next: PrimitiveObject): SceneObject[] {
  if (!target.groupId) return objects.map(o => (o.id === target.objectId ? { ...next, id: o.id, name: o.name, color: o.color } : o))
  return objects.map(o => {
    if (o.id !== target.groupId || o.kind !== 'group') return o
    const inv = objectMatrix(o, [1, 1, 1]).invert()
    const local = inv.multiply(objectMatrix(next, [1, 1, 1]))
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    local.decompose(p, q, s)
    return {
      ...o,
      children: o.children.map(c => (c.id === target.objectId
        ? { ...next, id: c.id, name: c.name, color: c.color, position: [round4(p.x), round4(p.y), round4(p.z)] as Vec3, rotation: eulerDegFromQuaternion(q) }
        : c)),
    }
  })
}

// ── Sketch objects (kept in the scene, extruded later) ─────────────────────

export function planeOfSketch(obj: PrimitiveObject): SketchPlane {
  const rot = new THREE.Matrix4().extractRotation(objectMatrix(obj, [1, 1, 1]))
  const axis = (i: number): Vec3 => arr(new THREE.Vector3().setFromMatrixColumn(rot, i).normalize())
  return { origin: [...obj.position] as Vec3, x: axis(0), y: axis(1), n: axis(2), label: tl("Sketch «{0}»", obj.name), targetId: obj.params.sketch?.target }
}

/** Edges of the face (or any solid edge on the plane) near the strokes: kept with the sketch so they can close its regions. */
export function sketchBoundary(entities: SketchEntity[], refs: [P, P][]): [P, P][] {
  const b = entitiesBounds(entities)
  if (!b || !refs.length) return []
  const m = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) * 0.5 + 20
  const x0 = b.min[0] - m, x1 = b.max[0] + m, y0 = b.min[1] - m, y1 = b.max[1] + m
  const out: [P, P][] = []
  for (const [p, q] of refs) {
    if (Math.max(p[0], q[0]) < x0 || Math.min(p[0], q[0]) > x1 || Math.max(p[1], q[1]) < y0 || Math.min(p[1], q[1]) > y1) continue
    if (dist(p, q) < 1e-4) continue
    out.push([[round4(p[0]), round4(p[1])], [round4(q[0]), round4(q[1])]])
    if (out.length >= 300) break
  }
  return out
}

export function makeSketchObject(plane: SketchPlane, entities: SketchEntity[], name: string, id = uid('sketch'), boundary?: [P, P][]): PrimitiveObject {
  return {
    id, name, kind: 'sketch', color: '#2563eb', hole: false, size: [1, 1, 1],
    position: [...plane.origin] as Vec3,
    rotation: eulerDegFromQuaternion(basisQuaternion(plane)),
    params: { sketch: { entities, z: 0, base: [1, 1, 1], target: plane.targetId, ...(boundary?.length ? { boundary } : {}) } },
  }
}

/** Create or update the sketch object of a session; an emptied sketch is removed. */
export function upsertSketch(objects: SceneObject[], plane: SketchPlane, entities: SketchEntity[], id?: string, refs?: [P, P][]): { objects: SceneObject[]; id: string | null } {
  const existing = id ? objects.find(o => o.id === id && o.kind === 'sketch') as PrimitiveObject | undefined : undefined
  if (!entities.length) return { objects: existing ? objects.filter(o => o !== existing) : objects, id: null }
  if (existing) {
    // Without fresh references (e.g. revolve probes) the boundary stored earlier is kept.
    const boundary = refs ? sketchBoundary(entities, refs) : existing.params.sketch?.boundary
    const next = { ...makeSketchObject(plane, entities, existing.name, existing.id, boundary), color: existing.color }
    return { objects: objects.map(o => (o === existing ? next : o)), id: existing.id }
  }
  const count = objects.filter(o => o.kind === 'sketch').length + 1
  const created = makeSketchObject(plane, entities, tl("Sketch {0}", count), undefined, refs ? sketchBoundary(entities, refs) : undefined)
  return { objects: [...objects, created], id: created.id }
}

export function sketchRegionsOf(obj: PrimitiveObject): { regions: Region[]; entities: SketchEntity[] } {
  const entities = obj.params.sketch?.entities ?? []
  return { regions: analyzeSketch(entities, obj.params.sketch?.boundary).regions, entities }
}

/** Interior point of a region (or of the biggest one) in the sketch's local frame, for the extrusion handle. */
export function sketchHandlePoint(obj: PrimitiveObject, regionIndex: number | null): P | null {
  const { regions } = sketchRegionsOf(obj)
  const r = regionIndex != null ? regions[regionIndex] : [...regions].sort((a, b) => b.area - a.area)[0]
  return r ? interiorPoint(r.outer) : null
}

export interface SketchExtrusionResult { objects: SceneObject[]; selectIds: string[]; mode: 'solid' | 'add' | 'cut' }

const overlaps = (a: THREE.Box3, b: THREE.Box3) => {
  const s = a.clone().intersect(b)
  return !s.isEmpty() && s.max.x - s.min.x > 0.01 && s.max.y - s.min.y > 0.01 && s.max.z - s.min.z > 0.01
}

function topLevel(objects: SceneObject[], id: string | undefined): SceneObject | null {
  if (!id) return null
  const has = (o: SceneObject): boolean => o.id === id || (o.kind === 'group' && o.children.some(has))
  return objects.find(has) ?? null
}

/**
 * Extrude a sketch (all its closed regions or just one) by the signed distance `t` along the plane normal.
 * Outward (t > 0): a new model, joined to the object the sketch lies on. Inward (t < 0), or symmetric,
 * into solids: a hole cut from them. With `preview` the result is a loose, ungrouped object for dragging.
 */
export function applySketchExtrusion(
  objects: SceneObject[], sketchId: string, regionIndex: number | null, t: number,
  opts: { symmetric?: boolean; preview?: boolean; dragId?: string } = {},
): SketchExtrusionResult | null {
  const sketch = objects.find(o => o.id === sketchId && o.kind === 'sketch') as PrimitiveObject | undefined
  if (!sketch || Math.abs(t) < 0.05) return null
  const { regions, entities } = sketchRegionsOf(sketch)
  const chosen = regionIndex != null && regions[regionIndex] ? [regions[regionIndex]] : regions
  if (!chosen.length) return null
  const plane = planeOfSketch(sketch)
  const depth = Math.abs(t)
  const make = (lo: number, hi: number, hole: boolean, color: string, name: string) => {
    const source: FeatureSource = { sketchId, points: chosen.map(r => interiorPoint(r.outer) as [number, number]), op: 'extrude', lo, hi }
    const o = buildExtrusion({ plane, regions: chosen, entities, lo, hi, hole, color, name, source })
    return opts.dragId ? { ...o, id: opts.dragId } : o
  }
  const others = objects.filter(o => o.kind !== 'sketch')
  const target = topLevel(others, sketch.params.sketch?.target)
  const solidTarget = target && !target.hole ? target : null
  const count = objects.filter(o => o.kind === 'extrusion').length + 1
  const inward = t < 0 || opts.symmetric

  // First measure the volume with no overlap margin to find which solids it enters.
  const probe = make(opts.symmetric ? -depth : t < 0 ? -depth : 0, opts.symmetric ? depth : t < 0 ? 0 : depth, false, '#000000', 'p')
  const box = worldBox(probe)
  const hit = inward ? others.filter(o => !o.hole && overlaps(worldBox(o), box)) : []
  const cutting = inward && hit.length > 0

  if (cutting) {
    const hole = make(opts.symmetric ? -depth : -depth, opts.symmetric ? depth : 0.1, true, solidTarget?.color ?? '#a3a3a3', tl("Foro sketch {0}", count))
    if (opts.preview) return { objects: [...objects, hole], selectIds: [sketchId], mode: 'cut' }
    const r = groupObjects([...objects, hole], [...hit.map(o => o.id), hole.id])
    return { objects: r.objects.map(o => (o.id === r.groupId && hit[0] ? { ...o, name: hit[0].name } : o)), selectIds: r.groupId ? [r.groupId] : [hole.id], mode: 'cut' }
  }
  const adding = !!solidTarget && !inward
  const body = make(opts.symmetric ? -depth : t < 0 ? -depth : adding ? -0.1 : 0, opts.symmetric ? depth : t < 0 ? 0 : depth, false, solidTarget?.color ?? '#0ea5e9', tl("Estrusione {0}", count))
  if (opts.preview || !adding) return { objects: [...objects, body], selectIds: opts.preview ? [sketchId] : [body.id], mode: 'solid' }
  const r = groupObjects([...objects, body], [solidTarget!.id, body.id])
  return { objects: r.objects.map(o => (o.id === r.groupId ? { ...o, name: solidTarget!.name } : o)), selectIds: r.groupId ? [r.groupId] : [body.id], mode: 'add' }
}

// ── Revolve ────────────────────────────────────────────────────────────────

export type RevolveFailure = 'crosses' | 'empty' | 'no-profile'

export function buildRevolve(plane: SketchPlane, regions: Region[], axis: RevolveAxis, angle: number, hole: boolean, color: string, name: string, source?: FeatureSource): PrimitiveObject | RevolveFailure {
  if (!regions.length) return 'no-profile'
  const profile: ProfileRegion[] = regions.map(r => ({ outer: r.outer, holes: r.holes }))
  const side = profileSide(profile, axis)
  if (side === 'crosses') return 'crosses'
  if (side === 'empty') return 'empty'
  const g = revolveGeometry(profile, axis, angle)
  const box = g.boundingBox!
  if (box.isEmpty()) return 'empty'
  const centre = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const world = toWorld(plane, [centre.x, centre.y], centre.z)
  g.dispose()
  return {
    id: uid('revolve'), name, kind: 'revolve', color, hole,
    size: [round4(Math.max(size.x, 0.1)), round4(Math.max(size.y, 0.1)), round4(Math.max(size.z, 0.1))],
    position: [round4(world.x), round4(world.y), round4(world.z)],
    rotation: eulerDegFromQuaternion(basisQuaternion(plane)),
    params: { revolve: { profile, axis: { a: axis.a, d: axis.d }, angle }, ...(source ? { source } : {}) },
  }
}

/** Axis candidates of a sketch: its own X / Y axes and every straight line. */
export function revolveAxes(obj: PrimitiveObject): { id: string; label: string; axis: RevolveAxis }[] {
  const out = [
    { id: 'x', label: tl("Asse X dello sketch"), axis: { a: [0, 0] as P, d: [1, 0] as P } },
    { id: 'y', label: tl("Asse Y dello sketch"), axis: { a: [0, 0] as P, d: [0, 1] as P } },
  ]
  let n = 0
  for (const e of obj.params.sketch?.entities ?? []) {
    if (e.type !== 'line') continue
    n++
    out.push({ id: e.id, label: tl("Linea {0} ({1}, {2}) → ({3}, {4})", n, round4(e.a[0]), round4(e.a[1]), round4(e.b[0]), round4(e.b[1])), axis: { a: e.a, d: [e.b[0] - e.a[0], e.b[1] - e.a[1]] } })
  }
  return out
}

export interface SketchRevolveResult { objects: SceneObject[]; selectIds: string[]; error?: RevolveFailure | 'nothing' }

/** The solid (not yet in the scene) for the picked strokes revolved about `axis`: also used for the live 3D preview. */
export function revolveFromSelection(
  sketch: PrimitiveObject, entityIds: string[], axis: RevolveAxis, angle: number, hole: boolean, color: string, name: string, sketchId = sketch.id,
): PrimitiveObject | RevolveFailure | 'nothing' {
  const entities = sketch.params.sketch?.entities ?? []
  const profile = profileFromSelection(entities, entityIds, axis)
  if (!profile.regions.length) return 'nothing'
  const source: FeatureSource = {
    sketchId, points: profile.regions.map(r => interiorPoint(r.outer) as [number, number]), op: 'revolve',
    entityIds, axis: { a: axis.a, d: axis.d }, angle,
  }
  return buildRevolve(planeOfSketch(sketch), profile.regions, axis, angle, hole, color, name, source)
}

/**
 * Revolve the picked strokes (closed shapes as they are, open curves closed against the axis) around `axis`.
 * A solid, or with mode 'cut' a hole carved from the solids it passes through.
 */
export function applySketchRevolve(objects: SceneObject[], sketchId: string, entityIds: string[], axis: RevolveAxis, angle: number, mode: 'solid' | 'cut' = 'solid'): SketchRevolveResult | null {
  const sketch = objects.find(o => o.id === sketchId && o.kind === 'sketch') as PrimitiveObject | undefined
  if (!sketch) return null
  const count = objects.filter(o => o.kind === 'revolve').length + 1
  const others = objects.filter(o => o.kind !== 'sketch')
  const target = topLevel(others, sketch.params.sketch?.target)
  const hole = mode === 'cut'
  const made = revolveFromSelection(sketch, entityIds, axis, angle, hole, target?.color ?? '#0ea5e9', hole ? tl("Foro rivoluzione {0}", count) : tl("Rivoluzione {0}", count))
  if (typeof made === 'string') return { objects, selectIds: [], error: made }
  if (!hole) return { objects: [...objects, made], selectIds: [made.id] }
  const box = worldBox(made)
  const hit = others.filter(o => !o.hole && overlaps(worldBox(o), box))
  if (!hit.length) return { objects: [...objects, made], selectIds: [made.id] }
  const r = groupObjects([...objects, made], [...hit.map(o => o.id), made.id])
  return { objects: r.objects.map(o => (o.id === r.groupId ? { ...o, name: hit[0].name } : o)), selectIds: r.groupId ? [r.groupId] : [made.id] }
}

// ── Parametric update ──────────────────────────────────────────────────────

export const smallestRegionAt = (regions: Region[], p: P): Region | null => {
  let best: Region | null = null
  for (const r of regions) if (regionContains(r, p) && (!best || r.area < best.area)) best = r
  if (best) return best
  // The sketch changed so much that the remembered point is no longer inside any profile: take the closest one.
  let near: Region | null = null, nd = Infinity
  for (const r of regions) {
    for (let i = 0; i < r.outer.length; i++) {
      const d = closestOnSegment(p, r.outer[i], r.outer[(i + 1) % r.outer.length]).d
      if (d < nd) { nd = d; near = r }
    }
  }
  return near && nd <= Math.sqrt(near.area) * 0.75 + 2 ? near : null
}

/**
 * Rebuild every extrusion / revolve made from `sketchId` after the sketch changed: the profiles are found
 * again from the stored interior points, then the same operation is applied. Features whose profiles
 * disappeared are left untouched (and reported).
 */
export function regenerateFeatures(objects: SceneObject[], sketchId: string, opts: { onlyPending?: boolean } = {}): { objects: SceneObject[]; updated: number; lost: string[] } {
  const sketch = objects.find(o => o.id === sketchId && o.kind === 'sketch') as PrimitiveObject | undefined
  if (!sketch) return { objects, updated: 0, lost: [] }
  const { regions, entities } = sketchRegionsOf(sketch)
  const plane = planeOfSketch(sketch)
  let updated = 0
  const lost: string[] = []
  const rebuild = (o: PrimitiveObject): PrimitiveObject | null => {
    const src = o.params.source
    if (!src || src.sketchId !== sketchId) return null
    if (opts.onlyPending && !isPendingFeature(o)) return null
    if (src.op === 'revolve' && src.entityIds?.length && src.axis) {
      const ids = src.entityIds.filter(id => entities.some(e => e.id === id))
      const made = ids.length ? revolveFromSelection(sketch, ids, src.axis, src.angle ?? 360, o.hole, o.color, o.name) : 'nothing'
      if (typeof made === 'string') { lost.push(o.name); return null }
      updated++
      return { ...made, id: o.id, name: o.name, color: o.color, hole: o.hole }
    }
    const chosen: Region[] = []
    for (const p of src.points) {
      const r = smallestRegionAt(regions, p as P)
      if (r && !chosen.includes(r)) chosen.push(r)
    }
    // No remembered points (feature made by the AI agent): every "material" region, i.e. not an island inside a hole.
    if (!src.points.length) chosen.push(...materialRegions(regions))
    if (!chosen.length) { lost.push(o.name); return null }
    let next: PrimitiveObject | RevolveFailure
    if (src.op === 'extrude') {
      next = buildExtrusion({ plane, regions: chosen, entities, lo: src.lo ?? 0, hi: src.hi ?? 1, hole: o.hole, color: o.color, name: o.name, source: { ...src, points: chosen.map(r => interiorPoint(r.outer) as [number, number]) } })
    } else if (src.axis) {
      next = buildRevolve(plane, chosen, src.axis, src.angle ?? 360, o.hole, o.color, o.name, { ...src, points: chosen.map(r => interiorPoint(r.outer) as [number, number]) })
    } else return null
    if (typeof next === 'string') { lost.push(o.name); return null }
    updated++
    return { ...next, id: o.id, name: o.name, color: o.color, hole: o.hole }
  }
  const out = objects.map(o => {
    if (o.kind === 'group') {
      if (!o.children.some(c => c.kind !== 'group' && (c as PrimitiveObject).params?.source?.sketchId === sketchId)) return o
      if (o.scale.some(v => Math.abs(v - 1) > 1e-6)) return o
      const inv = objectMatrix(o, [1, 1, 1]).invert()
      return {
        ...o,
        children: o.children.map(c => {
          if (c.kind === 'group') return c
          const next = rebuild(c as PrimitiveObject)
          if (!next) return c
          const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
          inv.clone().multiply(objectMatrix(next, [1, 1, 1])).decompose(p, q, s)
          return { ...next, position: [round4(p.x), round4(p.y), round4(p.z)] as Vec3, rotation: eulerDegFromQuaternion(q) }
        }),
      }
    }
    return o.kind === 'extrusion' || o.kind === 'revolve' ? rebuild(o as PrimitiveObject) ?? o : o
  })
  return { objects: out, updated, lost }
}

/** The most recent sketch lying on the same plane (same normal direction, same offset): reopened instead of stacking a new one. */
export function findSketchOnPlane(objects: SceneObject[], plane: SketchPlane): PrimitiveObject | null {
  const n = v3(plane.n)
  let found: PrimitiveObject | null = null
  for (const o of objects) {
    if (o.kind !== 'sketch') continue
    const sp = planeOfSketch(o as PrimitiveObject)
    if (v3(sp.n).dot(n) < 0.9999) continue
    if (Math.abs(v3(sp.origin).sub(v3(plane.origin)).dot(n)) > 0.01) continue
    found = o as PrimitiveObject
  }
  return found
}

/** Strokes of the other sketches lying on `plane`, as 2D references (visible and snappable while drawing). */
export function coplanarSketchRefs(objects: SceneObject[], plane: SketchPlane, excludeId?: string): [P, P][] {
  const n = v3(plane.n)
  const out: [P, P][] = []
  for (const o of objects) {
    if (o.kind !== 'sketch' || o.id === excludeId) continue
    const sk = o as PrimitiveObject
    const sp = planeOfSketch(sk)
    if (Math.abs(v3(sp.n).dot(n)) < 0.9999 || Math.abs(v3(sp.origin).sub(v3(plane.origin)).dot(n)) > 0.01) continue
    for (const e of sk.params.sketch?.entities ?? []) {
      const { pts, closed } = tessellate(e)
      const m = closed ? pts.length : pts.length - 1
      for (let i = 0; i < m; i++) out.push([toPlane(plane, toWorld(sp, pts[i])).p, toPlane(plane, toWorld(sp, pts[(i + 1) % pts.length])).p])
      if (out.length > 4000) return out
    }
  }
  return out
}

/** Regions that are solid material: a region lying inside another region's hole (an island) is left out. */
function materialRegions(regions: Region[]): Region[] {
  return regions.filter(r => {
    const p = interiorPoint(r.outer)
    return !regions.some(o => o !== r && o.holes.some(h => pointInPolygon(p, h)))
  })
}

/** Extrusion / revolve linked to a sketch whose exact geometry has not been built yet (e.g. created by the AI agent). */
export function isPendingFeature(o: SceneObject): boolean {
  if (o.kind !== 'extrusion' && o.kind !== 'revolve') return false
  const p = (o as PrimitiveObject).params
  return !!p?.source && (o.kind === 'extrusion' ? !p.profile?.length : !p.revolve?.profile?.length)
}

/** Build the exact geometry of every pending feature (after an AI run or when a project is loaded). */
export function materializeFeatures(objects: SceneObject[]): SceneObject[] {
  const ids = new Set<string>()
  const visit = (o: SceneObject) => {
    if (o.kind === 'group') o.children.forEach(visit)
    else if (isPendingFeature(o)) ids.add((o as PrimitiveObject).params.source!.sketchId)
  }
  objects.forEach(visit)
  let out = objects
  for (const id of ids) out = regenerateFeatures(out, id, { onlyPending: true }).objects
  return out
}
