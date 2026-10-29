import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { exportGLB } from './geometry'
import type { SceneObject } from './types'

// Node has Blob but no FileReader: the minimal subset GLTFExporter uses.
class NodeFileReader {
  result: ArrayBuffer | string | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.() }) }
  readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(b => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.() }) }
}
if (!('FileReader' in globalThis)) Object.assign(globalThis, { FileReader: NodeFileReader })

const box = (over: Partial<SceneObject>): SceneObject => ({
  id: 'a', name: 'Cubo', color: '#e8453c', hole: false, position: [50, 30, 10], rotation: [0, 0, 0],
  kind: 'box', size: [20, 40, 20], params: {}, ...over,
} as SceneObject)

describe('exportGLB', () => {
  it('writes a binary glTF at real size, Y up, resting on the floor and without holes', async () => {
    const blob = await exportGLB([box({}), box({ id: 'h', name: 'Foro', hole: true, position: [0, 0, 100] })])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('glTF')

    const gltf = await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, '')
    const meshes: THREE.Mesh[] = []
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
    expect(meshes).toHaveLength(1)
    expect((meshes[0].material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color('#e8453c').getHexString())

    const b = new THREE.Box3().setFromObject(gltf.scene)
    const size = b.getSize(new THREE.Vector3())
    // 20 × 40 × 20 mm, editor Z (height) becomes glTF Y; editor Y (depth) becomes glTF -Z.
    expect(size.x).toBeCloseTo(0.02, 4)
    expect(size.y).toBeCloseTo(0.02, 4)
    expect(size.z).toBeCloseTo(0.04, 4)
    expect(b.min.y).toBeCloseTo(0, 5)
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 5)
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 5)
  })
})

describe('planeGeometry', () => {
  it('triangulates an XRPlane polygon on y = 0 with a 20 cm UV tile', async () => {
    const { planeGeometry } = await import('./arPlacement')
    const square = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => ({ x, y: 0, z, w: 1 }) as DOMPointReadOnly)
    const g = planeGeometry(square)
    const pos = g.getAttribute('position')
    expect(pos.count).toBe(6)
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBe(0)
    expect(Math.max(...Array.from(g.getAttribute('uv').array as Float32Array))).toBeCloseTo(5)
    expect(planeGeometry(square.slice(0, 2)).getAttribute('position').count).toBe(0)
  })
})
