// Offline "studio" render of the 3D Lab scene: progressive accumulation of many passes, each with a slightly different
// sub-pixel camera offset (anti-aliasing) and a key light jittered over a disc (true soft shadows), on top of an
// image-based environment, then tone mapped and exported as PNG. Runs in its own WebGL context so the editor is untouched.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type RenderBackground = 'light' | 'dark' | 'white'

export interface RenderOptions {
  /** Long side of the image in pixels. */
  longSide: number
  /** Number of accumulated passes (more = smoother shadows, slower). */
  passes: number
  /** Key light size in degrees (penumbra softness). */
  softness: number
  background: RenderBackground
  /** Studio light intensity multiplier. */
  exposure: number
}

export const BACKGROUNDS: Record<RenderBackground, string> = { light: '#e9edf3', dark: '#1c1f26', white: '#ffffff' }

const halton = (i: number, base: number) => {
  let f = 1, r = 0
  for (let n = i + 1; n > 0; n = Math.floor(n / base)) { f /= base; r += f * (n % base) }
  return r
}

const nextFrame = () => new Promise<void>(res => setTimeout(res, 0))

interface Input {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** Width / height of the image (the viewport's, so the framing is what the user sees). */
  aspect: number
  /** Direction from the scene centre to the key light. */
  keyDir: THREE.Vector3
}

export async function renderScene(
  { scene, camera, aspect, keyDir }: Input,
  opts: RenderOptions,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const width = aspect >= 1 ? opts.longSide : Math.max(2, Math.round(opts.longSide * aspect))
  const height = aspect >= 1 ? Math.max(2, Math.round(opts.longSide / aspect)) : opts.longSide
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  // ── Hide the editor furniture and the lights of the live view while rendering ──
  const hidden: THREE.Object3D[] = []
  const hide = (o: THREE.Object3D) => { if (o.visible) { o.visible = false; hidden.push(o) } }
  const solids: THREE.Object3D[] = []
  scene.children.forEach(c => {
    if (c.userData.noRender || (c as THREE.Light).isLight) hide(c)
    else if (c.type === 'Group' && c.children.some(k => k.userData.objectId)) {
      c.children.forEach(k => {
        if (k.userData.sketch || k.userData.hole) hide(k)
        else if (k.visible) solids.push(k)
      })
    }
  })
  const box = new THREE.Box3()
  solids.forEach(o => box.expandByObject(o))
  if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50))
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 10)

  // ── Studio: environment, key / fill / rim lights, shadow-catching floor ──
  const oldEnv = scene.environment, oldEnvI = scene.environmentIntensity, oldBg = scene.background
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  pmrem.dispose()
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.6 * opts.exposure
  scene.background = new THREE.Color(BACKGROUNDS[opts.background])
  const added: THREE.Object3D[] = []
  const key = new THREE.DirectionalLight('#fff6ea', 2.6 * opts.exposure)
  key.castShadow = true
  key.shadow.mapSize.set(4096, 4096)
  key.shadow.radius = 1.5
  key.shadow.bias = -0.0002
  key.shadow.normalBias = (radius * 2.4) / 4096 * 2.5
  Object.assign(key.shadow.camera, { left: -radius * 1.25, right: radius * 1.25, top: radius * 1.25, bottom: -radius * 1.25, near: radius * 1.5, far: radius * 4.5 })
  const fill = new THREE.HemisphereLight('#ffffff', '#9aa6b8', 0.55 * opts.exposure)
  const rim = new THREE.DirectionalLight('#dbe7ff', 0.9 * opts.exposure)
  rim.position.set(center.x - keyDir.x * radius * 3, center.y - keyDir.y * radius * 3, center.z + radius * 2)
  rim.target.position.copy(center)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 60, radius * 60), new THREE.ShadowMaterial({ opacity: opts.background === 'dark' ? 0.55 : 0.32 }))
  floor.position.set(center.x, center.y, Math.min(0, box.min.z) - 0.02)
  floor.receiveShadow = true
  scene.add(key, key.target, fill, rim, rim.target, floor)
  added.push(key, key.target, fill, rim, rim.target, floor)

  // ── Accumulation buffers (half float, no blending needed: ping-pong) ──
  const mk = (samples: number, depth: boolean) => new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples, depthBuffer: depth })
  const rt = mk(4, true)
  const acc = [mk(0, false), mk(0, false)]
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quadGeo = new THREE.PlaneGeometry(2, 2)
  const addMat = new THREE.ShaderMaterial({
    uniforms: { tPrev: { value: null }, tNew: { value: null }, w: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tPrev; uniform sampler2D tNew; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tPrev, vUv) + texture2D(tNew, vUv) * w; }',
    depthTest: false, depthWrite: false,
  })
  const addScene = new THREE.Scene()
  const addQuad = new THREE.Mesh(quadGeo, addMat)
  addQuad.frustumCulled = false
  addScene.add(addQuad)
  const showMat = new THREE.MeshBasicMaterial({ map: acc[0].texture, toneMapped: true })
  const showScene = new THREE.Scene()
  const showQuad = new THREE.Mesh(quadGeo, showMat)
  showQuad.frustumCulled = false
  showScene.add(showQuad)

  const cleanup = () => {
    hidden.forEach(o => { o.visible = true })
    added.forEach(o => scene.remove(o))
    scene.environment = oldEnv
    scene.environmentIntensity = oldEnvI
    scene.background = oldBg
    floor.geometry.dispose()
    ;(floor.material as THREE.Material).dispose()
    key.shadow.map?.dispose()
    envRT.dispose()
    rt.dispose(); acc.forEach(a => a.dispose())
    quadGeo.dispose(); addMat.dispose(); showMat.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }

  try {
    renderer.setRenderTarget(acc[0])
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    const cam = camera.clone()
    cam.aspect = aspect
    cam.updateProjectionMatrix()
    const softRad = (Math.max(opts.softness, 0) * Math.PI) / 180
    const dir0 = keyDir.clone().normalize()
    const up = Math.abs(dir0.z) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
    const u = new THREE.Vector3().crossVectors(dir0, up).normalize()
    const v = new THREE.Vector3().crossVectors(dir0, u).normalize()
    const dist = radius * 3
    key.shadow.camera.near = dist - radius * 1.3
    key.shadow.camera.far = dist + radius * 1.3
    key.shadow.camera.updateProjectionMatrix()
    const N = Math.max(1, Math.round(opts.passes))
    renderer.setClearColor(new THREE.Color(BACKGROUNDS[opts.background]), 1)
    for (let i = 0; i < N; i++) {
      if (signal?.aborted) throw new DOMException('Render annullato', 'AbortError')
      cam.setViewOffset(width, height, halton(i, 2) - 0.5, halton(i, 3) - 0.5, width, height)
      const r = Math.sqrt(halton(i, 5)) * Math.tan(softRad), phi = halton(i, 7) * Math.PI * 2
      const d = dir0.clone().addScaledVector(u, Math.cos(phi) * r).addScaledVector(v, Math.sin(phi) * r).normalize()
      key.position.copy(center).addScaledVector(d, dist)
      key.target.position.copy(center)
      key.target.updateMatrixWorld()
      renderer.setRenderTarget(rt)
      renderer.clear()
      renderer.render(scene, cam)
      addMat.uniforms.tPrev.value = acc[0].texture
      addMat.uniforms.tNew.value = rt.texture
      addMat.uniforms.w.value = 1 / N
      renderer.setRenderTarget(acc[1])
      renderer.render(addScene, quadCam)
      acc.reverse()
      onProgress(i + 1, N)
      await nextFrame()
    }
    showMat.map = acc[0].texture
    renderer.setRenderTarget(null)
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1
    renderer.render(showScene, quadCam)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Esportazione immagine non riuscita'))), 'image/png'))
  } finally {
    cleanup()
  }
}
