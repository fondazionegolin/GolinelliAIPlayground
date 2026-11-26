import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/design/primitives/Button'
import { IconButton } from '@/design/primitives/IconButton'
import { Box, Check, Grid3x3, Magnet, Maximize, PencilLine, Redo2, Ruler, Trash2, Undo2 } from '@/components/icons'
import { cornerCandidates, dragVertex, entitiesOfRegion, entityInRect, entityVertices, filletCorner, pushEdge, mirrorEntity, mirrorEntities, segmentMidpoint, trimEntity, type MirrorAxis } from './edit2d'
import { DEFAULT_MODES, MODE_OPTIONS, drawNeed, drawPreview, type DrawModes, type DrawTool, type ModeTool } from './drawModes'
import { inferPoint } from './infer'
import { circularPattern, defaultStep, rectPattern, sourceCenter, MAX_COPIES, type PatternMode } from './pattern'
import { profileFromSelection, type RevolveAxis } from './revolve'
import { tl } from '@/i18n/tl'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { uid } from '../sceneOps'
import {
  add, analyzeSketch, chainFrom, closestOnSegment, dist, dot, entitiesBounds, keyPoints, len, mul,
  nearestOnEntity, norm, offsetLoop, offsetPath, polar, rectCorners, regionContains, sub, tessellate, thickenPath,
  translateEntity, arcEnds, arcSweep, type P, type Region, type SketchEntity, type SnapKind,
} from './geom2d'

type Tool = 'select' | DrawTool | 'offset' | 'trim' | 'fillet' | 'mid' | 'mirror' | 'pattern' | 'revolve'
const DRAW_TOOLS: Tool[] = ['line', 'arc', 'rect', 'circle', 'ellipse', 'polygon', 'curve']
const MODE_TOOLS: Tool[] = ['rect', 'circle', 'arc', 'curve']

export interface RevolveRequest {
  entities: SketchEntity[]
  /** Ids of the picked segments / curves: the shape that is rotated. */
  ids: string[]
  axis: RevolveAxis
  angle: number
  mode: 'solid' | 'cut'
}

interface Props {
  planeLabel: string
  /** Edges of the scene lying on the plane (snap / projection only). */
  refs: [P, P][]
  /** Solid edges on the plane: closed together with the strokes they bound extrudable regions. */
  boundary?: [P, P][]
  /** Sketch being resumed (the editor keeps it saved in the scene through `onChange`). */
  resume?: SketchEntity[]
  panelHost: HTMLElement | null
  onView: (center: P, pxPerMm: number) => void
  /** Every change of the sketch, so it stays in memory (saved in the scene) while drawing. */
  onChange: (entities: SketchEntity[]) => void
  onFinish: (entities: SketchEntity[]) => void
  /** Revolve the picked shape about an axis; returns an error message or null on success. */
  onRevolve: (req: RevolveRequest) => string | null
  /** Live 3D preview of the revolve (null clears it); returns an error message when it cannot be built. */
  onPreview: (req: RevolveRequest | null) => string | null
  /** Left column where the sketch tools are shown (it replaces the 3D shapes library while sketching). */
  toolsHost: HTMLElement | null
  /** Floating 3D preview of the scene (and of the revolve being set up) while sketching. */
  show3d: boolean
  onShow3d: (on: boolean) => void
  /** Open straight in the revolve tool (from the 3D panel). */
  startRevolve?: boolean
}

interface SnapResult { p: P; kind: SnapKind | 'grid' | 'free' | 'curve' | 'axis' | 'inferred'; guides: [P, P][]; label?: string; suggest?: P[]; sources?: P[] }

const DEG = Math.PI / 180
const fmt = (v: number, digits = 2) => {
  const r = Math.round(v * 10 ** digits) / 10 ** digits
  return (Object.is(r, -0) ? 0 : r).toLocaleString('it-IT', { maximumFractionDigits: digits })
}
const parseNum = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '' || s.trim() === '-') return null
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}
const SNAP_LABEL: Record<SnapResult['kind'], string> = {
  end: tl("Estremo"), mid: tl("Punto medio"), center: tl("Centro"), quadrant: tl("Quadrante"), intersection: tl("Intersezione"),
  origin: tl("Origine"), reference: tl("Bordo della faccia"), grid: tl("Griglia"), free: tl("Libero"), curve: tl("Sulla curva"), axis: tl("Allineato"), inferred: tl("Vincolo"),
}

// ── Tool icons (drawn as the geometry they create) ─────────────────────────

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const SELECT_ICON = svg(<path d="M6 3.5v15.5l4.2-4 2.9 6.2 2.6-1.2-2.9-6.1h5.7Z" />)
const TOOL_ICONS: Record<Exclude<Tool, 'select'>, ReactNode> = {
  line: svg(<><path d="M5 19 19 5" /><circle cx="5" cy="19" r="1.6" fill="currentColor" /><circle cx="19" cy="5" r="1.6" fill="currentColor" /></>),
  arc: svg(<><path d="M4 18a9 9 0 0 1 16 0" /><circle cx="4" cy="18" r="1.6" fill="currentColor" /><circle cx="20" cy="18" r="1.6" fill="currentColor" /></>),
  rect: svg(<rect x="4" y="6" width="16" height="12" rx="0.5" />),
  circle: svg(<><circle cx="12" cy="12" r="8" /><path d="M12 12h8" strokeDasharray="2 2" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></>),
  ellipse: svg(<ellipse cx="12" cy="12" rx="9" ry="5.5" />),
  polygon: svg(<path d="M12 3.5 19.4 7.75v8.5L12 20.5l-7.4-4.25v-8.5Z" />),
  curve: svg(<><path d="M4 18C4 6 20 18 20 6" /><path d="M4 18 4 9M20 6l0 9" strokeDasharray="2 2" strokeWidth={1.2} /><circle cx="4" cy="18" r="1.4" fill="currentColor" /><circle cx="20" cy="6" r="1.4" fill="currentColor" /></>),
  trim: svg(<><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M7.8 16.2 17 4M16.2 16.2 7 4" /></>),
  fillet: svg(<><path d="M4 4v6a6 6 0 0 0 6 6h10" /><path d="M4 20V4" strokeDasharray="0.1 3" /></>),
  mid: svg(<><path d="M4 18 20 6" /><path d="M12 8.2 15 12.6H9Z" fill="currentColor" transform="translate(0 0.4)" /><circle cx="4" cy="18" r="1.4" fill="currentColor" /><circle cx="20" cy="6" r="1.4" fill="currentColor" /></>),
  offset: svg(<><rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 2.4" /><rect x="7.5" y="7.5" width="9" height="9" rx="0.5" /></>),
  pattern: svg(<><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" strokeDasharray="2.6 2" /><rect x="3" y="14" width="7" height="7" rx="1.2" strokeDasharray="2.6 2" /><rect x="14" y="14" width="7" height="7" rx="1.2" strokeDasharray="2.6 2" /></>),
  mirror: svg(<><path d="M12 3v18" strokeDasharray="2.4 2" /><path d="M9 7 4 17h5Z" /><path d="m15 7 5 10h-5Z" fill="currentColor" fillOpacity="0.25" /></>),
  revolve: svg(<><path d="M12 2.5v19" strokeDasharray="2.4 2" /><ellipse cx="12" cy="7" rx="7" ry="2.2" /><path d="M5 7v10c0 1.2 3.1 2.2 7 2.2s7-1 7-2.2V7" /><path d="m15.5 4.4 2.2.5-1.3 1.8" /></>),
}
const TOOLS: { id: Tool; label: string; key: string; group: number }[] = [
  { id: 'select', label: tl("Seleziona"), key: 'S', group: 0 },
  { id: 'line', label: tl("Linea"), key: 'L', group: 1 },
  { id: 'rect', label: tl("Rettangolo"), key: 'R', group: 1 },
  { id: 'circle', label: tl("Cerchio"), key: 'C', group: 1 },
  { id: 'arc', label: tl("Arco"), key: 'A', group: 1 },
  { id: 'curve', label: tl("Curva (Bézier / spline)"), key: 'U', group: 1 },
  { id: 'ellipse', label: tl("Ellisse"), key: 'E', group: 1 },
  { id: 'polygon', label: tl("Poligono regolare"), key: 'P', group: 1 },
  { id: 'offset', label: tl("Offset / spessore"), key: 'O', group: 2 },
  { id: 'trim', label: tl("Taglia (trim)"), key: 'T', group: 2 },
  { id: 'fillet', label: tl("Raccordo angolo (fillet)"), key: 'B', group: 2 },
  { id: 'mid', label: tl("Punto medio"), key: 'M', group: 2 },
  { id: 'mirror', label: tl("Specchio (asse o punto di simmetria)"), key: 'X', group: 3 },
  { id: 'pattern', label: tl("Ripetizione rettangolare o circolare"), key: 'N', group: 2 },
  { id: 'revolve', label: tl("Solido di rotazione (profilo + asse)"), key: 'W', group: 3 },
]
const SHORT_LABEL: Record<Tool, string> = {
  select: tl("Seleziona"), line: tl("Linea"), rect: tl("Rettangolo"), circle: tl("Cerchio"), arc: tl("Arco"), curve: tl("Curva"), ellipse: tl("Ellisse"),
  polygon: tl("Poligono"), offset: tl("Offset"), trim: tl("Taglia"), fillet: tl("Raccordo"), mid: tl("Punto medio"), mirror: tl("Specchio"), pattern: tl("Ripeti"), revolve: tl("Rotazione"),
}
const TOOL_KEYS: Record<string, Tool> = { s: 'select', v: 'select', l: 'line', a: 'arc', r: 'rect', c: 'circle', e: 'ellipse', p: 'polygon', u: 'curve', o: 'offset', t: 'trim', b: 'fillet', m: 'mid', x: 'mirror', n: 'pattern', w: 'revolve' }

function isValid(e: SketchEntity): boolean {
  switch (e.type) {
    case 'line': return dist(e.a, e.b) > 1e-4
    case 'rect': return Math.abs(e.a[0] - e.b[0]) > 1e-4 && Math.abs(e.a[1] - e.b[1]) > 1e-4
    case 'circle': case 'arc': case 'polygon': return e.r > 1e-3
    case 'ellipse': return e.rx > 1e-3 && e.ry > 1e-3
    case 'polyline': return e.pts.length >= 2
    case 'bezier': return dist(e.pts[0], e.pts[3]) > 1e-4 || dist(e.pts[0], e.pts[1]) > 1e-4
    case 'spline': return e.pts.length >= 2
    case 'point': return true
  }
}

/** Draggable vertices of a selected entity (control points for curves). */
function handlesOf(e: SketchEntity): { key: string; p: P }[] {
  switch (e.type) {
    case 'line': case 'rect': return [{ key: 'a', p: e.a }, { key: 'b', p: e.b }]
    case 'circle': return [{ key: 'r', p: [e.c[0] + e.r, e.c[1]] }]
    case 'bezier': case 'spline': case 'polyline': return e.pts.map((p, i) => ({ key: String(i), p }))
    case 'point': return [{ key: 'p', p: e.p }]
    default: return []
  }
}
function applyHandle(e: SketchEntity, key: string, p: P): SketchEntity {
  switch (e.type) {
    case 'line': case 'rect': return key === 'a' ? { ...e, a: p } : { ...e, b: p }
    case 'circle': return { ...e, r: Math.max(0.001, dist(e.c, p)) }
    case 'bezier': return { ...e, pts: e.pts.map((q, i) => (String(i) === key ? p : q)) as [P, P, P, P] }
    case 'spline': case 'polyline': return { ...e, pts: e.pts.map((q, i) => (String(i) === key ? p : q)) }
    case 'point': return { ...e, p }
    default: return e
  }
}

interface QuickField { label: string; unit: string; value: number; set: (list: SketchEntity[], e: SketchEntity, v: number) => SketchEntity[] }

/** The main dimensions of a stroke, editable in place (Tab / double click). Lines keep their connections. */
function quickFields(e: SketchEntity): QuickField[] {
  const put = (list: SketchEntity[], next: SketchEntity) => list.map(x => (x.id === next.id ? next : x))
  switch (e.type) {
    case 'line': {
      const L = dist(e.a, e.b), ang = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0])
      return [
        { label: tl("Lunghezza"), unit: 'mm', value: L, set: (list, x, v) => { const l = x as typeof e; const a0 = Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0]); return v > 0 ? dragVertex(list, l.b, polar(l.a, v, a0)) : list } },
        { label: tl("Angolo"), unit: '°', value: ang / DEG, set: (list, x, v) => { const l = x as typeof e; return dragVertex(list, l.b, polar(l.a, dist(l.a, l.b), v * DEG)) } },
      ]
    }
    case 'rect': {
      const [lo, , hi] = rectCorners(e.a, e.b)
      return [
        { label: tl("Larghezza"), unit: 'mm', value: hi[0] - lo[0], set: (list, x, v) => { const [a, , b] = rectCorners((x as typeof e).a, (x as typeof e).b); return v > 0 ? put(list, { ...(x as typeof e), a, b: [a[0] + v, b[1]] }) : list } },
        { label: tl("Altezza"), unit: 'mm', value: hi[1] - lo[1], set: (list, x, v) => { const [a, , b] = rectCorners((x as typeof e).a, (x as typeof e).b); return v > 0 ? put(list, { ...(x as typeof e), a, b: [b[0], a[1] + v] }) : list } },
      ]
    }
    case 'circle':
      return [{ label: tl("Diametro"), unit: 'mm', value: e.r * 2, set: (list, x, v) => (v > 0 ? put(list, { ...(x as typeof e), r: v / 2 }) : list) }]
    case 'arc':
      return [
        { label: tl("Raggio"), unit: 'mm', value: e.r, set: (list, x, v) => (v > 0 ? put(list, { ...(x as typeof e), r: v }) : list) },
        { label: tl("Ampiezza"), unit: '°', value: arcSweep(e.a0, e.a1) / DEG, set: (list, x, v) => (v > 0 ? put(list, { ...(x as typeof e), a1: (x as typeof e).a0 + Math.min(359.99, v) * DEG }) : list) },
      ]
    case 'ellipse':
      return [
        { label: tl("Larghezza"), unit: 'mm', value: e.rx * 2, set: (list, x, v) => (v > 0 ? put(list, { ...(x as typeof e), rx: v / 2 }) : list) },
        { label: tl("Altezza"), unit: 'mm', value: e.ry * 2, set: (list, x, v) => (v > 0 ? put(list, { ...(x as typeof e), ry: v / 2 }) : list) },
      ]
    case 'polygon':
      return [
        { label: tl("Raggio"), unit: 'mm', value: e.r, set: (list, x, v) => (v > 0 ? put(list, { ...(x as typeof e), r: v }) : list) },
        { label: tl("Lati"), unit: '', value: e.n, set: (list, x, v) => put(list, { ...(x as typeof e), n: Math.max(3, Math.min(64, Math.round(v))) }) },
      ]
    default:
      return []
  }
}

const POINT_SNAPS: SnapResult['kind'][] = ['end', 'center', 'quadrant', 'intersection', 'origin', 'reference']

const same = (a: P, b: P) => dist(a, b) < 1e-6

/** Move every line / polyline vertex sitting on `old` (keeps connected strokes joined). */
function moveCoincident(list: SketchEntity[], old: P, next: P, skipId: string): SketchEntity[] {
  return list.map(e => {
    if (e.id === skipId) return e
    if (e.type === 'line' && (same(e.a, old) || same(e.b, old))) return { ...e, a: same(e.a, old) ? next : e.a, b: same(e.b, old) ? next : e.b }
    if (e.type === 'polyline' && e.pts.some(p => same(p, old))) return { ...e, pts: e.pts.map(p => (same(p, old) ? next : p)) }
    return e
  })
}

// ── Offset ────────────────────────────────────────────────────────────────

interface OffsetUi { ids: string[]; pts: P[]; closed: boolean; at: P; value: string; band: boolean; keep: boolean; source?: SketchEntity }

function offsetResult(ui: OffsetUi, d: number): SketchEntity[] {
  if (!d) return []
  const s = ui.source
  if (s?.type === 'circle') return s.r + d > 1e-3 ? [{ id: uid('e'), type: 'circle', c: s.c, r: s.r + d }] : []
  if (s?.type === 'rect') {
    const [lo, , hi] = rectCorners(s.a, s.b)
    const a: P = [lo[0] - d, lo[1] - d], b: P = [hi[0] + d, hi[1] + d]
    return b[0] - a[0] > 1e-3 && b[1] - a[1] > 1e-3 ? [{ id: uid('e'), type: 'rect', a, b }] : []
  }
  if (s?.type === 'polygon') {
    const r = s.r + d / Math.cos(Math.PI / s.n)
    return r > 1e-3 ? [{ ...s, id: uid('e'), r }] : []
  }
  if (ui.closed) return offsetLoop(ui.pts, d).map(pts => ({ id: uid('e'), type: 'polyline', pts, closed: true }))
  if (ui.band) return thickenPath(ui.pts, Math.abs(d)).map(pts => ({ id: uid('e'), type: 'polyline', pts, closed: true }))
  return [{ id: uid('e'), type: 'polyline', pts: offsetPath(ui.pts, -d), closed: false }]
}

// ── Small field ────────────────────────────────────────────────────────────

function Num({ label, value, onCommit, suffix = 'mm', step = 0.5, min, readOnly }: { label: string; value: number; onCommit?: (v: number) => void; suffix?: string; step?: number; min?: number; readOnly?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = parseNum(draft)
    if (v !== null && (min === undefined || v >= min)) onCommit?.(v)
    setDraft(null)
  }
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-slate-400">{label}</span>
      <div className={`flex items-center rounded-lg border border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 ${readOnly ? 'bg-slate-50' : 'bg-white'}`}>
        <input
          inputMode="decimal"
          readOnly={readOnly}
          step={step}
          value={draft ?? String(Math.round(value * 1000) / 1000)}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null) }}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-xs font-semibold text-slate-900 outline-none"
        />
        {suffix && <span className="pr-1.5 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </label>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-0.5 p-0.5" style={{ ...buildAccentNavClusterStyle(), gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([id, label, title]) => (
        <Button
          key={id}
          type="button"
          title={title}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          tone="neutral"
          surface="ghost"
          density="compact"
          className={`min-w-0 rounded-full px-1 text-[11px] ${value === id ? 'ds-selected' : ''}`}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

function RevStep({ n, state, title, children }: { n: number; state: 'todo' | 'active' | 'done'; title: string; children?: ReactNode }) {
  return (
    <div className={`space-y-1.5 rounded-lg border p-2 ${state === 'active' ? 'border-violet-300 bg-white' : 'border-transparent bg-white/50'}`}>
      <p className="flex items-center gap-2 text-[11px] font-semibold text-slate-800">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${state === 'active' ? 'bg-violet-600 text-white' : state === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{state === 'done' ? '✓' : n}</span>
        {title}
      </p>
      {children}
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────

export default function SketchEditor({ planeLabel, refs, boundary, resume, panelHost, onView, onChange, onFinish, onRevolve, onPreview, show3d, onShow3d, startRevolve, toolsHost }: Props) {
  const [hist, setHist] = useState<{ past: SketchEntity[][]; present: SketchEntity[]; future: SketchEntity[][] }>(
    () => ({ past: [], present: resume ?? [], future: [] }),
  )
  const entities = hist.present
  const commit = useCallback((next: SketchEntity[]) => setHist(h => ({ past: [...h.past.slice(-199), h.present], present: next, future: [] })), [])
  const undo = () => setHist(h => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h))
  const redo = () => setHist(h => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h))

  // The sketch stays in memory (saved in the scene) as it is drawn, whatever plane it is on.
  const firstRun = useRef(true)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    onChangeRef.current(entities)
  }, [entities])

  const [tool, setToolState] = useState<Tool>(startRevolve ? 'revolve' : resume?.length ? 'select' : 'line')
  const [modes, setModes] = useState<DrawModes>(DEFAULT_MODES)
  const [menuFor, setMenuFor] = useState<Tool | null>(null)
  const [draft, setDraft] = useState<P[]>([])
  const [cursor, setCursor] = useState<SnapResult | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [regionSel, setRegionSel] = useState<string[]>([])
  const [view, setView] = useState<{ c: P; k: number }>({ c: [0, 0], k: 0 })
  const [grid, setGrid] = useState(1)
  const [ortho, setOrtho] = useState(false)
  const [constrained, setConstrained] = useState(true)
  const [showDims, setShowDims] = useState(true)
  const [sides, setSides] = useState(6)
  const [shift, setShift] = useState(false)
  const [dimText, setDimText] = useState<string[]>([])
  const [offsetUi, setOffsetUi] = useState<OffsetUi | null>(null)
  const [filletUi, setFilletUi] = useState<{ at: P; value: string; all: boolean } | null>(null)
  const [moveDrag, setMoveDrag] = useState<{ from: P; delta: P; ids: string[] } | null>(null)
  const [handleDrag, setHandleDrag] = useState<{ id: string; key: string; p: P } | null>(null)
  const [mirrorKeep, setMirrorKeep] = useState(true)
  const [pat, setPat] = useState<{ mode: PatternMode; nx: number; ny: number; dx: number | null; dy: number | null; count: number; angle: number; centre: P | null }>({ mode: 'rect', nx: 3, ny: 1, dx: null, dy: null, count: 6, angle: 360, centre: null })
  const [patDrag, setPatDrag] = useState<'x' | 'y' | null>(null)
  const [rev, setRev] = useState<{ axis: RevolveAxis | null; label: string; angle: string; mode: 'solid' | 'cut'; error: string | null; step: 'shape' | 'axis' }>({ axis: null, label: '', angle: '360', mode: 'solid', error: null, step: 'shape' })
  const [marquee, setMarquee] = useState<{ a: P; b: P; moved: boolean } | null>(null)
  const [quickEdit, setQuickEdit] = useState<{ id: string; text: string[] } | null>(null)
  const quickRefs = useRef<(HTMLInputElement | null)[]>([])
  const [editDrag, setEditDrag] = useState<{ kind: 'vertex' | 'edge'; id?: string; from: P; to: P } | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dimRefs = useRef<(HTMLInputElement | null)[]>([])
  const [size, setSize] = useState({ w: 1, h: 1 })
  const panRef = useRef<{ x: number; y: number; c: P } | null>(null)

  const analysis = useMemo(() => analyzeSketch(entities, boundary), [entities, boundary])

  // Parametric drag: the shape adapts live (vertex: connected strokes follow; edge: pushed parallel to itself).
  const editPreview = useMemo(() => {
    if (!editDrag || same(editDrag.from, editDrag.to)) return null
    return editDrag.kind === 'vertex' ? dragVertex(entities, editDrag.from, editDrag.to, constrained) : pushEdge(entities, editDrag.id!, editDrag.from, editDrag.to)
  }, [editDrag, entities, constrained])
  const previewAnalysis = useMemo(() => (editPreview ? analyzeSketch(editPreview, boundary) : null), [editPreview, boundary])

  const setTool = (t: Tool) => { setToolState(t); setDraft([]); setDimText([]); setOffsetUi(null); setFilletUi(null); setMenuFor(null); setHandleDrag(null) }
  const modeTool = MODE_TOOLS.includes(tool) ? (tool as ModeTool) : null
  const isDrawTool = DRAW_TOOLS.includes(tool)
  const need = isDrawTool ? drawNeed(tool as DrawTool, modes) : 0

  // ── View ──
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth || 1, h: host.clientHeight || 1 }))
    ro.observe(host)
    setSize({ w: host.clientWidth || 1, h: host.clientHeight || 1 })
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const b = entitiesBounds(entities)
    let min: P = b ? b.min : [-50, -50], max: P = b ? b.max : [50, 50]
    if (!b) for (const [p, q] of refs) {
      min = [Math.min(min[0], p[0], q[0]), Math.min(min[1], p[1], q[1])]
      max = [Math.max(max[0], p[0], q[0]), Math.max(max[1], p[1], q[1])]
    }
    const span = Math.max(max[0] - min[0], max[1] - min[1], 20)
    const k = Math.max(0.3, Math.min(80, (Math.min(size.w, size.h) * 0.72) / span))
    setView({ c: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], k })
  }, [entities, refs, size])

  useEffect(() => { if (view.k === 0 && size.w > 1) fit() }, [size, view.k, fit])
  useEffect(() => { if (view.k > 0) onView(view.c, view.k) }, [view, onView])

  const toScreen = useCallback((p: P): P => [size.w / 2 + (p[0] - view.c[0]) * view.k, size.h / 2 - (p[1] - view.c[1]) * view.k], [size, view])
  const toSketch = useCallback((sx: number, sy: number): P => [view.c[0] + (sx - size.w / 2) / view.k, view.c[1] - (sy - size.h / 2) / view.k], [size, view])

  // ── Snapping ──
  /** Face / solid edges as straight strokes, so the inference (alignment, parallel, perpendicular) also works on them. */
  const refEntities = useMemo<SketchEntity[]>(() => refs.slice(0, 300).map(([a, b], i) => ({ id: `ref${i}`, type: 'line', a, b })), [refs])
  const snapPoint = useCallback((raw: P): SnapResult => {
    const k = view.k || 1
    const tol = 13 / k
    let best: { p: P; kind: SnapKind; d: number } | null = null
    const consider = (p: P, kind: SnapKind) => {
      const d = dist(p, raw)
      if (d < tol && (!best || d < best.d)) best = { p, kind, d }
    }
    for (const e of entities) for (const kp of keyPoints(e)) consider(kp.p, kp.kind)
    for (const v of analysis.vertices) consider(v, 'intersection')
    for (const [a, b] of refs) { consider(a, 'reference'); consider(b, 'reference'); consider(mul(add(a, b), 0.5), 'reference') }
    for (const p of draft) consider(p, 'end')
    consider([0, 0], 'origin')
    if (best) return { p: (best as { p: P }).p, kind: (best as { kind: SnapKind }).kind, guides: [] }

    const anchor = draft.length ? draft[draft.length - 1] : null
    // Magnetic edges: any stroke or face edge under the cursor attracts the point. When the horizontal / vertical
    // through the previous point crosses that edge close by, the point lands exactly there.
    if (isDrawTool) {
      const edgeTol = 9 / k
      let edge: { point: P; d: number; seg: [P, P] | null; ref: boolean } | null = null
      for (const e of entities) {
        const r = nearestOnEntity(e, raw)
        if (r.d < edgeTol && (!edge || r.d < edge.d)) {
          const t = tessellate(e)
          let seg: [P, P] | null = null
          if (e.type === 'line') seg = [e.a, e.b]
          else if (e.type === 'rect' || e.type === 'polygon' || e.type === 'polyline') {
            const n = t.closed ? t.pts.length : t.pts.length - 1
            for (let i = 0; i < n; i++) { const a = t.pts[i], b = t.pts[(i + 1) % t.pts.length]; if (closestOnSegment(raw, a, b).d < edgeTol * 0.5 + r.d) { seg = [a, b]; break } }
          }
          edge = { point: r.point, d: r.d, seg, ref: false }
        }
      }
      for (const [a, b] of refs) {
        const c = closestOnSegment(raw, a, b)
        if (c.d < edgeTol && (!edge || c.d < edge.d)) edge = { point: c.point, d: c.d, seg: [a, b], ref: true }
      }
      if (edge) {
        if (anchor && edge.seg) {
          const [a, b] = edge.seg
          const hit = (axis: 0 | 1): P | null => {
            const dv = b[axis] - a[axis]
            if (Math.abs(dv) < 1e-9) return null
            const t = (anchor[axis] - a[axis]) / dv
            if (t < -1e-6 || t > 1 + 1e-6) return null
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
          }
          for (const [axis, label] of [[0, tl("Verticale sul lato")], [1, tl("Orizzontale sul lato")]] as [0 | 1, string][]) {
            const q = hit(axis)
            if (q && dist(q, raw) < 14 / k && dist(q, anchor) > 1e-6) return { p: q, kind: 'inferred', guides: [[anchor, q]], label, sources: [q] }
          }
        }
        return { p: edge.point, kind: 'curve', guides: [], label: edge.ref ? tl("Sul bordo della faccia") : undefined }
      }
    }
    // Constrained mode: anchor points inferred from alignment with other vertices and edges.
    let suggest: P[] | undefined
    if (constrained && tool !== 'select') {
      const inf = inferPoint(raw, anchor, [...entities, ...refEntities], 12 / k)
      suggest = inf.suggestions
      if (inf.best) return { p: inf.best.p, kind: 'inferred', guides: inf.best.guides, label: inf.best.label, suggest, sources: inf.best.sources }
    }
    if (anchor && (tool === 'line' || (tool === 'arc' && draft.length === 1))) {
      const v = sub(raw, anchor)
      if (len(v) > 1e-9) {
        const ang = Math.atan2(v[1], v[0])
        const stepA = shift ? 15 * DEG : 90 * DEG
        const snapped = Math.round(ang / stepA) * stepA
        if (ortho || shift || Math.abs(ang - snapped) < 3 * DEG) {
          const d: P = [Math.cos(snapped), Math.sin(snapped)]
          let L = dot(v, d)
          if (grid > 0) L = Math.round(L / grid) * grid
          const p = add(anchor, mul(d, L))
          return { p, kind: 'axis', guides: [[anchor, add(anchor, mul(d, L + Math.sign(L || 1) * 30 / k))]], suggest }
        }
      }
    }

    let curve: { point: P; d: number } | null = null
    for (const e of entities) {
      const r = nearestOnEntity(e, raw)
      if (r.d < 6 / k && (!curve || r.d < curve.d)) curve = r
    }
    if (curve) return { p: curve.point, kind: 'curve', guides: [], suggest }

    let p: P = grid > 0 ? [Math.round(raw[0] / grid) * grid, Math.round(raw[1] / grid) * grid] : raw
    const alignTol = 6 / k
    let ax: P | null = null, ay: P | null = null
    const pts: P[] = [...draft]
    for (const e of entities) for (const kp of keyPoints(e)) { pts.push(kp.p); if (pts.length > 600) break }
    for (const q of pts) {
      if (Math.abs(raw[0] - q[0]) < alignTol && (!ax || Math.abs(raw[1] - q[1]) < Math.abs(raw[1] - ax[1]))) ax = q
      if (Math.abs(raw[1] - q[1]) < alignTol && (!ay || Math.abs(raw[0] - q[0]) < Math.abs(raw[0] - ay[0]))) ay = q
    }
    if (ax) p = [ax[0], p[1]]
    if (ay) p = [p[0], ay[1]]
    const guides: [P, P][] = []
    if (ax) guides.push([ax, p])
    if (ay) guides.push([ay, p])
    return { p, kind: ax || ay ? 'axis' : grid > 0 ? 'grid' : 'free', guides, suggest }
  }, [view.k, entities, analysis, refs, refEntities, draft, tool, isDrawTool, shift, ortho, grid, constrained])

  // Re-snap when modifiers / tool change without a mouse move.
  const lastRaw = useRef<P | null>(null)
  useEffect(() => { if (lastRaw.current) setCursor(snapPoint(lastRaw.current)) }, [snapPoint])

  const locked = useMemo(() => [parseNum(dimText[0]), parseNum(dimText[1])], [dimText])
  const pv = useMemo(() => (cursor && isDrawTool ? drawPreview(tool as DrawTool, modes, draft, cursor.p, locked, sides) : null), [tool, isDrawTool, modes, draft, cursor, locked, sides])

  const resetDim = () => {
    setDimText([])
    dimRefs.current.forEach(i => i?.blur())
    hostRef.current?.focus()
  }

  const finishSpline = (pts: P[]) => {
    const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-6)
    if (clean.length >= 2) commit([...entities, { id: uid('e'), type: 'spline', pts: clean }])
    setDraft([])
    resetDim()
  }

  const commitStep = (point: P) => {
    if (!isDrawTool) return
    if (!draft.length) { setDraft([point]); resetDim(); return }
    if (tool === 'curve' && modes.curve === 'spline') {
      if (dist(point, draft[draft.length - 1]) < 1e-6) finishSpline(draft)
      else setDraft([...draft, point])
      return
    }
    const p = drawPreview(tool as DrawTool, modes, draft, point, locked, sides)
    if (!p) return
    if (tool === 'line') {
      const line = { ...(p.ents[0] as Extract<SketchEntity, { type: 'line' }>), id: uid('e') }
      if (!isValid(line)) return
      const closes = draft.length >= 2 && same(line.b, draft[0])
      commit([...entities, line])
      setDraft(closes ? [] : [...draft, line.b])
    } else if (typeof need === 'number' && draft.length + 1 < need) {
      const next = p.end ?? point
      if (dist(next, draft[draft.length - 1]) > 1e-4) setDraft([...draft, next])
    } else {
      const ents = p.ents.map(e => ({ ...e, id: uid('e') })).filter(isValid)
      if (!ents.length) return
      commit([...entities, ...ents])
      setDraft([])
    }
    resetDim()
  }

  const openQuickEdit = (id: string) => {
    const ent = entities.find(x => x.id === id)
    if (!ent || !quickFields(ent).length) return
    setSelected([id])
    setQuickEdit({ id, text: [] })
    requestAnimationFrame(() => { const i = quickRefs.current[0]; if (i) { i.focus(); i.select() } })
  }
  const applyQuickEdit = () => {
    if (!quickEdit) return
    let list = entities
    const fields = quickFields(entities.find(x => x.id === quickEdit.id)!)
    fields.forEach((f, i) => {
      const v = parseNum(quickEdit.text[i])
      const cur = list.find(x => x.id === quickEdit.id)
      if (v == null || !cur || Math.abs(v - quickFields(cur)[i].value) < 1e-9) return
      list = f.set(list, cur, v)
    })
    if (list !== entities) commit(list)
    setQuickEdit(null)
    hostRef.current?.focus()
  }
  const vertexAt = (raw: P): P | null => {
    let best: P | null = null, bd = 9 / (view.k || 1)
    for (const e of entities) for (const v of entityVertices(e)) { const d = dist(v, raw); if (d < bd) { bd = d; best = v } }
    return best
  }
  const hitEntity = (raw: P): SketchEntity | null => {
    let best: SketchEntity | null = null, bd = 7 / (view.k || 1)
    for (const e of entities) {
      const d = nearestOnEntity(e, raw).d
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  const openOffset = (raw: P) => {
    const hit = hitEntity(raw)
    if (hit?.type === 'point') return
    if (hit) {
      const chain = chainFrom(entities, hit.id)
      if (!chain) return
      const single = chain.ids.length === 1 ? hit : undefined
      setOffsetUi({ ids: chain.ids, pts: chain.pts, closed: chain.closed, at: raw, value: '2', band: !chain.closed, keep: chain.closed, source: single })
      return
    }
    const region = smallestRegionAt(analysis.regions, raw)
    if (region) setOffsetUi({ ids: [], pts: region.outer, closed: true, at: raw, value: '2', band: false, keep: true })
  }

  const offsetValue = offsetUi ? parseNum(offsetUi.value) ?? 0 : 0
  const offsetPreview = useMemo(() => (offsetUi ? offsetResult(offsetUi, offsetValue) : []), [offsetUi, offsetValue])
  const applyOffset = () => {
    if (!offsetUi || !offsetPreview.length) return
    const base = offsetUi.keep ? entities : entities.filter(e => !offsetUi.ids.includes(e.id))
    commit([...base, ...offsetPreview])
    setOffsetUi(null)
  }

  const filletRadius = filletUi ? parseNum(filletUi.value) ?? 0 : 0
  const filletPreview = useMemo(() => (filletUi && filletRadius > 0 ? filletCorner(entities, filletUi.at, filletRadius, filletUi.all) : null), [filletUi, filletRadius, entities])
  const applyFillet = () => {
    if (!filletPreview) return
    commit(filletPreview.entities)
    setFilletUi(null)
  }
  const nearestCorner = (raw: P): P | null => {
    let best: P | null = null, bd = 14 / (view.k || 1)
    for (const c of cornerCandidates(entities)) { const d = dist(c, raw); if (d < bd) { bd = d; best = c } }
    return best
  }
  const addPoint = (p: P) => {
    if (entities.some(e => e.type === 'point' && same(e.p, p))) return
    commit([...entities, { id: uid('e'), type: 'point', p }])
  }
  const midClick = (raw: P, snap: SnapResult) => {
    if (draft.length === 1) {
      if (dist(snap.p, draft[0]) > 1e-6) addPoint(mul(add(draft[0], snap.p), 0.5))
      setDraft([])
      return
    }
    if (POINT_SNAPS.includes(snap.kind)) { setDraft([snap.p]); return }
    const hit = hitEntity(raw)
    const mp = hit ? segmentMidpoint(hit, raw) : null
    if (mp) addPoint(mp)
  }

  // ── Pattern (rectangular / circular repetition of the selection) ──
  const patSrc = useMemo(() => (tool === 'pattern' ? entities.filter(e => selected.includes(e.id)) : []), [tool, entities, selected])
  const patC = useMemo(() => sourceCenter(patSrc), [patSrc])
  const patStep = useMemo(() => defaultStep(patSrc), [patSrc])
  const patDx = pat.dx ?? patStep[0]
  const patDy = pat.dy ?? patStep[1]
  const patCopies = useMemo(() => {
    if (tool !== 'pattern' || !patSrc.length) return []
    if (pat.mode === 'rect') return rectPattern(patSrc, pat.nx, pat.ny, patDx, patDy)
    return pat.centre ? circularPattern(patSrc, pat.centre, pat.count, pat.angle) : []
  }, [tool, patSrc, pat, patDx, patDy])
  /** Arrow handles of the rectangular pattern: they sit on the last copy of the row / column. */
  const patHandles = (): { x: P; y: P } => ({ x: [patC[0] + Math.max(pat.nx - 1, 1) * patDx, patC[1]], y: [patC[0], patC[1] + Math.max(pat.ny - 1, 1) * patDy] })
  /** Points of the source that can be the centre of a circular pattern (vertices, centres, quadrants, midpoints). */
  const patCandidates = useMemo(() => {
    const seen = new Set<string>(); const out: P[] = []
    for (const e of patSrc) for (const kp of keyPoints(e)) {
      const key = `${kp.p[0].toFixed(3)},${kp.p[1].toFixed(3)}`
      if (!seen.has(key)) { seen.add(key); out.push(kp.p) }
    }
    return out
  }, [patSrc])
  const patCandidateAt = (raw: P): P | null => {
    let best: P | null = null, bd = 16 / view.k
    for (const q of patCandidates) { const d = dist(q, raw); if (d < bd) { bd = d; best = q } }
    return best
  }
  const patHandleAt = (raw: P): 'x' | 'y' | null => {
    if (tool !== 'pattern' || pat.mode !== 'rect' || !patSrc.length) return null
    const h = patHandles()
    if (dist(h.x, raw) * view.k < 16) return 'x'
    if (dist(h.y, raw) * view.k < 16) return 'y'
    return null
  }
  const applyPattern = () => {
    if (!patCopies.length) return
    commit([...entities, ...patCopies])
    setSelected(patCopies.map(e => e.id))
    setTool('select')
  }

  // ── Mirror ──
  const mirrorAxisAt = (raw: P, snap: SnapResult): { axis: MirrorAxis; axisId?: string } | null => {
    const hit = hitEntity(raw)
    if (hit?.type === 'line' && !selected.includes(hit.id)) return { axis: { kind: 'line', a: hit.a, d: sub(hit.b, hit.a) }, axisId: hit.id }
    if (POINT_SNAPS.includes(snap.kind)) return { axis: { kind: 'point', p: snap.p } }
    return null
  }
  const applyMirror = (axis: MirrorAxis, exclude: string[] = []) => {
    commit(mirrorEntities(entities, selected, axis, mirrorKeep, exclude))
  }

  // ── Revolve (profile + axis; the solid is made in the scene) ──
  const revolving = tool === 'revolve'
  const revAngle = Math.max(1, Math.min(360, parseNum(rev.angle) ?? 360))
  const revProfile = useMemo(() => (revolving && rev.axis && selected.length ? profileFromSelection(entities, selected, rev.axis) : null), [revolving, rev.axis, selected, entities])
  const setRevolveAxis = (axis: RevolveAxis, label: string) => setRev(r => ({ ...r, axis, label, error: null }))
  const revRequest = (): RevolveRequest | null => (rev.axis && selected.length ? { entities, ids: selected, axis: rev.axis, angle: revAngle, mode: rev.mode } : null)
  // The 3D preview follows the picked shape, the axis and the angle.
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview
  useEffect(() => {
    if (!revolving || !rev.axis || !selected.length) { onPreviewRef.current(null); return }
    const err = onPreviewRef.current({ entities, ids: selected, axis: rev.axis, angle: revAngle, mode: rev.mode })
    setRev(r => (r.error === err ? r : { ...r, error: err }))
  }, [revolving, rev.axis, rev.mode, selected, entities, revAngle])
  useEffect(() => () => { onPreviewRef.current(null) }, [])
  const autoShown = useRef(false)
  useEffect(() => {
    if (revolving && rev.axis && selected.length && !autoShown.current) { autoShown.current = true; onShow3d(true) }
    if (!rev.axis) autoShown.current = false
  }, [revolving, rev.axis, selected.length, onShow3d])
  const doRevolve = () => {
    const req = revRequest()
    if (!req) return
    const err = onRevolve(req)
    if (err) setRev(r => ({ ...r, error: err }))
    else { setRev(r => ({ ...r, axis: null, label: '', step: 'shape', error: null })); setSelected([]) }
  }

  // ── Pointer ──
  const pointer = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return toSketch(e.clientX - r.left, e.clientY - r.top)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (view.k <= 0) return
    hostRef.current?.focus()
    if (e.button === 1 || e.button === 2) {
      panRef.current = { x: e.clientX, y: e.clientY, c: view.c }
      ;(e.target as Element).setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const raw = pointer(e)
    const snap = snapPoint(raw)
    if (e.shiftKey && (tool === 'select' || tool === 'mirror' || (tool === 'revolve' && rev.step === 'shape'))) {
      const one = selected.length === 1 ? entities.find(x => x.id === selected[0]) : undefined
      const onHandle = tool === 'select' && one && handlesOf(one).some(h => dist(h.p, raw) < 9 / view.k)
      if (!onHandle) {
        setMarquee({ a: raw, b: raw, moved: false })
        ;(e.target as Element).setPointerCapture(e.pointerId)
        return
      }
    }
    if (tool === 'select') {
      const sel1 = selected.length === 1 ? entities.find(x => x.id === selected[0]) : undefined
      const grab = sel1 && (sel1.type === 'bezier' || sel1.type === 'circle') ? handlesOf(sel1).find(h => dist(h.p, raw) < 9 / view.k) : undefined
      if (sel1 && grab) {
        setHandleDrag({ id: sel1.id, key: grab.key, p: grab.p })
        ;(e.target as Element).setPointerCapture(e.pointerId)
        return
      }
      const v = vertexAt(raw)
      if (v) {
        setEditDrag({ kind: 'vertex', from: v, to: v })
        ;(e.target as Element).setPointerCapture(e.pointerId)
        return
      }
      const hit = hitEntity(raw)
      if (hit) {
        if (selected.length > 1 && selected.includes(hit.id)) {
          setMoveDrag({ from: raw, delta: [0, 0], ids: selected })
        } else {
          setSelected([hit.id])
          setEditDrag({ kind: 'edge', id: hit.id, from: raw, to: raw })
        }
        ;(e.target as Element).setPointerCapture(e.pointerId)
        return
      }
      const region = smallestRegionAt(analysis.regions, raw)
      if (region) {
        // Inside a closed shape: select all of it; dragging moves it rigidly.
        const ids = entitiesOfRegion(entities, region.outer, region.holes)
        setSelected(ids)
        setMoveDrag({ from: raw, delta: [0, 0], ids })
        ;(e.target as Element).setPointerCapture(e.pointerId)
        return
      }
      setSelected([])
      setRegionSel([])
      return
    }
    if (tool === 'offset') { openOffset(raw); return }
    if (tool === 'trim') {
      const hit = hitEntity(raw)
      const r = hit ? trimEntity(entities, hit.id, raw) : null
      if (r) { commit(r.entities); setSelected([]) }
      return
    }
    if (tool === 'fillet') {
      const c = nearestCorner(raw)
      if (c) setFilletUi({ at: c, value: filletUi?.value ?? '2', all: filletUi?.all ?? false })
      return
    }
    if (tool === 'mid') { midClick(raw, snap); return }
    if (tool === 'mirror') {
      const c = mirrorAxisAt(raw, snap)
      if (c) applyMirror(c.axis, c.axisId ? [c.axisId] : [])
      return
    }
    if (tool === 'pattern') {
      if (pat.mode === 'rect' && patSrc.length) {
        const g = patHandleAt(raw)
        if (g) { setPatDrag(g); ;(e.target as Element).setPointerCapture(e.pointerId); return }
      } else if (pat.mode === 'circ' && patSrc.length) {
        setPat(p => ({ ...p, centre: patCandidateAt(raw) ?? snap.p }))
      }
      return
    }
    if (tool === 'revolve') {
      const hit = hitEntity(raw)
      if (rev.step === 'shape') {
        if (hit && hit.type !== 'point') setSelected(sel => (sel.includes(hit.id) ? sel.filter(i => i !== hit.id) : [...sel, hit.id]))
        return
      }
      if (hit?.type === 'line' && !selected.includes(hit.id)) {
        setRevolveAxis({ a: hit.a, d: sub(hit.b, hit.a) }, tl("linea ({0}, {1}) → ({2}, {3})", fmt(hit.a[0]), fmt(hit.a[1]), fmt(hit.b[0]), fmt(hit.b[1])))
      } else if (hit) setRev(r => ({ ...r, error: tl("L'asse non può far parte della forma da ruotare: clicca un'altra linea.") }))
      return
    }
    commitStep(snap.p)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const p = panRef.current
      setView(v => ({ ...v, c: [p.c[0] - (e.clientX - p.x) / v.k, p.c[1] + (e.clientY - p.y) / v.k] }))
      return
    }
    if (view.k <= 0) return
    const raw = pointer(e)
    lastRaw.current = raw
    setShift(e.shiftKey)
    const snap = snapPoint(raw)
    setCursor(snap)
    if (patDrag) {
      const n = Math.max((patDrag === 'x' ? pat.nx : pat.ny) - 1, 1)
      let v = (patDrag === 'x' ? raw[0] - patC[0] : raw[1] - patC[1]) / n
      if (grid > 0) v = Math.round(v / grid) * grid
      v = Math.round(v * 100) / 100
      setPat(p => (patDrag === 'x' ? { ...p, dx: v } : { ...p, dy: v }))
    }
    if (marquee) setMarquee({ ...marquee, b: raw, moved: marquee.moved || dist(raw, marquee.a) * view.k > 3 })
    if (handleDrag) setHandleDrag({ ...handleDrag, p: snap.p })
    if (editDrag) {
      if (editDrag.kind === 'vertex') setEditDrag({ ...editDrag, to: snap.p })
      else {
        let d = sub(raw, editDrag.from)
        if (grid > 0) d = [Math.round(d[0] / grid) * grid, Math.round(d[1] / grid) * grid]
        setEditDrag({ ...editDrag, to: add(editDrag.from, d) })
      }
    }
    if (moveDrag) {
      let d = sub(raw, moveDrag.from)
      if (grid > 0) d = [Math.round(d[0] / grid) * grid, Math.round(d[1] / grid) * grid]
      setMoveDrag({ ...moveDrag, delta: d })
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (panRef.current) { panRef.current = null; return }
    if (patDrag) {
      setPatDrag(null)
      try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* not captured */ }
      return
    }
    if (editDrag) {
      if (editPreview) commit(editPreview)
      setEditDrag(null)
      try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* not captured */ }
      return
    }
    if (marquee) {
      if (marquee.moved) {
        const rect = { min: [Math.min(marquee.a[0], marquee.b[0]), Math.min(marquee.a[1], marquee.b[1])] as P, max: [Math.max(marquee.a[0], marquee.b[0]), Math.max(marquee.a[1], marquee.b[1])] as P }
        const crossing = marquee.b[0] < marquee.a[0]
        const ids = entities.filter(x => (tool !== 'revolve' || x.type !== 'point') && entityInRect(x, rect, crossing)).map(x => x.id)
        setSelected(sel => [...new Set([...sel, ...ids])])
      } else {
        const hit = hitEntity(marquee.a)
        if (hit) setSelected(sel => (sel.includes(hit.id) ? sel.filter(i => i !== hit.id) : [...sel, hit.id]))
        else if (tool === 'select') {
          const region = smallestRegionAt(analysis.regions, marquee.a)
          if (region) setRegionSel(sel => (sel.includes(region.key) ? sel.filter(k => k !== region.key) : [...sel, region.key]))
        }
      }
      setMarquee(null)
      try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* not captured */ }
      return
    }
    if (handleDrag) {
      const ent = entities.find(x => x.id === handleDrag.id)
      const old = ent ? handlesOf(ent).find(h => h.key === handleDrag.key)?.p : undefined
      if (ent && old && dist(old, handleDrag.p) > 1e-9) {
        let next = entities.map(x => (x.id === ent.id ? applyHandle(x, handleDrag.key, handleDrag.p) : x))
        if (ent.type === 'line' || ent.type === 'polyline') next = moveCoincident(next, old, handleDrag.p, ent.id)
        commit(next)
      }
      setHandleDrag(null)
      try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    }
    if (moveDrag) {
      if (len(moveDrag.delta) > 1e-9) commit(entities.map(en => (moveDrag.ids.includes(en.id) ? translateEntity(en, moveDrag.delta) : en)))
      setMoveDrag(null)
      try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    }
  }

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      setView(v => {
        const k = Math.max(0.3, Math.min(200, v.k * Math.exp(-e.deltaY * 0.0015)))
        const before: P = [v.c[0] + (sx - size.w / 2) / v.k, v.c[1] - (sy - size.h / 2) / v.k]
        return { k, c: [before[0] - (sx - size.w / 2) / k, before[1] + (sy - size.h / 2) / k] }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size])

  // ── Keyboard ──
  const deleteSelected = () => {
    if (!selected.length) return
    commit(entities.filter(e => !selected.includes(e.id)))
    setSelected([])
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(e.type === 'keydown')
      if (e.type !== 'keydown') return
      const el = e.target
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      e.stopPropagation()
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      else if (e.key === 'Escape') {
        if (quickEdit) setQuickEdit(null)
        else if (menuFor) setMenuFor(null)
        else if (offsetUi) setOffsetUi(null)
        else if (filletUi) setFilletUi(null)
        else if (draft.length) { setDraft([]); setDimText([]) }
        else if (selected.length || regionSel.length) { setSelected([]); setRegionSel([]) }
        else setTool('select')
      } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected() }
      else if (e.key === 'Enter') {
        if (tool === 'revolve' && rev.step === 'shape' && selected.length) setRev(r => ({ ...r, step: 'axis', error: null }))
        else if (tool === 'curve' && modes.curve === 'spline' && draft.length) finishSpline(draft)
        else if (tool === 'line' && draft.length) setDraft([])
        else if (tool === 'pattern') applyPattern()
      }
      else if (e.key === 'Tab') {
        e.preventDefault()
        if (draft.length && pv && pv.labels.length) requestAnimationFrame(() => { const i = dimRefs.current[0]; if (i) { i.focus(); i.select() } })
        else if (selected.length === 1) openQuickEdit(selected[0])
      }
      else if (e.key === 'F8') { e.preventDefault(); setOrtho(o => !o) }
      else if (e.key === 'F9') { e.preventDefault(); setConstrained(c => !c) }
      else if (!mod && /^[0-9.,-]$/.test(e.key) && draft.length && pv && pv.labels.length) {
        e.preventDefault()
        setDimText([e.key === ',' ? '.' : e.key])
        requestAnimationFrame(() => {
          const input = dimRefs.current[0]
          if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }
        })
      } else if (!mod && k === 'f') fit()
      else if (!mod && k === 'q') setShowDims(v => !v)
      else if (!mod && e.key === '3' && !draft.length) onShow3d(!show3d)
      else if (!mod && TOOL_KEYS[k]) setTool(TOOL_KEYS[k])
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  })

  // ── Drawing ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || view.k <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr)
      canvas.height = Math.round(size.h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    const k = view.k
    const S = toScreen
    const ents = editPreview ?? entities
    const an = previewAnalysis ?? analysis

    // Millimetre paper over the faded scene.
    ctx.fillStyle = 'rgba(250, 252, 255, 0.78)'
    ctx.fillRect(0, 0, size.w, size.h)
    const tl0 = toSketch(0, 0), br0 = toSketch(size.w, size.h)
    let base = 1
    while (base * k < 5) base *= 10
    const drawGrid = (step: number, color: string, width: number) => {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = width
      for (let x = Math.ceil(tl0[0] / step) * step; x <= br0[0]; x += step) { const sx = Math.round(S([x, 0])[0]) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, size.h) }
      for (let y = Math.ceil(br0[1] / step) * step; y <= tl0[1]; y += step) { const sy = Math.round(S([0, y])[1]) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(size.w, sy) }
      ctx.stroke()
    }
    drawGrid(base, 'rgba(56, 120, 190, 0.13)', 1)
    if (base * 5 * k >= 12) drawGrid(base * 5, 'rgba(56, 120, 190, 0.22)', 1)
    drawGrid(base * 10, 'rgba(56, 120, 190, 0.38)', 1)
    // Axes through the sketch origin.
    const o = S([0, 0])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)'
    ctx.beginPath(); ctx.moveTo(0, o[1]); ctx.lineTo(size.w, o[1]); ctx.stroke()
    ctx.strokeStyle = 'rgba(34, 160, 94, 0.75)'
    ctx.beginPath(); ctx.moveTo(o[0], 0); ctx.lineTo(o[0], size.h); ctx.stroke()

    // Scene edges on the plane.
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.7)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (const [a, b] of refs) { const sa = S(a), sb = S(b); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]) }
    ctx.stroke()
    ctx.setLineDash([])

    // Closed profiles: faint fill; selected ones strong.
    const fillRegion = (r: Region, color: string) => {
      ctx.beginPath()
      for (const loop of [r.outer, ...r.holes]) loop.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]) })
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill('evenodd')
    }
    const hoverRegion = tool === 'select' && cursor && !moveDrag ? smallestRegionAt(an.regions, lastRaw.current ?? cursor.p) : null
    for (const r of an.regions) {
      const sel = regionSel.includes(r.key)
      fillRegion(r, sel ? 'rgba(37, 99, 235, 0.32)' : r === hoverRegion ? 'rgba(37, 99, 235, 0.14)' : 'rgba(37, 99, 235, 0.06)')
    }

    const strokeEntity = (e: SketchEntity, color: string, width: number, dash: number[] = []) => {
      const { pts, closed } = tessellate(e)
      ctx.beginPath()
      pts.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]) })
      if (closed) ctx.closePath()
      ctx.setLineDash(dash)
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.stroke()
      ctx.setLineDash([])
    }
    const moving = moveDrag && len(moveDrag.delta) > 0 ? new Set(moveDrag.ids) : null
    for (const e of ents) {
      const shown = moving?.has(e.id) ? translateEntity(e, moveDrag!.delta) : handleDrag?.id === e.id ? applyHandle(e, handleDrag.key, handleDrag.p) : e
      const sel = selected.includes(e.id)
      const open = an.openEntityIds.has(e.id)
      strokeEntity(shown, sel && tool === 'revolve' ? '#7c3aed' : sel ? '#2563eb' : open ? '#ea580c' : '#1e293b', sel ? (tool === 'revolve' ? 3.6 : 2.6) : 1.7)
    }
    const label = (text: string, at: P, color = '#334155', bg = 'rgba(255,255,255,0.9)') => {
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      const w = ctx.measureText(text).width + 8
      ctx.fillStyle = bg
      ctx.beginPath(); ctx.roundRect(at[0] - w / 2, at[1] - 9, w, 18, 6); ctx.fill()
      ctx.fillStyle = color
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(text, at[0], at[1] + 0.5)
    }
    // Vertex / control-point handles of the selected entity.
    if (tool === 'select' && selected.length === 1) {
      const ent = entities.find(x => x.id === selected[0])
      if (ent) {
        const shown = handleDrag?.id === ent.id ? applyHandle(ent, handleDrag.key, handleDrag.p) : ent
        if (shown.type === 'bezier') {
          ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(37,99,235,0.6)'; ctx.lineWidth = 1
          for (const [i, j] of [[0, 1], [3, 2]]) { const a = S(shown.pts[i]), b = S(shown.pts[j]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke() }
          ctx.setLineDash([])
        }
        for (const h of handlesOf(shown)) {
          const sp = S(h.p)
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2
          ctx.beginPath()
          if (shown.type === 'bezier' && (h.key === '1' || h.key === '2')) ctx.arc(sp[0], sp[1], 4.5, 0, Math.PI * 2)
          else ctx.rect(sp[0] - 4.5, sp[1] - 4.5, 9, 9)
          ctx.fill(); ctx.stroke()
        }
      }
    }
    // Parametric editing hover: the vertex or edge that a drag will change.
    if (tool === 'select' && !editDrag && !moveDrag && !marquee && lastRaw.current) {
      const v = vertexAt(lastRaw.current)
      if (v) {
        const sp = S(v)
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(37,99,235,0.18)'; ctx.fill()
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.stroke()
      } else {
        const hit = hitEntity(lastRaw.current)
        if (hit && !(selected.length > 1 && selected.includes(hit.id))) strokeEntity(hit, 'rgba(37,99,235,0.45)', 5)
      }
    }
    if (editDrag?.kind === 'vertex') {
      const sp = S(editDrag.to)
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 6, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill()
    }
    // Construction points.
    for (const e of ents) {
      if (e.type !== 'point') continue
      const sp = S(e.p), sel = selected.includes(e.id)
      ctx.strokeStyle = sel ? '#2563eb' : '#0d9488'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(sp[0] - 5, sp[1]); ctx.lineTo(sp[0] + 5, sp[1]); ctx.moveTo(sp[0], sp[1] - 5); ctx.lineTo(sp[0], sp[1] + 5); ctx.stroke()
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 2.4, 0, Math.PI * 2); ctx.fillStyle = sel ? '#2563eb' : '#0d9488'; ctx.fill()
    }
    if (tool === 'trim' && lastRaw.current) {
      const hit = hitEntity(lastRaw.current)
      const r = hit ? trimEntity(entities, hit.id, lastRaw.current) : null
      if (r && r.removed.length) {
        ctx.beginPath()
        r.removed.forEach((p, i) => { const sp = S(p); if (i) ctx.lineTo(sp[0], sp[1]); else ctx.moveTo(sp[0], sp[1]) })
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'
      }
    }
    if (tool === 'fillet') {
      const corner = filletUi ? filletUi.at : lastRaw.current ? nearestCorner(lastRaw.current) : null
      if (corner) { const sp = S(corner); ctx.beginPath(); ctx.arc(sp[0], sp[1], 8, 0, Math.PI * 2); ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2; ctx.stroke() }
      if (filletPreview) for (const e of filletPreview.entities) if (!entities.includes(e) && e.type === 'arc') strokeEntity(e, '#7c3aed', 3)
    }
    if (tool === 'mid') {
      ctx.fillStyle = 'rgba(13, 148, 136, 0.9)'
      for (const e of entities) for (const kp of keyPoints(e)) {
        if (kp.kind !== 'mid') continue
        const sp = S(kp.p)
        ctx.beginPath(); ctx.moveTo(sp[0], sp[1] - 5); ctx.lineTo(sp[0] + 5, sp[1] + 4); ctx.lineTo(sp[0] - 5, sp[1] + 4); ctx.closePath(); ctx.fill()
      }
      if (draft.length === 1 && cursor) {
        const a = S(draft[0]), b = S(cursor.p), m = S(mul(add(draft[0], cursor.p), 0.5))
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(m[0], m[1], 5, 0, Math.PI * 2); ctx.fillStyle = '#0d9488'; ctx.fill()
        label(fmt(dist(draft[0], cursor.p) / 2), [m[0], m[1] - 16], '#0f766e')
      }
    }

    // Free ends: where a profile does not close.
    for (const p of an.openPoints) {
      const s = S(p)
      ctx.beginPath(); ctx.arc(s[0], s[1], 4, 0, Math.PI * 2)
      ctx.fillStyle = '#dc2626'; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
    }

    // Dimensions.
    const dimsOf = (e: SketchEntity, color?: string) => {
      switch (e.type) {
        case 'line': {
          const a = S(e.a), b = S(e.b)
          if (dist(a, b) < 36) return
          const n = norm([-(b[1] - a[1]), b[0] - a[0]])
          label(fmt(dist(e.a, e.b)), add(mul(add(a, b), 0.5), mul(n, 13)), color)
          return
        }
        case 'rect': {
          const c = rectCorners(e.a, e.b).map(S)
          if (Math.abs(c[1][0] - c[0][0]) > 36) label(fmt(Math.abs(e.b[0] - e.a[0])), [(c[0][0] + c[1][0]) / 2, c[0][1] + 13], color)
          if (Math.abs(c[2][1] - c[1][1]) > 30) label(fmt(Math.abs(e.b[1] - e.a[1])), [c[1][0] + 8 + ctx.measureText(fmt(Math.abs(e.b[1] - e.a[1]))).width / 2, (c[1][1] + c[2][1]) / 2], color)
          return
        }
        case 'circle': if (e.r * k > 14) label(`Ø ${fmt(e.r * 2)}`, S(e.c), color); return
        case 'arc': if (e.r * k > 14) label(`R ${fmt(e.r)}`, S(polar(e.c, e.r * 0.6, e.a0 + arcSweep(e.a0, e.a1) / 2)), color); return
        case 'ellipse': if (Math.min(e.rx, e.ry) * k > 14) label(`${fmt(e.rx * 2)} × ${fmt(e.ry * 2)}`, S(e.c), color); return
        case 'polygon': if (e.r * k > 18) label(`${e.n} · R ${fmt(e.r)}`, S(e.c), color); return
        default:
      }
    }
    if (showDims) for (const e of ents) if (!moving?.has(e.id)) dimsOf(e)

    // Offset preview.
    if (offsetUi) {
      for (const e of offsetPreview) strokeEntity(e, '#7c3aed', 2, [6, 4])
      for (const id of offsetUi.ids) { const e = entities.find(x => x.id === id); if (e) strokeEntity(e, '#7c3aed', 2.6) }
    }

    // Mirror preview and revolve axis.
    if (tool === 'mirror' && lastRaw.current && cursor) {
      const cand = mirrorAxisAt(lastRaw.current, cursor)
      if (cand) {
        const src = (selected.length ? entities.filter(x => selected.includes(x.id)) : entities).filter(x => x.id !== cand.axisId)
        for (const x of src) strokeEntity(mirrorEntity(x, cand.axis, 'ghost'), '#7c3aed', 2, [6, 4])
        if (cand.axis.kind === 'line') {
          const a = S(add(cand.axis.a, mul(norm(cand.axis.d), -1e4))), b = S(add(cand.axis.a, mul(norm(cand.axis.d), 1e4)))
          ctx.setLineDash([9, 5]); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([])
        } else {
          const c = S(cand.axis.p); ctx.beginPath(); ctx.arc(c[0], c[1], 8, 0, Math.PI * 2); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2; ctx.stroke()
        }
      }
    }
    if (tool === 'pattern' && patSrc.length) {
      for (const e of patCopies) strokeEntity(e, '#7c3aed', 2, [6, 4])
      for (const e of patSrc) strokeEntity(e, '#7c3aed', 2.6)
      // A real grip: white disc with violet rim and a double chevron; grows and fills violet under the pointer.
      const grip = (from: P, at: P, axis: 'x' | 'y', label: string, active: boolean) => {
        const a = S(from), b = S(at)
        ctx.setLineDash([]); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
        ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.arc(a[0], a[1], 3.5, 0, Math.PI * 2); ctx.fill()
        const r = active ? 17 : 14
        ctx.save()
        ctx.shadowColor = 'rgba(76, 29, 149, 0.45)'; ctx.shadowBlur = active ? 14 : 8; ctx.shadowOffsetY = 2
        ctx.beginPath(); ctx.arc(b[0], b[1], r, 0, Math.PI * 2)
        ctx.fillStyle = active ? '#7c3aed' : '#ffffff'; ctx.fill()
        ctx.restore()
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#7c3aed'; ctx.beginPath(); ctx.arc(b[0], b[1], r, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = active ? '#ffffff' : '#7c3aed'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        const [ux, uy] = axis === 'x' ? [1, 0] : [0, -1]
        for (const sgn of [-1, 1]) {
          const tip: P = [b[0] + sgn * ux * 8, b[1] + sgn * uy * 8]
          const base: P = [b[0] + sgn * ux * 3.5, b[1] + sgn * uy * 3.5]
          ctx.beginPath()
          ctx.moveTo(base[0] - uy * 5, base[1] + ux * 5); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(base[0] + uy * 5, base[1] - ux * 5)
          ctx.stroke()
        }
        // Value pill.
        ctx.font = '700 11px sans-serif'
        const w = ctx.measureText(label).width + 14
        const lx = b[0] + (axis === 'x' ? -w / 2 : r + 6), ly = b[1] + (axis === 'x' ? -r - 26 : -10)
        ctx.fillStyle = '#4c1d95'; ctx.beginPath(); ctx.roundRect(lx, ly, w, 20, 10); ctx.fill()
        ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx + 7, ly + 10); ctx.textBaseline = 'alphabetic'
      }
      if (pat.mode === 'rect') {
        const h = patHandles()
        const over = patDrag ?? (lastRaw.current ? patHandleAt(lastRaw.current) : null)
        grip(patC, h.x, 'x', `${fmt(patDx)} mm`, over === 'x')
        grip(patC, h.y, 'y', `${fmt(patDy)} mm`, over === 'y')
      } else {
        // Candidate centres: every vertex / centre of the shape to duplicate, the pointed one lit up.
        const hot = lastRaw.current ? patCandidateAt(lastRaw.current) : null
        for (const q of patCandidates) {
          const c = S(q); const isHot = hot === q
          ctx.setLineDash([]); ctx.beginPath(); ctx.arc(c[0], c[1], isHot ? 10 : 7, 0, Math.PI * 2)
          ctx.fillStyle = isHot ? 'rgba(124, 58, 237, 0.85)' : 'rgba(255,255,255,0.9)'; ctx.fill()
          ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2.2; ctx.stroke()
        }
        if (pat.centre) {
          const c = S(pat.centre)
          ctx.setLineDash([]); ctx.strokeStyle = '#4c1d95'; ctx.lineWidth = 2.4
          ctx.beginPath(); ctx.arc(c[0], c[1], 9, 0, Math.PI * 2); ctx.moveTo(c[0] - 15, c[1]); ctx.lineTo(c[0] + 15, c[1]); ctx.moveTo(c[0], c[1] - 15); ctx.lineTo(c[0], c[1] + 15); ctx.stroke()
          ctx.fillStyle = '#4c1d95'; ctx.beginPath(); ctx.arc(c[0], c[1], 3, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    if (tool === 'revolve') {
      // The exact shape that will rotate: picked closed shapes, plus open curves closed against the axis (dashed).
      if (revProfile) {
        for (const r of revProfile.regions) fillRegion(r, 'rgba(124, 58, 237, 0.22)')
        ctx.setLineDash([6, 4]); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2
        for (const [p, q] of revProfile.closing) { const a = S(p), b = S(q); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke() }
        ctx.setLineDash([])
      }
      if (rev.axis) {
        const a = S(add(rev.axis.a, mul(norm(rev.axis.d), -1e4))), b = S(add(rev.axis.a, mul(norm(rev.axis.d), 1e4)))
        ctx.setLineDash([14, 5, 3, 5]); ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2.4
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([])
        const mid = S(add(rev.axis.a, mul(rev.axis.d, 0.5)))
        label(tl("ASSE"), [mid[0] + 22, mid[1] - 14], '#c2410c', 'rgba(255,237,213,0.95)')
      }
      if (lastRaw.current) {
        const hit = hitEntity(lastRaw.current)
        const ok = rev.step === 'shape' ? hit && hit.type !== 'point' : hit?.type === 'line' && !selected.includes(hit.id)
        if (hit && ok) strokeEntity(hit, rev.step === 'shape' ? '#7c3aed' : '#ea580c', 4)
      }
    }
    if (marquee?.moved) {
      const a = S(marquee.a), b = S(marquee.b)
      const crossing = marquee.b[0] < marquee.a[0]
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5
      ctx.strokeStyle = crossing ? '#16a34a' : '#2563eb'; ctx.fillStyle = crossing ? 'rgba(22,163,74,0.12)' : 'rgba(37,99,235,0.12)'
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
      ctx.setLineDash([])
    }

    // Shape being drawn.
    if (pv) {
      if (pv.guides) {
        ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(37,99,235,0.5)'; ctx.lineWidth = 1
        for (const [p, q] of pv.guides) { const sa = S(p), sb = S(q); ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]); ctx.stroke() }
        ctx.setLineDash([])
      }
      for (const e of pv.ents) strokeEntity(e, '#2563eb', 2, [7, 4])
    }
    for (const [i, p] of draft.entries()) {
      const sp = S(p)
      ctx.fillStyle = '#2563eb'
      if (tool === 'curve' && modes.curve !== 'spline' && ((modes.curve === 'bezier3' && (i === 1 || i === 2)) || (modes.curve === 'bezier2' && i === 1))) {
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 4, 0, Math.PI * 2); ctx.fill()
      } else ctx.fillRect(sp[0] - 3, sp[1] - 3, 6, 6)
    }

    // Constrained mode: suggested anchors and the vertices that produced the inference.
    if (constrained && cursor && tool !== 'select' && cursor.suggest) {
      ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(234, 88, 12, 0.75)'
      for (const p of cursor.suggest) { const sp = S(p); ctx.beginPath(); ctx.arc(sp[0], sp[1], 4, 0, Math.PI * 2); ctx.stroke() }
    }
    if (cursor?.sources) {
      ctx.fillStyle = 'rgba(234, 88, 12, 0.9)'
      for (const p of cursor.sources) { const sp = S(p); ctx.beginPath(); ctx.arc(sp[0], sp[1], 3, 0, Math.PI * 2); ctx.fill() }
    }

    // Snap guides and marker.
    if (cursor && tool !== 'select') {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(234, 88, 12, 0.8)'; ctx.lineWidth = 1
      for (const [a, b] of cursor.guides) { const sa = S(a), sb = S(b); ctx.beginPath(); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]); ctx.stroke() }
      ctx.setLineDash([])
      const s = S(cursor.p)
      ctx.strokeStyle = '#ea580c'; ctx.fillStyle = 'rgba(234, 88, 12, 0.18)'; ctx.lineWidth = 1.8
      ctx.beginPath()
      switch (cursor.kind) {
        case 'end': case 'reference': ctx.rect(s[0] - 5, s[1] - 5, 10, 10); break
        case 'mid': ctx.moveTo(s[0], s[1] - 6); ctx.lineTo(s[0] + 6, s[1] + 5); ctx.lineTo(s[0] - 6, s[1] + 5); ctx.closePath(); break
        case 'center': case 'origin': ctx.arc(s[0], s[1], 6, 0, Math.PI * 2); ctx.moveTo(s[0] - 3, s[1]); ctx.lineTo(s[0] + 3, s[1]); ctx.moveTo(s[0], s[1] - 3); ctx.lineTo(s[0], s[1] + 3); break
        case 'quadrant': ctx.moveTo(s[0], s[1] - 6); ctx.lineTo(s[0] + 6, s[1]); ctx.lineTo(s[0], s[1] + 6); ctx.lineTo(s[0] - 6, s[1]); ctx.closePath(); break
        case 'intersection': ctx.moveTo(s[0] - 5, s[1] - 5); ctx.lineTo(s[0] + 5, s[1] + 5); ctx.moveTo(s[0] + 5, s[1] - 5); ctx.lineTo(s[0] - 5, s[1] + 5); break
        case 'curve': ctx.arc(s[0], s[1], 4, 0, Math.PI * 2); break
        default: ctx.moveTo(s[0] - 6, s[1]); ctx.lineTo(s[0] + 6, s[1]); ctx.moveTo(s[0], s[1] - 6); ctx.lineTo(s[0], s[1] + 6)
      }
      if (cursor.kind !== 'intersection' && cursor.kind !== 'grid' && cursor.kind !== 'free' && cursor.kind !== 'axis') ctx.fill()
      ctx.stroke()
    }
  })

  // ── Inspector ──
  const single = selected.length === 1 ? entities.find(e => e.id === selected[0]) ?? null : null
  const updateEntity = (id: string, fn: (e: SketchEntity) => SketchEntity, keepJoined?: { old: P; next: P }[]) => {
    let next = entities.map(e => (e.id === id ? fn(e) : e))
    for (const j of keepJoined ?? []) next = moveCoincident(next, j.old, j.next, id)
    commit(next)
  }

  const projectRefs = () => {
    const existing = entities.filter((e): e is Extract<SketchEntity, { type: 'line' }> => e.type === 'line')
    const fresh = refs
      .filter(([a, b]) => dist(a, b) > 1e-4 && !existing.some(l => (same(l.a, a) && same(l.b, b)) || (same(l.a, b) && same(l.b, a))))
      .map(([a, b]): SketchEntity => ({ id: uid('e'), type: 'line', a, b }))
    if (fresh.length) commit([...entities, ...fresh])
  }

  const modeHint = modeTool ? MODE_OPTIONS[modeTool].find(o => o.id === modes[modeTool])?.hint ?? '' : ''
  const stepInfo = isDrawTool && typeof need === 'number' ? ` (${Math.min(draft.length + 1, need)}/${need})` : ''
  const hint = (() => {
    if (offsetUi) return tl("Offset: scrivi la distanza (positiva = verso l'esterno) e premi Invio")
    switch (tool) {
      case 'select': return tl("Trascina un vertice o un lato per modificarlo · Tab o doppio clic = quote del tratto · clic dentro una forma per spostarla tutta · Shift + trascina = selezione rettangolare · Canc elimina")
      case 'line': return draft.length ? tl("Clic per il punto successivo · digita la lunghezza (Tab = angolo) · Shift = 15° · clic sul primo punto per chiudere · doppio clic/Esc termina") : tl("Clic per il primo punto della linea")
      case 'rect': case 'circle': case 'arc': return `${modeHint}${stepInfo}${draft.length ? tl(" · digita le quote") : ''}`
      case 'curve': return `${modeHint}${stepInfo}`
      case 'ellipse': return draft.length ? tl("Clic per i semiassi · digita semiasse X (Tab = Y)") : tl("Clic sul centro")
      case 'polygon': return draft.length ? tl("Clic su un vertice · digita il raggio") : tl("Clic sul centro del poligono")
      case 'offset': return tl("Clic su un tratto o dentro un profilo da copiare a distanza")
      case 'trim': return tl("Passa su un tratto: la parte rossa tra le intersezioni viene eliminata con un clic (senza intersezioni sparisce tutto il tratto)")
      case 'fillet': return filletUi ? tl("Scrivi il raggio e premi Invio · «Tutti gli angoli» raccorda l'intero contorno") : tl("Clic su un angolo tra due linee (rettangoli e poligoni inclusi) per arrotondarlo")
      case 'mid': return draft.length ? tl("Clic sul secondo punto: aggiungo il punto medio tra i due") : tl("Clic su un tratto per segnare il suo punto medio, oppure su due punti per trovare quello in mezzo")
      case 'mirror': return tl("Clic su una linea (asse di simmetria) o su un punto (simmetria centrale) · prima seleziona i tratti da specchiare, altrimenti vale tutto lo sketch")
      case 'pattern': return !selected.length ? tl("Prima seleziona l'oggetto da ripetere (strumento Seleziona), poi torna qui") : pat.mode === 'rect' ? tl("Trascina le due frecce per distribuire le copie (verso destra/sinistra, alto/basso) o scrivi il passo nel pannello · Invio = applica") : pat.centre ? tl("Cambia il numero di copie o clicca un altro punto per spostare il centro · Invio = applica") : tl("Clicca il vertice (o il punto) attorno a cui ruotare le copie")
      case 'revolve': return rev.step === 'shape' ? tl("Passo 1: seleziona i segmenti e le curve da ruotare (clic, oppure Shift + trascina) · Invio = avanti") : rev.axis ? tl("Passo 3: regola l'angolo e premi «Rivoluziona»") : tl("Passo 2: clicca la linea che farà da asse di rotazione")
    }
  })()

  // Floating dimension inputs next to the shape being drawn.
  const dimAnchor = pv && cursor ? toScreen(cursor.p) : null
  const offsetAnchor = offsetUi ? toScreen(offsetUi.at) : null

  const sectionTitle = (text: string) => <p className="text-[10px] font-semibold text-slate-500">{text}</p>
  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-200 p-3">
        <p className="text-sm font-semibold text-slate-900">{tl("Sketch 2D")}</p>
        <p className="text-[11px] text-slate-500">{planeLabel}</p>
        <p className="mt-1 text-[10px] text-emerald-700">{tl("Salvato nella scena mentre disegni")}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] leading-4">
          <p className={analysis.regions.length ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
            {analysis.regions.length === 1 ? tl("1 profilo chiuso") : analysis.regions.length ? tl("{0} profili chiusi", analysis.regions.length) : tl("Nessun profilo chiuso")}
          </p>
          {analysis.openEntityIds.size > 0 && (
            <p className="text-orange-700">{analysis.openEntityIds.size === 1
              ? tl("1 tratto aperto (arancione): non può diventare un solido finché non chiude un'area. I punti rossi sono gli estremi liberi.")
              : tl("{0} tratti aperti (arancioni): non possono diventare solidi finché non chiudono un'area. I punti rossi sono gli estremi liberi.", analysis.openEntityIds.size)}</p>
          )}
        </div>

        {single && tool !== 'revolve' && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              {sectionTitle(tl("Quote del tratto selezionato"))}
              <button type="button" onClick={deleteSelected} title={tl("Elimina (Canc)")} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <EntityInspector key={single.id + JSON.stringify(single)} e={single} update={updateEntity} />
          </div>
        )}
        {selected.length > 1 && tool !== 'revolve' && (
          <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
            {tl("{0} tratti selezionati · trascina per spostarli", selected.length)}
            <button type="button" onClick={deleteSelected} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {tool === 'pattern' && (
          <div className="space-y-2 rounded-lg bg-violet-50/70 p-2">
            {sectionTitle(tl("Ripetizione"))}
            {!selected.length ? (
              <p className="text-[11px] leading-4 text-slate-600">{tl("Seleziona prima l'oggetto (o più tratti) da ripetere con lo strumento Seleziona, poi scegli «Ripeti».")}</p>
            ) : (
              <>
                <p className="text-[11px] leading-4 text-slate-600">{tl("Ripeto {0} tratti selezionati.", selected.length)}</p>
                <Segmented<PatternMode>
                  value={pat.mode}
                  onChange={m => setPat(p => ({ ...p, mode: m }))}
                  options={[['rect', tl("Rettangolare"), tl("Griglia di colonne e righe")], ['circ', tl("Circolare"), tl("Copie equidistanti attorno a un vertice")]]}
                />
                {pat.mode === 'rect' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Num label={tl("Colonne")} value={pat.nx} suffix="" step={1} min={1} onCommit={v => setPat(p => ({ ...p, nx: Math.max(1, Math.min(50, Math.round(v))) }))} />
                    <Num label={tl("Righe")} value={pat.ny} suffix="" step={1} min={1} onCommit={v => setPat(p => ({ ...p, ny: Math.max(1, Math.min(50, Math.round(v))) }))} />
                    <Num label={tl("Passo X (− = sinistra)")} value={patDx} step={1} onCommit={v => setPat(p => ({ ...p, dx: v }))} />
                    <Num label={tl("Passo Y (− = basso)")} value={patDy} step={1} onCommit={v => setPat(p => ({ ...p, dy: v }))} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] leading-4 text-slate-600">{pat.centre ? tl("Centro: ({0}, {1})", fmt(pat.centre[0]), fmt(pat.centre[1])) : tl("Clicca nello sketch il vertice attorno a cui ruotare.")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label={tl("Copie totali")} value={pat.count} suffix="" step={1} min={2} onCommit={v => setPat(p => ({ ...p, count: Math.max(2, Math.min(MAX_COPIES, Math.round(v))) }))} />
                      <Num label={tl("Angolo totale")} value={pat.angle} suffix="°" step={15} onCommit={v => setPat(p => ({ ...p, angle: v }))} />
                    </div>
                    <p className="text-[10px] leading-4 text-slate-500">{tl("360° = copie equidistanti su tutto il giro; meno = distribuite tra la prima e l'ultima.")}</p>
                  </div>
                )}
                <Button type="button" tone="accent" surface="solid" density="compact" className="w-full rounded-full" disabled={!patCopies.length} onClick={applyPattern}><Check /> {tl("Applica ({0} copie)", patCopies.length / Math.max(patSrc.length, 1))}</Button>
              </>
            )}
          </div>
        )}

        {tool === 'mirror' && (
          <div className="space-y-2 rounded-lg bg-violet-50/70 p-2">
            {sectionTitle(tl("Specchio"))}
            <p className="text-[11px] leading-4 text-slate-600">
              {selected.length ? tl("Specchio di {0} tratti selezionati.", selected.length) : tl("Nessun tratto selezionato: si specchia tutto lo sketch (la linea scelta come asse resta com'è).")}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <Button type="button" tone="neutral" surface="solid" density="compact" className="rounded-full" onClick={() => applyMirror({ kind: 'line', a: [0, 0], d: [1, 0] })}>{tl("Asse X")}</Button>
              <Button type="button" tone="neutral" surface="solid" density="compact" className="rounded-full" onClick={() => applyMirror({ kind: 'line', a: [0, 0], d: [0, 1] })}>{tl("Asse Y")}</Button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <input type="checkbox" checked={mirrorKeep} onChange={e => setMirrorKeep(e.target.checked)} /> {tl("Mantieni l'originale")}
            </label>
            <p className="text-[10px] leading-4 text-slate-500">{tl("Oppure clicca nello sketch: su una linea = asse di simmetria, su un vertice/punto = simmetria rispetto a quel punto.")}</p>
          </div>
        )}

        {tool === 'revolve' && (
          <div className="space-y-2 rounded-xl bg-violet-50/70 p-2">
            {sectionTitle(tl("Solido di rotazione"))}
            <RevStep n={1} state={rev.step === 'shape' ? 'active' : selected.length ? 'done' : 'todo'} title={tl("Seleziona i segmenti e le curve da ruotare")}>
              <p className="text-[11px] leading-4 text-slate-600">
                {tl("Clicca i tratti uno a uno oppure Shift + trascina per selezionarne molti. Una forma aperta (es. il profilo di un vaso) viene chiusa da sola contro l'asse.")}
              </p>
              <p className={`text-[11px] font-semibold ${selected.length ? 'text-violet-700' : 'text-slate-500'}`}>
                {selected.length === 0 ? tl("Nessun tratto selezionato") : selected.length === 1 ? tl("1 tratto selezionato") : tl("{0} tratti selezionati", selected.length)}
              </p>
              {rev.step === 'shape' && (
                <div className="grid grid-cols-3 gap-1.5">
                  <Button type="button" tone="neutral" surface="soft" density="compact" className="rounded-full" onClick={() => setSelected(entities.filter(x => x.type !== 'point').map(x => x.id))}>{tl("Tutti")}</Button>
                  <Button type="button" tone="neutral" surface="soft" density="compact" className="rounded-full" onClick={() => setSelected([])}>{tl("Nessuno")}</Button>
                  <Button type="button" tone="accent" surface="solid" density="compact" className="rounded-full" disabled={!selected.length} onClick={() => setRev(r => ({ ...r, step: 'axis', error: null }))}>{tl("Avanti")}</Button>
                </div>
              )}
            </RevStep>
            <RevStep n={2} state={rev.step === 'axis' ? (rev.axis ? 'done' : 'active') : 'todo'} title={tl("Scegli l'asse di rotazione")}>
              {rev.step === 'axis' ? (
                <>
                  <p className="text-[11px] leading-4 text-slate-600">{tl("Clicca una linea dello sketch che non fa parte della forma, oppure usa uno degli assi dello sketch.")}</p>
                  <p className={`text-[11px] font-semibold ${rev.axis ? 'text-orange-700' : 'text-slate-500'}`}>{rev.axis ? tl("Asse: {0}", rev.label) : tl("Nessun asse scelto")}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button type="button" tone="neutral" surface="solid" density="compact" className="rounded-full" onClick={() => setRevolveAxis({ a: [0, 0], d: [1, 0] }, tl("asse X dello sketch"))}>{tl("Asse X")}</Button>
                    <Button type="button" tone="neutral" surface="solid" density="compact" className="rounded-full" onClick={() => setRevolveAxis({ a: [0, 0], d: [0, 1] }, tl("asse Y dello sketch"))}>{tl("Asse Y")}</Button>
                    <Button type="button" tone="neutral" surface="ghost" density="compact" className="rounded-full" onClick={() => setRev(r => ({ ...r, step: 'shape', axis: null, label: '' }))}>{tl("Indietro")}</Button>
                  </div>
                </>
              ) : <p className="text-[11px] text-slate-400">{tl("Dopo aver scelto la forma.")}</p>}
            </RevStep>
            <RevStep n={3} state={rev.step === 'axis' && rev.axis ? 'active' : 'todo'} title={tl("Ruota")}>
              {rev.step === 'axis' && rev.axis ? (
                <>
                  <label className="block">
                    <span className="flex justify-between text-[10px] font-semibold text-slate-400">{tl("Angolo")}<span className="text-slate-600">{Math.round(revAngle)}°</span></span>
                    <input type="range" min={1} max={360} step={1} value={revAngle} onChange={e => setRev(r => ({ ...r, angle: e.target.value }))} className="w-full" />
                  </label>
                  <Segmented<'solid' | 'cut'>
                    value={rev.mode}
                    onChange={v => setRev(r => ({ ...r, mode: v }))}
                    options={[['solid', tl("Solido")], ['cut', tl("Foro"), tl("Scava gli oggetti che attraversa")]]}
                  />
                  <Button type="button" tone="accent" surface="solid" density="compact" className="w-full rounded-full" onClick={doRevolve}><Check /> {tl("Rivoluziona")}</Button>
                  <p className="text-[10px] leading-4 text-slate-500">{tl("L'anteprima viola si vede nella finestra 3D in basso a destra.")}</p>
                </>
              ) : <p className="text-[11px] text-slate-400">{tl("Angolo, anteprima 3D e conferma.")}</p>}
            </RevStep>
            {rev.error && <p className="rounded-lg bg-rose-50 p-2 text-[11px] leading-4 text-rose-700">{rev.error === 'crosses' ? tl("La forma attraversa l'asse: l'asse deve stare su un lato (o sul bordo) della forma.") : rev.error}</p>}
            <p className="text-[10px] leading-4 text-slate-500">{tl("Il solido resta collegato allo sketch: se lo modifichi si aggiorna.")}</p>
          </div>
        )}

        <div className="space-y-2">
          {sectionTitle(tl("Disegno"))}
          <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><Grid3x3 className="h-3.5 w-3.5" /> {tl("Aggancio griglia")}</span>
            <select value={grid} onChange={e => setGrid(Number(e.target.value))} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 focus:outline-none">
              {[0, 0.1, 0.5, 1, 2, 5, 10].map(v => <option key={v} value={v}>{v === 0 ? tl("libero") : `${String(v).replace('.', ',')} mm`}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-1.5 text-[11px] font-semibold text-slate-600">
            <input type="checkbox" className="mt-0.5" checked={constrained} onChange={e => setConstrained(e.target.checked)} />
            <span>{tl("Modalità vincolata (F9)")}<span className="block text-[10px] font-normal leading-4 text-slate-400">{tl("Anchor suggeriti: allineamento con altri vertici, orizzontale/verticale, parallelo e perpendicolare ai lati, prolungamenti.")}</span></span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <input type="checkbox" checked={ortho} onChange={e => setOrtho(e.target.checked)} /> {tl("Ortogonale (solo linee orizzontali/verticali, F8)")}
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <input type="checkbox" checked={showDims} onChange={e => setShowDims(e.target.checked)} /> {tl("Mostra quote")}
          </label>
          {tool === 'polygon' && <Num label={tl("Lati del poligono")} value={sides} suffix="" step={1} min={3} onCommit={v => setSides(Math.max(3, Math.min(64, Math.round(v))))} />}
          {refs.length > 0 && (
            <button type="button" onClick={projectRefs} className="w-full rounded-lg border border-violet-200 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50">
              {tl("Proietta i bordi della faccia nello sketch")}
            </button>
          )}
        </div>
        <p className="text-[10px] leading-4 text-slate-400">{tl("Rotella: zoom · tasto destro/centrale: sposta · F: inquadra · Ctrl+Z/Y: annulla/ripeti. Le quote si digitano mentre disegni.")}</p>
      </div>
      <div className="flex gap-2 border-t border-slate-200 p-3">
        <Button type="button" tone="accent" surface="solid" density="compact" className="flex-1 rounded-full" onClick={() => onFinish(entities)} title={tl("Torna al 3D: lo sketch resta nella scena")}>
          <Check /> {tl("Fine sketch")}
        </Button>
      </div>
    </div>
  )

  const GROUPS: { label: string; tools: Tool[] }[] = [
    { label: tl("Seleziona e modifica"), tools: ['select'] },
    { label: tl("Disegna"), tools: ['line', 'rect', 'circle', 'arc', 'curve', 'ellipse', 'polygon'] },
    { label: tl("Elabora"), tools: ['offset', 'trim', 'fillet', 'mid', 'mirror', 'pattern'] },
    { label: tl("Crea solido"), tools: ['revolve'] },
  ]
  const toggle = (on: boolean, label: string, key: string, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      title={`${label} (${key})`}
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold transition ${on ? 'ds-accent-selected' : 'ds-well-tile text-[var(--text-primary)]'}`}
    >
      <span className="h-5 w-5 shrink-0 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>{label}
    </button>
  )
  // Mode picker: a floating popover anchored under the selected tool tile, so the tool column never reflows.
  const toolBtnRefs = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({})
  const [modeOpen, setModeOpen] = useState(false)
  const [modePos, setModePos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => { if (!modeTool) setModeOpen(false) }, [modeTool])
  useLayoutEffect(() => {
    if (!modeOpen || !modeTool) { setModePos(null); return }
    const place = () => {
      const r = toolBtnRefs.current[modeTool]?.getBoundingClientRect()
      if (!r) return
      const w = 272
      setModePos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [modeOpen, modeTool])
  useEffect(() => {
    if (!modeOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-sketch-mode-popover]') || t.closest('[data-sketch-tool]')) return
      setModeOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModeOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [modeOpen])
  const pickTool = (id: Tool) => {
    if (id === tool && MODE_TOOLS.includes(id)) { setModeOpen(o => !o); return }
    setTool(id)
    setModeOpen(MODE_TOOLS.includes(id))
  }
  const modePopover = modeOpen && modeTool && modePos && createPortal(
    <div
      data-sketch-mode-popover
      role="radiogroup"
      aria-label={tl("Modalità di disegno")}
      style={{ position: 'fixed', left: modePos.left, top: modePos.top, width: 272, zIndex: 80 }}
      className="ds-popover space-y-0.5 rounded-2xl bg-[var(--ds-popover-solid)] p-1.5 shadow-[var(--ds-shadow-popover)]"
    >
      <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold text-[var(--text-secondary)]">{tl("Modalità")} · {SHORT_LABEL[modeTool]}</p>
      {MODE_OPTIONS[modeTool].map(o => {
        const current = modes[modeTool] === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={current}
            onClick={() => { setModes(m => ({ ...m, [modeTool]: o.id })); setDraft([]); setDimText([]); setModeOpen(false) }}
            className={`flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition ${current ? 'ds-accent-selected' : 'text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}
          >
            <span className="text-[12px] font-semibold">{o.label}</span>
            <span className="text-[10.5px] leading-4 opacity-75">{o.hint}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
  const toolsPanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
        <p className="pt-1.5 text-[10px] font-semibold text-[var(--text-secondary)]">{tl("Strumenti sketch")}</p>
        <span className="flex gap-0.5">
          <IconButton type="button" title={tl("Annulla (Ctrl+Z)")} aria-label={tl("Annulla")} onClick={undo} disabled={!hist.past.length} tone="neutral" surface="ghost" size="sm" className="rounded-full"><Undo2 /></IconButton>
          <IconButton type="button" title={tl("Ripeti (Ctrl+Y)")} aria-label={tl("Ripeti")} onClick={redo} disabled={!hist.future.length} tone="neutral" surface="ghost" size="sm" className="rounded-full"><Redo2 /></IconButton>
        </span>
      </div>
      {/* Same spot as the «Sketch 2D» button of the shapes column: it turns into the highlighted «Fine sketch». */}
      <button
        type="button"
        onClick={() => onFinish(entities)}
        title={tl("Torna al 3D: lo sketch resta nella scena")}
        className="ds-accent-selected mx-2 mb-2 flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold leading-tight"
      >
        <PencilLine className="h-5 w-5 shrink-0" />
        <span>{tl("Fine Sketch")}</span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
        {GROUPS.map(g => (
          <section key={g.label} className="rounded-2xl bg-[var(--ds-well)] p-1.5">
            <p className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">{g.label}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {g.tools.map(id => {
                const t = TOOLS.find(x => x.id === id)!
                const active = tool === id
                return (
                  <button
                    key={id}
                    ref={el => { toolBtnRefs.current[id] = el }}
                    data-sketch-tool
                    type="button"
                    title={`${t.label} (${t.key})`}
                    aria-pressed={active}
                    aria-haspopup={MODE_TOOLS.includes(id) ? 'true' : undefined}
                    onClick={() => pickTool(id)}
                    className={`relative flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 text-[10px] font-semibold leading-tight transition ${active ? 'ds-accent-selected' : 'ds-well-tile text-[var(--text-primary)]'}`}
                  >
                    <span className="h-5 w-5 [&_svg]:h-5 [&_svg]:w-5">{id === 'select' ? SELECT_ICON : TOOL_ICONS[id as Exclude<Tool, 'select'>]}</span>
                    <span className="max-w-full truncate px-0.5">{SHORT_LABEL[id]}</span>
                    <span className={`absolute right-1 top-0.5 text-[7px] font-bold ${active ? 'opacity-80' : 'text-[var(--text-secondary)]'}`}>{t.key}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        <section className="rounded-2xl bg-[var(--ds-well)] p-1.5">
          <p className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">{tl("Aiuti")}</p>
          <div className="flex flex-col gap-1">
            {toggle(constrained, tl("Modalità vincolata"), 'F9', <Magnet />, () => setConstrained(c => !c))}
            {toggle(ortho, tl("Ortogonale"), 'F8', svg(<><path d="M5 4v15h15" /><path d="M5 12h4" strokeDasharray="2 2" /></>), () => setOrtho(o => !o))}
            {toggle(showDims, tl("Mostra quote"), 'Q', <Ruler />, () => setShowDims(v => !v))}
            {toggle(show3d, tl("Anteprima 3D"), '3', <Box />, () => onShow3d(!show3d))}
            {toggle(false, tl("Inquadra"), 'F', <Maximize />, fit)}
          </div>
        </section>
      </div>
      {modePopover}
    </div>
  )

  return (
    <>
      {toolsHost && createPortal(toolsPanel, toolsHost)}
      <div ref={hostRef} tabIndex={-1} className="absolute inset-0 z-10 outline-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ cursor: panRef.current || editDrag || moveDrag || patDrag ? 'grabbing' : tool === 'pattern' ? (lastRaw.current && patHandleAt(lastRaw.current) ? 'grab' : 'crosshair') : tool === 'select' ? (lastRaw.current && (vertexAt(lastRaw.current) || hitEntity(lastRaw.current)) ? 'grab' : 'default') : 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!moveDrag && !draft.length) { setCursor(null); lastRaw.current = null } }}
          onDoubleClick={() => { if (tool === 'line') { setDraft([]); resetDim() } else if (tool === 'curve' && modes.curve === 'spline' && draft.length) { finishSpline(draft) } else if (tool === 'select' && lastRaw.current) { const hit = hitEntity(lastRaw.current); if (hit) openQuickEdit(hit.id) } }}
          onContextMenu={e => e.preventDefault()}
        />

        {/* In-place dimensions of the selected stroke (Tab / double click) */}
        {quickEdit && (() => {
          const ent = entities.find(x => x.id === quickEdit.id)
          if (!ent) return null
          const fields = quickFields(ent)
          const b = entitiesBounds([ent])
          if (!b || !fields.length) return null
          const anchor = toScreen([(b.min[0] + b.max[0]) / 2, b.max[1]])
          return (
            <div className="absolute z-20 flex -translate-x-1/2 gap-1 rounded-xl border border-blue-300 bg-white p-1 shadow-lg" style={{ left: Math.max(130, Math.min(anchor[0], size.w - 130)), top: Math.max(8, anchor[1] - 64) }}>
              {fields.map((f, i) => (
                <label key={f.label} className="flex flex-col px-1">
                  <span className="text-[9px] font-semibold text-slate-400">{f.label}</span>
                  <span className="flex items-center gap-0.5">
                    <input
                      ref={el => { quickRefs.current[i] = el }}
                      inputMode="decimal"
                      value={quickEdit.text[i] ?? String(Math.round(f.value * 1000) / 1000)}
                      onFocus={e => e.currentTarget.select()}
                      onChange={e => setQuickEdit(q => (q ? { ...q, text: Object.assign([...q.text], { [i]: e.target.value }) } : q))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); applyQuickEdit() }
                        else if (e.key === 'Escape') { e.preventDefault(); setQuickEdit(null); hostRef.current?.focus() }
                        else if (e.key === 'Tab') { e.preventDefault(); const n = quickRefs.current[(i + (e.shiftKey ? fields.length - 1 : 1)) % fields.length]; n?.focus() }
                      }}
                      className="w-16 rounded-md bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-900 outline-none focus:bg-blue-50"
                    />
                    <span className="text-[10px] text-slate-400">{f.unit}</span>
                  </span>
                </label>
              ))}
              <button type="button" onClick={applyQuickEdit} title={tl("Applica (Invio)")} className="self-end rounded-lg bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white">OK</button>
            </div>
          )
        })()}

        {/* Live dimension entry */}
        {dimAnchor && pv && pv.labels.length > 0 && !offsetUi && (
          <div className="pointer-events-auto absolute flex gap-1 rounded-xl border border-blue-200 bg-white/95 p-1 shadow-lg" style={{ left: Math.min(dimAnchor[0] + 18, size.w - 230), top: Math.min(dimAnchor[1] + 18, size.h - 60) }}>
            {pv.labels.map((l, i) => (
              <label key={l} className="flex flex-col px-1">
                <span className="text-[9px] font-semibold text-slate-400">{l}</span>
                <span className="flex items-center gap-0.5">
                  <input
                    ref={el => { dimRefs.current[i] = el }}
                    inputMode="decimal"
                    value={dimText[i] ?? ''}
                    placeholder={fmt(pv.values[i])}
                    onChange={e => setDimText(t => { const n = [...t]; n[i] = e.target.value; return n })}
                    onKeyDown={e => {
                      if (e.key === 'Tab') {
                        e.preventDefault()
                        dimRefs.current[(i + (e.shiftKey ? -1 : 1) + pv.labels.length) % pv.labels.length]?.focus()
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (cursor) commitStep(cursor.p)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        resetDim()
                      }
                    }}
                    className={`w-16 rounded-md px-1.5 py-0.5 text-xs font-semibold outline-none ${parseNum(dimText[i]) != null ? 'bg-blue-50 text-blue-800' : 'bg-slate-50 text-slate-800'}`}
                  />
                  <span className="text-[10px] text-slate-400">{pv.units[i]}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Offset distance */}
        {offsetUi && offsetAnchor && (
          <div className="absolute z-20 w-60 space-y-2 rounded-xl border border-violet-200 bg-white p-2 shadow-xl" style={{ left: Math.min(offsetAnchor[0] + 14, size.w - 250), top: Math.min(offsetAnchor[1] + 14, size.h - 170) }}>
            <p className="text-[11px] font-semibold text-slate-700">{offsetUi.closed ? tl("Offset del profilo chiuso") : tl("Offset del tratto aperto")}</p>
            {!offsetUi.closed && (
              <Segmented<'band' | 'line'>
                value={offsetUi.band ? 'band' : 'line'}
                onChange={v => setOffsetUi({ ...offsetUi, band: v === 'band', keep: v !== 'band' })}
                options={[['band', tl("Spessore chiuso")], ['line', tl("Parallela")]]}
              />
            )}
            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
              {offsetUi.band ? tl("Spessore") : tl("Distanza")}
              <input
                autoFocus
                inputMode="decimal"
                value={offsetUi.value}
                onChange={e => setOffsetUi({ ...offsetUi, value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') applyOffset(); if (e.key === 'Escape') setOffsetUi(null) }}
                className="w-20 rounded-md bg-slate-50 px-1.5 py-1 text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-violet-200"
              /> mm
            </label>
            {!offsetUi.band && <p className="text-[10px] leading-3 text-slate-400">{offsetUi.closed ? tl("Positivo = verso l'esterno, negativo = verso l'interno.") : tl("Positivo = a sinistra del verso di disegno, negativo = a destra.")}</p>}
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" checked={offsetUi.keep} onChange={e => setOffsetUi({ ...offsetUi, keep: e.target.checked })} /> {tl("Mantieni la forma originale (crea una parete)")}
            </label>
            {!offsetPreview.length && <p className="text-[10px] text-rose-600">{tl("Distanza non valida per questa forma.")}</p>}
            <div className="flex justify-end gap-1">
              <Button type="button" tone="neutral" surface="ghost" density="compact" className="rounded-full" onClick={() => setOffsetUi(null)}>{tl("Annulla")}</Button>
              <Button type="button" tone="accent" surface="solid" density="compact" className="rounded-full" disabled={!offsetPreview.length} onClick={applyOffset}>{tl("Applica")}</Button>
            </div>
          </div>
        )}

        {/* Fillet radius */}
        {filletUi && tool === 'fillet' && (() => {
          const a = toScreen(filletUi.at)
          return (
            <div className="absolute z-20 w-60 space-y-2 rounded-xl border border-violet-200 bg-white p-2 shadow-xl" style={{ left: Math.min(a[0] + 14, size.w - 250), top: Math.min(a[1] + 14, size.h - 170) }}>
              <p className="text-[11px] font-semibold text-slate-700">{tl("Raccordo dell'angolo")}</p>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                {tl("Raggio")}
                <input
                  autoFocus
                  inputMode="decimal"
                  value={filletUi.value}
                  onChange={e => setFilletUi({ ...filletUi, value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') applyFillet(); if (e.key === 'Escape') setFilletUi(null) }}
                  className="w-20 rounded-md bg-slate-50 px-1.5 py-1 text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-violet-200"
                /> mm
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <input type="checkbox" checked={filletUi.all} onChange={e => setFilletUi({ ...filletUi, all: e.target.checked })} /> {tl("Tutti gli angoli del contorno")}
              </label>
              {filletPreview?.clamped && <p className="text-[10px] leading-3 text-amber-700">{tl("Raggio ridotto: il lato è troppo corto per il valore richiesto.")}</p>}
              {!filletPreview && <p className="text-[10px] text-rose-600">{tl("Servono due linee che si incontrano (non parallele) e un raggio valido.")}</p>}
              {filletPreview && filletPreview.count > 1 && <p className="text-[10px] text-slate-500">{tl("{0} angoli raccordati", filletPreview.count)}</p>}
              <div className="flex justify-end gap-1">
                <Button type="button" tone="neutral" surface="ghost" density="compact" className="rounded-full" onClick={() => setFilletUi(null)}>{tl("Annulla")}</Button>
                <Button type="button" tone="accent" surface="solid" density="compact" className="rounded-full" disabled={!filletPreview} onClick={applyFillet}>{tl("Applica")}</Button>
              </div>
            </div>
          )
        })()}

        {/* Status */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[10.5px] leading-4 text-slate-500 shadow-sm">
          {cursor && (
            <span className="font-mono font-semibold text-slate-800">
              x {fmt(cursor.p[0])} · y {fmt(cursor.p[1])}
              <span className="ml-1.5 font-sans font-semibold text-orange-600">{cursor.label ?? SNAP_LABEL[cursor.kind]}</span>
            </span>
          )}
          <span>{hint}</span>
        </div>
        {tool === 'pattern' && patSrc.length > 0 && pat.mode === 'circ' && (
          <div className="pointer-events-none absolute bottom-14 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-violet-200 bg-white/95 p-1 shadow-lg">
            {([[1, tl("Clicca il vertice attorno a cui duplicare"), pat.centre ? 'done' : 'active'], [2, tl("Copie e angolo, poi Invio"), pat.centre ? 'active' : 'todo']] as [number, string, 'todo' | 'active' | 'done'][]).map(([n, text, st]) => (
              <span key={n} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${st === 'active' ? 'bg-violet-600 text-white' : st === 'done' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400'}`}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${st === 'active' ? 'bg-white/25' : st === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-200'}`}>{st === 'done' ? '✓' : n}</span>
                {text}
              </span>
            ))}
          </div>
        )}
        {tool === 'revolve' && (
          <div className="pointer-events-none absolute bottom-14 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-full border border-violet-200 bg-white/95 p-1 shadow-lg">
              {([
                [1, tl("Seleziona i tratti da ruotare"), rev.step === 'shape' ? 'active' : 'done'],
                [2, tl("Scegli l'asse"), rev.step === 'axis' && !rev.axis ? 'active' : rev.axis ? 'done' : 'todo'],
                [3, tl("Ruota"), rev.step === 'axis' && rev.axis ? 'active' : 'todo'],
              ] as [number, string, 'todo' | 'active' | 'done'][]).map(([n, text, st]) => (
                <span key={n} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${st === 'active' ? 'bg-violet-600 text-white' : st === 'done' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400'}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${st === 'active' ? 'bg-white/25' : st === 'done' ? 'bg-emerald-500 text-white' : 'bg-slate-200'}`}>{st === 'done' ? '✓' : n}</span>
                  {text}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {panelHost && createPortal(panel, panelHost)}
    </>
  )
}

function smallestRegionAt(regions: Region[], p: P): Region | null {
  let best: Region | null = null
  for (const r of regions) if (regionContains(r, p) && (!best || r.area < best.area)) best = r
  return best
}

// ── Exact parameters of the selected entity ───────────────────────────────

function EntityInspector({ e, update }: { e: SketchEntity; update: (id: string, fn: (e: SketchEntity) => SketchEntity, keepJoined?: { old: P; next: P }[]) => void }) {
  const grid = (children: ReactNode) => <div className="grid grid-cols-2 gap-1.5">{children}</div>
  switch (e.type) {
    case 'line': {
      const L = dist(e.a, e.b)
      const ang = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) / DEG
      const setB = (b: P) => update(e.id, x => ({ ...(x as typeof e), b }), [{ old: e.b, next: b }])
      const setA = (a: P) => update(e.id, x => ({ ...(x as typeof e), a }), [{ old: e.a, next: a }])
      return (
        <div className="space-y-1.5">
          {grid(<>
            <Num label={tl("Lunghezza")} value={L} min={0.01} onCommit={v => setB(polar(e.a, v, ang * DEG))} />
            <Num label={tl("Angolo")} value={ang} suffix="°" step={15} onCommit={v => setB(polar(e.a, L, v * DEG))} />
            <Num label={tl("Inizio X")} value={e.a[0]} onCommit={v => setA([v, e.a[1]])} />
            <Num label={tl("Inizio Y")} value={e.a[1]} onCommit={v => setA([e.a[0], v])} />
            <Num label={tl("Fine X")} value={e.b[0]} onCommit={v => setB([v, e.b[1]])} />
            <Num label={tl("Fine Y")} value={e.b[1]} onCommit={v => setB([e.b[0], v])} />
          </>)}
          <p className="text-[10px] text-slate-400">{tl("Le linee collegate seguono l'estremo modificato.")}</p>
        </div>
      )
    }
    case 'rect': {
      const [lo, , hi] = rectCorners(e.a, e.b)
      const set = (a: P, b: P) => update(e.id, x => ({ ...(x as typeof e), a, b }))
      return grid(<>
        <Num label={tl("Larghezza")} value={hi[0] - lo[0]} min={0.01} onCommit={v => set(lo, [lo[0] + v, hi[1]])} />
        <Num label={tl("Altezza")} value={hi[1] - lo[1]} min={0.01} onCommit={v => set(lo, [hi[0], lo[1] + v])} />
        <Num label={tl("Angolo X")} value={lo[0]} onCommit={v => set([v, lo[1]], [v + hi[0] - lo[0], hi[1]])} />
        <Num label={tl("Angolo Y")} value={lo[1]} onCommit={v => set([lo[0], v], [hi[0], v + hi[1] - lo[1]])} />
        <Num label={tl("Centro X")} value={(lo[0] + hi[0]) / 2} onCommit={v => { const d = v - (lo[0] + hi[0]) / 2; set([lo[0] + d, lo[1]], [hi[0] + d, hi[1]]) }} />
        <Num label={tl("Centro Y")} value={(lo[1] + hi[1]) / 2} onCommit={v => { const d = v - (lo[1] + hi[1]) / 2; set([lo[0], lo[1] + d], [hi[0], hi[1] + d]) }} />
      </>)
    }
    case 'circle':
      return grid(<>
        <Num label={tl("Diametro")} value={e.r * 2} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), r: v / 2 }))} />
        <Num label={tl("Raggio")} value={e.r} min={0.005} onCommit={v => update(e.id, x => ({ ...(x as typeof e), r: v }))} />
        <Num label={tl("Centro X")} value={e.c[0]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [v, e.c[1]] }))} />
        <Num label={tl("Centro Y")} value={e.c[1]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [e.c[0], v] }))} />
      </>)
    case 'arc': {
      const sweep = arcSweep(e.a0, e.a1)
      const [s, t] = arcEnds(e)
      return (
        <div className="space-y-1.5">
          {grid(<>
            <Num label={tl("Raggio")} value={e.r} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), r: v }))} />
            <Num label={tl("Ampiezza")} value={sweep / DEG} suffix="°" step={15} min={0.1} onCommit={v => update(e.id, x => ({ ...(x as typeof e), a1: e.a0 + Math.min(359.99, v) * DEG }))} />
            <Num label={tl("Angolo iniziale")} value={e.a0 / DEG} suffix="°" step={15} onCommit={v => update(e.id, x => ({ ...(x as typeof e), a0: v * DEG, a1: v * DEG + sweep }))} />
            <Num label={tl("Corda")} value={dist(s, t)} readOnly />
            <Num label={tl("Centro X")} value={e.c[0]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [v, e.c[1]] }))} />
            <Num label={tl("Centro Y")} value={e.c[1]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [e.c[0], v] }))} />
          </>)}
        </div>
      )
    }
    case 'ellipse':
      return grid(<>
        <Num label={tl("Larghezza (2·a)")} value={e.rx * 2} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), rx: v / 2 }))} />
        <Num label={tl("Altezza (2·b)")} value={e.ry * 2} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), ry: v / 2 }))} />
        <Num label={tl("Centro X")} value={e.c[0]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [v, e.c[1]] }))} />
        <Num label={tl("Centro Y")} value={e.c[1]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [e.c[0], v] }))} />
        <Num label={tl("Rotazione")} value={e.rot / DEG} suffix="°" step={15} onCommit={v => update(e.id, x => ({ ...(x as typeof e), rot: v * DEG }))} />
      </>)
    case 'polygon': {
      const side = 2 * e.r * Math.sin(Math.PI / e.n)
      return grid(<>
        <Num label={tl("Lati")} value={e.n} suffix="" step={1} min={3} onCommit={v => update(e.id, x => ({ ...(x as typeof e), n: Math.max(3, Math.min(64, Math.round(v))) }))} />
        <Num label={tl("Lato")} value={side} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), r: v / (2 * Math.sin(Math.PI / e.n)) }))} />
        <Num label={tl("Raggio esterno")} value={e.r} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), r: v }))} />
        <Num label={tl("Raggio interno")} value={e.r * Math.cos(Math.PI / e.n)} min={0.01} onCommit={v => update(e.id, x => ({ ...(x as typeof e), r: v / Math.cos(Math.PI / e.n) }))} />
        <Num label={tl("Centro X")} value={e.c[0]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [v, e.c[1]] }))} />
        <Num label={tl("Centro Y")} value={e.c[1]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), c: [e.c[0], v] }))} />
        <Num label={tl("Rotazione")} value={e.rot / DEG} suffix="°" step={15} onCommit={v => update(e.id, x => ({ ...(x as typeof e), rot: v * DEG }))} />
      </>)
    }
    case 'bezier': case 'spline': {
      const names = e.type === 'bezier' ? [tl("Inizio"), tl("Controllo 1"), tl("Controllo 2"), tl("Fine")] : e.pts.map((_, i) => tl("Punto {0}", i + 1))
      return (
        <div className="space-y-1.5">
          {e.pts.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-1.5">
              <Num label={`${names[i]} X`} value={p[0]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), pts: (x as typeof e).pts.map((q, j) => (j === i ? [v, q[1]] : q)) } as SketchEntity))} />
              <Num label={`${names[i]} Y`} value={p[1]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), pts: (x as typeof e).pts.map((q, j) => (j === i ? [q[0], v] : q)) } as SketchEntity))} />
            </div>
          ))}
        </div>
      )
    }
    case 'point':
      return grid(<>
        <Num label={tl("X")} value={e.p[0]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), p: [v, e.p[1]] }))} />
        <Num label={tl("Y")} value={e.p[1]} onCommit={v => update(e.id, x => ({ ...(x as typeof e), p: [e.p[0], v] }))} />
      </>)
    case 'polyline': {
      const b = entitiesBounds([e])!
      return (
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-500">{tl("Contorno di {0} vertici ({1})", e.pts.length, e.closed ? tl("chiuso") : tl("aperto"))}</p>
          {grid(<>
            <Num label={tl("Ingombro X")} value={b.max[0] - b.min[0]} readOnly />
            <Num label={tl("Ingombro Y")} value={b.max[1] - b.min[1]} readOnly />
            <Num label={tl("Sposta a X (min)")} value={b.min[0]} onCommit={v => update(e.id, x => translateEntity(x, [v - b.min[0], 0]))} />
            <Num label={tl("Sposta a Y (min)")} value={b.min[1]} onCommit={v => update(e.id, x => translateEntity(x, [0, v - b.min[1]]))} />
          </>)}
        </div>
      )
    }
  }
}
