import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { tl } from '@/i18n/tl'

/**
 * Custom WebXR AR session (Chrome on Android): recognised surfaces drawn on the camera feed,
 * a reticle on the aimed point, a see-through preview of the model sitting there, tap to place,
 * then one-finger rotate / pinch scale. iOS has no WebXR: callers fall back to Quick Look.
 */

export type ArStage =
  | 'starting'
  | 'scanning'   // no surface under the reticle yet
  | 'vertical'   // aiming at a wall: cannot rest the object there
  | 'aiming'     // floor/table found: preview follows the reticle, tap to place
  | 'placed'

export interface ArPlacementCallbacks {
  onStage: (stage: ArStage) => void
  onScale: (scale: number) => void
  onPlanes: (count: number) => void
  onEnd: () => void
}

const ACCENT = new THREE.Color('#8b5cf6')
const OK = new THREE.Color('#22c55e')
const WARN = new THREE.Color('#f59e0b')
const MIN_SCALE = 0.1
const MAX_SCALE = 20
const MAX_DOTS = 700

export async function isWebXrArSupported(): Promise<boolean> {
  try {
    return !!(await navigator.xr?.isSessionSupported('immersive-ar'))
  } catch {
    return false
  }
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Dotted grid texture for recognised planes (tiles every 10 cm). */
function gridTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,255,255,0.10)'
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = 'rgba(255,255,255,0.95)'
  for (const [x, y] of [[32, 32], [96, 32], [32, 96], [96, 96]]) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill() }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(0,0,0,0.45)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function buildReticle(): { group: THREE.Group; materials: THREE.MeshBasicMaterial[]; pulse: THREE.Mesh } {
  const group = new THREE.Group()
  const mat = () => new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.085, 0.1, 64).rotateX(-Math.PI / 2), mat())
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.014, 24).rotateX(-Math.PI / 2), mat())
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.11, 64).rotateX(-Math.PI / 2), mat())
  const ticks = [0, 1, 2, 3].map(i => {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.04).rotateX(-Math.PI / 2).translate(0, 0, -0.135), mat())
    tick.rotation.y = (i * Math.PI) / 2
    return tick
  })
  for (const m of [ring, dot, pulse, ...ticks]) { m.renderOrder = 10; group.add(m) }
  group.visible = false
  return { group, materials: [ring, dot, pulse, ...ticks].map(m => m.material as THREE.MeshBasicMaterial), pulse }
}

interface PlaneEntry { mesh: THREE.Mesh; changed: number }

export class ArPlacementSession {
  private renderer: THREE.WebGLRenderer | null = null
  private session: XRSession | null = null
  private refSpace: XRReferenceSpace | null = null
  private hitSource: XRHitTestSource | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera()
  private model: THREE.Group | null = null
  private holder = new THREE.Group()
  private shadow: THREE.Mesh
  private reticle = buildReticle()
  private planes = new Map<XRPlane, PlaneEntry>()
  private planeMaterial: THREE.MeshBasicMaterial
  private dots: THREE.Points
  private dotCount = 0
  private frameNo = 0
  private stage: ArStage = 'starting'
  private hitPosition: THREE.Vector3 | null = null
  private yaw = 0
  private scale = 1
  private materials: THREE.Material[] = []
  private touch: { mode: 'tap' | 'rotate' | 'pinch'; x: number; y: number; t: number; dist: number; scale: number; yaw: number } | null = null

  constructor(private overlay: HTMLElement, private cb: ArPlacementCallbacks) {
    this.planeMaterial = new THREE.MeshBasicMaterial({ map: gridTexture(), color: '#c4b5fd', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
    const dotGeometry = new THREE.BufferGeometry()
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3))
    dotGeometry.setDrawRange(0, 0)
    this.dots = new THREE.Points(dotGeometry, new THREE.PointsMaterial({ map: dotTexture(), color: '#ddd6fe', size: 0.014, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.2 }))
    this.dots.frustumCulled = false
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }))
    this.scene.add(this.dots, this.reticle.group, this.holder)
    this.holder.visible = false
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a8a', 2.2))
    const sun = new THREE.DirectionalLight('#ffffff', 1.6)
    sun.position.set(0.5, 2, 1)
    this.scene.add(sun)
  }

  async start(src: string): Promise<void> {
    const xr = navigator.xr
    if (!xr) throw new Error(tl("WebXR non disponibile"))
    // requestSession needs the tap's user activation: ask for the camera first, load the model meanwhile.
    const loading = new GLTFLoader().loadAsync(src)
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local'],
      optionalFeatures: ['dom-overlay', 'plane-detection'],
      domOverlay: { root: this.overlay },
    })
    let gltf: Awaited<typeof loading>
    try {
      gltf = await loading
    } catch (err) {
      await session.end().catch(() => undefined)
      throw err
    }
    this.model = gltf.scene
    this.model.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of list) { m.transparent = true; this.materials.push(m) }
    })
    const box = new THREE.Box3().setFromObject(this.model)
    const size = box.getSize(new THREE.Vector3())
    const footprint = Math.max(size.x, size.z, 0.02) * 1.6
    this.shadow.scale.set(footprint, 1, footprint)
    this.shadow.position.y = 0.0005
    this.holder.add(this.shadow, this.model)

    this.session = session
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local')
    this.renderer = renderer
    await renderer.xr.setSession(session)
    this.refSpace = renderer.xr.getReferenceSpace()
    const viewer = await session.requestReferenceSpace('viewer')
    this.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null

    // Taps on the DOM overlay must not also fire XR "select" (we handle gestures ourselves).
    this.overlay.addEventListener('beforexrselect', this.preventSelect)
    this.overlay.addEventListener('touchstart', this.onTouchStart, { passive: false })
    this.overlay.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.overlay.addEventListener('touchend', this.onTouchEnd)
    session.addEventListener('end', this.onSessionEnd)
    this.setStage('scanning')
    renderer.setAnimationLoop(this.onFrame)
  }

  /** Back to aiming: the preview follows the reticle again until the next tap. */
  move() {
    if (this.stage === 'placed') this.setStage(this.hitPosition ? 'aiming' : 'scanning')
  }

  resetScale() { this.setScale(1) }

  /** Tap on "Posiziona qui" (or anywhere on the camera view). */
  place() {
    if (this.stage !== 'aiming' || !this.hitPosition) return
    this.holder.position.copy(this.hitPosition)
    this.setStage('placed')
    navigator.vibrate?.(30)
  }

  end() { void this.session?.end().catch(() => this.onSessionEnd()) }

  private preventSelect = (e: Event) => e.preventDefault()

  private setStage(stage: ArStage) {
    if (stage === this.stage) return
    this.stage = stage
    const ghost = stage !== 'placed'
    for (const m of this.materials) { m.opacity = ghost ? 0.55 : 1; m.depthWrite = !ghost; m.needsUpdate = true }
    this.cb.onStage(stage)
  }

  private setScale(scale: number) {
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
    this.holder.scale.setScalar(this.scale)
    this.cb.onScale(this.scale)
  }

  private onTouchStart = (e: TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-ar-ui]')) return
    e.preventDefault()
    const [a, b] = [e.touches[0], e.touches[1]]
    if (b) {
      this.touch = { mode: 'pinch', x: 0, y: 0, t: 0, dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale: this.scale, yaw: this.yaw }
    } else {
      this.touch = { mode: 'tap', x: a.clientX, y: a.clientY, t: performance.now(), dist: 0, scale: this.scale, yaw: this.yaw }
    }
  }

  private onTouchMove = (e: TouchEvent) => {
    const t = this.touch
    if (!t) return
    e.preventDefault()
    const [a, b] = [e.touches[0], e.touches[1]]
    if (t.mode === 'pinch' && b) {
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (t.dist > 0) this.setScale(t.scale * (dist / t.dist))
      return
    }
    if (!a) return
    const dx = a.clientX - t.x
    if (t.mode === 'tap' && Math.hypot(dx, a.clientY - t.y) > 12) t.mode = 'rotate'
    if (t.mode === 'rotate') this.yaw = t.yaw + dx * 0.012
  }

  private onTouchEnd = (e: TouchEvent) => {
    const t = this.touch
    if (!t || e.touches.length) return
    this.touch = null
    if (t.mode === 'tap' && performance.now() - t.t < 450) this.place()
  }

  private onFrame = (time: number, frame?: XRFrame) => {
    const renderer = this.renderer
    if (!renderer || !frame || !this.refSpace) return
    this.frameNo += 1
    const refSpace = this.refSpace

    // Recognised horizontal planes (when the browser supports plane detection).
    const detected = frame.detectedPlanes
    if (detected) {
      for (const [plane, entry] of this.planes) {
        if (!detected.has(plane)) { this.scene.remove(entry.mesh); entry.mesh.geometry.dispose(); this.planes.delete(plane) }
      }
      for (const plane of detected) {
        if (plane.orientation !== 'horizontal') continue
        let entry = this.planes.get(plane)
        if (!entry || entry.changed < plane.lastChangedTime) {
          const geometry = planeGeometry(plane.polygon)
          if (entry) { entry.mesh.geometry.dispose(); entry.mesh.geometry = geometry }
          else {
            entry = { mesh: new THREE.Mesh(geometry, this.planeMaterial), changed: 0 }
            entry.mesh.matrixAutoUpdate = false
            this.scene.add(entry.mesh)
            this.planes.set(plane, entry)
          }
          entry.changed = plane.lastChangedTime
        }
        const pose = frame.getPose(plane.planeSpace, refSpace)
        if (pose) entry.mesh.matrix.fromArray(pose.transform.matrix)
        entry.mesh.visible = this.stage !== 'placed'
      }
      if (this.frameNo % 30 === 0) this.cb.onPlanes(this.planes.size)
    }

    // Reticle on the point under the screen centre.
    const hit = this.hitSource ? frame.getHitTestResults(this.hitSource)[0] : undefined
    const pose = hit?.getPose(refSpace)
    if (pose) {
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix)
      const position = new THREE.Vector3().setFromMatrixPosition(m)
      const up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m))
      const horizontal = up.y > 0.75
      this.reticle.group.visible = this.stage !== 'placed'
      this.reticle.group.position.copy(position)
      this.reticle.group.quaternion.setFromRotationMatrix(m)
      const color = horizontal ? (this.stage === 'aiming' ? OK : ACCENT) : WARN
      for (const mat of this.reticle.materials) mat.color.copy(color)
      const s = 1 + 0.25 * Math.sin(time / 260)
      this.reticle.pulse.scale.set(s, 1, s)
      ;(this.reticle.pulse.material as THREE.MeshBasicMaterial).opacity = 0.9 - 0.6 * ((s - 0.75) / 0.5)
      if (horizontal) {
        this.hitPosition = position
        if (this.stage === 'scanning' || this.stage === 'vertical') this.setStage('aiming')
        // Without plane detection, leave a trail of dots on the surfaces found so far.
        if (!detected && this.frameNo % 4 === 0) this.addDot(position)
      } else if (this.stage !== 'placed') {
        this.hitPosition = null
        this.setStage('vertical')
      }
    } else {
      this.reticle.group.visible = false
      if (this.stage !== 'placed') { this.hitPosition = null; this.setStage('scanning') }
    }

    // Preview glued to the reticle (smoothed) until placed.
    if (this.stage === 'aiming' && this.hitPosition) {
      if (!this.holder.visible) this.holder.position.copy(this.hitPosition)
      this.holder.position.lerp(this.hitPosition, 0.35)
    }
    this.holder.visible = this.stage === 'aiming' || this.stage === 'placed'
    this.holder.rotation.set(0, this.yaw, 0)
    this.dots.visible = this.stage !== 'placed'

    renderer.render(this.scene, this.camera)
  }

  private addDot(p: THREE.Vector3) {
    const attr = this.dots.geometry.getAttribute('position') as THREE.BufferAttribute
    const i = this.dotCount % MAX_DOTS
    attr.setXYZ(i, p.x, p.y + 0.001, p.z)
    attr.needsUpdate = true
    this.dotCount += 1
    this.dots.geometry.setDrawRange(0, Math.min(this.dotCount, MAX_DOTS))
  }

  private onSessionEnd = () => {
    this.renderer?.setAnimationLoop(null)
    this.hitSource?.cancel()
    this.overlay.removeEventListener('beforexrselect', this.preventSelect)
    this.overlay.removeEventListener('touchstart', this.onTouchStart)
    this.overlay.removeEventListener('touchmove', this.onTouchMove)
    this.overlay.removeEventListener('touchend', this.onTouchEnd)
    for (const entry of this.planes.values()) entry.mesh.geometry.dispose()
    this.planes.clear()
    this.renderer?.dispose()
    this.renderer = null
    this.session = null
    this.cb.onEnd()
  }
}

/** XRPlane polygon (plane space, y = 0) → triangulated mesh with a 10 cm dotted grid. */
export function planeGeometry(polygon: ReadonlyArray<DOMPointReadOnly>): THREE.BufferGeometry {
  const contour = polygon.map(p => new THREE.Vector2(p.x, p.z))
  const faces = contour.length >= 3 ? THREE.ShapeUtils.triangulateShape(contour, []) : []
  const positions: number[] = []
  const uvs: number[] = []
  for (const face of faces) for (const i of face) {
    positions.push(contour[i].x, 0, contour[i].y)
    uvs.push(contour[i].x / 0.2, contour[i].y / 0.2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return g
}
