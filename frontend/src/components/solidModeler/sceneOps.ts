import * as THREE from 'three'
import { eulerDegFromQuaternion, objectMatrix, worldBox } from './geometry'
import type { GroupObject, PrimitiveDef, PrimitiveObject, SceneObject, Vec3 } from './types'
import { KIND_LABEL } from './types'

export function uid(prefix = 'o'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

export function createPrimitive(def: PrimitiveDef, at: [number, number] = [0, 0], existing: SceneObject[] = []): PrimitiveObject {
  const count = existing.filter(o => o.kind === def.kind).length + 1
  return {
    id: uid(def.kind),
    name: `${def.hole ? 'Foro ' : ''}${KIND_LABEL[def.kind]} ${count}`,
    kind: def.kind,
    color: def.color,
    hole: Boolean(def.hole),
    size: [...def.size] as Vec3,
    position: [at[0], at[1], def.size[2] / 2],
    rotation: [0, 0, 0],
    params: { ...(def.params ?? {}) },
  }
}

function reid(obj: SceneObject): SceneObject {
  const copy = { ...obj, id: uid(obj.kind) } as SceneObject
  if (copy.kind === 'group') copy.children = copy.children.map(reid)
  return copy
}

export function duplicateObjects(objects: SceneObject[], ids: string[], offset: Vec3 = [10, 10, 0]): { objects: SceneObject[]; newIds: string[] } {
  const clones = objects
    .filter(o => ids.includes(o.id))
    .map(o => {
      const c = reid(structuredClone(o))
      c.position = [o.position[0] + offset[0], o.position[1] + offset[1], o.position[2] + offset[2]]
      c.name = `${o.name} copia`
      return c
    })
  return { objects: [...objects, ...clones], newIds: clones.map(c => c.id) }
}

/** Same frame convention as the backend `build_group`: translate-only frame at the solids' bbox centre. */
export function groupObjects(objects: SceneObject[], ids: string[]): { objects: SceneObject[]; groupId: string | null } {
  const members = objects.filter(o => ids.includes(o.id))
  if (members.length < 2) return { objects, groupId: null }
  const solids = members.filter(m => !m.hole)
  const box = new THREE.Box3()
  for (const m of solids.length ? solids : members) box.union(worldBox(m))
  const c = box.getCenter(new THREE.Vector3())
  const firstSolid = solids[0] ?? members[0]
  const group: GroupObject = {
    id: uid('group'),
    name: `Gruppo ${objects.filter(o => o.kind === 'group').length + 1}`,
    kind: 'group',
    color: firstSolid.color,
    hole: solids.length === 0,
    position: [c.x, c.y, c.z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children: members.map(m => ({ ...m, position: [m.position[0] - c.x, m.position[1] - c.y, m.position[2] - c.z] as Vec3 })),
  }
  const firstIndex = objects.findIndex(o => ids.includes(o.id))
  const rest = objects.filter(o => !ids.includes(o.id))
  rest.splice(Math.min(firstIndex, rest.length), 0, group)
  return { objects: rest, groupId: group.id }
}

/** Bake the group transform into its children (exact unless rotation + non-uniform scale create shear). */
export function ungroupObject(objects: SceneObject[], id: string): { objects: SceneObject[]; newIds: string[] } {
  const group = objects.find(o => o.id === id)
  if (!group || group.kind !== 'group') return { objects, newIds: [] }
  const gm = objectMatrix(group)
  const children = group.children.map(child => {
    const m = gm.clone().multiply(objectMatrix(child))
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    m.decompose(p, q, s)
    const scale: Vec3 = [Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)]
    const base = { ...child, position: [p.x, p.y, p.z] as Vec3, rotation: eulerDegFromQuaternion(q) }
    return child.kind === 'group' ? { ...base, scale } as GroupObject : { ...base, size: scale } as PrimitiveObject
  })
  const index = objects.indexOf(group)
  const next = [...objects]
  next.splice(index, 1, ...children)
  return { objects: next, newIds: children.map(c => c.id) }
}

export function dropToPlate(objects: SceneObject[], ids: string[]): SceneObject[] {
  return objects.map(o => {
    if (!ids.includes(o.id)) return o
    const box = worldBox(o)
    return { ...o, position: [o.position[0], o.position[1], o.position[2] - box.min.z] as Vec3 }
  })
}

export type AlignMode = 'min' | 'center' | 'max'

export function alignObjects(objects: SceneObject[], ids: string[], axis: 0 | 1 | 2, mode: AlignMode): SceneObject[] {
  const members = objects.filter(o => ids.includes(o.id))
  if (members.length < 2) return objects
  const boxes = new Map(members.map(m => [m.id, worldBox(m)]))
  const all = new THREE.Box3()
  boxes.forEach(b => all.union(b))
  const key = (['x', 'y', 'z'] as const)[axis]
  const target = mode === 'min' ? all.min[key] : mode === 'max' ? all.max[key] : (all.min[key] + all.max[key]) / 2
  return objects.map(o => {
    const b = boxes.get(o.id)
    if (!b) return o
    const current = mode === 'min' ? b.min[key] : mode === 'max' ? b.max[key] : (b.min[key] + b.max[key]) / 2
    const pos = [...o.position] as Vec3
    pos[axis] += target - current
    return { ...o, position: pos }
  })
}

/** Mirror in place across the object's own centre plane (world axis). */
export function mirrorObjects(objects: SceneObject[], ids: string[], axis: 0 | 1 | 2): SceneObject[] {
  const flip = (o: SceneObject, local = false): SceneObject => {
    const [rx, ry, rz] = o.rotation
    const rotation: Vec3 = axis === 0 ? [rx, -ry, -rz] : axis === 1 ? [-rx, ry, -rz] : [-rx, -ry, rz]
    const position = [...o.position] as Vec3
    if (local) position[axis] = -position[axis]
    const next = { ...o, rotation, position } as SceneObject
    if (next.kind === 'group') next.children = next.children.map(c => flip(c, true))
    return next
  }
  return objects.map(o => (ids.includes(o.id) ? flip(o) : o))
}

export function sceneBox(objects: SceneObject[]): THREE.Box3 | null {
  if (!objects.length) return null
  const box = new THREE.Box3()
  objects.forEach(o => box.union(worldBox(o)))
  return box
}
