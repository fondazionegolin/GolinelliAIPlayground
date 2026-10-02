import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Loader2 } from 'lucide-react'

/** Orbitable preview for a .glb/.gltf/.stl blob. */
export function GlbViewer({ blob, format }: { blob: Blob; format: 'glb' | 'stl' }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(3, 5, 4)
    scene.add(sun)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.2

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const frame = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object)
      const size = box.getSize(new THREE.Vector3()).length() || 1
      const center = box.getCenter(new THREE.Vector3())
      object.position.sub(center)
      camera.position.set(size * 0.7, size * 0.5, size * 0.9)
      camera.near = size / 100
      camera.far = size * 100
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
    }

    blob.arrayBuffer().then((buffer) => {
      if (disposed) return
      if (format === 'stl') {
        const geometry = new STLLoader().parse(buffer)
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8b7cf6, metalness: 0.1, roughness: 0.6 }))
        mesh.rotation.x = -Math.PI / 2
        scene.add(mesh)
        frame(mesh)
        setState('ready')
        return
      }
      new GLTFLoader().parse(buffer, '', (gltf) => {
        if (disposed) return
        scene.add(gltf.scene)
        frame(gltf.scene)
        setState('ready')
      }, () => setState('error'))
    }).catch(() => setState('error'))

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()
    const stopSpin = () => { controls.autoRotate = false }
    renderer.domElement.addEventListener('pointerdown', stopSpin)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', stopSpin)
      controls.dispose()
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        mesh.geometry?.dispose()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [blob, format])

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-b from-slate-50 to-slate-200">
      {state === 'loading' && <Loader2 className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      {state === 'error' && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Impossibile leggere il modello 3D</p>}
    </div>
  )
}
