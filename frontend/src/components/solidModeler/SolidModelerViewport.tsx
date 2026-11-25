import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { applyMaterialPreset, materialById } from './materials'
import { renderScene, type RenderOptions } from './render'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { editableEdges, edgeLength, eulerDegFromQuaternion, objectGeometry, objectMatrix, regionGeometry, scaleOf, sketchLines, worldBox } from './geometry'
import { sceneBox } from './sceneOps'
import type { PrimitiveDef, PrimitiveObject, SceneObject, Vec3 } from './types'
import { applySketchExtrusion, planeOfSketch, sketchHandlePoint, sketchRegionsOf, type SketchPlane } from './sketch/plane'
import { PLATE_SIZE, PRIMITIVES } from './types'
import { tl } from '@/i18n/tl'

export type ViewName = 'home' | 'top' | 'front' | 'back' | 'left' | 'right' | 'fit'

/** Orthographic view square to a sketch plane: `center` (mm, in plane coords) at the middle of the canvas. */
export interface SketchCameraView {
  plane: SketchPlane
  center: [number, number]
  pxPerMm: number
}

export interface PlanePick {
  objectId: string | null
  normal: THREE.Vector3
  /** World-space triangles (flat list, 3 per triangle) of the planar face under the pointer. */
  triangles: THREE.Vector3[]
}

/** Click on any planar face of a solid in extrude mode. */
export interface FacePick extends PlanePick {
  /** World point under the pointer (tells which closed outline of the face is meant). */
  point: THREE.Vector3
}

export interface ViewportApi {
  setView: (view: ViewName) => void
  /** Switch to an orthographic camera square to a sketch plane (null = back to the 3D view). */
  setSketchCamera: (view: SketchCameraView | null) => void
  /** Put the keyboard in the first editable dimension of the selected object (Tab). */
  focusDimensions: () => void
  /** Small 16:10 WebP preview of the current view (without handles / selection). */
  snapshot: () => string | null
  /** Studio render of the current view (soft shadows, environment light) as a PNG. */
  render: (opts: RenderOptions, onProgress: (done: number, total: number) => void, signal?: AbortSignal) => Promise<Blob>
}

interface Props {
  objects: SceneObject[]
  edgeMode?: boolean
  selectedEdge?: string | null
  onSelectEdge?: (id: string | null) => void
  onEdgeLength?: (id: string, length: number) => void
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
  /** Plane picking for a new sketch: click the plate or a face. */
  pickPlane?: boolean
  onPickPlane?: (pick: PlanePick) => void
  /** Objects not drawn (e.g. the sketch being edited). */
  hiddenIds?: string[]
  /** Closed region of the selected sketch the extrusion handle works on (null = all). */
  sketchRegion?: number | null
  onSketchRegion?: (id: string, index: number | null) => void
  /** Extrude mode: a planar face of a solid was clicked. */
  onPickFace?: (pick: FacePick) => void
  /** Extrude mode: distance being dragged on the arrow (mm, negative = into the material). */
  onExtrudeDepth?: (t: number) => void
  /** Double click on a sketch in the scene: open it for editing. */
  onOpenSketch?: (id: string) => void
  /** Keep sketches visible even in the read-only (orbit-only) mode. */
  showSketches?: boolean
  /** Which manipulators the selected object shows: none, move (arrows + faces), rotate (rings), scale (corners + faces). */
  transformMode?: TransformMode
  /** Editable dimensions of the single selected object (local X, Y, Z), shown on its edges. */
  dimensions?: Vec3 | null
  onDimension?: (axis: 0 | 1 | 2, value: number) => void
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
  { label: tl("DESTRA"), view: 'right' },
  { label: tl("SINISTRA"), view: 'left' },
  { label: 'ALTO', view: 'top' },
  { label: 'BASSO', view: 'bottom' },
  { label: 'FRONTE', view: 'front' },
  { label: 'RETRO', view: 'back' },
]

export type TransformMode = 'select' | 'move' | 'rotate' | 'scale' | 'extrude'

type HandleKind =
  | { type: 'face'; axis: 0 | 1 | 2; side: 1 | -1; symmetric?: boolean }
  | { type: 'corner'; sx: 1 | -1; sy: 1 | -1; uniform?: boolean }
  | { type: 'axis'; axis: 0 | 1 | 2 }
  | { type: 'lift' }
  | { type: 'rotate'; axis: 0 | 1 | 2 }
  | { type: 'extrude' }

interface DragState {
  mode: 'move' | 'handle' | 'marquee' | 'none'
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
  extrudeT?: number
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

/** Triangles coplanar with `faceIndex` (same plane), in world space. */
function coplanarTriangles(mesh: THREE.Mesh, faceIndex: number): { normal: THREE.Vector3; triangles: THREE.Vector3[] } {
  const g = mesh.geometry
  const pos = g.getAttribute('position')
  const index = g.index
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k)
  const count = index ? index.count / 3 : pos.count / 3
  const m = mesh.matrixWorld
  const tri = (t: number) => [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, vi(t, k)).applyMatrix4(m))
  const ref = tri(faceIndex)
  const normal = new THREE.Vector3().subVectors(ref[1], ref[0]).cross(new THREE.Vector3().subVectors(ref[2], ref[0])).normalize()
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, ref[0])
  const out: THREE.Vector3[] = []
  if (count > 60000) return { normal, triangles: ref }
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  for (let t = 0; t < count; t++) {
    const v = tri(t)
    if (v.some(p => Math.abs(plane.distanceToPoint(p)) > 0.02)) continue
    const n = e1.subVectors(v[1], v[0]).cross(e2.subVectors(v[2], v[0]))
    if (n.lengthSq() < 1e-12 || n.normalize().dot(normal) < 0.999) continue
    out.push(...v)
  }
  return { normal, triangles: out.length ? out : ref }
}

function localBox(obj: SceneObject): THREE.Box3 {
  return objectGeometry(obj).boundingBox?.clone() ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
}

export default function SolidModelerViewport({
  objects, selection = EMPTY, snap = 1, highlightIds, readOnly = false, edgeMode = false, selectedEdge, onSelectEdge, onEdgeLength,
  onSelect = NOOP, onChange = NOOP, onDropPrimitive = NOOP, onHover, apiRef, pickPlane = false, onPickPlane, hiddenIds, sketchRegion = null, onSketchRegion, onPickFace, onExtrudeDepth, onOpenSketch, showSketches = false, transformMode = 'select', dimensions, onDimension,
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
    ortho: THREE.OrthographicCamera
    sketchView: SketchCameraView | null
    pickFx: THREE.Mesh
    pickKey: string
    hoverFx: THREE.Mesh
    hoverKey: string
    sun: THREE.DirectionalLight
    /** The offline render owns the scene for a while: the live loop must not draw it. */
    paused: boolean
  } | null>(null)
  // Latest props for the imperative event handlers.
  const live = useRef({ objects, selection, snap, readOnly, edgeMode, onSelectEdge, onSelect, onChange, onDropPrimitive, onHover, apiRef, pickPlane, onPickPlane, sketchRegion, onSketchRegion, onPickFace, onExtrudeDepth, onOpenSketch, hiddenIds, transformMode })
  live.current = { objects, selection, snap, readOnly, edgeMode, onSelectEdge, onSelect, onChange, onDropPrimitive, onHover, apiRef, pickPlane, onPickPlane, sketchRegion, onSketchRegion, onPickFace, onExtrudeDepth, onOpenSketch, hiddenIds, transformMode }
  const localApi = useRef<ViewportApi | null>(null)

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.autoClear = false
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.setClearColor('#eef2f7')
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#eef2f7')
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000)
    camera.up.set(0, 0, 1)
    camera.position.set(180, -260, 210)

    // Soft studio lighting: a room environment (reflections for metals, gentle fill) plus one key light with soft shadows.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTexture
    scene.environmentIntensity = 0.55
    pmrem.dispose()
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4d6', 0.9))
    const sun = new THREE.DirectionalLight('#ffffff', 1.5)
    sun.position.set(120, -160, 300)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    sun.shadow.radius = 5
    sun.shadow.blurSamples = 12
    Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 10, far: 800 })
    sun.shadow.bias = -0.0002
    sun.shadow.normalBias = 0.4
    scene.add(sun, sun.target)

    // Work plate (Tinkercad-like blue grid).
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE),
      new THREE.MeshStandardMaterial({ color: '#dbe7f5', roughness: 0.95, metalness: 0 }),
    )
    plate.receiveShadow = true
    plate.position.z = -0.05
    plate.userData.noRender = true
    scene.add(plate)
    const minor = new THREE.GridHelper(PLATE_SIZE, PLATE_SIZE / 2, '#b9cbe2', '#c8d7ea')
    minor.rotation.x = Math.PI / 2
    minor.userData.noRender = true
    ;(minor.material as THREE.Material).transparent = true
    ;(minor.material as THREE.Material).opacity = 0.7
    scene.add(minor)
    const major = new THREE.GridHelper(PLATE_SIZE, PLATE_SIZE / 10, '#6f8fbf', '#8fa9d0')
    major.rotation.x = Math.PI / 2
    major.position.z = 0.02
    major.userData.noRender = true
    scene.add(major)
    const axes = new THREE.Group()
    const axisLine = (to: THREE.Vector3, color: string) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to]), new THREE.LineBasicMaterial({ color }))
    axes.add(axisLine(new THREE.Vector3(PLATE_SIZE / 2, 0, 0.05), '#ef4444'), axisLine(new THREE.Vector3(0, PLATE_SIZE / 2, 0.05), '#22c55e'))
    axes.userData.noRender = true
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
    plaque.userData.noRender = true
    scene.add(plaque)
    const sideLabel = (text: string, x: number, y: number, rot: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 8),
        new THREE.MeshBasicMaterial({ map: labelTexture(text, { bg: '#dbe7f5', fg: '#6f8fbf', w: 500, h: 100, font: 60 }), transparent: true, opacity: 0.9, toneMapped: false }),
      )
      m.position.set(x, y, 0.08)
      m.rotation.z = rot
      m.userData.noRender = true
      scene.add(m)
    }
    // Oriented to read from the default (front) point of view.
    sideLabel('RETRO', 0, PLATE_SIZE / 2 - 6, 0)
    sideLabel(tl("DESTRA"), PLATE_SIZE / 2 - 6, 0, Math.PI / 2)
    sideLabel(tl("SINISTRA"), -PLATE_SIZE / 2 + 6, 0, Math.PI / 2)

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
    selBoxes.userData.noRender = true
    handles.userData.noRender = true
    scene.add(world, selBoxes, handles)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 10)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    controls.maxDistance = 1500
    controls.minDistance = 20

    // Sketch mode: orthographic camera square to the sketch plane, driven by the 2D editor.
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000)
    const pickFx = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    )
    pickFx.renderOrder = 5
    pickFx.visible = false
    pickFx.userData.noRender = true
    pickFx.raycast = () => {}
    scene.add(pickFx)
    // Face of a sketch under the pointer: lights up so it is clear which closed outline a click will pick.
    const hoverFx = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    )
    hoverFx.renderOrder = 6
    hoverFx.visible = false
    hoverFx.userData.noRender = true
    hoverFx.matrixAutoUpdate = false
    hoverFx.raycast = () => {}
    scene.add(hoverFx)

    three.current = { renderer, scene, camera, controls, world, handles, selBoxes, plate, meshes: new Map(), cubeScene, cubeCamera, cube, cubeHover: -1, ortho, sketchView: null, pickFx, pickKey: '', hoverFx, hoverKey: '', sun, paused: false }

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
      if (three.current?.paused) return
      controls.update()
      // Keep handles a constant on-screen size.
      handles.children.forEach(h => {
        if (h.userData.fixedScreen) {
          h.getWorldPosition(tmp)
          const s = camera.position.distanceTo(tmp) * (h.userData.screenScale ?? 0.0135)
          h.scale.setScalar(s)
          if (h.userData.billboard) h.quaternion.copy(camera.quaternion)
        }
      })
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, w, h)
      renderer.clear()
      const sketchView = three.current?.sketchView
      if (sketchView) {
        const { plane, center, pxPerMm } = sketchView
        const n = new THREE.Vector3(...plane.n)
        const target = new THREE.Vector3(...plane.origin)
          .addScaledVector(new THREE.Vector3(...plane.x), center[0])
          .addScaledVector(new THREE.Vector3(...plane.y), center[1])
        ortho.position.copy(target).addScaledVector(n, 3000)
        ortho.up.set(...plane.y)
        ortho.lookAt(target)
        ortho.left = -w / 2 / pxPerMm
        ortho.right = w / 2 / pxPerMm
        ortho.top = h / 2 / pxPerMm
        ortho.bottom = -h / 2 / pxPerMm
        ortho.updateProjectionMatrix()
        handles.visible = false
        selBoxes.visible = false
        renderer.render(scene, ortho)
        handles.visible = true
        selBoxes.visible = true
        return
      }
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
      render: async (opts, onProgress, signal) => {
        const t = three.current
        if (!t) throw new Error('Viewport non pronto')
        const el = t.renderer.domElement
        t.paused = true
        try {
          return await renderScene({
            scene: t.scene,
            camera: t.camera,
            aspect: (el.clientWidth || 16) / (el.clientHeight || 9),
            keyDir: t.sun.position.clone().sub(t.sun.target.position),
          }, opts, onProgress, signal)
        } finally {
          t.paused = false
        }
      },
      setSketchCamera: () => {},
      focusDimensions: () => {},
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
    api.setSketchCamera = (view) => {
      const t = three.current
      if (!t) return
      t.sketchView = view
      t.controls.enabled = !view
    }
    localApi.current = api
    if (apiRef) apiRef.current = api
  }, [apiRef])

  useEffect(() => {
    const t = three.current
    if (!t || pickPlane) return
    t.pickFx.visible = false
    t.pickKey = ''
  }, [pickPlane])

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
        mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial())
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
      if (obj.kind === 'sketch') {
        // Sketches stay in the scene as a faint blue film with a thin outline (not in the public viewer).
        const sm = mesh.material as THREE.MeshStandardMaterial
        sm.color.set('#2563eb')
        sm.transparent = true
        sm.opacity = selected ? 0.3 : 0.16
        sm.depthWrite = false
        sm.side = THREE.DoubleSide
        sm.polygonOffset = true
        sm.polygonOffsetFactor = -2
        sm.polygonOffsetUnits = -2
        sm.emissive.set('#1d4ed8')
        sm.emissiveIntensity = selected ? 0.3 : 0.1
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.userData.sketch = true
        mesh.visible = (!readOnly || showSketches) && !obj.hidden && !(hiddenIds ?? []).includes(obj.id)
        const stale = mesh.children.find(c => c.userData.sketchLines)
        if (stale && stale.userData.src !== obj.params.sketch?.entities) { mesh.remove(stale); stale.userData.disposeMaterial?.() }
        if (!mesh.children.some(c => c.userData.sketchLines)) {
          const lm = new THREE.LineBasicMaterial({ color: '#1d4ed8', transparent: true, opacity: 0.75, depthWrite: false })
          const lines = new THREE.LineSegments(sketchLines(obj as PrimitiveObject), lm)
          lines.userData = { sketchLines: true, src: obj.params?.sketch?.entities, disposeMaterial: () => lm.dispose() }
          lines.raycast = () => {}
          mesh.add(lines)
        }
        const lm = (mesh.children.find(c => c.userData.sketchLines) as THREE.LineSegments).material as THREE.LineBasicMaterial
        lm.opacity = selected ? 1 : 0.55
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(objectMatrix(obj))
        mesh.matrixWorldNeedsUpdate = true
        continue
      }
      mesh.visible = !obj.hidden
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.color.set(obj.hole ? HOLE_COLOR : obj.color)
      // Extrude mode: only the new volume (and a selected result) stays solid; every other model turns see-through.
      const isPreview = obj.id === 'extrude-preview'
      const ghost = transformMode === 'extrude' && !obj.hole && !isPreview && !selected
      const preset = materialById(obj.material)
      applyMaterialPreset(mat as unknown as THREE.MeshPhysicalMaterial, preset, obj.color)
      if (obj.hole) mat.color.set(HOLE_COLOR)
      const glass = preset.opacity != null && !obj.hole
      mat.transparent = obj.hole || ghost || glass
      mat.opacity = isPreview ? (obj.hole ? 0.8 : 1) : obj.hole ? 0.32 : ghost ? 0.2 : (preset.opacity ?? 1)
      mat.depthWrite = !obj.hole && !ghost && !glass
      mesh.renderOrder = isPreview ? 10 : 0
      mesh.userData.hole = obj.hole
      if (mat.userData.ghost !== ghost) { mat.userData.ghost = ghost; mat.needsUpdate = true }
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
    // Shadow frustum hugging the models: sharper, softer-edged shadows (no stair steps) at any scene size.
    {
      const bounds = new THREE.Box3()
      for (const [, m] of t.meshes) if (m.visible && !m.userData.sketch && !m.userData.hole) bounds.expandByObject(m)
      if (!bounds.isEmpty()) {
        const c = bounds.getCenter(new THREE.Vector3())
        const r = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius * 1.15, 12)
        const dir = t.sun.position.clone().sub(t.sun.target.position).normalize()
        t.sun.target.position.copy(c)
        t.sun.position.copy(c).addScaledVector(dir, r * 3)
        Object.assign(t.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: r * 1.4, far: r * 4.6 })
        t.sun.shadow.camera.updateProjectionMatrix()
        t.sun.shadow.normalBias = Math.max((r * 2) / 4096 * 2.5, 0.05)
        t.sun.target.updateMatrixWorld()
      }
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
  }, [objects, selection, highlightIds, edgeMode, hiddenIds, sketchRegion, readOnly, showSketches, transformMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function buildSelectionOverlay() {
    const t = three.current
    if (!t) return
    const dispose = (g: THREE.Group) => {
      g.children.forEach(c => c.traverse(n => { if ((n as THREE.Mesh).geometry) (n as THREE.Mesh).geometry.dispose() }))
      g.clear()
    }
    dispose(t.handles)
    dispose(t.selBoxes)
    const selected = objects.filter(o => selection.includes(o.id) && !o.hidden)
    for (const obj of selected) {
      const helper = new THREE.Box3Helper(worldBox(obj), new THREE.Color('#2563eb'))
      ;(helper.material as THREE.LineBasicMaterial).transparent = true
      ;(helper.material as THREE.LineBasicMaterial).opacity = 0.55
      helper.raycast = () => {}
      t.selBoxes.add(helper)
    }
    if (selected.length === 1 && selected[0].kind === 'sketch' && !readOnly) {
      const sk = selected[0] as PrimitiveObject
      const m = objectMatrix(sk)
      const { regions } = sketchRegionsOf(sk)
      const chosen = sketchRegion != null && regions[sketchRegion] ? [regions[sketchRegion]] : []
      for (const r of chosen) {
        const fill = new THREE.Mesh(regionGeometry(r).translate(0, 0, 0.08), new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
        fill.applyMatrix4(m)
        fill.raycast = () => {}
        t.selBoxes.add(fill)
      }
      const hp = transformMode === 'extrude' ? sketchHandlePoint(sk, sketchRegion) : null
      if (hp) {
        const plane = planeOfSketch(sk)
        const n = new THREE.Vector3(...plane.n)
        const holder = new THREE.Group()
        holder.position.copy(new THREE.Vector3(hp[0], hp[1], 0.1).applyMatrix4(m))
        holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
        holder.userData = { fixedScreen: true, screenScale: 0.0075 }
        // One small arrow out of the face (negative distances are typed in the field or dragged below the face).
        const kind: HandleKind = { type: 'extrude' }
        const shaftLen = 4, headLen = 2.4, headR = 1.2, shaftR = 0.38
        for (const outline of [true, false]) {
          const grow = outline ? 0.28 : 0
          const mat = new THREE.MeshBasicMaterial({ color: outline ? '#ffffff' : '#1d4ed8', depthTest: false, side: outline ? THREE.BackSide : THREE.FrontSide })
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR + grow, shaftR + grow, shaftLen + grow * 2, 14).rotateX(Math.PI / 2), mat)
          shaft.position.z = shaftLen / 2
          const head = new THREE.Mesh(new THREE.ConeGeometry(headR + grow * 1.5, headLen + grow * 2, 20).rotateX(Math.PI / 2), mat)
          head.position.z = shaftLen + headLen / 2
          for (const part of [shaft, head]) { part.renderOrder = outline ? 11 : 12; part.userData = { handle: kind }; holder.add(part) }
        }
        const dot = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }))
        dot.renderOrder = 11
        dot.userData = { handle: kind }
        holder.add(dot)
        t.handles.add(holder)
      }
      return
    }
    if (!selected.length || edgeMode) return
    const multi = selected.length > 1
    const mode = live.current.transformMode
    // Several objects: one shared gizmo (move arrows / rotation rings) around their combined box.
    if (multi && mode !== 'move' && mode !== 'rotate') return
    const obj = selected[0]
    const m = objectMatrix(obj)
    const lb = localBox(obj)
    const lc = lb.getCenter(new THREE.Vector3())

    // Handles are flat discs facing the camera (white fill, blue rim), shown only in the mode that uses them.
    const disc = (pos: THREE.Vector3, kind: HandleKind, rim = '#2563eb') => {
      const g = new THREE.Group()
      g.position.copy(pos)
      g.userData = { fixedScreen: true, billboard: true, screenScale: 0.0085 }
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }))
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 32), new THREE.MeshBasicMaterial({ color: rim, depthTest: false }))
      face.renderOrder = 12
      ring.renderOrder = 13
      face.userData = { handle: kind }
      ring.userData = { handle: kind }
      g.add(face, ring)
      t.handles.add(g)
    }
    const faces: [0 | 1 | 2, 1 | -1][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]
    const faceCentre = (axis: number, side: number) => {
      const p = lc.clone()
      p.setComponent(axis, side > 0 ? lb.max.getComponent(axis) : lb.min.getComponent(axis))
      return p.applyMatrix4(m)
    }
    const wb = new THREE.Box3()
    for (const o of selected) wb.union(worldBox(o))
    const center = wb.getCenter(new THREE.Vector3())
    const colors = ['#ef4444', '#16a34a', '#2563eb']

    if (mode === 'move') {
      // Arrows along the world axes move the whole object; the discs on each face move just that face.
      const gizmo = new THREE.Group()
      gizmo.position.copy(center)
      gizmo.userData = { fixedScreen: true, screenScale: 0.012 }
      ;([0, 1, 2] as const).forEach(axis => {
        const dir = new THREE.Vector3().setComponent(axis, 1)
        const mat = new THREE.MeshBasicMaterial({ color: colors[axis], depthTest: false })
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 10), mat)
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 16), mat)
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
        shaft.quaternion.copy(q); head.quaternion.copy(q)
        shaft.position.copy(dir).multiplyScalar(3); head.position.copy(dir).multiplyScalar(6.6)
        const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 7.5, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false }))
        pick.quaternion.copy(q); pick.position.copy(dir).multiplyScalar(3.8)
        for (const part of [shaft, head, pick]) { part.renderOrder = 12; part.userData = { handle: { type: 'axis', axis } satisfies HandleKind } }
        gizmo.add(shaft, head, pick)
      })
      t.handles.add(gizmo)
      if (!multi) for (const [axis, side] of faces) disc(faceCentre(axis, side), { type: 'face', axis, side })
    } else if (mode === 'scale') {
      // Corners scale proportionally, face discs stretch symmetrically about the centre.
      for (const sx of [-1, 1] as const) for (const sy of [-1, 1] as const) {
        disc(new THREE.Vector3(sx > 0 ? lb.max.x : lb.min.x, sy > 0 ? lb.max.y : lb.min.y, lb.min.z).applyMatrix4(m), { type: 'corner', sx, sy, uniform: true }, '#7c3aed')
      }
      for (const [axis, side] of faces) disc(faceCentre(axis, side), { type: 'face', axis, side, symmetric: true }, '#7c3aed')
    } else if (mode === 'rotate') {
      // Large, thin rings well outside the model: easy to grab without touching anything else.
      const size = wb.getSize(new THREE.Vector3())
      const r = Math.max(size.length() / 2 * 1.35 + 14, 26)
      ;([2, 0, 1] as const).forEach(axis => {
        const ring = new THREE.Group()
        ring.position.copy(center)
        if (axis === 0) ring.rotation.y = Math.PI / 2
        if (axis === 1) ring.rotation.x = Math.PI / 2
        const visible = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(r * 0.0035, 0.18), 6, 160), new THREE.MeshBasicMaterial({ color: colors[axis], transparent: true, opacity: 0.9, depthWrite: false }))
        visible.raycast = () => {}
        const pick = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(r * 0.035, 1.6), 6, 96), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
        pick.userData = { handle: { type: 'rotate', axis } satisfies HandleKind }
        ring.add(visible, pick)
        t.handles.add(ring)
      })
    }
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
      void objectDist
      const hit = hits[0]
      return hit?.object.userData.handle as HandleKind | undefined
    }
    const hitObject = (skipSketch = false) => raycaster.intersectObjects(t.world.children, false).find(h => h.object.visible && !(skipSketch && h.object.userData.sketch))
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
      if (live.current.pickPlane) {
        e.stopImmediatePropagation()
        const hit = hitObject(true)
        if (hit && hit.faceIndex != null) {
          const { normal, triangles } = coplanarTriangles(hit.object as THREE.Mesh, hit.faceIndex)
          live.current.onPickPlane?.({ objectId: hit.object.userData.objectId as string, normal, triangles })
        } else {
          const p = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) {
            live.current.onPickPlane?.({ objectId: null, normal: new THREE.Vector3(0, 0, 1), triangles: [] })
          }
        }
        return
      }
      const { objects: objs, selection: sel } = live.current
      if (live.current.edgeMode) {
        const obj = objs.find(o => sel.length === 1 && sel[0] === o.id)
        if (obj) {
          const m = objectMatrix(obj)
          const surface = hitObject()?.distance ?? Infinity
          let closest: string | null = null
          let best = Infinity
          for (const edge of editableEdges(obj)) {
            const a = edge.a.clone().applyMatrix4(m), b = edge.b.clone().applyMatrix4(m)
            const rayPoint = new THREE.Vector3(), edgePoint = new THREE.Vector3()
            raycaster.ray.distanceSqToSegment(a, b, rayPoint, edgePoint)
            const screen = edgePoint.clone().project(t.camera)
            const pixels = Math.hypot((screen.x - ndc.x) * el.clientWidth / 2, (screen.y - ndc.y) * el.clientHeight / 2)
            if (pixels < 10 && pixels < best && t.camera.position.distanceTo(edgePoint) <= surface + 1) { closest = edge.id; best = pixels }
          }
          if (closest) { live.current.onSelectEdge?.(closest); e.stopImmediatePropagation(); return }
        }
      }
      const handle = !live.current.edgeMode && sel.length >= 1 ? hitHandle() : undefined
      if (live.current.transformMode === 'extrude' && !handle && !e.shiftKey) {
        const fh = hitObject()
        if (fh && fh.faceIndex != null && !fh.object.userData.sketch) {
          e.stopImmediatePropagation()
          const { normal, triangles } = coplanarTriangles(fh.object as THREE.Mesh, fh.faceIndex)
          live.current.onPickFace?.({ objectId: fh.object.userData.objectId as string, normal, triangles, point: fh.point.clone() })
          return
        }
      }
      const base: DragState = {
        mode: 'none', startObjects: objs.some(o => o.id === 'extrude-preview') ? objs.filter(o => o.id !== 'extrude-preview') : objs, startPoint: new THREE.Vector3(), recorded: false, moved: false,
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
        const unionBox = () => { const b = new THREE.Box3(); for (const o of objs) if (sel.includes(o.id)) b.union(worldBox(o)); return b }
        if (handle.type === 'axis') {
          const origin = unionBox().getCenter(new THREE.Vector3())
          const dir = new THREE.Vector3().setComponent(handle.axis, 1)
          drag.line = { origin, dir, t0: closestOnLine(raycaster.ray, origin, dir) }
        } else if (handle.type === 'face') {
          const dir = new THREE.Vector3().setFromMatrixColumn(rot, handle.axis).normalize()
          const lc = lb.getCenter(new THREE.Vector3())
          const lp = lc.clone()
          lp.setComponent(handle.axis, handle.side > 0 ? lb.max.getComponent(handle.axis) : lb.min.getComponent(handle.axis))
          const origin = lp.applyMatrix4(m)
          drag.line = { origin, dir, t0: closestOnLine(raycaster.ray, origin, dir) }
        } else if (handle.type === 'extrude') {
          const sk = obj as PrimitiveObject
          const hp = sketchHandlePoint(sk, live.current.sketchRegion ?? null)
          if (hp) {
            const origin = new THREE.Vector3(hp[0], hp[1], 0).applyMatrix4(m)
            const dir = new THREE.Vector3().setFromMatrixColumn(rot, 2).normalize()
            drag.line = { origin, dir, t0: closestOnLine(raycaster.ray, origin, dir) }
          }
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
          const wb = unionBox()
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
      if (base.additive) {
        // Shift + drag draws a selection rectangle; Shift + click (no drag) toggles the object under the pointer.
        t.controls.enabled = false
        try { el.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
        drag = { ...base, mode: 'marquee', hitId: hit ? (hit.object.userData.objectId as string) : null }
        return
      }
      if (hit) {
        const id = hit.object.userData.objectId as string
        t.controls.enabled = false
        el.setPointerCapture(e.pointerId)
        let nextSel = sel
        if (base.additive) nextSel = sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id]
        else if (!sel.includes(id)) nextSel = [id]
        if (nextSel !== sel) live.current.onSelect(nextSel)
        const isSketchHit = !!hit.object.userData.sketch
        if (isSketchHit && hit.faceIndex != null) {
          const ranges = (hit.object as THREE.Mesh).geometry.userData.ranges as number[] | undefined
          const idx = ranges ? ranges.findIndex(end => hit.faceIndex! < end) : -1
          live.current.onSketchRegion?.(id, idx >= 0 ? idx : null)
        }
        drag = { ...base, mode: base.additive || isSketchHit ? 'none' : 'move', hitId: id }
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
        const obj = hitObject(live.current.pickPlane)
        const id = obj?.object.userData.objectId as string | undefined
        const o = id ? live.current.objects.find(x => x.id === id) : undefined
        if (live.current.pickPlane) {
          t.hoverFx.visible = false
          t.hoverKey = ''
          const key = obj && obj.faceIndex != null ? `${id}:${obj.faceIndex}` : 'plate'
          if (key !== t.pickKey) {
            t.pickKey = key
            const tris = obj && obj.faceIndex != null
              ? coplanarTriangles(obj.object as THREE.Mesh, obj.faceIndex)
              : null
            const points = tris
              ? tris.triangles.map(p => p.clone().addScaledVector(tris.normal, 0.05))
              : [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * PLATE_SIZE / 2, y * PLATE_SIZE / 2, 0.08))
            t.pickFx.geometry.dispose()
            t.pickFx.geometry = new THREE.BufferGeometry().setFromPoints(points)
          }
          t.pickFx.visible = true
          live.current.onHover?.(o ? tl("Sketch sulla faccia di {0}", o.name) : tl("Sketch sul piano di lavoro"))
          el.style.cursor = 'crosshair'
          return
        }
        const overHandle = hitHandle()
        // Any closed face of a sketch lights up under the pointer (click = pick it for extrusion).
        let hoverKey = ''
        if (o?.kind === 'sketch' && obj?.faceIndex != null && !overHandle) {
          const ranges = (obj.object as THREE.Mesh).geometry.userData.ranges as number[] | undefined
          const idx = ranges ? ranges.findIndex(end => obj.faceIndex! < end) : -1
          const regions = idx >= 0 ? sketchRegionsOf(o as PrimitiveObject).regions : []
          if (idx >= 0 && regions[idx]) {
            hoverKey = `${id}:${idx}:${(o as PrimitiveObject).params.sketch?.entities.length}`
            if (hoverKey !== t.hoverKey) {
              t.hoverFx.geometry.dispose()
              t.hoverFx.geometry = regionGeometry(regions[idx]).translate(0, 0, 0.1)
              t.hoverFx.matrix.copy(objectMatrix(o))
              t.hoverFx.matrixWorldNeedsUpdate = true
            }
          }
        }
        if (!hoverKey && o && o.kind !== 'sketch' && obj?.faceIndex != null && live.current.transformMode === 'extrude' && !overHandle) {
          hoverKey = `${id}:f:${obj.faceIndex}`
          if (hoverKey !== t.hoverKey) {
            const tris = coplanarTriangles(obj.object as THREE.Mesh, obj.faceIndex)
            t.hoverFx.geometry.dispose()
            t.hoverFx.geometry = new THREE.BufferGeometry().setFromPoints(tris.triangles.map(p => p.clone().addScaledVector(tris.normal, 0.06)))
            t.hoverFx.matrix.identity()
            t.hoverFx.matrixWorldNeedsUpdate = true
          }
        }
        t.hoverKey = hoverKey
        t.hoverFx.visible = !!hoverKey
        const extrudeHint = overHandle?.type === 'extrude' ? tl("Trascina la freccia: verso l'alto aggiunge materiale, verso il basso scava") : null
        live.current.onHover?.(extrudeHint ?? (hoverKey ? tl("Clic per estrudere questa faccia") : o ? o.name : null))
        el.style.cursor = overHandle ? 'grab' : o ? 'pointer' : 'default'
        return
      }
      if (Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > 3) drag.moved = true
      if (!drag.moved) return
      if (drag.mode === 'marquee') {
        const r = el.getBoundingClientRect()
        const box = marqueeRef.current
        if (box) {
          const x0 = Math.min(drag.downX, e.clientX) - r.left, y0 = Math.min(drag.downY, e.clientY) - r.top
          Object.assign(box.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(e.clientX - drag.downX)}px`, height: `${Math.abs(e.clientY - drag.downY)}px` })
          const crossing = e.clientX < drag.downX
          box.style.borderColor = crossing ? '#16a34a' : '#2563eb'
          box.style.background = crossing ? 'rgba(22,163,74,0.12)' : 'rgba(37,99,235,0.12)'
        }
        live.current.onHover?.(e.clientX < drag.downX ? tl("Selezione per intersezione (da destra a sinistra)") : tl("Selezione per contenimento (da sinistra a destra)"))
        return
      }
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
      /** Same change on every selected object (several selected: they move / rotate together). */
      const replaceSel = (fn: (o: SceneObject) => SceneObject) => { const ids = live.current.selection; commit(start.map(o => (ids.includes(o.id) ? fn(o) : o))) }

      if (h.type === 'extrude' && drag.line) {
        const tt = snapTo(closestOnLine(raycaster.ray, drag.line.origin, drag.line.dir) - drag.line.t0, step)
        drag.extrudeT = tt
        live.current.onExtrudeDepth?.(tt)
        const res = applySketchExtrusion(start, obj.id, live.current.sketchRegion ?? null, tt, { preview: true, dragId: 'extrude-preview' })
        live.current.onHover?.(Math.abs(tt) < 0.05 ? tl("Trascina per estrudere") : res?.mode === 'cut' ? tl("Foratura {0} mm", round2(Math.abs(tt))) : tl("Estrusione {0} mm", round2(tt)))
        commit(res ? res.objects : start)
        return
      }
      if (h.type === 'axis' && drag.line) {
        const tt = snapTo(closestOnLine(raycaster.ray, drag.line.origin, drag.line.dir) - drag.line.t0, step)
        live.current.onHover?.(tl("Sposta {0}: {1} mm", ['X', 'Y', 'Z'][h.axis], round2(tt)))
        replaceSel(o => { const pos = [...o.position] as Vec3; pos[h.axis] = round2(pos[h.axis] + tt); return { ...o, position: pos } })
        return
      }
      if (h.type === 'face' && drag.line) {
        const tt = closestOnLine(raycaster.ray, drag.line.origin, drag.line.dir) - drag.line.t0
        const e0 = extent(h.axis)
        const e1 = Math.max(step || 0.5, snapTo(e0 + tt * h.side * (h.symmetric ? 2 : 1), step))
        live.current.onHover?.(tl("{0}: {1} mm", ['X', 'Y', 'Z'][h.axis], round2(e1)))
        if (h.symmetric) {
          const ns = [...scale] as Vec3
          ns[h.axis] = scale[h.axis] * (e1 / e0)
          replace(rescale(ns, lb.getCenter(new THREE.Vector3())))
          return
        }
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
        if (e.shiftKey || h.uniform) {
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
        live.current.onHover?.(tl("Rotazione {0}°", Math.round((ang * 180) / Math.PI)))
        replaceSel(o => {
          const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rotation.map(v => v * Math.PI / 180) as Vec3, 'XYZ'))
          const pos = new THREE.Vector3(...o.position).sub(drag!.pivot!).applyQuaternion(qd).add(drag!.pivot!)
          return { ...o, rotation: eulerDegFromQuaternion(qd.clone().multiply(q0)), position: [round2(pos.x), round2(pos.y), round2(pos.z)] as Vec3 }
        })
      }
    }

    const onUp = (e: PointerEvent) => {
      if (drag?.mode === 'marquee') {
        if (marqueeRef.current) marqueeRef.current.style.display = 'none'
        const { selection: sel, objects: objs } = live.current
        if (drag.moved) {
          const r = el.getBoundingClientRect()
          const x0 = Math.min(drag.downX, e.clientX) - r.left, x1 = Math.max(drag.downX, e.clientX) - r.left
          const y0 = Math.min(drag.downY, e.clientY) - r.top, y1 = Math.max(drag.downY, e.clientY) - r.top
          const crossing = e.clientX < drag.downX
          const hits: string[] = []
          const corner = new THREE.Vector3()
          for (const o of objs) {
            if (o.id === 'extrude-preview' || (o.kind === 'sketch' && live.current.readOnly && !showSketches)) continue
            if (o.hidden || (live.current.hiddenIds ?? []).includes(o.id)) continue
            const b = worldBox(o)
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
              corner.set(cx, cy, cz).project(t.camera)
              const px = ((corner.x + 1) / 2) * r.width, py = ((1 - corner.y) / 2) * r.height
              minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py)
            }
            const inside = minX >= x0 && maxX <= x1 && minY >= y0 && maxY <= y1
            const touches = maxX >= x0 && minX <= x1 && maxY >= y0 && minY <= y1
            if (crossing ? touches : inside) hits.push(o.id)
          }
          live.current.onSelect([...new Set([...sel, ...hits])])
          live.current.onHover?.(null)
        } else if (drag.hitId) {
          const id = drag.hitId
          live.current.onSelect(sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id])
        }
        try { el.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
        t.controls.enabled = true
        drag = null
        return
      }
      if (drag?.mode === 'handle' && drag.handle?.type === 'extrude' && drag.moved) {
        const id = live.current.selection[0]
        const res = id ? applySketchExtrusion(drag.startObjects, id, live.current.sketchRegion ?? null, drag.extrudeT ?? 0) : null
        live.current.onChange(res ? res.objects : drag.startObjects, false)
        if (res) live.current.onSelect(res.selectIds)
        live.current.onHover?.(null)
      }
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
    const onDblClick = (e: MouseEvent) => {
      if (live.current.readOnly || live.current.pickPlane) return
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, t.camera)
      const hit = hitObject()
      if (hit?.object.userData.sketch) live.current.onOpenSketch?.(hit.object.userData.objectId as string)
    }
    el.addEventListener('dblclick', onDblClick)
    el.addEventListener('contextmenu', ev => ev.preventDefault())
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true })
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
      el.removeEventListener('dblclick', onDblClick)
    }
  }, [])

  // ── Editable dimensions on the edges of the selected object (Tab to focus) ──
  const dimLabels = useRef<(HTMLLabelElement | null)[]>([])
  const dimInputs = useRef<(HTMLInputElement | null)[]>([])
  const dimObject = !readOnly && transformMode !== 'rotate' && transformMode !== 'extrude' && selection.length === 1 ? objects.find(o => o.id === selection[0] && o.kind !== 'sketch') : undefined
  useEffect(() => {
    const t = three.current
    if (!t || !dimObject || !dimensions) return
    const m = objectMatrix(dimObject)
    const lb = localBox(dimObject)
    const lc = lb.getCenter(new THREE.Vector3())
    const anchors = [
      new THREE.Vector3(lc.x, lb.min.y, lb.min.z), new THREE.Vector3(lb.max.x, lc.y, lb.min.z), new THREE.Vector3(lb.min.x, lb.min.y, lc.z),
    ].map(p => p.applyMatrix4(m))
    const centre = lc.clone().applyMatrix4(m)
    let frame = 0
    const update = () => {
      const w = t.renderer.domElement.clientWidth, h = t.renderer.domElement.clientHeight
      const cam = t.sketchView ? t.ortho : t.camera
      const c = centre.clone().project(cam)
      const cx = (c.x + 1) * w / 2, cy = (1 - c.y) * h / 2
      anchors.forEach((p, i) => {
        const el = dimLabels.current[i]
        if (!el) return
        const s = p.clone().project(cam)
        // Pushed outwards from the object's centre on screen, so the three labels never overlap the model or each other.
        let x = (s.x + 1) * w / 2, y = (1 - s.y) * h / 2
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1
        x += (dx / d) * 46
        y += (dy / d) * 30 + (i === 2 ? 0 : 6)
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.style.display = s.z > 1 || t.sketchView ? 'none' : 'flex'
      })
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [dimObject, dimensions])
  useEffect(() => {
    if (!apiRef?.current && !localApi.current) return
    const focus = () => { const i = dimInputs.current[0]; if (i) { i.focus(); i.select() } }
    if (localApi.current) localApi.current.focusDimensions = focus
    if (apiRef?.current) apiRef.current.focusDimensions = focus
  })

  const quoteRef = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const edgeObject = selection.length === 1 ? objects.find(o => o.id === selection[0]) : undefined
  const activeEdge = edgeMode && selectedEdge && edgeObject && editableEdges(edgeObject).find(e => e.id === selectedEdge)
  useEffect(() => {
    const t = three.current
    if (!t || !edgeMode || !edgeObject) return
    const group = new THREE.Group()
    const m = objectMatrix(edgeObject)
    for (const edge of editableEdges(edgeObject)) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([edge.a.clone().applyMatrix4(m), edge.b.clone().applyMatrix4(m)]), new THREE.LineBasicMaterial({ color: edge.id === selectedEdge ? '#f97316' : '#334155', depthTest: true }))
      group.add(line)
    }
    t.selBoxes.add(group)
    let frame = 0
    const update = () => {
      if (quoteRef.current && activeEdge) {
        const point = activeEdge.a.clone().add(activeEdge.b).multiplyScalar(0.5).applyMatrix4(m).project(t.camera)
        quoteRef.current.style.left = `${(point.x + 1) * t.renderer.domElement.clientWidth / 2}px`
        quoteRef.current.style.top = `${(1 - point.y) * t.renderer.domElement.clientHeight / 2}px`
        quoteRef.current.style.display = point.z > 1 ? 'none' : 'block'
      }
      frame = requestAnimationFrame(update)
    }
    update()
    return () => { cancelAnimationFrame(frame); t.selBoxes.remove(group); group.traverse(o => { if (o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } }) }
  }, [objects, selection, edgeMode, selectedEdge, highlightIds])

  return <>
    <div ref={hostRef} className="absolute inset-0" />
    {dimObject && dimensions && (
      <div className="pointer-events-none absolute inset-0 z-[5]">
        {(['X', 'Y', 'Z'] as const).map((axisLabel, i) => (
          <label
            key={axisLabel}
            ref={el => { dimLabels.current[i] = el }}
            style={{ display: 'none' }}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-slate-200 bg-white/95 py-0.5 pl-2 pr-1 text-[10px] font-semibold text-slate-500 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"
          >
            <span className={['text-red-500', 'text-green-600', 'text-blue-600'][i]}>{axisLabel}</span>
            <input
              ref={el => { dimInputs.current[i] = el }}
              key={`${dimObject.id}:${i}:${dimensions[i]}`}
              defaultValue={String(round2(dimensions[i]))}
              inputMode="decimal"
              aria-label={tl("Dimensione {0}", axisLabel)}
              onFocus={e => e.currentTarget.select()}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { e.currentTarget.value = String(round2(dimensions[i])); e.currentTarget.blur() }
                if (e.key === 'Tab') { e.preventDefault(); const next = dimInputs.current[(i + (e.shiftKey ? 2 : 1)) % 3]; next?.focus(); next?.select() }
              }}
              onBlur={e => {
                const v = Number(e.currentTarget.value.replace(',', '.'))
                if (Number.isFinite(v) && v > 0.05 && Math.abs(v - dimensions[i]) > 1e-6) onDimension?.(i as 0 | 1 | 2, v)
              }}
              className="w-12 rounded-full bg-slate-50 px-1.5 py-0.5 text-right text-[11px] font-semibold text-slate-900 outline-none"
            />
            <span className="pr-1">mm</span>
          </label>
        ))}
      </div>
    )}
    <div ref={marqueeRef} className="pointer-events-none absolute z-10 hidden border-2 border-dashed" style={{ display: 'none' }} />
    {edgeMode && activeEdge && edgeObject && <div ref={quoteRef} className="absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border-2 border-orange-400 bg-white p-1 shadow-lg">
      <label className="flex items-center gap-1 text-xs font-semibold text-slate-700">
        <input key={`${edgeObject.id}:${activeEdge.id}:${edgeLength(edgeObject, activeEdge)}`} aria-label={tl("Lunghezza dello spigolo")} type="number" min="0.1" step="0.1" defaultValue={Number(edgeLength(edgeObject, activeEdge).toFixed(2))} className="w-20 rounded border p-1" onBlur={e => { if (e.target.value.trim()) onEdgeLength?.(activeEdge.id, Number(e.target.value)) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /> mm
      </label>
    </div>}
  </>
}
