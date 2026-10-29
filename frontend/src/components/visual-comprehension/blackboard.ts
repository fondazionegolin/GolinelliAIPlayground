import type { Box } from './types'

export type Ink = 'ink' | 'blue' | 'red' | 'green' | 'amber' | 'violet' | 'white'
/** Stroke colours: one harmonious, slightly desaturated family (Radix-like steps 9). */
export const INKS: Record<Ink, string> = { ink: '#1f2a3d', blue: '#3e63dd', red: '#e5484d', green: '#2b9a66', amber: '#f0a020', violet: '#7d5bd8', white: '#ffffff' }
/** Text colours: the same hues one step darker, so labels keep contrast on white and on photos. */
export const TEXT_INKS: Record<Ink, string> = { ink: '#1f2a3d', blue: '#3451b2', red: '#c62a2f', green: '#1d7a51', amber: '#a35a00', violet: '#5b3fb0', white: '#ffffff' }
export type Point = { x: number; y: number }
export type Curve = { kind: 'polynomial' | 'sin' | 'cos' | 'sqrt' | 'gaussian' | 'exp' | 'log' | 'abs'; coefficients: number[]; a: number; b: number; c: number; d: number; color: Ink; label: string }
export type PlotData = { x_min: number; x_max: number; y_min: number; y_max: number; x_label: string; y_label: string; curves: Curve[]; series: Array<{ label: string; color: Ink; mode: 'line' | 'scatter'; points: Point[] }>; x_ref?: number; y_ref?: number
  sliders?: Slider[]; formula?: string }
export type SliderField = 'a' | 'b' | 'c' | 'd' | 'c0' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7'
/** A parameter the student moves: one field of one curve, recomputed live. */
export type Slider = { curve: number; field: SliderField; label: string; min: number; max: number; step: number }
export type DiagramData = { nodes: Array<{ id: string; label: string; box: Box; shape: 'rectangle' | 'ellipse' | 'diamond' }>; edges: Array<{ source: string; target: string; label: string }> }
export type FretboardData = { label: string; frets: number[]; fingers: number[]; start_fret: number; visible_frets: number; tuning: string[] }
export type RhythmData = { beats_per_bar: number; beat_unit: number; events: Array<{ label: string; beats: number; rest: boolean }> }
export type NumberLineData = { min: number; max: number; step: number; marks: Array<{ value: number; label: string; color: Ink }>; jumps: Array<{ start: number; end: number; label: string; color: Ink }> }
export type AreaModelData = {
  cols: Array<{ size: number; label: string }>; rows: Array<{ size: number; label: string }>
  cells: Array<Array<{ label: string; color: Ink; step: number | null }>>; top: string; side: string
}
export type AnchorAt = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'
/** Named point computed by the renderer (never guessed by the model). */
export type ScenePoint = {
  id: string; kind: 'xy' | 'region' | 'element' | 'midpoint' | 'foot' | 'intersection' | 'lerp'
  space: string; x: number | null; y: number | null; region: string | null; element: string | null
  at: AnchorAt; refs: string[]; t: number | null; dx: number; dy: number
}
export type MarkKind = 'line' | 'arrow' | 'polyline' | 'rectangle' | 'ellipse' | 'text' | 'number' | 'formula' | 'brace' | 'connector' | 'plot' | 'diagram' | 'fretboard' | 'rhythm'
  | 'polygon' | 'arc' | 'right_angle' | 'circle' | 'tick' | 'dimension' | 'callout' | 'highlight' | 'lens' | 'numberline' | 'spotlight' | 'area_model'
export type DrawingMark = {
  id: string; kind: MarkKind
  /** 'image', a board id, or legacy 'board' (single board of side/below layouts). */
  space: string; box: Box | null; points: Point[]; text: string; color: Ink; fill: 'none' | 'soft' | 'solid' | 'white'
  font_size: number; stroke_width: number; step: number; from_region_id: string | null; to_element_id: string | null
  plot: PlotData | null; diagram: DiagramData | null; fretboard: FretboardData | null; rhythm: RhythmData | null
  // v2 fields: absent in scenes saved before anchors existed
  numberline?: NumberLineData | null; area_model?: AreaModelData | null; anchors?: string[]; target?: string | null; radius?: number; count?: number
  // v3: curved arrows and soft strokes
  bend?: number; sharp?: boolean; ink?: boolean
  /** Kept from the previous turn's drawing: on the board from the start, never animated again. */
  carried?: boolean
}
export type Board = { id: string; side: 'right' | 'left' | 'below' | 'above'; width: number; height: number; title: string }
export type CameraFocus = { step: number; target: string }
export type DrawingScene = {
  title: string; layout: 'overlay' | 'side' | 'below'; steps: string[]; notes?: string[]; points?: ScenePoint[]; elements: DrawingMark[]
  boards?: Board[]; focus?: CameraFocus[]
}
export type Frame = { x: number; y: number; width: number; height: number }
/** World of the infinite canvas: the source card plus boards, in source-pixel units. `board` is the first board (legacy). */
export type DrawingLayout = { width: number; height: number; image: Frame; board: Frame | null; frames: Record<string, Frame>; boards: Array<Board & { frame: Frame }> }

function boardsOf(w: number, h: number, drawing: DrawingScene): Board[] {
  if (drawing.boards?.length) return drawing.boards
  // Scenes saved before boards existed: one board beside (side) or under (below) the source, with the old proportions.
  if (drawing.layout === 'side') {
    const width = Math.max(w * .65, h * .85)
    return [{ id: 'board', side: 'right', width: width / w, height: Math.max(h, width * 1.15) / h, title: '' }]
  }
  if (drawing.layout === 'below') return [{ id: 'board', side: 'below', width: 1, height: Math.max(h * .65, w * .6) / h, title: '' }]
  return []
}

/** Places the boards around the source card (each side stacks outward) and normalises the world to start at 0,0. */
export function getDrawingLayout(w: number, h: number, drawing?: DrawingScene | null): DrawingLayout {
  const boards = drawing ? boardsOf(w, h, drawing) : []
  const gap = Math.max(w, h) * .06
  let left = 0, top = 0, right = w, bottom = h
  const placed = boards.map(b => {
    const width = b.width * w, height = b.height * h
    let frame: Frame
    if (b.side === 'right') { frame = { x: right + gap, y: 0, width, height }; right = frame.x + width }
    else if (b.side === 'left') { frame = { x: left - gap - width, y: 0, width, height }; left = frame.x }
    else if (b.side === 'below') { frame = { x: 0, y: bottom + gap, width, height }; bottom = frame.y + height }
    else { frame = { x: 0, y: top - gap - height, width, height }; top = frame.y }
    return { ...b, frame }
  })
  const minX = Math.min(0, ...placed.map(b => b.frame.x)), minY = Math.min(0, ...placed.map(b => b.frame.y))
  const maxX = Math.max(w, ...placed.map(b => b.frame.x + b.frame.width)), maxY = Math.max(h, ...placed.map(b => b.frame.y + b.frame.height))
  const shift = (f: Frame): Frame => ({ ...f, x: f.x - minX, y: f.y - minY })
  const image = shift({ x: 0, y: 0, width: w, height: h })
  const shifted = placed.map(b => ({ ...b, frame: shift(b.frame) }))
  const frames: Record<string, Frame> = { image, ...Object.fromEntries(shifted.map(b => [b.id, b.frame])) }
  return { width: maxX - minX, height: maxY - minY, image, board: shifted[0]?.frame ?? null, frames, boards: shifted }
}

export function pointInFrame(p: Point, f: Frame): Point { return { x: f.x + p.x * f.width / 100, y: f.y + p.y * f.height / 100 } }
export function boxInFrame(b: Box, f: Frame): Frame { return { ...pointInFrame(b, f), width: b.width * f.width / 100, height: b.height * f.height / 100 } }

/** Only these fixed mathematical operations are executable: model expressions are never evaluated. */
export function curveValue(curve: Curve, x: number): number | null {
  let value: number
  if (curve.kind === 'polynomial') value = curve.coefficients.reduceRight((sum, c) => sum * x + c, 0)
  else {
    const input = curve.b * x + curve.c
    if ((curve.kind === 'sqrt' && input < 0) || (curve.kind === 'log' && input <= 0)) return null
    if (curve.kind === 'gaussian') value = curve.a * Math.exp(-(((x - curve.c) / (curve.b || 1)) ** 2) / 2) + curve.d
    else {
      const f = curve.kind === 'sin' ? Math.sin : curve.kind === 'cos' ? Math.cos : curve.kind === 'sqrt' ? Math.sqrt
        : curve.kind === 'exp' ? Math.exp : curve.kind === 'log' ? Math.log : Math.abs
      value = curve.a * f(input) + curve.d
    }
  }
  return Number.isFinite(value) ? value : null
}

export function edgePoints(a: Frame, b: Frame): [Point, Point] {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  const dx = bc.x - ac.x, dy = bc.y - ac.y
  const ratio = (box: Frame) => Math.min(Math.abs(dx) > .001 ? box.width / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > .001 ? box.height / 2 / Math.abs(dy) : Infinity, .45)
  const ar = ratio(a), br = ratio(b)
  return [{ x: ac.x + dx * ar, y: ac.y + dy * ar }, { x: bc.x - dx * br, y: bc.y - dy * br }]
}

export const sliderKey = (s: Slider) => `${s.curve}:${s.field}`

/** Current value of a slider's field in the plot as the model wrote it. */
export function sliderDefault(plot: PlotData, s: Slider): number {
  const curve = plot.curves[s.curve]
  if (!curve) return s.min
  return s.field.startsWith('c') && s.field !== 'c' ? curve.coefficients[Number(s.field.slice(1))] ?? 0 : curve[s.field as 'a' | 'b' | 'c' | 'd']
}

/** The plot with the student's slider values applied (pure: the scene itself never changes). */
export function withParams(plot: PlotData, values: Record<string, number> | undefined): PlotData {
  if (!values || !plot.sliders?.length) return plot
  const curves = plot.curves.map(c => ({ ...c, coefficients: [...c.coefficients] }))
  for (const s of plot.sliders) {
    const v = values[sliderKey(s)], curve = curves[s.curve]
    if (v === undefined || !curve) continue
    if (s.field.startsWith('c') && s.field !== 'c') curve.coefficients[Number(s.field.slice(1))] = v
    else curve[s.field as 'a' | 'b' | 'c' | 'd'] = v
  }
  return { ...plot, curves }
}

const num = (v: number) => Number(v.toFixed(2)).toLocaleString('it-IT')
const term = (coef: number, body: string, first: boolean) => {
  if (Math.abs(coef) < 1e-9) return ''
  const sign = coef < 0 ? (first ? '−' : ' − ') : (first ? '' : ' + ')
  const size = Math.abs(coef)
  return sign + (body && Math.abs(size - 1) < 1e-9 ? '' : num(size)) + body
}

/** The curve's equation with its current numbers (e.g. "y = 2·sin(3x + 0,5)"), read off the live values. */
export function liveFormula(c: Curve): string {
  if (c.kind === 'polynomial') {
    const parts = c.coefficients.map((k, i) => ({ k, body: i === 0 ? '' : i === 1 ? 'x' : `x${['', '', '²', '³', '⁴', '⁵', '⁶', '⁷'][i]}` })).reverse()
    let first = true
    const text = parts.map(p => { const t = term(p.k, p.body, first); if (t) first = false; return t }).join('')
    return `y = ${text || '0'}`
  }
  const inner = `${Math.abs(c.b - 1) < 1e-9 ? '' : Math.abs(c.b + 1) < 1e-9 ? '−' : num(c.b)}x${Math.abs(c.c) < 1e-9 ? '' : c.c < 0 ? ` − ${num(-c.c)}` : ` + ${num(c.c)}`}`
  const body = c.kind === 'gaussian' ? `e^(−((x − ${num(c.c)})/${num(c.b)})²/2)` : c.kind === 'abs' ? `|${inner}|` : `${c.kind === 'log' ? 'ln' : c.kind}(${inner})`
  const scaled = Math.abs(c.a - 1) < 1e-9 ? body : `${num(c.a)}·${body}`
  return `y = ${scaled}${Math.abs(c.d) < 1e-9 ? '' : c.d < 0 ? ` − ${num(-c.d)}` : ` + ${num(c.d)}`}`
}
