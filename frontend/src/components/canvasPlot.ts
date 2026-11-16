/**
 * Cartesian plots for the smart canvas. Everything that must be exact is computed here from the expression —
 * curves, the region under (or between) curves, Riemann rectangles, drop lines at the limits and the numeric value of
 * the integral — so the model only chooses WHAT to show (expression, interval) and never draws or measures anything.
 */
import { evaluate, parseEquation, samples } from './visual-comprehension/mathExpr'

export type PlotMark = { x: number; y: number; label?: string }
/** Region between `expr` (default: the plot's main curve) and `below` (default: the x axis) for from ≤ x ≤ to. */
export type PlotArea = { from: number; to: number; expr?: string; below?: string; color?: string; label?: string }
export type PlotExtra = { expr: string; color?: string; label?: string }
export type PlotVLine = { x: number; label?: string }
export type PlotRiemann = { from: number; to: number; n: number; kind: 'left' | 'right' | 'mid' | 'trap'; expr?: string }

export type PlotSpec = {
  w: number; h: number; expr: string; xMin: number; xMax: number; yMin: number; yMax: number; title?: string; color?: string
  marks?: PlotMark[]; areas?: PlotArea[]; extra?: PlotExtra[]; vlines?: PlotVLine[]; riemann?: PlotRiemann
}

type Pt = { x: number; y: number }
export type PlotGeometry = {
  grid: Array<[number, number, number, number]>
  axes: Array<[number, number, number, number]>
  ticks: Array<{ x: number; y: number; text: string; align: 'middle' | 'end' }>
  curves: Pt[][]
  extraCurves: Array<{ points: Pt[][]; color: string; label: string }>
  marks: Array<{ x: number; y: number; label: string }>
  areas: Array<{ d: string; color: string; label: string; lx: number; ly: number; value: number | null }>
  rects: Array<{ x: number; y: number; w: number; h: number }>
  riemannLabel: { text: string; x: number; y: number } | null
  vlines: Array<{ x1: number; y1: number; x2: number; y2: number; label: string; lx: number; ly: number }>
  titleY: number
  ok: boolean
}

export const AREA_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899']
export const EXTRA_COLORS = ['#2563eb', '#16a34a', '#9333ea', '#ea580c']

export function niceStep(span: number): number {
  const raw = span / 8
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / pow
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
}
export const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6)

/** y = f(x) as a plain function; NaN where it is undefined. Null when the text is not an explicit function of x. */
export function compileFn(expr: string | undefined): ((x: number) => number) | null {
  if (!expr || !expr.trim()) return null
  try {
    const eq = parseEquation(expr.includes('=') ? expr : `y = ${expr}`)
    const node = eq.explicit
    if (!node) return null
    return (x: number) => {
      try { return evaluate(node, { x }) } catch { return NaN }
    }
  } catch { return null }
}

/** Simpson's rule on [a, b]; null if the function is undefined or infinite somewhere in the interval. */
export function integrate(f: (x: number) => number, a: number, b: number, n = 2000): number | null {
  if (!(b > a)) return null
  const h = (b - a) / n
  let sum = 0
  for (let i = 0; i <= n; i += 1) {
    const y = f(a + i * h)
    if (!Number.isFinite(y)) return null
    sum += y * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2)
  }
  return (sum * h) / 3
}

/** "26/3 ≈ 8.667" when the value is a small fraction, else just the rounded number. */
export function formatValue(v: number): string {
  const rounded = Math.round(v * 10000) / 10000
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v))
  for (let d = 2; d <= 12; d += 1) {
    const n = Math.round(v * d)
    if (Math.abs(v - n / d) < 1e-7 && n !== 0) return `${n}/${d} ≈ ${rounded}`
  }
  return String(rounded)
}

const span = (a: number, b: number) => Math.max(b - a, 1e-9)

/**
 * Grows the window so what the plot is meant to show is not clipped: every shaded region and its limits, the Riemann
 * rectangles, the drop lines and the curves over the shaded interval. It never shrinks the window the model chose.
 */
export function fitWindow(spec: PlotSpec): Pick<PlotSpec, 'xMin' | 'xMax' | 'yMin' | 'yMax'> {
  let { xMin, xMax, yMin, yMax } = spec
  const xs: number[] = []
  const ys: number[] = []
  const main = compileFn(spec.expr)
  const regions: Array<{ from: number; to: number; fns: Array<((x: number) => number) | null> }> = []
  for (const a of spec.areas || []) regions.push({ from: a.from, to: a.to, fns: [compileFn(a.expr) || main, a.below ? compileFn(a.below) : () => 0] })
  if (spec.riemann) regions.push({ from: spec.riemann.from, to: spec.riemann.to, fns: [compileFn(spec.riemann.expr) || main, () => 0] })
  for (const r of regions) {
    xs.push(r.from, r.to)
    for (const fn of r.fns) {
      if (!fn) continue
      for (let i = 0; i <= 80; i += 1) {
        const y = fn(r.from + ((r.to - r.from) * i) / 80)
        if (Number.isFinite(y) && Math.abs(y) < 1e6) ys.push(y)
      }
    }
  }
  for (const v of spec.vlines || []) xs.push(v.x)
  if (!xs.length && !ys.length) return { xMin, xMax, yMin, yMax }
  const padX = span(Math.min(xMin, ...xs), Math.max(xMax, ...xs)) * 0.06
  if (xs.length) {
    xMin = Math.min(xMin, Math.min(...xs) - padX)
    xMax = Math.max(xMax, Math.max(...xs) + padX)
  }
  if (ys.length) {
    const lo = Math.min(...ys, 0), hi = Math.max(...ys, 0)
    const padY = span(Math.min(yMin, lo), Math.max(yMax, hi)) * 0.08
    yMin = Math.min(yMin, lo - padY)
    yMax = Math.max(yMax, hi + padY)
  }
  return { xMin, xMax, yMin, yMax }
}

/** Everything a plot draws, in the item's own pixels (0..w, 0..h): shared by the SVG renderer and the PNG snapshot. */
export function plotGeometry(spec: PlotSpec): PlotGeometry {
  const { w, h, xMin: xa, xMax: xb, yMin: ya, yMax: yb } = spec
  const top = spec.title ? 34 : 14, pad = 30, left = 40
  const gx = left, gy = top, gw = Math.max(w - left - pad, 10), gh = Math.max(h - top - pad, 10)
  const px = (X: number) => gx + ((X - xa) / (xb - xa)) * gw
  const py = (Y: number) => gy + gh - ((Y - ya) / (yb - ya)) * gh
  const clampY = (Y: number) => Math.min(Math.max(Y, ya), yb)
  const out: PlotGeometry = { grid: [], axes: [], ticks: [], curves: [], extraCurves: [], marks: [], areas: [], rects: [], riemannLabel: null, vlines: [], titleY: 22, ok: false }
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

  const win = { x0: xa, x1: xb, y0: ya, y1: yb }
  const curveRuns = (expr: string): Pt[][] => {
    const eq = parseEquation(expr.includes('=') ? expr : `y = ${expr}`)
    if (!eq.explicit) return []
    return samples(eq.explicit, {}, win, 320)
      .map((run) => run.filter(([, Y]) => Y >= ya && Y <= yb).map(([X, Y]) => ({ x: px(X), y: py(Y) })))
      .filter((run) => run.length > 1)
  }
  const main = compileFn(spec.expr)
  try {
    out.curves = curveRuns(spec.expr)
    out.ok = out.curves.length > 0 || !!main
  } catch { /* an unreadable expression draws axes only */ }
  ;(spec.extra || []).slice(0, 4).forEach((extra, i) => {
    try { out.extraCurves.push({ points: curveRuns(extra.expr), color: extra.color || EXTRA_COLORS[i % EXTRA_COLORS.length], label: extra.label || '' }) } catch { /* skip */ }
  })

  // Shaded regions: the polygon follows the real curves point by point (never rectangles), clipped to the window.
  const STEPS = 240
  ;(spec.areas || []).slice(0, 4).forEach((area, index) => {
    const upper = compileFn(area.expr) || main
    const lower = area.below ? compileFn(area.below) : () => 0
    if (!upper || !lower || !(area.to > area.from)) return
    const from = area.from, to = area.to
    const runs: Array<Array<{ X: number; t: number; b: number }>> = []
    let run: Array<{ X: number; t: number; b: number }> = []
    for (let i = 0; i <= STEPS; i += 1) {
      const X = from + ((to - from) * i) / STEPS
      const t = upper(X), b = lower(X)
      if (Number.isFinite(t) && Number.isFinite(b)) run.push({ X, t, b })
      else if (run.length) { runs.push(run); run = [] }
    }
    if (run.length) runs.push(run)
    const d = runs.filter((r) => r.length > 1).map((r) =>
      'M' + r.map((p) => `${px(p.X).toFixed(2)} ${py(clampY(p.t)).toFixed(2)}`).join('L')
      + 'L' + [...r].reverse().map((p) => `${px(p.X).toFixed(2)} ${py(clampY(p.b)).toFixed(2)}`).join('L') + 'Z').join('')
    if (!d) return
    const value = integrate((x) => upper(x) - lower(x), from, to)
    const auto = value === null ? '' : `A = ∫[${fmt(from)}, ${fmt(to)}] = ${formatValue(value)}`
    const text = area.label ?? auto
    // The label sits inside the region, where it is tallest (clamped so it fits between the limits), low enough to stay clear of the curve.
    const half = (text.length * 6.4) / 2 + 4
    let bestX = (from + to) / 2, bestH = -1
    for (let i = 1; i < 20; i += 1) {
      const X = from + ((to - from) * i) / 20
      const t = upper(X), b = lower(X)
      if (!Number.isFinite(t) || !Number.isFinite(b)) continue
      const height = Math.abs(py(clampY(t)) - py(clampY(b)))
      if (height > bestH) { bestH = height; bestX = X }
    }
    const lo = px(from) + half, hi = px(to) - half
    const lx = lo <= hi ? Math.min(Math.max(px(bestX), lo), hi) : px((from + to) / 2)
    const lxX = xa + ((lx - gx) / gw) * (xb - xa)
    const mt = upper(lxX), mb = lower(lxX)
    const ly = Number.isFinite(mt) && Number.isFinite(mb) ? py(clampY(mb + (mt - mb) * 0.38)) + 4 : py((ya + yb) / 2)
    out.areas.push({ d, color: area.color || AREA_COLORS[index % AREA_COLORS.length], label: text, lx, ly, value })
  })

  // Riemann rectangles: exact heights from the function at the left/right/middle of every slice.
  const rm = spec.riemann
  if (rm && rm.to > rm.from) {
    const f = compileFn(rm.expr) || main
    const n = Math.min(Math.max(Math.round(rm.n), 1), 60)
    if (f) {
      const dx = (rm.to - rm.from) / n
      let total = 0
      let valid = true
      for (let i = 0; i < n; i += 1) {
        const a = rm.from + i * dx, b = a + dx
        const height = rm.kind === 'left' ? f(a) : rm.kind === 'right' ? f(b) : rm.kind === 'mid' ? f(a + dx / 2) : (f(a) + f(b)) / 2
        if (!Number.isFinite(height)) { valid = false; continue }
        total += height * dx
        const yTop = py(clampY(Math.max(height, 0))), yBot = py(clampY(Math.min(height, 0)))
        out.rects.push({ x: px(a), y: yTop, w: px(b) - px(a), h: Math.max(yBot - yTop, 0.5) })
      }
      if (valid) {
        const kind = rm.kind === 'left' ? 'sinistra' : rm.kind === 'right' ? 'destra' : rm.kind === 'mid' ? 'punto medio' : 'trapezi'
        out.riemannLabel = { text: `Somma di Riemann (${n} rettangoli, ${kind}) ≈ ${formatValue(total)}`, x: gx + 8, y: gy + 16 }
      }
    }
  }

  // Drop lines at the limits (and at any x the model asks for): axis → curve, with the value under the axis.
  const limits = new Map<number, string>()
  for (const a of spec.areas || []) { limits.set(a.from, ''); limits.set(a.to, '') }
  if (rm) { limits.set(rm.from, ''); limits.set(rm.to, '') }
  for (const v of spec.vlines || []) limits.set(v.x, v.label || '')
  ;[...limits.entries()].slice(0, 8).forEach(([X, label]) => {
    if (X < xa || X > xb) return
    const y = main ? main(X) : NaN
    const yEnd = Number.isFinite(y) ? clampY(y) : yb
    const x = px(X)
    out.vlines.push({ x1: x, y1: py(0 >= ya && 0 <= yb ? 0 : ya), x2: x, y2: py(yEnd), label: label || fmt(X), lx: x, ly: Math.min(axisY + 28, gy + gh + 26) })
  })

  for (const m of spec.marks || []) {
    if (m.x >= xa && m.x <= xb && m.y >= ya && m.y <= yb) out.marks.push({ x: px(m.x), y: py(m.y), label: m.label || '' })
  }
  return out
}
