import * as THREE from 'three'
import { unitGeometry } from './geometry'
import type { PrimitiveDef } from './types'

const PREVIEW_PX = 144
const HOLE_COLOR = '#a3a3a3'

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
  const key = `${def.kind}|${JSON.stringify(def.params ?? {})}|${def.size.join('x')}|${def.hole ? 'h' : 's'}|${def.color}`
  const hit = cache.get(key)
  if (hit) return hit
  const gl = getRenderer()
  if (!gl) return null
  try {
    const scene = new THREE.Scene()
    const material = new THREE.MeshStandardMaterial({
      color: def.hole ? HOLE_COLOR : def.color,
      roughness: 0.55,
      metalness: 0.05,
      transparent: !!def.hole,
      opacity: def.hole ? 0.55 : 1,
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
    if (def.hole) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), new THREE.LineBasicMaterial({ color: '#737373' }))
      edges.scale.copy(mesh.scale)
      pivot.add(edges)
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 1.1))
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
