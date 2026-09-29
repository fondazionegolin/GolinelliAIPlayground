import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { eulerDegFromQuaternion, objectGeometry, objectMatrix, scaleOf, worldBox } from './geometry'
import { sceneBox } from './sceneOps'
import type { PrimitiveDef, SceneObject, Vec3 } from './types'
import { PLATE_SIZE, PRIMITIVES } from './types'

export type ViewName = 'home' | 'top' | 'front' | 'back' | 'left' | 'right' | 'fit'

export interface ViewportApi {
  setView: (view: ViewName) => void
  /** Small 16:10 WebP preview of the current view (without handles / selection). */
  snapshot: () => string | null
}

interface Props {
  objects: SceneObject[]
  selection?: string[]
  snap?: number
  highlightIds?: string[]
  /** Viewer mode: orbit only, no picking/handles/drop. */
  readOnly?: boolean
  onSelect?: (ids: string[]) => void
  /** Replace objects; `record` pushes an undo snapshot (true on the first frame of a drag). */
  onChange?: (next: SceneObject[], record: boolean) => void
  onDropPrimitive?: (def: PrimitiveDef, at: [number, number]) => void
  onHover?: (info: string | null) => void
  apiRef?: React.MutableRefObject<ViewportApi | null>
}

const NOOP = () => {}
const EMPTY: string[] = []
const CUBE_SIZE = 96
const CUBE_MARGIN = 12

function labelTexture(text: string, opts: { bg: string; fg: string; w?: number; h?: number; font?: number; border?: string }): THREE.CanvasTexture {
  const w = opts.w ?? 256
  const h = opts.h ?? 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = opts.bg
  ctx.fillRect(0, 0, w, h)
  if (opts.border) {
    ctx.strokeStyle = opts.border
    ctx.lineWidth = 10
    ctx.strokeRect(5, 5, w - 10, h - 10)
  }
  ctx.fillStyle = opts.fg
  ctx.font = `800 ${opts.font ?? 52}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Face label → view, in BoxGeometry material order (geometry is rotated to Z-up afterwards). */
const CUBE_FACES: { label: string; view: ViewName | 'bottom' }[] = [
  { label: 'DESTRA', view: 'right' },
  { label: 'SINISTRA', view: 'left' },
  { label: 'ALTO', view: 'top' },
  { label: 'BASSO', view: 'bottom' },
  { label: 'FRONTE', view: 'front' },
  { label: 'RETRO', view: 'back' },
]

type HandleKind =
  | { type: 'face'; axis: 0 | 1 | 2; side: 1 | -1 }
  | { type: 'corner'; sx: 1 | -1; sy: 1 | -1 }
  | { type: 'lift' }
  | { type: 'rotate'; axis: 0 | 1 | 2 }

interface DragState {
  mode: 'move' | 'handle' | 'none'
  handle?: HandleKind
  startObjects: SceneObject[]
  startPoint: THREE.Vector3
  plane?: THREE.Plane
  line?: { origin: THREE.Vector3; dir: THREE.Vector3; t0: number }
  angle0?: number
  pivot?: THREE.Vector3
  recorded: boolean
  moved: boolean
  downX: number
  downY: number
  additive: boolean
  hitId: string | null
}

const HOLE_COLOR = '#a3a3a3'

const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v)
const round2 = (v: number) => Math.round(v * 100) / 100

/** Parameter t along the line (origin + t·dir) closest to the ray. */
function closestOnLine(ray: THREE.Ray, origin: THREE.Vector3, dir: THREE.Vector3): number {
  const w0 = origin.clone().sub(ray.origin)
  const a = dir.dot(dir)
  const b = dir.dot(ray.direction)
  const c = ray.direction.dot(ray.direction)
  const d = dir.dot(w0)
  const e = ray.direction.dot(w0)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-8) return 0
  return (b * e - c * d) / denom
}

function localBox(obj: SceneObject): THREE.Box3 {
  return objectGeometry(obj).boundingBox?.clone() ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
}

export default function SolidModelerViewport({
  objects, selection = EMPTY, snap = 1, highlightIds, readOnly = false,
  onSelect = NOOP, onChange = NOOP, onDropPrimitive = NOOP, onHover, apiRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const three = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    world: THREE.Group
    handles: THREE.Group
    selBoxes: THREE.Group
    plate: THREE.Mesh
    meshes: Map<string, THREE.Mesh>
    cubeScene: THREE.Scene
    cubeCamera: THREE.OrthographicCamera
    cube: THREE.Mesh
    cubeHover: number
  } | null>(null)
  // Latest props for the imperative event handlers.
  const live = useRef({ objects, selection, snap, readOnly, onSelect, onChange, onDropPrimitive, onHover, apiRef })
  live.current = { objects, selection, snap, readOnly, onSelect, onChange, onDropPrimitive, onHover, apiRef }
  const localApi = useRef<ViewportApi | null>(null)

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.autoClear = false
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setClearColor('#eef2f7')
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#eef2f7')
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000)
    camera.up.set(0, 0, 1)
    camera.position.set(180, -260, 210)

    scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4d6', 1.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.5)
    sun.position.set(120, -160, 300)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 10, far: 800 })
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.6
    scene.add(sun)

    // Work plate (Tinkercad-like blue grid).
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE),
      new THREE.MeshStandardMaterial({ color: '#dbe7f5', roughness: 0.95, metalness: 0 }),
    )
    plate.receiveShadow = true
    plate.position.z = -0.05
    scene.add(plate)
    const minor = new THREE.GridHelper(PLATE_SIZE, PLATE_SIZE / 2, '#b9cbe2', '#c8d7ea')
    minor.rotation.x = Math.PI / 2
    ;(minor.material as THREE.Material).transparent = true
    ;(minor.material as THREE.Material).opacity = 0.7
    scene.add(minor)
    const major = new THREE.GridHelper(PLATE_SIZE, PLATE_SIZE / 10, '#6f8fbf', '#8fa9d0')
    major.rotation.x = Math.PI / 2
    major.position.z = 0.02
    scene.add(major)
    const axes = new THREE.Group()
    const axisLine = (to: THREE.Vector3, color: string) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to]), new THREE.LineBasicMaterial({ color }))
    axes.add(axisLine(new THREE.Vector3(PLATE_SIZE / 2, 0, 0.05), '#ef4444'), axisLine(new THREE.Vector3(0, PLATE_SIZE / 2, 0.05), '#22c55e'))
    scene.add(axes)

    // Front plaque: tells which side of the plate is the front (-Y), like a label on a real build plate.
    const plaque = new THREE.Group()
    const plaqueBody = new THREE.Mesh(
      new THREE.BoxGeometry(64, 14, 1.2),
      new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.6 }),
    )
    plaqueBody.receiveShadow = true
    const plaqueLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(62, 12),
      new THREE.MeshBasicMaterial({ map: labelTexture('▲  FRONTE', { bg: '#1e3a8a', fg: '#ffffff', w: 620, h: 120, font: 72 }), toneMapped: false }),
    )
    plaqueLabel.position.z = 0.61
    plaque.add(plaqueBody, plaqueLabel)
    plaque.position.set(0, -PLATE_SIZE / 2 - 7.5, 0.1)
    scene.add(plaque)
    const sideLabel = (text: string, x: number, y: number, rot: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 8),
        new THREE.MeshBasicMaterial({ map: labelTexture(text, { bg: '#dbe7f5', fg: '#6f8fbf', w: 500, h: 100, font: 60 }), transparent: true, opacity: 0.9, toneMapped: false }),
      )
      m.position.set(x, y, 0.08)
      m.rotation.z = rot
      scene.add(m)
    }
    // Oriented to read from the default (front) point of view.
    sideLabel('RETRO', 0, PLATE_SIZE / 2 - 6, 0)
    sideLabel('DESTRA', PLATE_SIZE / 2 - 6, 0, Math.PI / 2)
    sideLabel('SINISTRA', -PLATE_SIZE / 2 + 6, 0, Math.PI / 2)

    // Orientation cube (bottom-right corner, rendered in its own viewport).
    const cubeScene = new THREE.Scene()
    const cubeCamera = new THREE.OrthographicCamera(-1.05, 1.05, 1.05, -1.05, 0.1, 10)
    const cubeGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2).rotateX(Math.PI / 2)
    const cube = new THREE.Mesh(cubeGeometry, CUBE_FACES.map(f => new THREE.MeshBasicMaterial({
      map: labelTexture(f.label, { bg: f.view === 'front' ? '#dbeafe' : '#fafafa', fg: f.view === 'front' ? '#1e3a8a' : '#404040', font: f.label.length > 6 ? 40 : 50, border: '#a3a3a3' }),
      toneMapped: false,
    })))
    const cubeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(cubeGeometry), new THREE.LineBasicMaterial({ color: '#737373' }))
    cube.add(cubeEdges)
    cubeScene.add(cube)

    const world = new THREE.Group()
    const handles = new THREE.Group()
    const selBoxes = new THREE.Group()
    scene.add(world, selBoxes, handles)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 10)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    controls.maxDistance = 1500
    controls.minDistance = 20

    three.current = { renderer, scene, camera, controls, world, handles, selBoxes, plate, meshes: new Map(), cubeScene, cubeCamera, cube, cubeHover: -1 }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    let raf = 0
    const tmp = new THREE.Vector3()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      // Keep handles a constant on-screen size.
      handles.children.forEach(h => {
        if (h.userData.fixedScreen) {
          h.getWorldPosition(tmp)
          const s = camera.position.distanceTo(tmp) * (h.userData.screenScale ?? 0.0135)
          h.scale.setScalar(s)
        }
      })
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, w, h)
      renderer.clear()
      renderer.render(scene, camera)
      // Orientation cube follows the main camera direction.
      const dir = tmp.copy(camera.position).sub(controls.target).normalize()
      cubeCamera.position.copy(dir).multiplyScalar(4)
      cubeCamera.up.copy(camera.up)
      cubeCamera.lookAt(0, 0, 0)
      const hover = three.current?.cubeHover ?? -1
      ;(cube.material as THREE.MeshBasicMaterial[]).forEach((m, i) => m.color.set(i === hover ? '#bfdbfe' : '#ffffff'))
      renderer.setScissorTest(true)
      renderer.setScissor(w - CUBE_SIZE - CUBE_MARGIN, CUBE_MARGIN, CUBE_SIZE, CUBE_SIZE)
      renderer.setViewport(w - CUBE_SIZE - CUBE_MARGIN, CUBE_MARGIN, CUBE_SIZE, CUBE_SIZE)
      renderer.clearDepth()
      renderer.render(cubeScene, cubeCamera)
      renderer.setScissorTest(false)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
      three.current = null
    }
  }, [])

  // ── View API ────────────────────────────────────────────────────────────
  useEffect(() => {
    const api: ViewportApi = {
      snapshot: () => {
        const t = three.current
        if (!t) return null
        const w = t.renderer.domElement.clientWidth
        const h = t.renderer.domElement.clientHeight
        if (!w || !h) return null
        t.handles.visible = false
        t.selBoxes.visible = false
        t.renderer.setScissorTest(false)
        t.renderer.setViewport(0, 0, w, h)
        t.renderer.clear()
        t.renderer.render(t.scene, t.camera)
        const src = t.renderer.domElement
        t.handles.visible = true
        t.selBoxes.visible = true
        const out = document.createElement('canvas')
        out.width = 320
        out.height = 200
        const ctx = out.getContext('2d')
        if (!ctx) return null
        // centre-crop to 16:10
        const target = 320 / 200
        let sw = src.width
        let sh = src.height
        if (sw / sh > target) sw = sh * target
        else sh = sw / target
        ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 320, 200)
        return out.toDataURL('image/webp', 0.8)
      },
      setView: (view) => {
        const t = three.current
        if (!t) return
        const box = sceneBox(live.current.objects.filter(o => view !== 'fit' || !live.current.selection.length || live.current.selection.includes(o.id)))
        const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 10)
        const radius = box ? Math.max(box.getSize(new THREE.Vector3()).length() / 2, 30) : 120
        const dist = view === 'fit' ? radius / Math.tan((t.camera.fov * Math.PI) / 360) * 1.25 : Math.max(radius * 3.2, 260)
        const dirs: Record<ViewName, THREE.Vector3> = {
          home: new THREE.Vector3(0.55, -0.8, 0.65),
          fit: t.camera.position.clone().sub(t.controls.target).normalize(),
          top: new THREE.Vector3(0, -0.0001, 1),
          front: new THREE.Vector3(0, -1, 0.02),
          back: new THREE.Vector3(0, 1, 0.02),
          left: new THREE.Vector3(-1, 0, 0.02),
          right: new THREE.Vector3(1, 0, 0.02),
        }
        const dir = dirs[view].normalize()
        t.controls.target.copy(center)
        t.camera.position.copy(center).addScaledVector(dir, dist)
        t.controls.update()
      },
    }
    localApi.current = api
    if (apiRef) apiRef.current = api
  }, [apiRef])

  // ── Sync meshes ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = three.current
    if (!t) return
    const seen = new Set<string>()
    const highlight = new Set(highlightIds ?? [])
    for (const obj of objects) {
      seen.add(obj.id)
      let mesh = t.meshes.get(obj.id)
      const geometry = objectGeometry(obj)
      const selected = selection.includes(obj.id)
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.userData.objectId = obj.id
        t.world.add(mesh)
        t.meshes.set(obj.id, mesh)
      }
      if (mesh.geometry !== geometry) {
        mesh.geometry = geometry
        const edges = mesh.children.find(c => c.userData.edges)
        if (edges) { mesh.remove(edges); (edges as THREE.LineSegments).geometry.dispose() }
      }
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.color.set(obj.hole ? HOLE_COLOR : obj.color)
      mat.transparent = obj.hole
      mat.opacity = obj.hole ? 0.32 : 1
      mat.depthWrite = !obj.hole
      mat.roughness = 0.55
      mat.metalness = 0.02
      mat.emissive.set(selected ? '#1d4ed8' : highlight.has(obj.id) ? '#7c3aed' : '#000000')
      mat.emissiveIntensity = selected ? 0.18 : highlight.has(obj.id) ? 0.25 : 0
      mesh.castShadow = !obj.hole
      // Holes get crisp edges so they read like Tinkercad's hatched shapes.
      const existingEdges = mesh.children.find(c => c.userData.edges)
      if (obj.hole && !existingEdges) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: '#525252', transparent: true, opacity: 0.8 }))
        edges.userData.edges = true
        edges.raycast = () => {}
        mesh.add(edges)
      } else if (!obj.hole && existingEdges) {
        mesh.remove(existingEdges)
        ;(existingEdges as THREE.LineSegments).geometry.dispose()
      }
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(objectMatrix(obj))
      mesh.matrixWorldNeedsUpdate = true
    }
    for (const [id, mesh] of t.meshes) {
      if (!seen.has(id)) {
        t.world.remove(mesh)
        ;(mesh.material as THREE.Material).dispose()
        t.meshes.delete(id)
      }
    }
    // Draw order = scene order so solids render before translucent holes.
    t.world.children.sort((a, b) => objects.findIndex(o => o.id === a.userData.objectId) - objects.findIndex(o => o.id === b.userData.objectId))
    buildSelectionOverlay()
  }, [objects, selection, highlightIds]) // eslint-disable-line react-hooks/exhaustive-deps

  function buildSelectionOverlay() {
    const t = three.current
    if (!t) return
    const dispose = (g: THREE.Group) => {
      g.children.forEach(c => c.traverse(n => { if ((n as THREE.Mesh).geometry) (n as THREE.Mesh).geometry.dispose() }))
      g.clear()
    }
    dispose(t.handles)
    dispose(t.selBoxes)
    const selected = objects.filter(o => selection.includes(o.id))
    for (const obj of selected) {
      const helper = new THREE.Box3Helper(worldBox(obj), new THREE.Color('#2563eb'))
      ;(helper.material as THREE.LineBasicMaterial).transparent = true
      ;(helper.material as THREE.LineBasicMaterial).opacity = 0.55
      helper.raycast = () => {}
      t.selBoxes.add(helper)
    }
    if (selected.length !== 1) return
    const obj = selected[0]
    const m = objectMatrix(obj)
    const lb = localBox(obj)
    const lc = lb.getCenter(new THREE.Vector3())
    const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m)

    const cubeGeo = new THREE.BoxGeometry(1, 1, 1)
    const addHandle = (pos: THREE.Vector3, kind: HandleKind, color: string, geo: THREE.BufferGeometry = cubeGeo) => {
      const h = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false }))
      h.renderOrder = 10
      h.position.copy(pos)
      h.userData = { handle: kind, fixedScreen: true }
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#262626', depthTest: false }))
      outline.renderOrder = 11
      outline.raycast = () => {}
      h.add(outline)
      t.handles.add(h)
    }
    for (const sx of [-1, 1] as const) for (const sy of [-1, 1] as const) {
      addHandle(toWorld(sx > 0 ? lb.max.x : lb.min.x, sy > 0 ? lb.max.y : lb.min.y, lb.min.z), { type: 'corner', sx, sy }, '#ffffff')
    }
    addHandle(toWorld(lb.max.x, lc.y, lb.min.z), { type: 'face', axis: 0, side: 1 }, '#e5e5e5')
    addHandle(toWorld(lb.min.x, lc.y, lb.min.z), { type: 'face', axis: 0, side: -1 }, '#e5e5e5')
    addHandle(toWorld(lc.x, lb.max.y, lb.min.z), { type: 'face', axis: 1, side: 1 }, '#e5e5e5')
    addHandle(toWorld(lc.x, lb.min.y, lb.min.z), { type: 'face', axis: 1, side: -1 }, '#e5e5e5')
    addHandle(toWorld(lc.x, lc.y, lb.max.z), { type: 'face', axis: 2, side: 1 }, '#ffffff')

    // Elevation cone above the object.
    const wb = worldBox(obj)
    const top = new THREE.Vector3((wb.min.x + wb.max.x) / 2, (wb.min.y + wb.max.y) / 2, wb.max.z)
    const cone = new THREE.ConeGeometry(0.7, 1.6, 20).rotateX(Math.PI / 2)
    const liftHolder = new THREE.Group()
    liftHolder.position.copy(top)
    liftHolder.userData = { fixedScreen: true, screenScale: 0.011 }
    const lift = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: '#171717', depthTest: false }))
    lift.position.z = 3.2
    lift.renderOrder = 10
    lift.userData = { handle: { type: 'lift' } satisfies HandleKind }
    liftHolder.add(lift)
    t.handles.add(liftHolder)

    // Rotation rings (world axes) around the bbox centre.
    const center = wb.getCenter(new THREE.Vector3())
    const size = wb.getSize(new THREE.Vector3())
    const colors = ['#ef4444', '#22c55e', '#2563eb']
    ;([2, 0, 1] as const).forEach(axis => {
      const others = [0, 1, 2].filter(a => a !== axis)
      const r = Math.max(Math.hypot(size.getComponent(others[0]), size.getComponent(others[1])) / 2 + 6, 12)
      const ring = new THREE.Group()
      ring.position.copy(center)
      if (axis === 2) ring.position.z = wb.min.z + 0.2
      if (axis === 0) ring.rotation.y = Math.PI / 2
      if (axis === 1) ring.rotation.x = Math.PI / 2
      // Depth-tested: the part of the ring behind the model is hidden (less visual clutter).
      const visible = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(r * 0.01, 0.3), 8, 128), new THREE.MeshBasicMaterial({ color: colors[axis], transparent: true, opacity: 0.7, depthWrite: false }))
      visible.raycast = () => {}
      const pick = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(r * 0.05, 1.6), 6, 64), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
      pick.userData = { handle: { type: 'rotate', axis } satisfies HandleKind }
      ring.add(visible, pick)
      t.handles.add(ring)
    })
  }

  // ── Pointer interaction ─────────────────────────────────────────────────
  useEffect(() => {
    const t = three.current!
    const el = t.renderer.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let drag: DragState | null = null

    const setRay = (e: PointerEvent | DragEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, t.camera)
    }
    const hitHandle = () => {
      const hits = raycaster.intersectObjects(t.handles.children, true).filter(h => h.object.userData.handle)
      // Rotation rings are depth-tested: a ring segment hidden behind the model must not steal the click.
      const objectDist = raycaster.intersectObjects(t.world.children, false)[0]?.distance ?? Infinity
      const hit = hits.find(h => (h.object.userData.handle as HandleKind).type !== 'rotate' || h.distance <= objectDist + 0.5)
      return hit?.object.userData.handle as HandleKind | undefined
    }
    const hitObject = () => raycaster.intersectObjects(t.world.children, false)[0]
    /** Face index of the orientation cube under the pointer, or -1. */
    const cubeRay = new THREE.Raycaster()
    const hitCube = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left - (r.width - CUBE_SIZE - CUBE_MARGIN)
      const y = e.clientY - r.top - (r.height - CUBE_SIZE - CUBE_MARGIN)
      if (x < 0 || y < 0 || x > CUBE_SIZE || y > CUBE_SIZE) return -1
      cubeRay.setFromCamera(new THREE.Vector2((x / CUBE_SIZE) * 2 - 1, -(y / CUBE_SIZE) * 2 + 1), t.cubeCamera)
      const hit = cubeRay.intersectObject(t.cube, false)[0]
      return hit?.face ? hit.face.materialIndex : -1
    }

    const commit = (next: SceneObject[]) => {
      if (!drag) return
      live.current.onChange(next, !drag.recorded)
      drag.recorded = true
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const face = hitCube(e)
      if (face >= 0) {
        e.stopImmediatePropagation()
        const view = CUBE_FACES[face].view
        if (view !== 'bottom') localApi.current?.setView(view)
        return
      }
      if (live.current.readOnly) return
      setRay(e)
      const { objects: objs, selection: sel } = live.current
      const handle = sel.length === 1 ? hitHandle() : undefined
      const base: DragState = {
        mode: 'none', startObjects: objs, startPoint: new THREE.Vector3(), recorded: false, moved: false,
        downX: e.clientX, downY: e.clientY, additive: e.shiftKey || e.ctrlKey || e.metaKey, hitId: null,
      }
      if (handle) {
        t.controls.enabled = false
        el.setPointerCapture(e.pointerId)
        const obj = objs.find(o => o.id === sel[0])!
        drag = { ...base, mode: 'handle', handle }
        const m = objectMatrix(obj)
        const rot = new THREE.Matrix4().extractRotation(m)
        const lb = localBox(obj)
        if (handle.type === 'face') {
          const dir = new THREE.Vector3().setFromMatrixColumn(rot, handle.axis).normalize()
          const lc = lb.getCenter(new THREE.Vector3())
          const lp = lc.clone()
          lp.setComponent(handle.axis, handle.side > 0 ? lb.max.getComponent(handle.axis) : lb.min.getComponent(handle.axis))
          const origin = lp.applyMatrix4(m)
          drag.line = { origin, dir, t0: closestOnLine(raycaster.ray, origin, dir) }
        } else if (handle.type === 'lift') {
          const wb = worldBox(obj)
          const origin = new THREE.Vector3(obj.position[0], obj.position[1], wb.max.z)
          const dir = new THREE.Vector3(0, 0, 1)
          drag.line = { origin, dir, t0: closestOnLine(raycaster.ray, origin, dir) }
        } else if (handle.type === 'corner') {
          const normal = new THREE.Vector3().setFromMatrixColumn(rot, 2).normalize()
          const corner = new THREE.Vector3(handle.sx > 0 ? lb.max.x : lb.min.x, handle.sy > 0 ? lb.max.y : lb.min.y, lb.min.z).applyMatrix4(m)
          drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, corner)
          raycaster.ray.intersectPlane(drag.plane, drag.startPoint)
        } else if (handle.type === 'rotate') {
          const wb = worldBox(obj)
          const pivot = wb.getCenter(new THREE.Vector3())
          if (handle.axis === 2) pivot.z = wb.min.z
          const normal = new THREE.Vector3().setComponent(handle.axis, 1)
          drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pivot)
          drag.pivot = pivot
          const p = new THREE.Vector3()
          raycaster.ray.intersectPlane(drag.plane, p)
          drag.angle0 = angleAround(p.sub(pivot), handle.axis)
        }
        return
      }
      const hit = hitObject()
      if (hit) {
        const id = hit.object.userData.objectId as string
        t.controls.enabled = false
        el.setPointerCapture(e.pointerId)
        let nextSel = sel
        if (base.additive) nextSel = sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id]
        else if (!sel.includes(id)) nextSel = [id]
        if (nextSel !== sel) live.current.onSelect(nextSel)
        drag = { ...base, mode: base.additive ? 'none' : 'move', hitId: id }
        drag.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.point.z)
        drag.startPoint.copy(hit.point)
        return
      }
      drag = base // empty space: orbit via controls; click without move clears selection
    }

    const angleAround = (v: THREE.Vector3, axis: 0 | 1 | 2) => {
      if (axis === 2) return Math.atan2(v.y, v.x)
      if (axis === 0) return Math.atan2(v.z, v.y)
      return Math.atan2(v.x, v.z)
    }

    const onMove = (e: PointerEvent) => {
      setRay(e)
      if (!drag) {
        const face = hitCube(e)
        t.cubeHover = face
        if (face >= 0 || live.current.readOnly) {
          el.style.cursor = face >= 0 ? 'pointer' : 'default'
          return
        }
        const obj = hitObject()
        const id = obj?.object.userData.objectId as string | undefined
        const o = id ? live.current.objects.find(x => x.id === id) : undefined
        live.current.onHover?.(o ? o.name : null)
        el.style.cursor = hitHandle() ? 'grab' : o ? 'pointer' : 'default'
        return
      }
      if (Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > 3) drag.moved = true
      if (!drag.moved) return
      const { snap: step } = live.current
      const start = drag.startObjects

      if (drag.mode === 'move' && drag.plane) {
        const p = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(drag.plane, p)) return
        const dx = snapTo(p.x - drag.startPoint.x, step)
        const dy = snapTo(p.y - drag.startPoint.y, step)
        const sel = live.current.selection
        commit(start.map(o => sel.includes(o.id) ? { ...o, position: [round2(o.position[0] + dx), round2(o.position[1] + dy), o.position[2]] as Vec3 } : o))
        return
      }
      if (drag.mode !== 'handle' || !drag.handle) return
      const id = live.current.selection[0]
      const obj = start.find(o => o.id === id)
      if (!obj) return
      const h = drag.handle
      const m = objectMatrix(obj)
      const lb = localBox(obj)
      const scale = [...scaleOf(obj)] as Vec3
      const extent = (axis: number) => (lb.max.getComponent(axis) - lb.min.getComponent(axis)) * scale[axis]

      /** Rescale, keeping the local point `fixed` (in unit-box coords) where it is in world space. */
      const rescale = (newScale: Vec3, fixed: THREE.Vector3): SceneObject => {
        const before = fixed.clone().applyMatrix4(m)
        const after = fixed.clone().applyMatrix4(objectMatrix(obj, newScale))
        const pos = obj.position.map((v, i) => round2(v + before.getComponent(i) - after.getComponent(i))) as Vec3
        return obj.kind === 'group' ? { ...obj, scale: newScale, position: pos } : { ...obj, size: newScale.map(round2) as Vec3, position: pos }
      }
      const replace = (next: SceneObject) => commit(start.map(o => (o.id === id ? next : o)))

      if (h.type === 'face' && drag.line) {
        const tt = closestOnLine(raycaster.ray, drag.line.origin, drag.line.dir) - drag.line.t0
        const e0 = extent(h.axis)
        const e1 = Math.max(step || 0.5, snapTo(e0 + tt * h.side, step))
        const newScale = [...scale] as Vec3
        newScale[h.axis] = scale[h.axis] * (e1 / e0)
        const fixed = lb.getCenter(new THREE.Vector3())
        fixed.setComponent(h.axis, h.side > 0 ? lb.min.getComponent(h.axis) : lb.max.getComponent(h.axis))
        if (e.shiftKey) {
          const f = e1 / e0
          replace(rescale(scale.map(s => s * f) as Vec3, new THREE.Vector3(fixed.x, fixed.y, lb.min.z)))
        } else replace(rescale(newScale, fixed))
      } else if (h.type === 'corner' && drag.plane) {
        const p = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(drag.plane, p)) return
        const d = p.sub(drag.startPoint)
        const rot = new THREE.Matrix4().extractRotation(m)
        const ax = new THREE.Vector3().setFromMatrixColumn(rot, 0).normalize()
        const ay = new THREE.Vector3().setFromMatrixColumn(rot, 1).normalize()
        const ex0 = extent(0)
        const ey0 = extent(1)
        let ex1 = Math.max(step || 0.5, snapTo(ex0 + d.dot(ax) * h.sx, step))
        let ey1 = Math.max(step || 0.5, snapTo(ey0 + d.dot(ay) * h.sy, step))
        const newScale = [...scale] as Vec3
        if (e.shiftKey) {
          const f = Math.max(ex1 / ex0, ey1 / ey0)
          ex1 = ex0 * f; ey1 = ey0 * f
          newScale[2] = scale[2] * f
        }
        newScale[0] = scale[0] * (ex1 / ex0)
        newScale[1] = scale[1] * (ey1 / ey0)
        const fixed = new THREE.Vector3(h.sx > 0 ? lb.min.x : lb.max.x, h.sy > 0 ? lb.min.y : lb.max.y, lb.min.z)
        replace(rescale(newScale, fixed))
      } else if (h.type === 'lift' && drag.line) {
        const tt = snapTo(closestOnLine(raycaster.ray, drag.line.origin, drag.line.dir) - drag.line.t0, step)
        replace({ ...obj, position: [obj.position[0], obj.position[1], round2(obj.position[2] + tt)] })
      } else if (h.type === 'rotate' && drag.plane && drag.pivot) {
        const p = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(drag.plane, p)) return
        const raw = angleAround(p.clone().sub(drag.pivot), h.axis) - (drag.angle0 ?? 0)
        const stepRad = (e.shiftKey ? 1 : 15) * Math.PI / 180
        const ang = Math.round(raw / stepRad) * stepRad
        const axisVec = new THREE.Vector3().setComponent(h.axis, 1)
        const qd = new THREE.Quaternion().setFromAxisAngle(axisVec, ang)
        const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...obj.rotation.map(v => v * Math.PI / 180) as Vec3, 'XYZ'))
        const pos = new THREE.Vector3(...obj.position).sub(drag.pivot).applyQuaternion(qd).add(drag.pivot)
        live.current.onHover?.(`Rotazione ${Math.round((ang * 180) / Math.PI)}°`)
        replace({ ...obj, rotation: eulerDegFromQuaternion(qd.multiply(q0)), position: [round2(pos.x), round2(pos.y), round2(pos.z)] })
      }
    }

    const onUp = (e: PointerEvent) => {
      if (drag && !drag.moved && drag.mode === 'none' && !drag.hitId && e.button === 0) {
        if (!drag.additive) live.current.onSelect([])
      }
      if (drag?.mode === 'handle' || drag?.mode === 'move' || drag?.hitId) {
        try { el.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
      }
      t.controls.enabled = true
      drag = null
    }

    const onDragOver = (e: DragEvent) => { if (!live.current.readOnly && e.dataTransfer?.types.includes('application/x-solid-primitive')) e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData('application/x-solid-primitive')
      if (!raw) return
      e.preventDefault()
      setRay(e)
      const p = new THREE.Vector3()
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)
      const def = PRIMITIVES[Number(raw)]
      if (def) {
        const s = live.current.snap || 1
        live.current.onDropPrimitive(def, hit ? [snapTo(p.x, s), snapTo(p.y, s)] : [0, 0])
      }
    }

    // Registered before OrbitControls handles the event (capture on the canvas).
    el.addEventListener('pointerdown', onDown, { capture: true })
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    el.addEventListener('contextmenu', ev => ev.preventDefault())
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true })
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
    }
  }, [])

  return <div ref={hostRef} className="absolute inset-0" />
}
