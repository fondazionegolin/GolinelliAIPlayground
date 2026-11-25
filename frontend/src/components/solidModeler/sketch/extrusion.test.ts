import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { objectGeometry, objectMatrix, worldBox } from '../geometry'
import { groupObjects } from '../sceneOps'
import type { PrimitiveObject } from '../types'
import { analyzeSketch, regionContains, type SketchEntity } from './geom2d'
import { applySketchExtrusion, applySketchRevolve, regenerateFeatures, buildExtrusion, depthThrough, faceFrame, replaceExtrusion, sketchFromExtrusion, STANDARD_PLANES, upsertSketch } from './plane'
import type { SceneObject } from '../types'

const volume = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
  const mesh = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m)
  const p = mesh.getAttribute('position')
  let sum = 0
  for (let i = 0; i < p.count; i += 3) {
    const v = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, i + j))
    sum += v[0].dot(v[1].cross(v[2])) / 6
  }
  return Math.abs(sum)
}

const plate: SketchEntity[] = [{ id: 'r', type: 'rect', a: [-10, -5], b: [30, 15] }, { id: 'c', type: 'circle', c: [10, 5], r: 5 }]

describe('sketch extrusion', () => {
  it('extrudes a plate with a hole at real size and position', () => {
    const outer = analyzeSketch(plate).regions.find(r => r.holes.length === 1)!
    const obj = buildExtrusion({ plane: STANDARD_PLANES.top, regions: [outer], entities: plate, lo: 0, hi: 6, hole: false, color: '#000000', name: 'P' })
    expect(obj.size).toEqual([40, 20, 6])
    expect(obj.position).toEqual([10, 5, 3])
    const box = worldBox(obj)
    expect(box.min.z).toBeCloseTo(0, 6)
    expect(box.max.x).toBeCloseTo(30, 6)
    expect(volume(objectGeometry(obj), objectMatrix(obj))).toBeCloseTo((800 - Math.PI * 25) * 6, -1)
  })

  it('places a front-plane sketch extruded towards the viewer (-Y)', () => {
    const tri: SketchEntity[] = [{ id: 'p', type: 'polyline', pts: [[0, 0], [20, 0], [0, 10]], closed: true }]
    const region = analyzeSketch(tri).regions[0]
    const obj = buildExtrusion({ plane: STANDARD_PLANES.front, regions: [region], entities: tri, lo: 0, hi: 4, hole: false, color: '#000000', name: 'T' })
    const box = worldBox(obj)
    expect(box.min.y).toBeCloseTo(-4, 5)
    expect(box.max.y).toBeCloseTo(0, 5)
    expect(box.max.z).toBeCloseTo(10, 5)
    expect(box.max.x).toBeCloseTo(20, 5)
  })

  it('reopens the sketch of an extrusion and finds the same profiles, even after a resize', () => {
    const regions = analyzeSketch(plate).regions
    const outer = regions.find(r => r.holes.length === 1)!
    const obj = buildExtrusion({ plane: STANDARD_PLANES.top, regions: [outer], entities: plate, lo: -0.1, hi: 6, hole: false, color: '#000000', name: 'P' })
    const edit = sketchFromExtrusion(obj)!
    expect(edit.lo).toBeCloseTo(-0.1, 6)
    expect(edit.hi).toBeCloseTo(6, 6)
    const again = analyzeSketch(edit.entities).regions
    expect(again).toHaveLength(2)
    expect(again.filter(r => edit.regionPoints.some(p => regionContains(r, p)))).toHaveLength(1)

    const resized: PrimitiveObject = { ...obj, size: [80, 20, 12] }
    const e2 = sketchFromExtrusion(resized)!
    expect(e2.entities.find(e => e.id === 'c')!.type).toBe('ellipse')
    const rebuilt = buildExtrusion({ plane: e2.plane, regions: analyzeSketch(e2.entities).regions.filter(r => r.holes.length), entities: e2.entities, lo: e2.lo, hi: e2.hi, hole: false, color: '#000', name: 'P' })
    const b1 = worldBox(resized), b2 = worldBox(rebuilt)
    expect(b2.min.distanceTo(b1.min)).toBeLessThan(0.05)
    expect(b2.max.distanceTo(b1.max)).toBeLessThan(0.05)
  })

  it('cuts a pocket into a face and edits it inside the group', () => {
    const box: PrimitiveObject = { id: 'b', kind: 'box', name: 'Blocco', color: '#ff0000', hole: false, size: [40, 40, 20], position: [0, 0, 10], rotation: [0, 0, 0], params: {} }
    const g = objectGeometry(box)
    const tris: THREE.Vector3[] = []
    const pos = g.getAttribute('position'), idx = g.index!
    const m = objectMatrix(box)
    for (let i = 0; i < idx.count; i++) tris.push(new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(m))
    const top = tris.filter((_, i) => tris[i - (i % 3)].z > 19.99 && tris[i - (i % 3) + 1].z > 19.99 && tris[i - (i % 3) + 2].z > 19.99)
    const plane = faceFrame(box, new THREE.Vector3(0, 0, 1), top)
    expect(plane.origin).toEqual([0, 0, 20])
    expect(depthThrough(box, plane)).toBeCloseTo(21, 6)
    const sq: SketchEntity[] = [{ id: 's', type: 'rect', a: [-5, -5], b: [5, 5] }]
    const cut = buildExtrusion({ plane, regions: analyzeSketch(sq).regions, entities: sq, lo: -8, hi: 0.1, hole: true, color: '#ff0000', name: 'F' })
    const grouped = groupObjects([box, cut], ['b', cut.id])
    const group = grouped.objects[0]
    expect(group.kind).toBe('group')
    expect(volume(objectGeometry(group), objectMatrix(group))).toBeCloseTo(40 * 40 * 20 - 10 * 10 * 8, -1)
    if (group.kind !== 'group') return
    const edit = sketchFromExtrusion(group.children[1] as PrimitiveObject, group)!
    expect(edit.plane.origin[2]).toBeCloseTo(20, 5)
    const bigger: SketchEntity[] = [{ id: 's', type: 'rect', a: [-10, -10], b: [10, 10] }]
    const next = buildExtrusion({ plane: edit.plane, regions: analyzeSketch(bigger).regions, entities: bigger, lo: edit.lo, hi: edit.hi, hole: true, color: '#000', name: 'x' })
    const scene = replaceExtrusion(grouped.objects, edit, next)
    expect(volume(objectGeometry(scene[0]), objectMatrix(scene[0]))).toBeCloseTo(40 * 40 * 20 - 20 * 20 * 8, -1)
  })
})

describe('sketch objects and handle extrusion', () => {
  const block: PrimitiveObject = { id: 'b', kind: 'box', name: 'Blocco', color: '#ff0000', hole: false, size: [40, 40, 20], position: [0, 0, 10], rotation: [0, 0, 0], params: {} }
  const topPlane = () => {
    const g = objectGeometry(block), pos = g.getAttribute('position'), idx = g.index!, m = objectMatrix(block)
    const tris: THREE.Vector3[] = []
    for (let i = 0; i < idx.count; i++) tris.push(new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(m))
    return faceFrame(block, new THREE.Vector3(0, 0, 1), tris.filter((_, i) => tris[i - (i % 3)].z > 19.99 && tris[i - (i % 3) + 1].z > 19.99 && tris[i - (i % 3) + 2].z > 19.99))
  }
  const sq: SketchEntity[] = [{ id: 's', type: 'rect', a: [-5, -5], b: [5, 5] }]
  const vol = (o: SceneObject) => volume(objectGeometry(o), objectMatrix(o))

  it('drawing on a face and dragging outwards adds to the block, inwards drills it', () => {
    const { objects, id } = upsertSketch([block], topPlane(), sq)
    expect(objects.map(o => o.kind)).toEqual(['box', 'sketch'])
    const up = applySketchExtrusion(objects, id!, null, 6)!
    expect(up.mode).toBe('add')
    const g = up.objects.find(o => o.id === up.selectIds[0])!
    expect(g.kind).toBe('group')
    expect(vol(g)).toBeCloseTo(32000 + 100 * 6, -1)

    const down = applySketchExtrusion(objects, id!, null, -8)!
    expect(down.mode).toBe('cut')
    expect(vol(down.objects.find(o => o.id === down.selectIds[0])!)).toBeCloseTo(32000 - 100 * 8, -1)
    expect(down.objects.some(o => o.kind === 'sketch')).toBe(true)

    const preview = applySketchExtrusion(objects, id!, null, -8, { preview: true, dragId: 'drag' })!
    expect(preview.objects.find(o => o.id === 'drag')!.hole).toBe(true)
    expect(preview.objects).toHaveLength(3)
  })

  it('on the work plate outwards gives a new model, and tiny drags do nothing', () => {
    const { objects, id } = upsertSketch([], STANDARD_PLANES.top, sq)
    const up = applySketchExtrusion(objects, id!, null, 12)!
    expect(up.mode).toBe('solid')
    expect(vol(up.objects.find(o => o.id === up.selectIds[0])!)).toBeCloseTo(1200, 0)
    expect(applySketchExtrusion(objects, id!, null, 0.01)).toBeNull()
    expect(applySketchExtrusion(objects, id!, null, -5)!.mode).toBe('solid')
  })

  it('extrudes only the chosen region and can update or remove the sketch object', () => {
    const two: SketchEntity[] = [{ id: 'a', type: 'rect', a: [0, 0], b: [10, 10] }, { id: 'b', type: 'rect', a: [20, 0], b: [30, 10] }]
    const { objects, id } = upsertSketch([], STANDARD_PLANES.top, two)
    const one = applySketchExtrusion(objects, id!, 1, 5)!
    expect(vol(one.objects.find(o => o.id === one.selectIds[0])!)).toBeCloseTo(500, 0)
    const all = applySketchExtrusion(objects, id!, null, 5)!
    expect(vol(all.objects.find(o => o.id === all.selectIds[0])!)).toBeCloseTo(1000, 0)
    expect(upsertSketch(objects, STANDARD_PLANES.top, sq, id!).objects).toHaveLength(1)
    expect(upsertSketch(objects, STANDARD_PLANES.top, [], id!).objects).toHaveLength(0)
  })
})

describe('parametric features', () => {
  const block: PrimitiveObject = { id: 'b', kind: 'box', name: 'Blocco', color: '#ff0000', hole: false, size: [40, 40, 20], position: [0, 0, 10], rotation: [0, 0, 0], params: {} }
  const vol = (o: SceneObject) => volume(objectGeometry(o), objectMatrix(o))
  const topPlane = () => {
    const g = objectGeometry(block), pos = g.getAttribute('position'), idx = g.index!, m = objectMatrix(block)
    const tris: THREE.Vector3[] = []
    for (let i = 0; i < idx.count; i++) tris.push(new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(m))
    return { ...faceFrame(block, new THREE.Vector3(0, 0, 1), tris.filter((_, i) => tris[i - (i % 3)].z > 19.99 && tris[i - (i % 3) + 1].z > 19.99 && tris[i - (i % 3) + 2].z > 19.99)), targetId: 'b' }
  }
  const small: SketchEntity[] = [{ id: 's', type: 'rect', a: [-5, -5], b: [5, 5] }]
  const big: SketchEntity[] = [{ id: 's', type: 'rect', a: [-10, -10], b: [10, 10] }]

  it('a drilled hole follows the sketch when the sketch is edited', () => {
    const { objects, id } = upsertSketch([block], topPlane(), small)
    const cut = applySketchExtrusion(objects, id!, null, -8)!
    expect(vol(cut.objects.find(o => o.id === cut.selectIds[0])!)).toBeCloseTo(32000 - 800, -1)
    const edited = upsertSketch(cut.objects, topPlane(), big, id!).objects
    const r = regenerateFeatures(edited, id!)
    expect(r.updated).toBe(1)
    expect(r.lost).toEqual([])
    const group = r.objects.find(o => o.kind === 'group')!
    expect(vol(group)).toBeCloseTo(32000 - 20 * 20 * 8, -1)
  })

  it('keeps a feature untouched when its profile disappears', () => {
    const { objects, id } = upsertSketch([], STANDARD_PLANES.top, small)
    const ext = applySketchExtrusion(objects, id!, null, 5)!
    const open: SketchEntity[] = [{ id: 'l', type: 'line', a: [0, 0], b: [3, 3] }]
    const r = regenerateFeatures(upsertSketch(ext.objects, STANDARD_PLANES.top, open, id!).objects, id!)
    expect(r.updated).toBe(0)
    expect(r.lost).toHaveLength(1)
    expect(r.objects.some(o => o.kind === 'extrusion')).toBe(true)
  })

  it('revolves a profile around a sketch line and regenerates after an edit', () => {
    const profile: SketchEntity[] = [{ id: 'r', type: 'rect', a: [5, 0], b: [10, 4] }, { id: 'ax', type: 'line', a: [0, -2], b: [0, 8] }]
    const { objects, id } = upsertSketch([], STANDARD_PLANES.front, profile)
    const res = applySketchRevolve(objects, id!, ['r'], { a: [0, 0], d: [0, 1] }, 360)!
    const solid = res.objects.find(o => o.id === res.selectIds[0])!
    expect(solid.kind).toBe('revolve')
    expect(vol(solid)).toBeCloseTo(Math.PI * 75 * 4, -1)
    expect(worldBox(solid).max.z).toBeCloseTo(4, 3)
    const wider: SketchEntity[] = [{ id: 'r', type: 'rect', a: [5, 0], b: [10, 8] }, profile[1]]
    const r = regenerateFeatures(upsertSketch(res.objects, STANDARD_PLANES.front, wider, id!).objects, id!)
    expect(r.updated).toBe(1)
    expect(vol(r.objects.find(o => o.kind === 'revolve')!)).toBeCloseTo(Math.PI * 75 * 8, -2)
    expect(applySketchRevolve(objects, id!, ['r'], { a: [7, 0], d: [0, 1] }, 360)!.error).toBe('crosses')
    expect(applySketchRevolve(objects, id!, [], { a: [0, 0], d: [0, 1] }, 360)!.error).toBe('nothing')
  })

  it('closes an open silhouette against the axis and revolves it into a solid', () => {
    // A vase half-profile: only curves / segments, no closed shape and no segment on the axis.
    const silhouette: SketchEntity[] = [
      { id: 'a', type: 'line', a: [0, 0], b: [10, 0] },
      { id: 'b', type: 'line', a: [10, 0], b: [10, 20] },
      { id: 'c', type: 'line', a: [10, 20], b: [0, 20] },
    ]
    const { objects, id } = upsertSketch([], STANDARD_PLANES.front, silhouette)
    const res = applySketchRevolve(objects, id!, ['a', 'b', 'c'], { a: [0, 0], d: [0, 1] }, 360)!
    expect(res.error).toBeUndefined()
    const solid = res.objects.find(o => o.id === res.selectIds[0])!
    expect(vol(solid)).toBeCloseTo(Math.PI * 100 * 20, -2)
    // Only the side wall picked: it is closed with the axis too (a cylinder of radius 10).
    const wall = applySketchRevolve(objects, id!, ['b'], { a: [0, 0], d: [0, 1] }, 360)!
    expect(vol(wall.objects.find(o => o.id === wall.selectIds[0])!)).toBeCloseTo(Math.PI * 100 * 20, -2)
  })

  it('follows a profile that moved so far that the remembered point is outside it', () => {
    const { objects, id } = upsertSketch([], STANDARD_PLANES.top, [{ id: 'r', type: 'rect', a: [0, 0], b: [10, 10] }])
    const ext = applySketchExtrusion(objects, id!, null, 4)!
    const moved: SketchEntity[] = [{ id: 'r', type: 'rect', a: [12, 0], b: [22, 10] }]
    const r = regenerateFeatures(upsertSketch(ext.objects, STANDARD_PLANES.top, moved, id!).objects, id!)
    expect(r.updated).toBe(1)
    expect(worldBox(r.objects.find(o => o.kind === 'extrusion')!).min.x).toBeCloseTo(12, 3)
  })
})
