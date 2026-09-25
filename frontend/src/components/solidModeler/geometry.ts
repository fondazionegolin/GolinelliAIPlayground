import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
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
  return kind === 'box' && (params?.radius ?? 0) > 0.001
}

export function unitGeometry(kind: PrimitiveKind, params: PrimitiveParams, size: Vec3 = [1, 1, 1]): THREE.BufferGeometry {
  const sized = sizeDependent(kind, params)
  const key = `${kind}|${JSON.stringify(params ?? {})}${sized ? `|${size.map(v => v.toFixed(2)).join('x')}` : ''}`
  let g = unitCache.get(key)
  if (!g) {
    g = buildUnit(kind, params ?? {}, size)
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
