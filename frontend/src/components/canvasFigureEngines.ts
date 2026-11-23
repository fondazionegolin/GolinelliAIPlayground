/**
 * Declarative engines for figures the built-in library does not cover: Vega-Lite (statistical charts) and JSXGraph
 * (interactive geometry and functions). The model only supplies a JSON description; it is validated and cleaned here
 * (no remote data, no scripts) and drawn by the library. A raster snapshot of every drawn engine figure is kept so that
 * the assistant can "see" it when it looks at the board.
 */
import { PALETTE, type JsxElement, type JsxGraphDef } from './canvasFigures'

const snapshots = new Map<string, string>()
export const snapshotKey = (id: string, spec: unknown) => `${id}:${JSON.stringify(spec).length}:${hash(JSON.stringify(spec))}`
function hash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0 }
export const saveSnapshot = (key: string, dataUrl: string) => { snapshots.set(key, dataUrl); if (snapshots.size > 60) snapshots.delete(snapshots.keys().next().value as string) }
export const getSnapshot = (key: string) => snapshots.get(key)

const VEGA_BANNED = new Set(['url', 'href', 'loader'])
/** Vega-Lite spec without anything that could reach the network: only inline data survives. */
export function sanitizeVega(def: Record<string, unknown>): Record<string, unknown> | null {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 24) return undefined
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!VEGA_BANNED.has(k)) out[k] = walk(x, depth + 1)
      return out
    }
    return v
  }
  const clean = walk(def, 0) as Record<string, unknown>
  const hasMark = ['mark', 'layer', 'hconcat', 'vconcat', 'concat', 'facet', 'repeat'].some((k) => k in clean)
  return hasMark ? clean : null
}

export function vegaSpecFor(def: Record<string, unknown>, w: number, h: number, title?: string): Record<string, unknown> {
  const composite = ['hconcat', 'vconcat', 'concat', 'facet', 'repeat'].some((k) => k in def)
  const base: Record<string, unknown> = { ...def, $schema: 'https://vega.github.io/schema/vega-lite/v5.json', background: '#ffffff' }
  if (!composite) { base.width = Math.max(w - 40, 120); base.height = Math.max(h - 40, 90); base.autosize = { type: 'fit', contains: 'padding' } }
  if (title && !base.title) base.title = title
  base.config = {
    font: 'Inter, system-ui, sans-serif',
    range: { category: PALETTE, ordinal: { scheme: 'blues' } },
    title: { fontSize: 15, fontWeight: 600, anchor: 'start', color: '#0f172a' },
    axis: { labelFontSize: 11, titleFontSize: 12, labelColor: '#64748b', titleColor: '#64748b', gridColor: '#e2e8f0', domainColor: '#94a3b8', tickColor: '#94a3b8' },
    legend: { labelFontSize: 12, titleFontSize: 12 },
    view: { stroke: null },
    bar: { cornerRadiusEnd: 3 },
    ...(def.config as object | undefined),
  }
  return base
}

export const VEGA_LOCALE = { decimal: ',', thousands: '.', grouping: [3], currency: ['', ' €'] }

// ─── JSXGraph: JSON → board, through a whitelist (no scripts, no code from the model) ─────────────────

export const JSX_TYPES = new Set(['point', 'glider', 'line', 'segment', 'ray', 'circle', 'polygon', 'regularpolygon', 'angle', 'arc', 'sector', 'functiongraph', 'curve', 'slider',
  'text', 'intersection', 'perpendicular', 'parallel', 'midpoint', 'tangent', 'normal', 'vector', 'ellipse', 'parabola', 'hyperbola', 'conic', 'reflection', 'bisector', 'integral', 'riemannsum', 'inequality', 'arrow', 'circumcircle', 'incircle'])

type Board = { create: (type: string, args: unknown[], attrs?: Record<string, unknown>) => unknown }

/** Builds the described construction on a JSXGraph board. Returns the ids that could not be created. */
export function buildJsxElements(board: Board, elements: JsxElement[]): string[] {
  const refs = new Map<string, unknown>()
  const failed: string[] = []
  const resolve = (a: unknown): unknown => (typeof a === 'string' && a.startsWith('@') ? refs.get(a.slice(1)) : Array.isArray(a) ? a.map(resolve) : a)
  for (const el of elements.slice(0, 60)) {
    if (!JSX_TYPES.has(el.type)) { failed.push(el.type); continue }
    try {
      const obj = board.create(el.type, (el.args ?? []).map(resolve), { ...(el.attrs ?? {}) })
      if (el.id) refs.set(el.id, obj)
    } catch { failed.push(el.id || el.type) }
  }
  return failed
}

export const jsxBoardOptions = (def: JsxGraphDef) => ({
  boundingbox: def.boundingbox ?? [-6, 6, 6, -6],
  axis: def.axis !== false,
  grid: def.grid !== false,
  showCopyright: false,
  showNavigation: false,
  keepAspectRatio: false,
  pan: { enabled: false },
  zoom: { enabled: false },
})
