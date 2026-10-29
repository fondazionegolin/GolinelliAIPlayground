import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildNet, buildSolid, faceMatrices, faceNormal, type Net, type Polyhedron } from './solids'
import type { SolidWidget } from './types'
import { tl } from '@/i18n/tl'

const LATERAL = '#8fa6ee', BASE = '#f3c56f', EDGE = '#1f2a3d'
const UNFOLD_MS = 2600
const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const letter = (i: number) => LETTERS[i % 26] + (i >= 26 ? Math.floor(i / 26) : '')

function labelSprite(text: string, size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.arc(64, 64, 46, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = EDGE; ctx.font = '600 64px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 68)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }))
  sprite.scale.setScalar(size)
  sprite.renderOrder = 10
  return sprite
}

/** One face as its own mesh + outline, so each can turn around its hinge. */
function faceObject(poly: Polyhedron, f: number) {
  const pts = poly.faces[f].map(i => new THREE.Vector3(...poly.vertices[i]))
  const geometry = new THREE.BufferGeometry().setFromPoints(pts.slice(1, -1).flatMap((p, k) => [pts[0], p, pts[k + 2]]))
  geometry.computeVertexNormals()
  const base = poly.bases.includes(f)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: base ? BASE : LATERAL, side: THREE.DoubleSide, flatShading: true, transparent: true, opacity: .88, roughness: .65,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  }))
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: poly.smooth && !base ? .07 : .85 }))
  const group = new THREE.Group()
  group.add(mesh, outline)
  group.matrixAutoUpdate = false
  return group
}

/**
 * A solid the student orbits (drag), zooms (wheel/pinch) and opens into its net with a slider or the play button.
 * Rendered with three.js inside the Lab card; pointer and wheel events stay in the card, not on the canvas.
 */
export function SolidCard({ widget, onAsk }: { widget: SolidWidget; onAsk?: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const poly = useMemo(() => buildSolid(widget), [widget])
  const net = useMemo<Net | null>(() => poly ? buildNet(poly, widget.shape) : null, [poly, widget.shape])
  const canLabel = !!poly && !poly.smooth
  const [t, setT] = useState(0)
  const [spin, setSpin] = useState(!widget.unfold)
  const [labels, setLabels] = useState(widget.labels && canLabel)
  const tRef = useRef(0)
  tRef.current = t
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const view = useRef<{ render: () => void; reset: () => void; setSpin: (on: boolean) => void } | null>(null)
  const tween = useRef<number>()

  const animateTo = (target: number) => {
    cancelAnimationFrame(tween.current!)
    const from = tRef.current, start = performance.now(), ms = UNFOLD_MS * Math.abs(target - from)
    setSpin(false)
    const tick = (now: number) => {
      const k = ms ? Math.min(1, (now - start) / ms) : 1
      setT(from + (target - from) * ease(k))
      if (k < 1) tween.current = requestAnimationFrame(tick)
    }
    tween.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => cancelAnimationFrame(tween.current!), [])
  // Asked for its net: the card opens it by itself once it is on screen.
  useEffect(() => {
    if (!widget.unfold || !net) return
    const timer = window.setTimeout(() => animateTo(1), 900)
    return () => clearTimeout(timer)
  }, [widget.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    // The card is scaled by the canvas camera: render sharper than its CSS size so zooming in stays crisp.
    renderer.setPixelRatio(Math.min(3, (window.devicePixelRatio || 1) * 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.style.touchAction = 'none'
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight('#ffffff', '#c9d2e3', 1.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.5)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 1000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.autoRotateSpeed = 1.6

    // Problems give any unit (cm, m): the model is shown at a fixed size, its proportions intact.
    const size = poly ? Math.max(...poly.vertices.flat().map(Math.abs)) : widget.a
    const root = new THREE.Group()
    root.scale.setScalar(1 / size)
    scene.add(root)
    const faces = poly ? poly.faces.map((_, f) => faceObject(poly, f)) : []
    faces.forEach(g => root.add(g))
    if (!poly) root.add(new THREE.Mesh(new THREE.SphereGeometry(widget.a, 64, 40),
      new THREE.MeshStandardMaterial({ color: LATERAL, roughness: .55, transparent: true, opacity: .92 })))
    // Letters: on the vertices while closed, on each face's corners once it opens (a vertex splits across the net).
    // Pushed slightly outward, so a letter is hidden by the solid only when its vertex is behind it.
    const vertexLabels = poly ? poly.vertices.map((p, i) => { const s = labelSprite(letter(i), size * .16); s.position.set(...p).multiplyScalar(1.12); root.add(s); return s }) : []
    const cornerLabels = poly ? poly.faces.flatMap((face, f) => {
      const c = face.reduce((s, i) => s.add(new THREE.Vector3(...poly.vertices[i])), new THREE.Vector3()).divideScalar(face.length)
      return face.map(i => {
        const edge = new THREE.Vector3(...poly.vertices[face[0]]).distanceTo(new THREE.Vector3(...poly.vertices[face[1]]))
        const s = labelSprite(letter(i), edge * .2)
        // Inside the face, lifted off it on the side the net is seen from once flat (opposite to the outward normal).
        const local = new THREE.Vector3(...poly.vertices[i]).lerp(c, .24).addScaledVector(faceNormal(poly, f), -size * .03)
        root.add(s)
        return { sprite: s, face: f, local }
      })
    }) : []

    // Distance at which a sphere of radius r fits the narrower side of the view, with a margin.
    const fitDistance = (r: number) => r * 1.12 / Math.sin(THREE.MathUtils.degToRad(Math.min(camera.fov, camera.fov * camera.aspect) / 2))
    const radius = fitDistance(Math.sqrt(3))
    const home = () => { camera.position.set(.55, .45, .7).normalize().multiplyScalar(radius); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0) }
    home()
    let dirty = true, frame = 0, framing = true
    // While it opens, the view rises towards the top, so the finished net reads like a drawing on paper.
    const above = new THREE.Vector3(.12, 1, .42).normalize()
    let from = new THREE.Vector3(.55, .45, .7).normalize()
    controls.addEventListener('start', () => { framing = false })
    controls.addEventListener('change', () => { dirty = true })
    const place = (k: number) => {
      if (!poly || !net) return
      const m = faceMatrices(poly, net, k)
      faces.forEach((g, f) => { g.matrix.copy(m[f]); g.matrixWorldNeedsUpdate = true })
      const show = labelsRef.current
      vertexLabels.forEach(s => { s.visible = show && k < .02 })
      cornerLabels.forEach(({ sprite, face, local }) => { sprite.visible = show && k > .9; sprite.position.copy(local).applyMatrix4(m[face]) })
      // Until the student moves the view, the camera backs off to keep the opening net in frame.
      if (framing) {
        root.updateMatrixWorld(true)
        const box = new THREE.Box3()
        faces.forEach(g => box.expandByObject(g))
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        if (k < .001) from = camera.position.clone().sub(controls.target).normalize()
        const dir = from.clone().lerp(above, ease(k)).normalize()
        controls.target.copy(sphere.center)
        camera.position.copy(sphere.center).addScaledVector(dir, fitDistance(sphere.radius) * (1 - .18 * k))
      }
      dirty = true
    }
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'
      camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    let labelsOn = labelsRef.current, placed = -1
    const loop = () => {
      frame = requestAnimationFrame(loop)
      const k = tRef.current
      if (labelsOn !== labelsRef.current || placed !== k) { labelsOn = labelsRef.current; placed = k; place(k) }
      controls.update()
      if (!dirty && !controls.autoRotate) return
      sun.position.copy(camera.position).add(new THREE.Vector3(radius, radius * 2, 0))
      renderer.render(scene, camera)
      dirty = false
    }
    loop()
    // Wheel zooms the model, not the canvas around the card.
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    view.current = {
      render: () => { dirty = true },
      reset: () => { framing = true; home(); placed = -1; dirty = true },
      setSpin: on => { controls.autoRotate = on; dirty = true },
    }
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); el.removeEventListener('wheel', stop); controls.dispose()
      scene.traverse(o => {
        const obj = o as THREE.Mesh
        obj.geometry?.dispose()
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
        mats.forEach(mt => { (mt as THREE.SpriteMaterial).map?.dispose(); mt.dispose() })
      })
      renderer.dispose(); renderer.domElement.remove(); view.current = null
    }
  }, [poly, net, widget.a]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { view.current?.setSpin(spin) }, [spin])

  const opened = t > .98, closed = t < .02
  return <>
    <div ref={host} className="vc-solid-view" aria-label={tl("Modello 3D: {0}. Trascina per ruotarlo, rotella per avvicinarti.", widget.title)} role="img" />
    {net && <label className="vc-lab-row vc-solid-row"><span>{tl("Sviluppo")}</span>
      <input type="range" min={0} max={1} step={.01} value={t} aria-label={tl("Apri il solido nel piano")}
        onChange={e => { cancelAnimationFrame(tween.current!); setSpin(false); setT(Number(e.target.value)) }} />
      <output>{Math.round(t * 100)}%</output></label>}
    <div className="vc-lab-foot">
      {widget.note && <p>{widget.note}</p>}
      {net && <button type="button" onClick={() => animateTo(opened || (!closed && t > .5) ? 0 : 1)}>{opened ? tl("Richiudi") : closed ? tl("Sviluppa nel piano") : t > .5 ? tl("Richiudi") : 'Apri'}</button>}
      <button type="button" aria-pressed={spin} onClick={() => setSpin(s => !s)}>{spin ? tl("Ferma rotazione") : tl("Ruota")}</button>
      {canLabel && <button type="button" aria-pressed={labels} onClick={() => setLabels(l => !l)}>{labels ? tl("Nascondi lettere") : tl("Lettere ai vertici")}</button>}
      <button type="button" onClick={() => view.current?.reset()}>{tl("Vista iniziale")}</button>
      {onAsk && <button type="button" onClick={() => onAsk(tl("Sto guardando il modello 3D «{0}»{1}. ", widget.title, opened ? ' aperto nel suo sviluppo piano' : '') +
        tl("Aiutami a capire come usarlo per il problema, senza darmi la soluzione."))}>{tl("Chiedi al tutor")}</button>}
    </div>
  </>
}
