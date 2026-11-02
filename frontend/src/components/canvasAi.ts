/**
 * Pure helpers that let an AI read and draw on a CollaborativeCanvas board:
 * shape geometry shared with the renderer, ops applied to a document, a structured scene,
 * a change log between two states and a pixel rendering of the whole board.
 */
import type { CanvasDoc, CanvasItem } from './CollaborativeCanvas'
import { parseEquation, samples } from './visual-comprehension/mathExpr'
import { explicitFunction, graphWindow } from './canvasMath'
import type { Scene } from './motion/spec'
import { canvasLabelColor } from './canvasColors'

export type ShapeKind = 'rect' | 'rounded-rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'hexagon' | 'parallelogram'
type Anchor = 'top' | 'right' | 'bottom' | 'left'

/** Mirror of the backend `CanvasOp` (snake_case on the wire). */
export type AiOp = {
  kind: 'shape' | 'text' | 'note' | 'frame' | 'arrow' | 'line' | 'plot' | 'curve' | 'formula' | 'animation' | 'connect' | 'update' | 'delete'
  expr?: string; x_min?: number; x_max?: number; y_min?: number; y_max?: number
  marks?: Array<{ x: number; y: number; label?: string }>; points?: number[][]
  id?: string; target?: string; shape?: ShapeKind
  /** With `on`, x/y/w/h are % (0-100) of that item's box instead of world pixels: annotations on a pasted image. */
  on?: string; opacity?: number
  /** animation: what to show (the director turns it into `scene`); with `update` it asks to change an existing animation. */
  brief?: string; scene?: Scene
  x?: number; y?: number; w?: number; h?: number
  text?: string; font_size?: number; fill?: string; stroke?: string
  from_id?: string; to_id?: string; from_anchor?: Anchor; to_anchor?: Anchor
  flip_x?: boolean; flip_y?: boolean; arrow?: boolean
}

export type SceneItem = { id: string; type: string; x?: number; y?: number; w?: number; h?: number; text: string; detail: string }

const PAD = 4

/** SVG path of a shape inside a w×h box (also usable as a Canvas2D Path2D). */
export function shapePath(shape: ShapeKind, w: number, h: number): string {
  const l = PAD, t = PAD, r = Math.max(w - PAD, l + 1), b = Math.max(h - PAD, t + 1)
  const cx = w / 2, cy = h / 2
  switch (shape) {
    case 'rect': return `M${l} ${t}H${r}V${b}H${l}Z`
    case 'rounded-rect': {
      const k = Math.min(16, (r - l) / 2, (b - t) / 2)
      return `M${l + k} ${t}H${r - k}A${k} ${k} 0 0 1 ${r} ${t + k}V${b - k}A${k} ${k} 0 0 1 ${r - k} ${b}H${l + k}A${k} ${k} 0 0 1 ${l} ${b - k}V${t + k}A${k} ${k} 0 0 1 ${l + k} ${t}Z`
    }
    case 'ellipse': {
      const rx = (r - l) / 2, ry = (b - t) / 2
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
    }
    case 'diamond': return `M${cx} ${t}L${r} ${cy}L${cx} ${b}L${l} ${cy}Z`
    case 'triangle': return `M${cx} ${t}L${r} ${b}L${l} ${b}Z`
    case 'parallelogram': return `M24 ${t}H${r}L${w - 24} ${b}H${l}Z`
    case 'hexagon': {
      const k = Math.min((r - l) * 0.25, (b - t))
      return `M${l + k} ${t}H${r - k}L${r} ${cy}L${r - k} ${b}H${l + k}L${l} ${cy}Z`
    }
    case 'star': {
      const points: string[] = []
      const rx = (r - l) / 2, ry = (b - t) / 2
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const k = i % 2 === 0 ? 1 : 0.42
        points.push(`${cx + Math.cos(angle) * rx * k} ${cy + Math.sin(angle) * ry * k}`)
      }
      return `M${points.join('L')}Z`
    }
  }
}

/** A pen stroke as a positioned item: points live in the stroke's own box (0..ow, 0..oh) and stretch with it. */
export function makePath(id: string, points: Array<{ x: number; y: number }>, color: string, width: number, extra: Record<string, unknown> = {}): CanvasItem {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  const ow = Math.max(Math.max(...xs) - x, 1), oh = Math.max(Math.max(...ys) - y, 1)
  return { id, type: 'path', x, y, w: ow, h: oh, ow, oh, points: points.map((p) => ({ x: p.x - x, y: p.y - y })), color, width, ...extra } as CanvasItem
}

/** Old documents stored strokes with absolute points and no box: give them one. */
export function normalizePath(item: CanvasItem): CanvasItem {
  const raw = item as unknown as { type: string; points?: Array<{ x: number; y: number }>; w?: number }
  if (raw.type !== 'path' || raw.w !== undefined || !raw.points?.length) return item
  const legacy = item as unknown as { id: string; color: string; width: number; parentFrameId?: string; ai?: boolean }
  return makePath(legacy.id, raw.points, legacy.color, legacy.width, { ...(legacy.parentFrameId ? { parentFrameId: legacy.parentFrameId } : {}), ...(legacy.ai ? { ai: true } : {}) })
}

const CLEAN = (value: string | undefined, limit: number) => (value || '').replace(/\s+/g, ' ').trim().slice(0, limit)

function bounds(item: CanvasItem) {
  return 'w' in item ? { x: item.x, y: item.y, w: item.w, h: item.h } : null
}

function pickAnchors(from: CanvasItem, to: CanvasItem): [Anchor, Anchor] {
  const a = bounds(from), b = bounds(to)
  if (!a || !b) return ['right', 'left']
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

const TEXT_STYLE = (fontSize = 14, weight: 'normal' | '600' = 'normal') =>
  ({ fontFamily: 'Inter, system-ui, sans-serif', fontSize, fontWeight: weight, fontStyle: 'normal' as const })

function buildItem(op: AiOp): CanvasItem | null {
  const id = op.id as string
  const x = op.x ?? 0, y = op.y ?? 0
  const stroke = op.stroke || '#1e3a8a'
  switch (op.kind) {
    case 'shape':
      return { id, ai: true, type: 'shape', shape: op.shape || 'rounded-rect', x, y, w: op.w ?? 200, h: op.h ?? 100,
        fill: op.fill || '#dbeafe', fillOpacity: op.opacity, stroke, borderWidth: 2.5, borderStyle: 'solid', text: op.text || '', textColor: '#171717', textStyle: TEXT_STYLE(op.font_size ?? 15) }
    case 'text':
      return { id, ai: true, type: 'text', x, y, w: op.w ?? 280, h: op.h ?? 60, text: op.text || '', color: op.stroke || '#171717', textStyle: TEXT_STYLE(op.font_size ?? 16) }
    case 'note':
      return { id, ai: true, type: 'postit', x, y, w: op.w ?? 220, h: op.h ?? 160, text: op.text || '', color: op.fill || '#fef9c3', textStyle: TEXT_STYLE(op.font_size ?? 14) }
    case 'frame':
      return { id, ai: true, type: 'frame', x, y, w: op.w ?? 480, h: op.h ?? 320, text: op.text || 'Sezione', color: op.stroke || '#3ea9f4',
        backgroundColor: op.fill ? `${op.fill}66` : '#ffffff99', borderWidth: 2, borderStyle: 'dashed', textStyle: TEXT_STYLE(op.font_size ?? 13, '600') }
    case 'animation':
      return op.scene ? { id, ai: true, type: 'animation', x, y, w: op.w ?? 640, h: op.h ?? 360, scene: op.scene } : null
    case 'formula':
      return { id, ai: true, type: 'formula', x, y, w: op.w ?? 380, h: op.h ?? 84, latex: op.text || '', src: op.expr, fontSize: op.font_size ?? 28, color: op.stroke || '#0f172a' }
    case 'arrow':
    case 'line':
      return { id, ai: true, type: 'line', x, y, w: Math.max(op.w ?? 120, 1), h: Math.max(op.h ?? 0, 1), flipX: !!op.flip_x, flipY: !!op.flip_y,
        arrow: op.arrow ?? op.kind === 'arrow', color: op.stroke || '#e11d48', width: 3 }
    default:
      return null
  }
}

/** A tick step giving about 4–10 labels across the span, on 1/2/5 × 10ⁿ. */
function niceStep(span: number): number {
  const raw = span / 7
  const pow = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / pow
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * pow
}

const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6)

/** Catmull-Rom through the points, densified so the stroke reads as a smooth curve. */
export function smoothCurve(points: Array<{ x: number; y: number }>, steps = 12): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)]
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps, t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  out.push(points[points.length - 1])
  return out
}

export type PlotSpec = { w: number; h: number; expr: string; xMin: number; xMax: number; yMin: number; yMax: number; title?: string; marks?: Array<{ x: number; y: number; label?: string }> }
export type PlotGeometry = {
  grid: Array<[number, number, number, number]>
  axes: Array<[number, number, number, number]>
  ticks: Array<{ x: number; y: number; text: string; align: 'middle' | 'end' }>
  curves: Array<Array<{ x: number; y: number }>>
  marks: Array<{ x: number; y: number; label: string }>
  titleY: number
  ok: boolean
}

/** Everything a plot draws, in the item's own pixels (0..w, 0..h): shared by the SVG renderer and the PNG snapshot. */
export function plotGeometry(spec: PlotSpec): PlotGeometry {
  const { w, h, xMin: xa, xMax: xb, yMin: ya, yMax: yb } = spec
  const top = spec.title ? 34 : 14, pad = 30, left = 40
  const gx = left, gy = top, gw = Math.max(w - left - pad, 10), gh = Math.max(h - top - pad, 10)
  const px = (X: number) => gx + ((X - xa) / (xb - xa)) * gw
  const py = (Y: number) => gy + gh - ((Y - ya) / (yb - ya)) * gh
  const out: PlotGeometry = { grid: [], axes: [], ticks: [], curves: [], marks: [], titleY: 22, ok: false }
  if (!(xb > xa) || !(yb > ya)) return out
  const axisY = Math.min(Math.max(py(0), gy), gy + gh), axisX = Math.min(Math.max(px(0), gx), gx + gw)
  const sx = niceStep(xb - xa), sy = niceStep(yb - ya)
  for (let X = Math.ceil(xa / sx) * sx; X <= xb + 1e-9; X += sx) {
    out.grid.push([px(X), gy, px(X), gy + gh])
    if (Math.abs(X) > 1e-9) out.ticks.push({ x: px(X), y: Math.min(axisY + 16, gy + gh + 16), text: fmt(X), align: 'middle' })
  }
  for (let Y = Math.ceil(ya / sy) * sy; Y <= yb + 1e-9; Y += sy) {
    out.grid.push([gx, py(Y), gx + gw, py(Y)])
    if (Math.abs(Y) > 1e-9) out.ticks.push({ x: axisX - 6, y: py(Y) + 4, text: fmt(Y), align: 'end' })
  }
  out.axes.push([gx, axisY, gx + gw + 8, axisY], [axisX, gy + gh, axisX, gy - 8])
  try {
    const eq = parseEquation(spec.expr.includes('=') ? spec.expr : `y = ${spec.expr}`)
    if (eq.explicit) {
      for (const run of samples(eq.explicit, {}, { x0: xa, x1: xb, y0: ya, y1: yb }, 320)) {
        const inside = run.filter(([, Y]) => Y >= ya && Y <= yb)
        if (inside.length > 1) out.curves.push(inside.map(([X, Y]) => ({ x: px(X), y: py(Y) })))
      }
      out.ok = true
    }
  } catch { /* an unreadable expression draws axes only */ }
  for (const m of spec.marks || []) {
    if (m.x >= xa && m.x <= xb && m.y >= ya && m.y <= yb) out.marks.push({ x: px(m.x), y: py(m.y), label: m.label || '' })
  }
  return out
}

function buildPlot(op: AiOp, id: string): CanvasItem | null {
  const item: CanvasItem = { id, ai: true, type: 'plot', x: op.x ?? 0, y: op.y ?? 0, w: Math.max(op.w ?? 520, 200), h: Math.max(op.h ?? 420, 160),
    expr: op.expr || '', xMin: op.x_min ?? -5, xMax: op.x_max ?? 5, yMin: op.y_min ?? -5, yMax: op.y_max ?? 5, color: op.stroke || '#dc2626', title: op.text || `y = ${op.expr}`, marks: op.marks }
  return plotGeometry(item as unknown as PlotSpec).ok ? item : null
}

/** Fields an `update` may touch, mapped onto whichever item type carries them. */
function patchItem(item: CanvasItem, op: AiOp): CanvasItem {
  const next: Record<string, unknown> = { ...item }
  if (op.x !== undefined) next.x = op.x
  if (op.y !== undefined) next.y = op.y
  if (op.w !== undefined && 'w' in item) next.w = op.w
  if (op.h !== undefined && 'h' in item) next.h = op.h
  if (op.text !== undefined && 'text' in item) next.text = op.text
  if (item.type === 'animation' && op.scene) next.scene = op.scene
  if (item.type === 'formula') {
    if (op.text !== undefined) { next.latex = op.text; if (op.expr === undefined) next.src = undefined }
    if (op.expr !== undefined) next.src = op.expr
    if (op.font_size !== undefined) next.fontSize = op.font_size
  }
  if (op.fill !== undefined) {
    if (item.type === 'shape') next.fill = op.fill
    else if (item.type === 'postit') next.color = op.fill
    else if (item.type === 'frame') next.backgroundColor = `${op.fill}66`
  }
  if (op.stroke !== undefined) {
    if (item.type === 'shape') next.stroke = op.stroke
    else if (item.type === 'connector' || item.type === 'line' || item.type === 'path' || item.type === 'text' || item.type === 'frame') next.color = op.stroke
  }
  if (op.shape && item.type === 'shape') next.shape = op.shape
  if (op.opacity !== undefined && item.type === 'shape') next.fillOpacity = op.opacity
  if (op.font_size !== undefined && 'textStyle' in item) next.textStyle = { ...(item.textStyle as object), fontSize: op.font_size }
  if (item.type === 'plot') {
    if (op.expr !== undefined) next.expr = op.expr
    if (op.x_min !== undefined) next.xMin = op.x_min
    if (op.x_max !== undefined) next.xMax = op.x_max
    if (op.y_min !== undefined) next.yMin = op.y_min
    if (op.y_max !== undefined) next.yMax = op.y_max
    if (op.marks !== undefined) next.marks = op.marks
    if (op.text !== undefined) next.title = op.text
    if (op.stroke !== undefined) next.color = op.stroke
  }
  if (op.flip_x !== undefined && item.type === 'line') next.flipX = op.flip_x
  if (op.flip_y !== undefined && item.type === 'line') next.flipY = op.flip_y
  if (op.arrow !== undefined && item.type === 'line') next.arrow = op.arrow
  next.ai = true
  return next as CanvasItem
}

/** Annotation ops carry `on` = the image they mark: x/y/w/h are % of its box, turned into world pixels here. */
function relativeTo(items: CanvasItem[], op: AiOp, resolve: (id?: string) => string): AiOp {
  if (!op.on) return op
  const target = items.find((i) => i.id === resolve(op.on))
  const box = target && bounds(target)
  if (!box) return op
  const pct = (v: number | undefined, size: number) => (v === undefined ? undefined : (v / 100) * size)
  const x = pct(op.x, box.w), y = pct(op.y, box.h)
  return { ...op, on: undefined, x: x === undefined ? undefined : box.x + x, y: y === undefined ? undefined : box.y + y, w: pct(op.w, box.w), h: pct(op.h, box.h) }
}

/** Applies a model's ops. Ops that point at missing items are skipped rather than failing the batch. */
export function applyAiOps(doc: CanvasDoc, ops: AiOp[], newId: () => string = () => crypto.randomUUID()): { doc: CanvasDoc; created: string[]; idMap: Record<string, string> } {
  let items = [...doc.items]
  const created: string[] = []
  const idMap: Record<string, string> = {}
  const resolve = (id?: string) => (id ? idMap[id] || id : '')
  for (const op of ops) {
    if (op.kind === 'connect') {
      const from = items.find((i) => i.id === resolve(op.from_id)), to = items.find((i) => i.id === resolve(op.to_id))
      if (!from || !to || !('w' in from) || !('w' in to)) continue
      const [fromAnchor, toAnchor] = pickAnchors(from, to)
      const id = newId()
      items.push({ id, ai: true, type: 'connector', fromId: from.id, fromAnchor: op.from_anchor || fromAnchor, toId: to.id, toAnchor: op.to_anchor || toAnchor, color: op.stroke || '#475569', width: 2 })
      created.push(id)
    } else if (op.kind === 'update') {
      const targetId = resolve(op.target)
      items = items.map((i) => (i.id === targetId ? patchItem(i, op) : i))
    } else if (op.kind === 'delete') {
      const targetId = resolve(op.target)
      items = items.filter((i) => i.id !== targetId && !(i.type === 'connector' && (i.fromId === targetId || i.toId === targetId)))
    } else if (op.kind === 'plot' && op.id) {
      const plot = buildPlot(op, newId())
      if (!plot) continue
      idMap[op.id] = plot.id
      items.push(plot)
      created.push(plot.id)
    } else if (op.kind === 'curve' && op.id) {
      const raw = (op.points || []).filter((p) => p.length === 2).map(([x, y]) => ({ x, y }))
      if (raw.length < 3) continue
      const id = newId()
      idMap[op.id] = id
      items.push(makePath(id, smoothCurve(raw), op.stroke || '#dc2626', 3, { ai: true }))
      created.push(id)
    } else if (op.id) {
      const item = buildItem({ ...relativeTo(items, op, resolve), id: newId() })
      if (!item) continue
      idMap[op.id] = item.id
      items.push(item)
      created.push(item.id)
    }
  }
  // Children join the smallest frame that contains their centre, so moving a frame moves what is inside it.
  const frames = items.filter((i): i is Extract<CanvasItem, { type: 'frame' }> => i.type === 'frame')
  items = items.map((item) => {
    const box = created.includes(item.id) ? bounds(item) : null
    if (!box || item.type === 'connector') return item
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2
    const parent = frames.filter((f) => f.id !== item.id && cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h && f.w * f.h > box.w * box.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0]
    return parent ? { ...item, parentFrameId: parent.id } : item
  })
  return { doc: { ...doc, items }, created, idMap }
}

/** Structured scene sent to the model, with short aliases (n1, n2…) instead of UUIDs. */
export function describeDoc(doc: CanvasDoc): { items: SceneItem[]; toAlias: Record<string, string>; fromAlias: Record<string, string> } {
  const toAlias: Record<string, string> = {}
  const fromAlias: Record<string, string> = {}
  doc.items.forEach((item, index) => { toAlias[item.id] = `n${index + 1}`; fromAlias[`n${index + 1}`] = item.id })
  const items = doc.items.slice(0, 400).map((item): SceneItem => {
    const box = bounds(item)
    const base = { id: toAlias[item.id], type: item.type === 'postit' ? 'note' : item.type, ...(box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) } : {}) }
    const parent = 'parentFrameId' in item && item.parentFrameId && toAlias[item.parentFrameId] ? `dentro ${toAlias[item.parentFrameId]}` : ''
    switch (item.type) {
      case 'postit': case 'frame': case 'text': return { ...base, text: CLEAN(item.text, 600), detail: parent }
      case 'shape': return { ...base, text: CLEAN(item.text, 600), detail: [item.shape, parent].filter(Boolean).join(', ') }
      case 'connector': return { ...base, text: '', detail: `da ${toAlias[item.fromId] || '?'} a ${toAlias[item.toId] || '?'}` }
      case 'image': return { ...base, text: '', detail: 'immagine incollata' }
      case 'table': return { ...base, text: CLEAN(item.data.slice(0, 6).map((row) => row.join(' | ')).join(' / '), 600), detail: `tabella ${item.data.length} righe` }
      case 'path': return { ...base, text: '', detail: 'disegno a mano libera' }
      case 'line': return { ...base, text: '', detail: item.arrow ? 'freccia' : 'linea' }
      case 'formula': return { ...base, text: CLEAN(item.latex, 600), detail: CLEAN(`formula${item.src ? ` (${item.src})` : ''}${parent ? `, ${parent}` : ''}`, 380) }
      case 'animation': return { ...base, text: CLEAN(item.scene.title, 200), detail: CLEAN(`animazione di ${item.scene.duration}s: ${item.scene.steps.map((s) => s.text).join(' / ')}`, 380) }
      case 'plot': return { ...base, text: CLEAN(item.title || '', 600), detail: CLEAN(`grafico y=${item.expr}, x ${item.xMin}..${item.xMax}, y ${item.yMin}..${item.yMax}`, 380) }
      default: return { ...base, text: '', detail: '' }
    }
  })
  return { items, toAlias, fromAlias }
}

/** Translate aliases in the model's ops (and focus) back to real ids. */
export function unaliasOps(ops: AiOp[], fromAlias: Record<string, string>): AiOp[] {
  const real = (id?: string) => (id ? fromAlias[id] || id : id)
  return ops.map((op) => ({ ...op, target: real(op.target), from_id: real(op.from_id), to_id: real(op.to_id), on: real(op.on) }))
}

const label = (item: CanvasItem) => {
  const text = item.type === 'formula' ? CLEAN(item.src || item.latex, 40) : 'text' in item ? CLEAN(item.text, 40) : ''
  const names: Record<string, string> = { postit: 'post-it', frame: 'sezione', text: 'testo', shape: 'forma', image: 'immagine', table: 'tabella', path: 'disegno', line: 'linea', connector: 'freccia', plot: 'grafico', formula: 'formula', animation: 'animazione' }
  return `${names[item.type] || item.type}${text ? ` «${text}»` : ''}`
}

/** Human-readable list of what changed between two documents (what the user did since the AI last looked). */
export function diffDocs(before: CanvasDoc, after: CanvasDoc): string[] {
  const prev = new Map(before.items.map((i) => [i.id, i]))
  const next = new Map(after.items.map((i) => [i.id, i]))
  const aliases = describeDoc(after).toAlias
  const tag = (item: CanvasItem) => `${aliases[item.id] ? `${aliases[item.id]} ` : ''}${label(item)}`
  const out: string[] = []
  next.forEach((item, id) => {
    const old = prev.get(id)
    if (!old) { if (!(item as { ai?: boolean }).ai) out.push(`aggiunto ${tag(item)}`); return }
    if (JSON.stringify(old) === JSON.stringify(item)) return
    const a = bounds(old), b = bounds(item)
    if (old.type === 'formula' && item.type === 'formula' && old.latex !== item.latex) out.push(`modificato la formula ${tag(item)} (prima «${CLEAN(old.src || old.latex, 80)}»)`)
    else if ('text' in old && 'text' in item && old.text !== item.text) out.push(`modificato il testo di ${tag(item)} (prima «${CLEAN(old.text, 80)}»)`)
    else if (a && b && (Math.abs(a.x - b.x) > 20 || Math.abs(a.y - b.y) > 20)) out.push(`spostato ${tag(item)} in (${Math.round(b.x)}, ${Math.round(b.y)})`)
    else if (a && b && (Math.abs(a.w - b.w) > 20 || Math.abs(a.h - b.h) > 20)) out.push(`ridimensionato ${tag(item)}`)
    else out.push(`modificato ${tag(item)}`)
  })
  prev.forEach((item, id) => { if (!next.has(id)) out.push(`rimosso ${label(item)}`) })
  return out.slice(0, 40)
}

// ─── Pixels ────────────────────────────────────────────────────────────────────

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (line && ctx.measureText(test).width > width) { lines.push(line); line = word } else line = test
    }
    lines.push(line)
  }
  return lines
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, size: number, color: string, center: boolean) {
  if (!text) return
  ctx.font = `${size}px Inter, system-ui, sans-serif`
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  const lines = wrap(ctx, text, Math.max(w - 12, 10))
  const lineHeight = size * 1.3
  const top = center ? y + Math.max((h - lines.length * lineHeight) / 2, 4) : y + 8
  ctx.textAlign = center ? 'center' : 'left'
  lines.forEach((line, i) => {
    if (top + i * lineHeight < y + h) ctx.fillText(line, center ? x + w / 2 : x + 8, top + i * lineHeight)
  })
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function anchorPoint(item: CanvasItem, anchor: Anchor) {
  const b = bounds(item)
  if (!b) return { x: 0, y: 0 }
  if (anchor === 'top') return { x: b.x + b.w / 2, y: b.y }
  if (anchor === 'right') return { x: b.x + b.w, y: b.y + b.h / 2 }
  if (anchor === 'bottom') return { x: b.x + b.w / 2, y: b.y + b.h }
  return { x: b.x, y: b.y + b.h / 2 }
}

function arrowHead(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number) {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  ctx.beginPath()
  ctx.moveTo(toX, toY)
  ctx.lineTo(toX - size * Math.cos(angle - 0.4), toY - size * Math.sin(angle - 0.4))
  ctx.lineTo(toX - size * Math.cos(angle + 0.4), toY - size * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
}

/** Draws the whole board (what a person would see after "zoom to fit") with each item tagged by its alias. */
export async function renderDocToPng(doc: CanvasDoc, aliases: Record<string, string>, maxSide = 1600, jpeg?: number): Promise<string> {
  const boxes = doc.items.map(bounds).filter((b): b is NonNullable<typeof b> => !!b)
  const xs = boxes.flatMap((b) => [b.x, b.x + b.w])
  const ys = boxes.flatMap((b) => [b.y, b.y + b.h])
  const margin = 40
  const minX = (xs.length ? Math.min(...xs) : 0) - margin, minY = (ys.length ? Math.min(...ys) : 0) - margin
  const width = (xs.length ? Math.max(...xs) : 400) + margin - minX, height = (ys.length ? Math.max(...ys) : 300) + margin - minY
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(width * scale), 64)
  canvas.height = Math.max(Math.round(height * scale), 64)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.translate(-minX, -minY)
  const byId = new Map(doc.items.map((i) => [i.id, i]))
  const images = new Map<string, HTMLImageElement | null>()
  await Promise.all(doc.items.filter((i) => i.type === 'image').map(async (i) => { if (i.type === 'image') images.set(i.id, await loadImage(i.src)) }))

  for (const item of doc.items) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (item.type === 'frame') {
      ctx.fillStyle = item.backgroundColor || '#ffffff99'; ctx.fillRect(item.x, item.y, item.w, item.h)
      ctx.strokeStyle = item.color; ctx.lineWidth = item.borderWidth ?? 2; ctx.setLineDash([8, 5]); ctx.strokeRect(item.x, item.y, item.w, item.h)
      ctx.setLineDash([])
      drawText(ctx, item.text, item.x, item.y - 2, item.w, 24, item.textStyle?.fontSize || 13, canvasLabelColor(item.backgroundColor || '#ffffff99', item.color), false)
    } else if (item.type === 'postit') {
      ctx.fillStyle = item.color; ctx.fillRect(item.x, item.y, item.w, item.h)
      drawText(ctx, item.text, item.x, item.y, item.w, item.h, item.textStyle?.fontSize || 14, canvasLabelColor(item.color), false)
    } else if (item.type === 'text') {
      drawText(ctx, item.text, item.x, item.y, item.w, item.h, item.textStyle?.fontSize || 14, item.color, false)
    } else if (item.type === 'shape') {
      ctx.translate(item.x, item.y)
      const path = new Path2D(shapePath(item.shape, item.w, item.h))
      ctx.globalAlpha = item.fillOpacity ?? 1; ctx.fillStyle = item.fill; ctx.fill(path); ctx.globalAlpha = 1
      ctx.strokeStyle = item.stroke; ctx.lineWidth = item.borderWidth ?? 2.5
      if (item.borderStyle === 'dashed') ctx.setLineDash([8, 5])
      ctx.stroke(path)
      ctx.setLineDash([])
      drawText(ctx, item.text || '', 0, 0, item.w, item.h, item.textStyle?.fontSize || 14, canvasLabelColor(item.fill, item.textColor, item.fillOpacity), true)
    } else if (item.type === 'image') {
      const image = images.get(item.id)
      if (image) ctx.drawImage(image, item.x, item.y, item.w, item.h)
      else { ctx.fillStyle = '#e2e8f0'; ctx.fillRect(item.x, item.y, item.w, item.h); drawText(ctx, '(immagine non leggibile)', item.x, item.y, item.w, item.h, 14, '#475569', true) }
    } else if (item.type === 'table') {
      const rows = item.data.length || 1, cols = Math.max(...item.data.map((r) => r.length), 1)
      const cw = item.w / cols, rh = item.h / rows
      ctx.strokeStyle = '#94a3b8'; ctx.fillStyle = '#ffffff'; ctx.fillRect(item.x, item.y, item.w, item.h)
      item.data.forEach((row, r) => row.forEach((cell, c) => {
        ctx.strokeRect(item.x + c * cw, item.y + r * rh, cw, rh)
        drawText(ctx, cell, item.x + c * cw, item.y + r * rh, cw, rh, 12, '#171717', false)
      }))
    } else if (item.type === 'path') {
      ctx.translate(item.x, item.y); ctx.scale(item.w / item.ow, item.h / item.oh)
      ctx.strokeStyle = item.color; ctx.lineWidth = item.width / Math.max(Math.min(item.w / item.ow, item.h / item.oh), 0.01)
      ctx.beginPath(); item.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke()
    } else if (item.type === 'animation') {
      ctx.fillStyle = '#0f172a'; ctx.fillRect(item.x, item.y, item.w, item.h)
      drawText(ctx, `▶ ${item.scene.title}`, item.x, item.y, item.w, item.h, 18, '#e2e8f0', true)
    } else if (item.type === 'formula') {
      drawText(ctx, item.src || item.latex, item.x, item.y, item.w, item.h, item.fontSize, item.color, true)
    } else if (item.type === 'plot') {
      const geo = plotGeometry(item)
      ctx.translate(item.x, item.y)
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, item.w, item.h)
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.5; ctx.strokeRect(0, 0, item.w, item.h)
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1
      for (const [a, b, c, d] of geo.grid) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke() }
      ctx.strokeStyle = '#1e293b'; ctx.fillStyle = '#1e293b'; ctx.lineWidth = 2
      for (const [a, b, c, d] of geo.axes) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); arrowHead(ctx, a, b, c, d, 9) }
      ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#475569'; ctx.textBaseline = 'alphabetic'
      for (const t of geo.ticks) { ctx.textAlign = t.align === 'end' ? 'right' : 'center'; ctx.fillText(t.text, t.x, t.y) }
      ctx.strokeStyle = item.color; ctx.lineWidth = 3
      for (const curve of geo.curves) { ctx.beginPath(); curve.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke() }
      for (const m of geo.marks) { ctx.fillStyle = item.color; ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#171717'; ctx.textAlign = 'left'; ctx.fillText(m.label, m.x + 7, m.y - 7) }
      if (item.title) { ctx.fillStyle = '#334155'; ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(item.title, 10, 22) }
    } else if (item.type === 'line') {
      const x1 = item.flipX ? item.x + item.w : item.x, x2 = item.flipX ? item.x : item.x + item.w
      const y1 = item.flipY ? item.y + item.h : item.y, y2 = item.flipY ? item.y : item.y + item.h
      ctx.strokeStyle = item.color; ctx.fillStyle = item.color; ctx.lineWidth = item.width
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      if (item.arrow) arrowHead(ctx, x1, y1, x2, y2, 8 + item.width * 2)
    } else if (item.type === 'connector') {
      const from = byId.get(item.fromId), to = byId.get(item.toId)
      if (from && to) {
        const a = anchorPoint(from, item.fromAnchor), b = anchorPoint(to, item.toAnchor)
        ctx.strokeStyle = item.color; ctx.fillStyle = item.color; ctx.lineWidth = item.width
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        arrowHead(ctx, a.x, a.y, b.x, b.y, 10)
      }
    }
    ctx.restore()
  }
  // Alias tags let the model refer to what it sees by the same names used in the structured list.
  ctx.font = 'bold 12px Inter, system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  for (const item of doc.items) {
    const b = bounds(item)
    const tag = aliases[item.id]
    if (!b || !tag || item.type === 'frame') continue
    const w = ctx.measureText(tag).width + 8
    ctx.fillStyle = 'rgba(15,23,42,.78)'; ctx.fillRect(b.x, b.y - 16, w, 16)
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.fillText(tag, b.x + 4, b.y - 2)
  }
  return jpeg ? canvas.toDataURL('image/jpeg', jpeg) : canvas.toDataURL('image/png')
}

/** A small JPEG of the whole board for the landing page (null when there is nothing to show). */
export async function renderPreview(doc: CanvasDoc): Promise<string | null> {
  if (!doc.items.length) return null
  try { return await renderDocToPng(doc, {}, 440, 0.62) } catch { return null }
}

export type SentImage = { src: string; meta: { id: string; width: number; height: number } }

/** A faint 10% grid with labelled edges: the model reads positions off it instead of estimating blindly. */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save()
  const label = Math.max(11, Math.round(Math.min(w, h) / 55))
  ctx.font = `bold ${label}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (let i = 1; i < 10; i += 1) {
    const major = i === 5
    ctx.strokeStyle = major ? 'rgba(236,72,153,.55)' : 'rgba(14,165,233,.38)'
    ctx.lineWidth = major ? 1.6 : 1
    ctx.beginPath(); ctx.moveTo((w * i) / 10, 0); ctx.lineTo((w * i) / 10, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, (h * i) / 10); ctx.lineTo(w, (h * i) / 10); ctx.stroke()
    const text = String(i * 10)
    const tw = ctx.measureText(text).width + 6
    ctx.fillStyle = 'rgba(15,23,42,.78)'
    ctx.fillRect((w * i) / 10 - tw / 2, 0, tw, label + 4)
    ctx.fillRect(0, (h * i) / 10 - (label + 4) / 2, tw, label + 4)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.fillText(text, (w * i) / 10, 2)
    ctx.fillText(text, tw / 2, (h * i) / 10 - label / 2)
  }
  ctx.restore()
}

/** Pasted images the model should see at full detail (selected first, then the largest), each with a % grid and its alias. */
export async function collectImages(doc: CanvasDoc, selectedIds: string[], toAlias: Record<string, string>, limit = 3, maxSide = 1568): Promise<SentImage[]> {
  const images = doc.items.filter((i): i is Extract<CanvasItem, { type: 'image' }> => i.type === 'image')
  const ranked = [...images].sort((a, b) => Number(selectedIds.includes(b.id)) - Number(selectedIds.includes(a.id)) || b.w * b.h - a.w * a.h).slice(0, limit)
  const out: SentImage[] = []
  for (const item of ranked) {
    const image = await loadImage(item.src)
    if (!image) continue
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(Math.round(image.naturalWidth * scale), 1)
    canvas.height = Math.max(Math.round(image.naturalHeight * scale), 1)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    drawGrid(ctx, canvas.width, canvas.height)
    try { out.push({ src: canvas.toDataURL('image/jpeg', 0.88), meta: { id: toAlias[item.id], width: image.naturalWidth, height: image.naturalHeight } }) } catch { /* cross-origin image: the overview still shows it */ }
  }
  return out
}

/** A zoomed crop (box in % of the original) with its own 10% grid, for a second, more precise look. */
export async function cropWithGrid(src: string, crop: { x: number; y: number; w: number; h: number }, maxSide = 1400): Promise<string | null> {
  const image = await loadImage(src)
  if (!image) return null
  const sw = (crop.w / 100) * image.naturalWidth, sh = (crop.h / 100) * image.naturalHeight
  const scale = Math.min(maxSide / Math.max(sw, sh), 4)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(sw * scale), 1); canvas.height = Math.max(Math.round(sh * scale), 1)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, (crop.x / 100) * image.naturalWidth, (crop.y / 100) * image.naturalHeight, sw, sh, 0, 0, canvas.width, canvas.height)
  drawGrid(ctx, canvas.width, canvas.height)
  try { return canvas.toDataURL('image/jpeg', 0.9) } catch { return null }
}

// ─── Placement & derived items ──────────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number }

const allBoxes = (doc: CanvasDoc) => doc.items.map(bounds).filter((b): b is Box => !!b)

/** A free w×h spot, preferring the sides of `near` (right, below, left, above), else past the right edge of everything. */
export function findFreeRect(doc: CanvasDoc, near: Box | null, w: number, h: number, gap = 40): { x: number; y: number } {
  const boxes = allBoxes(doc)
  const free = (x: number, y: number) => !boxes.some((b) => x < b.x + b.w + gap / 2 && x + w > b.x - gap / 2 && y < b.y + b.h + gap / 2 && y + h > b.y - gap / 2)
  if (near) {
    for (const [x, y] of [[near.x + near.w + gap, near.y], [near.x, near.y + near.h + gap], [near.x - gap - w, near.y], [near.x, near.y - gap - h]]) if (free(x, y)) return { x, y }
  }
  const right = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : -gap
  const top = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0
  return { x: right + gap, y: near ? near.y : top }
}

/** The graph of a formula item (y = f(x)), placed beside it and linked by an arrow. Null when the formula is not a plain function. */
export function graphFromFormula(doc: CanvasDoc, item: Extract<CanvasItem, { type: 'formula' }>, newId: () => string = () => crypto.randomUUID()): CanvasItem[] | null {
  const plain = item.src || ''
  const f = explicitFunction(plain)
  if (!f) return null
  const win = graphWindow(f, plain)
  const size = { w: 520, h: 420 }
  const spot = findFreeRect(doc, { x: item.x, y: item.y, w: item.w, h: item.h }, size.w, size.h)
  const plot: CanvasItem = { id: newId(), type: 'plot', ...spot, ...size, expr: plain.replace(/^\s*y\s*=\s*/i, ''), ...win, color: '#dc2626', title: plain.trim() }
  const connector: CanvasItem = { id: newId(), type: 'connector', fromId: item.id, fromAnchor: spot.x >= item.x + item.w ? 'right' : 'bottom', toId: plot.id, toAnchor: spot.x >= item.x + item.w ? 'left' : 'top', color: '#94a3b8', width: 2 }
  return [plot, connector]
}

/** Ids the user added or edited since `before`: where their attention is (the AI places new work next to them). */
export function changedIds(before: CanvasDoc, after: CanvasDoc): string[] {
  const prev = new Map(before.items.map((i) => [i.id, JSON.stringify(i)]))
  return after.items.filter((i) => !(i as { ai?: boolean }).ai && prev.get(i.id) !== JSON.stringify(i) && bounds(i)).map((i) => i.id).slice(-5)
}
