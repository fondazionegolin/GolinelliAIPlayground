// Scene model shared with the backend agent (backend/app/services/solid_modeler_agent.py).
// Units: mm, Z up, work plate = XY plane at z=0. Every primitive fills its `size`
// box centred on `position`; rotation is Euler XYZ in degrees.

export type PrimitiveKind =
  | 'box' | 'cylinder' | 'sphere' | 'cone' | 'pyramid' | 'hemisphere'
  | 'wedge' | 'torus' | 'tube' | 'star' | 'text'

export type Vec3 = [number, number, number]

export interface PrimitiveParams {
  sides?: number
  points?: number
  radius?: number
  topRatio?: number
  thickness?: number
  wall?: number
  inner?: number
  text?: string
}

interface BaseObject {
  id: string
  name: string
  color: string
  hole: boolean
  position: Vec3
  rotation: Vec3
}

export interface PrimitiveObject extends BaseObject {
  kind: PrimitiveKind
  size: Vec3
  params: PrimitiveParams
}

export interface GroupObject extends BaseObject {
  kind: 'group'
  scale: Vec3
  children: SceneObject[]
}

export type SceneObject = PrimitiveObject | GroupObject

export interface PrimitiveDef {
  kind: PrimitiveKind
  label: string
  size: Vec3
  color: string
  params?: PrimitiveParams
  hole?: boolean
}

export const PRIMITIVES: PrimitiveDef[] = [
  { kind: 'box', label: 'Cubo', size: [20, 20, 20], color: '#e8453c' },
  { kind: 'cylinder', label: 'Cilindro', size: [20, 20, 20], color: '#f59e0b', params: { sides: 32 } },
  { kind: 'sphere', label: 'Sfera', size: [20, 20, 20], color: '#0ea5e9' },
  { kind: 'cone', label: 'Cono', size: [20, 20, 20], color: '#a855f7', params: { sides: 32, topRatio: 0 } },
  { kind: 'pyramid', label: 'Piramide', size: [20, 20, 20], color: '#facc15' },
  { kind: 'hemisphere', label: 'Cupola', size: [20, 20, 10], color: '#ec4899' },
  { kind: 'wedge', label: 'Cuneo', size: [20, 20, 20], color: '#22c55e' },
  { kind: 'torus', label: 'Toro', size: [30, 30, 6], color: '#6366f1', params: { thickness: 0.2 } },
  { kind: 'tube', label: 'Tubo', size: [20, 20, 20], color: '#f97316', params: { wall: 0.12 } },
  { kind: 'star', label: 'Stella', size: [30, 30, 6], color: '#eab308', params: { points: 5, inner: 0.5 } },
  { kind: 'text', label: 'Testo', size: [40, 12, 5], color: '#0f766e', params: { text: 'Ciao' } },
  { kind: 'box', label: 'Foro cubo', size: [20, 20, 20], color: '#a3a3a3', hole: true },
  { kind: 'cylinder', label: 'Foro cilindro', size: [20, 20, 20], color: '#a3a3a3', hole: true, params: { sides: 32 } },
]

export const KIND_LABEL: Record<PrimitiveKind | 'group', string> = {
  box: 'Cubo', cylinder: 'Cilindro', sphere: 'Sfera', cone: 'Cono', pyramid: 'Piramide',
  hemisphere: 'Cupola', wedge: 'Cuneo', torus: 'Toro', tube: 'Tubo', star: 'Stella', text: 'Testo', group: 'Gruppo',
}

export const COLOR_SWATCHES = [
  '#e8453c', '#f97316', '#f59e0b', '#facc15', '#22c55e', '#0f766e',
  '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#a3a3a3', '#fafafa', '#262626',
]

export const PLATE_SIZE = 200

export interface AgentStepEvent {
  step: number
  thought: string
  actions: string[]
  errors: string[]
  warnings: string[]
}
