import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import type { GroupObject, PrimitiveKind, PrimitiveObject, PrimitiveParams, SceneObject, Vec3 } from './types'

const DEG = Math.PI / 180

// ── Unit primitives: every geometry is normalised to fill [-0.5, 0.5]^3, Z up ──

function normalize(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry
  g.deleteAttribute('uv')
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  g.computeBoundingBox()
  const box = g.boundingBox!
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  g.translate(-center.x, -center.y, -center.z)
  // BufferGeometry.scale() also transforms normals through the normal matrix: smooth shading survives.
  g.scale(1 / (size.x || 1), 1 / (size.y || 1), 1 / (size.z || 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function extrude(shape: THREE.Shape, curveSegments = 32): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments })
}

let font: ReturnType<FontLoader['parse']> | null = null
function getFont() {
  if (!font) font = new FontLoader().parse(fontData as never)
  return font
}

function buildUnit(kind: PrimitiveKind, p: PrimitiveParams, size: Vec3): THREE.BufferGeometry {
  switch (kind) {
    case 'box': {
      const r = Math.max(0, Math.min(0.49, p.radius ?? 0))
      if (r <= 0.001) return normalize(new THREE.BoxGeometry(1, 1, 1))
      // Fillet on every edge. Built at real size then normalised, so scaling back by `size`
      // restores circular (not stretched) fillets; radius = fraction of the smallest side.
      const radius = r * Math.min(size[0], size[1], size[2])
      return normalize(new RoundedBoxGeometry(size[0], size[2], size[1], 5, radius).rotateX(Math.PI / 2))
    }
    case 'cylinder':
      return normalize(new THREE.CylinderGeometry(0.5, 0.5, 1, p.sides ?? 32).rotateX(Math.PI / 2))
    case 'cone': {
      const top = Math.max(0, Math.min(1, p.topRatio ?? 0)) * 0.5
      return normalize(new THREE.CylinderGeometry(top, 0.5, 1, p.sides ?? 32).rotateX(Math.PI / 2))
    }
    case 'polyhedron': {
      const n = Math.max(3, Math.min(63, Math.round(p.faces ?? 7) - 1))
      const points = Array.from({ length: n }, (_, i) => new THREE.Vector3(Math.cos(i * 2 * Math.PI / n), Math.sin(i * 2 * Math.PI / n), -0.5))
      points.push(new THREE.Vector3(0, 0, 0.5))
      return normalize(new ConvexGeometry(points))
    }
    case 'pyramid':
      return normalize(new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2))
    case 'sphere':
      return normalize(new THREE.SphereGeometry(0.5, 40, 24))
    case 'hemisphere': {
      const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)]
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * (Math.PI / 2)
        pts.push(new THREE.Vector2(Math.cos(a) * 0.5, Math.sin(a) * 0.5))
      }
      pts[pts.length - 1].x = 0
      return normalize(new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2))
    }
    case 'wedge': {
      const s = new THREE.Shape()
      s.moveTo(-0.5, -0.5)
      s.lineTo(0.5, -0.5)
      s.lineTo(-0.5, 0.5)
      s.lineTo(-0.5, -0.5)
      return normalize(extrude(s, 1).rotateX(Math.PI / 2))
    }
    case 'torus': {
      const t = Math.max(0.05, Math.min(0.45, p.thickness ?? 0.2))
      const r = t / 2
      return normalize(new THREE.TorusGeometry(0.5 - r, r, 20, 48))
    }
    case 'tube': {
      const wall = Math.max(0.05, Math.min(0.45, p.wall ?? 0.12))
      const s = new THREE.Shape()
      s.absarc(0, 0, 0.5, 0, Math.PI * 2, false)
      const hole = new THREE.Path()
      hole.absarc(0, 0, 0.5 - wall, 0, Math.PI * 2, true)
      s.holes.push(hole)
      return normalize(extrude(s, 48))
    }
    case 'star': {
      const n = Math.max(3, Math.min(24, p.points ?? 5))
      const inner = Math.max(0.2, Math.min(0.9, p.inner ?? 0.5)) * 0.5
      const s = new THREE.Shape()
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? 0.5 : inner
        const a = Math.PI / 2 + (i * Math.PI) / n
        if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      s.closePath()
      return normalize(extrude(s, 1))
    }
    case 'text': {
      const text = (p.text || 'Testo').slice(0, 24)
      const g = new TextGeometry(text, { font: getFont(), size: 1, depth: 0.3, curveSegments: 5, bevelEnabled: false })
      return normalize(g)
    }
  }
}

const unitCache = new Map<string, THREE.BufferGeometry>()

/** Geometry depends on the real size only for filleted boxes (see buildUnit). */
function sizeDependent(kind: PrimitiveKind, params: PrimitiveParams): boolean {
  return (kind === 'box' && (params?.radius ?? 0) > 0.001) || !!Object.keys(params.edgeFillets ?? {}).length
}

export function unitGeometry(kind: PrimitiveKind, params: PrimitiveParams, size: Vec3 = [1, 1, 1]): THREE.BufferGeometry {
  const sized = sizeDependent(kind, params)
  const key = `${kind}|${JSON.stringify(params ?? {})}${sized ? `|${size.map(v => v.toFixed(2)).join('x')}` : ''}`
  let g = unitCache.get(key)
  if (!g) {
    g = buildUnit(kind, params ?? {}, size)
    if (Object.keys(params.edgeFillets ?? {}).length && supportsEdgeFillet(kind)) g = filletEdges(g, params, size)
    // Slider edits create many variants; keep the cache bounded (evicted geometries are GC'd once unused).
    if (unitCache.size > 200) unitCache.delete(unitCache.keys().next().value as string)
    unitCache.set(key, g)
  }
  return g
}

// ── Transforms ─────────────────────────────────────────────────────────────

export function scaleOf(obj: SceneObject): Vec3 {
  return obj.kind === 'group' ? obj.scale : obj.size
}

export function objectMatrix(obj: SceneObject, scale: Vec3 = scaleOf(obj)): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(obj.rotation[0] * DEG, obj.rotation[1] * DEG, obj.rotation[2] * DEG, 'XYZ'))
  return new THREE.Matrix4().compose(new THREE.Vector3(...obj.position), q, new THREE.Vector3(...scale))
}

export function eulerDegFromQuaternion(q: THREE.Quaternion): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  const clean = (v: number) => {
    const d = Math.round((v / DEG) * 100) / 100
    return Object.is(d, -0) ? 0 : d
  }
  return [clean(e.x), clean(e.y), clean(e.z)]
}

// ── CSG groups ─────────────────────────────────────────────────────────────

const evaluator = new Evaluator()
evaluator.attributes = ['position', 'normal']
evaluator.useGroups = false

const groupCache = new Map<string, THREE.BufferGeometry>()

function brushFor(obj: SceneObject): Brush {
  const geometry = obj.kind === 'group' ? groupGeometry(obj) : unitGeometry(obj.kind, obj.params, obj.size)
  const brush = new Brush(geometry)
  objectMatrix(obj).decompose(brush.position, brush.quaternion, brush.scale)
  brush.updateMatrixWorld(true)
  return brush
}

function mergeFallback(children: SceneObject[]): THREE.BufferGeometry {
  const parts = children.map(c => {
    const src = c.kind === 'group' ? groupGeometry(c) : unitGeometry(c.kind, c.params, c.size)
    const g = src.index ? src.toNonIndexed() : src.clone()
    g.applyMatrix4(objectMatrix(c))
    return g
  })
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry()
}

/** Group-local geometry: union of solid children minus hole children (all-holes group = union of holes). */
export function groupGeometry(group: GroupObject): THREE.BufferGeometry {
  const key = JSON.stringify(group.children, (k, v) => (k === 'id' || k === 'name' || k === 'color' ? undefined : v))
  const cached = groupCache.get(key)
  if (cached) return cached
  const solids = group.children.filter(c => !c.hole)
  const holes = group.children.filter(c => c.hole)
  const base = solids.length ? solids : holes
  let geometry: THREE.BufferGeometry
  try {
    let acc: Brush = brushFor(base[0])
    for (const c of base.slice(1)) acc = evaluator.evaluate(acc, brushFor(c), ADDITION)
    if (solids.length) for (const h of holes) acc = evaluator.evaluate(acc, brushFor(h), SUBTRACTION)
    // CSG output lives in brush A's local frame; bake that frame (clone: acc may still hold a cached unit geometry).
    geometry = acc.geometry.clone().applyMatrix4(acc.matrixWorld)
  } catch (err) {
    console.warn('CSG failed, falling back to merge', err)
    geometry = mergeFallback(solids.length ? solids : holes)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  if (groupCache.size > 80) groupCache.delete(groupCache.keys().next().value as string)
  groupCache.set(key, geometry)
  return geometry
}

export function objectGeometry(obj: SceneObject): THREE.BufferGeometry {
  return obj.kind === 'group' ? groupGeometry(obj) : unitGeometry(obj.kind, (obj as PrimitiveObject).params, (obj as PrimitiveObject).size)
}

/** Precise world-space bounding box from the real geometry. */
export function worldBox(obj: SceneObject): THREE.Box3 {
  const g = objectGeometry(obj)
  const m = objectMatrix(obj)
  const box = new THREE.Box3()
  const pos = g.getAttribute('position')
  const v = new THREE.Vector3()
  const stride = Math.max(1, Math.floor(pos.count / 4000))
  for (let i = 0; i < pos.count; i += stride) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m))
  return box
}

// ── Export ─────────────────────────────────────────────────────────────────

export function exportSTL(objects: SceneObject[]): Blob {
  const scene = new THREE.Scene()
  for (const obj of objects) {
    if (obj.hole) continue
    const mesh = new THREE.Mesh(objectGeometry(obj))
    mesh.applyMatrix4(objectMatrix(obj))
    scene.add(mesh)
  }
  scene.updateMatrixWorld(true)
  const data = new STLExporter().parse(scene, { binary: true }) as DataView
  return new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' })
}

/**
 * Binary glTF for AR viewers (WebXR, Scene Viewer, Quick Look): coloured meshes, holes left out,
 * converted from the editor frame (millimetres, Z up) to glTF (metres, Y up) at real size,
 * centred on X/Z and resting on the floor (y = 0).
 */
export async function exportGLB(objects: SceneObject[]): Promise<Blob> {
  const model = new THREE.Group()
  for (const obj of objects) {
    if (obj.hole) continue
    const mesh = new THREE.Mesh(
      objectGeometry(obj),
      new THREE.MeshStandardMaterial({ color: obj.color, roughness: 0.55, metalness: 0.02 }),
    )
    mesh.name = obj.name
    mesh.applyMatrix4(objectMatrix(obj))
    model.add(mesh)
  }
  const root = new THREE.Group()
  root.rotation.x = -Math.PI / 2
  root.scale.setScalar(0.001)
  root.add(model)
  const scene = new THREE.Scene()
  scene.add(root)
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3())
    root.position.set(-center.x, -box.min.y, -center.z)
    scene.updateMatrixWorld(true)
  }
  const data = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true })
  return new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' })
}


export interface SolidEdge { id: string; a: THREE.Vector3; b: THREE.Vector3 }
const vertexKey = (v: THREE.Vector3) => v.toArray().map(n => n.toFixed(5)).join(',')
export function geometryEdges(g: THREE.BufferGeometry, threshold = 20): SolidEdge[] {
  const lines = new THREE.EdgesGeometry(g, threshold)
  const p = lines.getAttribute('position')
  const result: SolidEdge[] = []
  for (let i = 0; i < p.count; i += 2) {
    let a = new THREE.Vector3().fromBufferAttribute(p, i)
    let b = new THREE.Vector3().fromBufferAttribute(p, i + 1)
    if (vertexKey(a) > vertexKey(b)) [a, b] = [b, a]
    result.push({ id: `${vertexKey(a)}|${vertexKey(b)}`, a, b })
  }
  lines.dispose()
  return result
}
export function editableEdges(obj: SceneObject): SolidEdge[] {
  // Keep edge identity stable when a fillet changes the rendered topology.
  return geometryEdges(obj.kind === 'group' ? objectGeometry(obj) : unitGeometry(obj.kind, { ...obj.params, radius: 0, edgeFillets: undefined }, obj.size), supportsEdgeFillet(obj.kind) ? 0.1 : 20)
}
export function edgeLength(obj: SceneObject, edge: SolidEdge): number {
  return edge.a.clone().applyMatrix4(objectMatrix(obj)).distanceTo(edge.b.clone().applyMatrix4(objectMatrix(obj)))
}
export function resizeEdge(obj: SceneObject, edge: SolidEdge, length: number): SceneObject {
  if (!Number.isFinite(length) || length < 0.1) return obj
  const current = edgeLength(obj, edge)
  if (current < 1e-8) return obj
  const ratio = length / current
  const delta = edge.b.clone().sub(edge.a)
  const axes = [0, 1, 2].filter(i => Math.abs(delta.getComponent(i)) > 1e-5)
  const scale = scaleOf(obj).map((v, i) => v * (axes.length === 1 && axes[0] !== i ? 1 : ratio)) as Vec3
  const next = obj.kind === 'group' ? { ...obj, scale } : { ...obj, size: scale }
  next.position = [...obj.position] as Vec3
  next.position[2] += worldBox(obj).min.z - worldBox(next).min.z
  return next
}
export function supportsEdgeFillet(kind: string): boolean {
  return ['box', 'polyhedron', 'pyramid', 'wedge', 'cylinder', 'cone'].includes(kind)
}
function filletEdges(source: THREE.BufferGeometry, params: PrimitiveParams, size: Vec3): THREE.BufferGeometry {
  const original = source.clone().scale(...size)
  const triangles = original.index ? original.toNonIndexed() : original
  const pos = triangles.getAttribute('position')
  let polygons: THREE.Vector3[][] = []
  for (let i = 0; i < pos.count; i += 3) polygons.push([0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(pos, i + j)))
  for (const edge of geometryEdges(source, 0.1)) {
    const requested = params.edgeFillets?.[edge.id] ?? 0
    if (!(requested > 0)) continue
    const a = edge.a.clone().multiply(new THREE.Vector3(...size))
    const b = edge.b.clone().multiply(new THREE.Vector3(...size))
    const normals: THREE.Vector3[] = []
    for (let i = 0; i < pos.count; i += 3) {
      const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(pos, i + j))
      const n = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize()
      if (Math.abs(n.dot(a.clone().sub(v[0]))) < 1e-4 && Math.abs(n.dot(b.clone().sub(v[0]))) < 1e-4 && !normals.some(m => m.dot(n) > 0.9999)) normals.push(n)
    }
    if (normals.length !== 2) continue
    const [n1, n2] = normals
    const angle = Math.acos(THREE.MathUtils.clamp(n1.dot(n2), -1, 1))
    const bisector = n1.clone().add(n2).normalize()
    const radius = Math.min(requested, Math.min(...size) * 0.2, a.distanceTo(b) * 0.2)
    const center = a.clone().add(b).multiplyScalar(0.5).addScaledVector(bisector, -radius / Math.cos(angle / 2))
    for (let step = 1; step < 12; step++) {
      const t = step / 12
      const n = n1.clone().multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(n2, Math.sin(t * angle)).normalize()
      const limit = n.dot(center) + radius
      const clipped: THREE.Vector3[][] = []
      const cap = new Map<string, THREE.Vector3>()
      for (const polygon of polygons) {
        const points: THREE.Vector3[] = []
        for (let j = 0; j < polygon.length; j++) {
          const v = polygon[j], w = polygon[(j + 1) % polygon.length]
          const dv = n.dot(v) - limit, dw = n.dot(w) - limit
          if (dv <= 0) points.push(v)
          if ((dv < 0) !== (dw < 0)) {
            const intersection = v.clone().lerp(w, dv / (dv - dw))
            points.push(intersection)
            cap.set(intersection.toArray().map(x => x.toFixed(7)).join(','), intersection)
          }
        }
        if (points.length >= 3) clipped.push(points)
      }
      const ring = [...cap.values()]
      if (ring.length >= 3) {
        const middle = ring.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(ring.length)
        const u = ring[0].clone().sub(middle).normalize(), v = n.clone().cross(u)
        const angleOf = (p: THREE.Vector3) => Math.atan2(p.clone().sub(middle).dot(v), p.clone().sub(middle).dot(u))
        ring.sort((a, b) => angleOf(a) - angleOf(b))
        clipped.push(ring)
      }
      polygons = clipped
    }
  }
  original.dispose()
  if (triangles !== original) triangles.dispose()
  const points = new Map<string, THREE.Vector3>()
  for (const polygon of polygons) for (const point of polygon) points.set(point.toArray().map(v => v.toFixed(7)).join(','), point)
  const result = new ConvexGeometry([...points.values()])
  result.scale(1 / size[0], 1 / size[1], 1 / size[2])
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}
