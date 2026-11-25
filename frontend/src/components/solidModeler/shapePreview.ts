import * as THREE from 'three'
import { unitGeometry } from './geometry'
import type { PrimitiveDef } from './types'

const PREVIEW_PX = 144
// Library thumbnails are line art in black and white: light grey solid with crisp black edges.
const SOLID_FILL = '#f4f4f5'
const HOLE_FILL = '#ffffff'

let renderer: THREE.WebGLRenderer | null = null
let failed = false
const cache = new Map<string, string>()

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(PREVIEW_PX, PREVIEW_PX, false)
    renderer.setClearColor(0x000000, 0)
  } catch {
    failed = true
    renderer = null
  }
  return renderer
}

/** Renders the real library geometry (same builder as the viewport) once and caches it as an image,
 * so the palette shows what the shape actually looks like instead of a generic icon. Returns null
 * when WebGL is unavailable; callers fall back to an icon. */
export function shapePreviewUrl(def: PrimitiveDef): string | null {
  const key = `bw|${def.kind}|${JSON.stringify(def.params ?? {})}|${def.size.join('x')}|${def.hole ? 'h' : 's'}`
  const hit = cache.get(key)
  if (hit) return hit
  const gl = getRenderer()
  if (!gl) return null
  try {
    const scene = new THREE.Scene()
    const material = new THREE.MeshStandardMaterial({
      color: def.hole ? HOLE_FILL : SOLID_FILL,
      roughness: 0.9,
      metalness: 0,
      transparent: !!def.hole,
      opacity: def.hole ? 0.7 : 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      side: def.hole ? THREE.DoubleSide : THREE.FrontSide,
    })
    const mesh = new THREE.Mesh(unitGeometry(def.kind, def.params ?? {}, def.size), material)
    // Real proportions (a torus is flat, a wedge is not a cube), normalised so every shape fills the tile.
    const largest = Math.max(...def.size)
    mesh.scale.set(def.size[0] / largest, def.size[1] / largest, def.size[2] / largest)
    // The viewport is Z-up: stand the model up the same way before looking at it.
    const pivot = new THREE.Group()
    pivot.rotation.x = -Math.PI / 2
    pivot.add(mesh)
    scene.add(pivot)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 25),
      def.hole ? new THREE.LineDashedMaterial({ color: '#52525b', dashSize: 0.06, gapSize: 0.04 }) : new THREE.LineBasicMaterial({ color: '#18181b' }),
    )
    edges.computeLineDistances()
    edges.scale.copy(mesh.scale)
    pivot.add(edges)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 1.3))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(2, 3, 2.5)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
    camera.position.set(1.7, 1.35, 1.9)
    camera.lookAt(0, 0, 0)
    gl.render(scene, camera)
    const url = gl.domElement.toDataURL('image/png')
    material.dispose()
    cache.set(key, url)
    return url
  } catch {
    return null
  }
}
