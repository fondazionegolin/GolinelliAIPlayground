/**
 * Motion graphics engine: a scene is plain data (entities + values that are numbers, expressions of time or keyframes),
 * evaluated at any time t. No state accumulates, so playing, looping and scrubbing are the same thing.
 * Nothing the AI writes is ever executed: expressions go through the safe math parser only.
 */
import { evaluate, parse, type Node } from '../visual-comprehension/mathExpr'

export type Ease = 'linear' | 'in' | 'out' | 'inout'
export type Keys = { keys: Array<[number, number | string]>; ease?: Ease }
/** A number, an expression in t / D (duration) / p (= t/D), keyframes, or a colour (hex, or keyframes of hex). */
export type Val = number | string | Keys

export type EntityType =
  | 'circle' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'path' | 'text' | 'atom' | 'bond' | 'body' | 'orbit' | 'wave' | 'helix' | 'particles' | 'spring'

export type Entity = {
  id: string; type: EntityType; parent?: string
  x?: Val; y?: Val; rotate?: Val; scale?: Val; opacity?: Val
  fill?: Val; stroke?: Val; strokeWidth?: Val; dash?: boolean; glow?: boolean; shade?: boolean; light?: Val
  r?: Val; w?: Val; h?: Val; rx?: Val; x2?: Val; y2?: Val; d?: string; draw?: Val
  text?: string; size?: Val; anchor?: 'start' | 'middle' | 'end'; bold?: boolean
  el?: string; a?: string; b?: string; order?: number; progress?: Val
  kind?: string; phase?: Val
  count?: number; amp?: Val; wavelength?: number; speed?: Val; turns?: number; seed?: number; mode?: string; fill2?: string; ratio?: number; spread?: Val; coils?: number
}

export type Scene = {
  title: string; width: number; height: number; duration: number; loop: boolean; background: string
  entities: Entity[]; steps: Array<{ at: number; text: string }>
}

// ─── Values ────────────────────────────────────────────────────────────────────

const parsed = new Map<string, Node | null>()
function expression(text: string): Node | null {
  if (!parsed.has(text)) { try { parsed.set(text, parse(text)) } catch { parsed.set(text, null) } }
  return parsed.get(text)!
}

export type Env = { t: number; D: number; p: number }
const easeFn: Record<Ease, (u: number) => number> = {
  linear: (u) => u, in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), inout: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
}

const isKeys = (v: unknown): v is Keys => typeof v === 'object' && v !== null && Array.isArray((v as Keys).keys)

function scalar(v: number | string, env: Env, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  const node = expression(v)
  if (!node) return fallback
  try { const out = evaluate(node, { ...env }); return Number.isFinite(out) ? out : fallback } catch { return fallback }
}

/** Numeric value of a property at time `env.t`. */
export function num(v: Val | undefined, env: Env, fallback: number): number {
  if (v === undefined || v === null) return fallback
  if (!isKeys(v)) return scalar(v as number | string, env, fallback)
  const keys = [...v.keys].sort((a, b) => a[0] - b[0])
  if (!keys.length) return fallback
  const t = env.t
  if (t <= keys[0][0]) return scalar(keys[0][1], env, fallback)
  const last = keys[keys.length - 1]
  if (t >= last[0]) return scalar(last[1], env, fallback)
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1]
    if (t >= t0 && t <= t1) {
      const u = easeFn[v.ease || 'inout']((t - t0) / Math.max(t1 - t0, 1e-9))
      const a = scalar(v0, env, fallback), b = scalar(v1, env, fallback)
      return a + (b - a) * u
    }
  }
  return fallback
}

const hex = (c: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const toHex = (rgb: number[]) => `#${rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`

/** Colour at time t: a hex string, or keyframes of hex strings blended in RGB. */
export function color(v: Val | undefined, env: Env, fallback: string): string {
  if (v === undefined || v === null) return fallback
  if (typeof v === 'string') return v
  if (!isKeys(v)) return fallback
  const keys = [...v.keys].sort((a, b) => a[0] - b[0]).filter((k) => typeof k[1] === 'string')
  if (!keys.length) return fallback
  const t = env.t
  if (t <= keys[0][0]) return String(keys[0][1])
  const last = keys[keys.length - 1]
  if (t >= last[0]) return String(last[1])
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [t0, c0] = keys[i], [t1, c1] = keys[i + 1]
    if (t >= t0 && t <= t1) {
      const a = hex(String(c0)), b = hex(String(c1))
      if (!a || !b) return String(c0)
      const u = easeFn[v.ease || 'inout']((t - t0) / Math.max(t1 - t0, 1e-9))
      return toHex(a.map((x, k) => x + (b[k] - x) * u))
    }
  }
  return fallback
}

// ─── Frames (world transforms) ─────────────────────────────────────────────────

export type Frame = { x: number; y: number; rot: number; scale: number; opacity: number }

export function envAt(scene: Scene, time: number): Env {
  const D = Math.max(scene.duration, 0.1)
  const t = scene.loop ? ((time % D) + D) % D : Math.min(Math.max(time, 0), D)
  return { t, D, p: t / D }
}

/** World transform of every entity at `env.t`: parents compose into children, so a molecule can move as one. */
export function frames(scene: Scene, env: Env): Map<string, Frame> {
  const byId = new Map(scene.entities.map((e) => [e.id, e]))
  const out = new Map<string, Frame>()
  const resolve = (id: string, depth = 0): Frame => {
    const done = out.get(id)
    if (done) return done
    const e = byId.get(id)
    if (!e || depth > 12) return { x: 0, y: 0, rot: 0, scale: 1, opacity: 1 }
    const local = { x: num(e.x, env, 0), y: num(e.y, env, 0), rot: num(e.rotate, env, 0), scale: num(e.scale, env, 1), opacity: Math.max(0, Math.min(1, num(e.opacity, env, 1))) }
    let frame: Frame = local
    if (e.parent && byId.has(e.parent)) {
      const p = resolve(e.parent, depth + 1)
      const rad = (p.rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad)
      frame = { x: p.x + p.scale * (local.x * c - local.y * s), y: p.y + p.scale * (local.x * s + local.y * c), rot: p.rot + local.rot, scale: p.scale * local.scale, opacity: p.opacity * local.opacity }
    }
    out.set(id, frame)
    return frame
  }
  scene.entities.forEach((e) => resolve(e.id))
  return out
}

export function captionAt(scene: Scene, time: number): string {
  const { t } = envAt(scene, time)
  const steps = [...scene.steps].sort((a, b) => a.at - b.at)
  let text = ''
  for (const s of steps) if (t >= s.at) text = s.text
  return text
}

// ─── Chemistry & astronomy data ────────────────────────────────────────────────

/** CPK-style colours and drawing radii (stage units) for common elements. */
export const ELEMENTS: Record<string, { color: string; r: number; ink: string }> = {
  H: { color: '#f8fafc', r: 13, ink: '#1e293b' }, He: { color: '#d9ffff', r: 14, ink: '#1e293b' }, C: { color: '#475569', r: 20, ink: '#fff' },
  N: { color: '#3b82f6', r: 19, ink: '#fff' }, O: { color: '#ef4444', r: 18, ink: '#fff' }, F: { color: '#84cc16', r: 16, ink: '#1e293b' },
  Na: { color: '#a855f7', r: 26, ink: '#fff' }, Mg: { color: '#22c55e', r: 24, ink: '#fff' }, P: { color: '#f97316', r: 21, ink: '#fff' },
  S: { color: '#eab308', r: 21, ink: '#1e293b' }, Cl: { color: '#22c55e', r: 21, ink: '#fff' }, K: { color: '#8b5cf6', r: 28, ink: '#fff' },
  Ca: { color: '#14b8a6', r: 26, ink: '#fff' }, Fe: { color: '#b45309', r: 23, ink: '#fff' }, Cu: { color: '#c2410c', r: 23, ink: '#fff' },
  Zn: { color: '#64748b', r: 23, ink: '#fff' }, Br: { color: '#9a3412', r: 23, ink: '#fff' }, I: { color: '#7e22ce', r: 25, ink: '#fff' },
}

export const BODIES: Record<string, { color: string; dark: string; ring?: boolean; glow?: string }> = {
  sun: { color: '#fde047', dark: '#f97316', glow: '#fbbf24' }, earth: { color: '#60a5fa', dark: '#1e3a8a' }, moon: { color: '#e5e7eb', dark: '#6b7280' },
  mars: { color: '#f87171', dark: '#7f1d1d' }, venus: { color: '#fcd34d', dark: '#b45309' }, mercury: { color: '#cbd5e1', dark: '#475569' },
  jupiter: { color: '#fdba74', dark: '#9a3412' }, saturn: { color: '#fde68a', dark: '#a16207', ring: true }, star: { color: '#ffffff', dark: '#93c5fd', glow: '#bfdbfe' },
  generic: { color: '#94a3b8', dark: '#334155' },
}

export const BACKGROUNDS: Record<string, [string, string]> = {
  space: ['#0b1026', '#020617'], lab: ['#f8fafc', '#e2e8f0'], cell: ['#fdf2f8', '#e0f2fe'], paper: ['#ffffff', '#f1f5f9'], dark: ['#1e293b', '#0f172a'],
}

// ─── Deterministic randomness ──────────────────────────────────────────────────

export function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Folds any real number into [0, 1] like a ball bouncing between two walls. */
export const bounce = (u: number) => { const m = ((u % 2) + 2) % 2; return m > 1 ? 2 - m : m }

/** Lightens (amount > 0) or darkens (amount < 0) a hex colour. */
export function tint(c: string, amount: number): string {
  const rgb = hex(c)
  if (!rgb) return c
  const target = amount >= 0 ? 255 : 0
  return toHex(rgb.map((x) => x + (target - x) * Math.abs(amount)))
}

export const luminance = (c: string) => { const rgb = hex(c); return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0.5 }
