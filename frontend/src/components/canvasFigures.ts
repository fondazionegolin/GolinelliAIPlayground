/**
 * Figure library of the smart canvas. The model only gives DATA (slices, series, fractions, sets…); everything geometric is
 * computed and drawn here, exactly: angles, percentages, exact fractions, quartiles, regression, probabilities, truth tables.
 * Each renderer returns a self-contained SVG string, used both on the board and (rasterised) when the assistant looks at it.
 */

export type Frac = [number, number]

export type PieSpec = { guided?: boolean; fig: 'pie'; title?: string; slices: Array<{ label: string; value: number; color?: string }>; donut?: boolean; show?: 'percent' | 'value' | 'both' | 'none' }
export type BarSpec = { guided?: boolean; fig: 'bar'; title?: string; categories: string[]; series: Array<{ name: string; values: number[]; color?: string }>; orientation?: 'vertical' | 'horizontal'; stacked?: boolean; x_label?: string; y_label?: string }
export type LineSpec = { guided?: boolean; fig: 'line'; title?: string; x: Array<number | string>; series: Array<{ name: string; values: number[]; color?: string }>; x_label?: string; y_label?: string; markers?: boolean }
export type HistogramSpec = { guided?: boolean; fig: 'histogram'; title?: string; values: number[]; bins?: number; x_label?: string }
export type ScatterSpec = { guided?: boolean; fig: 'scatter'; title?: string; points: Array<[number, number]>; regression?: boolean; x_label?: string; y_label?: string }
export type BoxplotSpec = { guided?: boolean; fig: 'boxplot'; title?: string; groups: Array<{ name: string; values: number[] }>; y_label?: string }
export type NormalSpec = { guided?: boolean; fig: 'normal'; title?: string; mean: number; sd: number; from?: number | null; to?: number | null }
export type FractionSpec = { guided?: boolean; fig: 'fraction'; title?: string; op: 'show' | 'compare' | 'add' | 'sub' | 'multiply' | 'divide'; model?: 'pie' | 'bar'; fractions: Frac[] }
export type VennSpec = { guided?: boolean; fig: 'venn'; title?: string; sets: Array<{ label: string }>; regions?: Array<{ sets: string; text: string }>; outside?: string }
export type NumberlineSpec = { guided?: boolean; fig: 'numberline'; title?: string; min: number; max: number; step?: number; denominator?: number; points?: Array<{ value: number; label?: string; open?: boolean }>; intervals?: Array<{ from: number; to: number; from_open?: boolean; to_open?: boolean; label?: string }> }
export type TruthTableSpec = { guided?: boolean; fig: 'truth_table'; title?: string; variables: string[]; expressions: string[]; symbols?: 'VF' | '10' }
export type TreeNode = { label: string; p?: number | string; children?: TreeNode[] }
export type TreeSpec = { guided?: boolean; fig: 'tree'; title?: string; root: TreeNode }
/** Declarative engines for what the built-in figures do not cover. */
export type VegaSpec = { guided?: boolean; fig: 'vega'; title?: string; def: Record<string, unknown> }
export type JsxGraphSpec = { guided?: boolean; fig: 'jsxgraph'; title?: string; def: JsxGraphDef }
export type JsxElement = { id?: string; type: string; args?: unknown[]; attrs?: Record<string, string | number | boolean> }
export type JsxGraphDef = { boundingbox?: [number, number, number, number]; axis?: boolean; grid?: boolean; elements: JsxElement[] }

export type FigureSpec = PieSpec | BarSpec | LineSpec | HistogramSpec | ScatterSpec | BoxplotSpec | NormalSpec | FractionSpec | VennSpec | NumberlineSpec | TruthTableSpec | TreeSpec | VegaSpec | JsxGraphSpec
export const ENGINE_FIGS = ['vega', 'jsxgraph']
export const isEngine = (spec: FigureSpec): spec is VegaSpec | JsxGraphSpec => ENGINE_FIGS.includes(spec.fig)

export const PALETTE = ['#6366f1', '#e85c8d', '#0d9488', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#84cc16', '#f97316', '#64748b', '#06b6d4']
const INK = '#0f172a', MUTED = '#64748b', GRID = '#e2e8f0'

// ─── tiny helpers ─────────────────────────────────────────────────────────────

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (n: number) => Math.round(n * 100) / 100
/** Italian number: comma decimals, up to `d` digits, no trailing zeros. */
export const fmt = (v: number, d = 2) => {
  if (!Number.isFinite(v)) return '–'
  const s = String(Math.round(v * 10 ** d) / 10 ** d)
  return s.replace('.', ',')
}
const pct = (v: number) => `${fmt(v * 100, 1)}%`
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(n - 1, 1))}…` : s)

interface TextOpts { size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number; fill?: string; italic?: boolean; baseline?: 'auto' | 'middle' | 'hanging' }
const T = (x: number, y: number, text: unknown, o: TextOpts = {}) =>
  `<text x="${r2(x)}" y="${r2(y)}" font-size="${o.size ?? 12}" text-anchor="${o.anchor ?? 'start'}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? '#334155'}"${o.italic ? ' font-style="italic"' : ''}${o.baseline ? ` dominant-baseline="${o.baseline}"` : ''}>${esc(text)}</text>`
const textW = (s: string, size: number) => s.length * size * 0.56

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (const para of String(text).split(/\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > maxChars) { out.push(line); line = word } else line = line ? `${line} ${word}` : word
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}

function shell(w: number, h: number, title: string | undefined, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif">`
    + `<rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="14" fill="#ffffff" stroke="${GRID}" stroke-width="1.5"/>`
    + (title ? T(18, 28, shorten(title, Math.max(12, Math.floor((w - 36) / 7.6))), { size: 15, weight: 600, fill: INK }) : '')
    + body + '</svg>'
}
const topOf = (title?: string) => (title ? 46 : 20)

/** Axis ticks with round numbers covering [lo, hi]. */
export function niceScale(lo: number, hi: number, target = 5): { min: number; max: number; step: number; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1 }
  if (lo === hi) { hi = lo + 1 }
  const span = hi - lo
  const raw = span / Math.max(target, 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return { min, max, step, ticks }
}

// ─── exact fractions ──────────────────────────────────────────────────────────

export const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b] } return a || 1 }
export const lcm = (a: number, b: number) => Math.abs(a * b) / gcd(a, b)
export const reduce = ([n, d]: Frac): Frac => { if (d < 0) { n = -n; d = -d } const g = gcd(n, d); return [n / g, d / g] }
export const fracText = ([n, d]: Frac) => (d === 1 ? String(n) : `${n}/${d}`)
export const fracValue = ([n, d]: Frac) => n / d
export const fAdd = (a: Frac, b: Frac): Frac => reduce([a[0] * b[1] + b[0] * a[1], a[1] * b[1]])
export const fSub = (a: Frac, b: Frac): Frac => reduce([a[0] * b[1] - b[0] * a[1], a[1] * b[1]])
export const fMul = (a: Frac, b: Frac): Frac => reduce([a[0] * b[0], a[1] * b[1]])
export const fDiv = (a: Frac, b: Frac): Frac => reduce([a[0] * b[1], a[1] * b[0]])
/** «6/5 = 1 e 1/5 = 1,2» style chain for a result. */
export function fracChain(raw: Frac): string {
  const f = reduce(raw)
  const parts = [fracText(raw)]
  if (fracText(f) !== fracText(raw)) parts.push(fracText(f))
  if (Math.abs(f[0]) > f[1] && f[1] !== 1) parts.push(`${Math.trunc(f[0] / f[1])} e ${Math.abs(f[0] % f[1])}/${f[1]}`)
  if (f[1] !== 1) parts.push(fmt(fracValue(f), 4))
  return parts.join(' = ')
}

// ─── pie ──────────────────────────────────────────────────────────────────────

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number, inner = 0): string {
  const p = (a: number, rad: number) => `${r2(cx + rad * Math.cos(a))} ${r2(cy + rad * Math.sin(a))}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  if (inner > 0) return `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`
  return `M ${r2(cx)} ${r2(cy)} L ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} Z`
}

function pieSvg(s: PieSpec, w: number, h: number): string {
  const slices = s.slices.filter((x) => x.value > 0)
  const total = slices.reduce((a, b) => a + b.value, 0)
  const top = topOf(s.title)
  if (!total) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessun dato', { anchor: 'middle', fill: MUTED }))
  const legendW = Math.min(w * 0.42, 190)
  const R = Math.max(Math.min((w - legendW - 40) / 2, (h - top - 18) / 2), 30)
  const cx = 18 + R, cy = top + (h - top) / 2
  const show = s.show ?? 'percent'
  let a = -Math.PI / 2
  let body = ''
  slices.forEach((sl, i) => {
    const frac = sl.value / total
    const a1 = a + frac * Math.PI * 2
    const color = sl.color || PALETTE[i % PALETTE.length]
    body += slices.length === 1
      ? `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R)}" fill="${color}" stroke="#fff" stroke-width="2"/>`
      : `<path d="${arcPath(cx, cy, R, a, a1, s.donut ? R * 0.55 : 0)}" fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>`
    if (frac >= 0.05 && show !== 'none') {
      const mid = (a + a1) / 2, rr = s.donut ? R * 0.78 : R * 0.66
      const label = show === 'value' ? fmt(sl.value) : pct(frac)
      body += T(cx + rr * Math.cos(mid), cy + rr * Math.sin(mid), label, { size: Math.max(11, Math.min(15, R / 7)), weight: 600, fill: '#fff', anchor: 'middle', baseline: 'middle' })
    }
    a = a1
  })
  if (s.donut) body += T(cx, cy, fmt(total), { size: Math.max(14, R / 4), weight: 600, fill: INK, anchor: 'middle', baseline: 'middle' })
  // legend
  const lx = cx + R + 28, rowH = Math.min(26, (h - top - 20) / Math.max(slices.length, 1))
  let ly = cy - (slices.length * rowH) / 2 + rowH / 2
  const chars = Math.floor((w - lx - 22) / 7)
  slices.forEach((sl, i) => {
    const frac = sl.value / total
    const tail = show === 'both' ? ` · ${fmt(sl.value)} (${pct(frac)})` : show === 'value' ? ` · ${fmt(sl.value)}` : show === 'percent' ? ` · ${pct(frac)}` : ''
    body += `<rect x="${r2(lx)}" y="${r2(ly - 6)}" width="12" height="12" rx="3" fill="${sl.color || PALETTE[i % PALETTE.length]}"/>` + T(lx + 19, ly, shorten(sl.label + tail, Math.max(chars, 8)), { size: 12.5, baseline: 'middle' })
    ly += rowH
  })
  return shell(w, h, s.title, body)
}

// ─── axes shared by bar / line / scatter / histogram ─────────────────────────

interface Frame { l: number; t: number; r: number; b: number }
function axesFrame(w: number, h: number, title: string | undefined, o: { xLabel?: string; yLabel?: string; legend?: boolean; left?: number }): Frame {
  return { l: o.left ?? 54 + (o.yLabel ? 8 : 0), t: topOf(title) + (o.legend ? 20 : 0), r: w - 20, b: h - (o.xLabel ? 54 : 38) }
}
function yAxis(f: Frame, sc: { min: number; max: number; ticks: number[] }, label?: string): { body: string; y: (v: number) => number } {
  const y = (v: number) => f.b - ((v - sc.min) / (sc.max - sc.min)) * (f.b - f.t)
  let body = ''
  for (const t of sc.ticks) body += `<line x1="${f.l}" x2="${f.r}" y1="${r2(y(t))}" y2="${r2(y(t))}" stroke="${t === 0 ? '#94a3b8' : GRID}" stroke-width="${t === 0 ? 1.5 : 1}"/>` + T(f.l - 8, y(t), fmt(t), { size: 11, anchor: 'end', fill: MUTED, baseline: 'middle' })
  if (label) body += `<text transform="translate(14 ${r2((f.t + f.b) / 2)}) rotate(-90)" font-size="12" text-anchor="middle" fill="${MUTED}">${esc(label)}</text>`
  return { body, y }
}
const legendRow = (names: Array<{ name: string; color: string }>, x: number, y: number, maxW: number) => {
  let cx = x, body = ''
  for (const n of names) {
    const lbl = shorten(n.name, 22), wd = textW(lbl, 12) + 26
    if (cx + wd > x + maxW) break
    body += `<rect x="${r2(cx)}" y="${y - 6}" width="12" height="12" rx="3" fill="${n.color}"/>` + T(cx + 17, y, lbl, { size: 12, baseline: 'middle' })
    cx += wd + 10
  }
  return body
}

// ─── bar ──────────────────────────────────────────────────────────────────────

function barSvg(s: BarSpec, w: number, h: number): string {
  const cats = s.categories.length, ns = s.series.length
  if (!cats || !ns) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessun dato', { anchor: 'middle', fill: MUTED }))
  const colors = s.series.map((x, i) => x.color || PALETTE[i % PALETTE.length])
  const val = (si: number, ci: number) => s.series[si].values[ci] ?? 0
  const stacked = !!s.stacked && ns > 1
  const horizontal = s.orientation === 'horizontal'
  let lo = 0, hi = 0
  for (let c = 0; c < cats; c++) {
    if (stacked) { let pos = 0, neg = 0; for (let k = 0; k < ns; k++) { const v = val(k, c); if (v >= 0) pos += v; else neg += v } hi = Math.max(hi, pos); lo = Math.min(lo, neg) }
    else for (let k = 0; k < ns; k++) { hi = Math.max(hi, val(k, c)); lo = Math.min(lo, val(k, c)) }
  }
  const sc = niceScale(lo, hi * 1.06, 5)
  let body = ''
  const legend = ns > 1
  if (legend) body += legendRow(s.series.map((x, i) => ({ name: x.name, color: colors[i] })), 18, topOf(s.title) + 2, w - 36)
  if (horizontal) {
    const f: Frame = { l: 18 + Math.min(120, Math.max(...s.categories.map((c) => textW(shorten(c, 16), 12))) + 14), t: topOf(s.title) + (legend ? 20 : 0), r: w - 28, b: h - (s.y_label ? 44 : 30) }
    const x = (v: number) => f.l + ((v - sc.min) / (sc.max - sc.min)) * (f.r - f.l)
    for (const t of sc.ticks) body += `<line y1="${f.t}" y2="${f.b}" x1="${r2(x(t))}" x2="${r2(x(t))}" stroke="${t === 0 ? '#94a3b8' : GRID}"/>` + T(x(t), f.b + 16, fmt(t), { size: 11, anchor: 'middle', fill: MUTED })
    if (s.y_label) body += T((f.l + f.r) / 2, h - 10, s.y_label, { size: 12, anchor: 'middle', fill: MUTED })
    const band = (f.b - f.t) / cats, inner = band * 0.72
    for (let c = 0; c < cats; c++) {
      const y0 = f.t + c * band + (band - inner) / 2
      body += T(f.l - 8, f.t + c * band + band / 2, shorten(s.categories[c], 16), { size: 12, anchor: 'end', baseline: 'middle' })
      let acc = 0
      for (let k = 0; k < ns; k++) {
        const v = val(k, c)
        const bh = stacked ? inner : inner / ns, by = stacked ? y0 : y0 + k * bh
        const a = stacked ? acc : 0, b = stacked ? acc + v : v
        body += `<rect x="${r2(Math.min(x(a), x(b)))}" y="${r2(by)}" width="${r2(Math.abs(x(b) - x(a)))}" height="${r2(bh - 2)}" rx="4" fill="${colors[k]}"/>`
        if (!stacked || ns === 1) body += T(x(b) + (v >= 0 ? 5 : -5), by + bh / 2 - 1, fmt(v), { size: 11, weight: 600, anchor: v >= 0 ? 'start' : 'end', baseline: 'middle' })
        acc = b
      }
    }
    return shell(w, h, s.title, body)
  }
  const f = axesFrame(w, h, s.title, { xLabel: s.x_label, yLabel: s.y_label, legend })
  const ax = yAxis(f, sc, s.y_label)
  body += ax.body
  const band = (f.r - f.l) / cats, inner = band * 0.72
  for (let c = 0; c < cats; c++) {
    const x0 = f.l + c * band + (band - inner) / 2
    let acc = 0
    for (let k = 0; k < ns; k++) {
      const v = val(k, c)
      const bw = stacked ? inner : inner / ns, bx = stacked ? x0 : x0 + k * bw
      const a = stacked ? acc : 0, b = stacked ? acc + v : v
      body += `<rect x="${r2(bx)}" y="${r2(Math.min(ax.y(a), ax.y(b)))}" width="${r2(bw - 2)}" height="${r2(Math.abs(ax.y(b) - ax.y(a)))}" rx="4" fill="${colors[k]}"/>`
      if ((!stacked || ns === 1) && bw > 18) body += T(bx + (bw - 2) / 2, v >= 0 ? ax.y(b) - 5 : ax.y(b) + 14, fmt(v), { size: 11, weight: 600, anchor: 'middle' })
      acc = b
    }
    const lbl = shorten(s.categories[c], Math.max(3, Math.floor(band / 6.8)))
    body += T(f.l + c * band + band / 2, f.b + 17, lbl, { size: 12, anchor: 'middle' })
  }
  if (s.x_label) body += T((f.l + f.r) / 2, h - 12, s.x_label, { size: 12, anchor: 'middle', fill: MUTED })
  return shell(w, h, s.title, body)
}

// ─── line ─────────────────────────────────────────────────────────────────────

function lineSvg(s: LineSpec, w: number, h: number): string {
  const n = s.x.length
  if (!n || !s.series.length) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessun dato', { anchor: 'middle', fill: MUTED }))
  const colors = s.series.map((x, i) => x.color || PALETTE[i % PALETTE.length])
  const all = s.series.flatMap((x) => x.values.filter(Number.isFinite))
  const sc = niceScale(Math.min(0, ...all), Math.max(...all) * 1.05 || 1, 5)
  const legend = s.series.length > 1
  const f = axesFrame(w, h, s.title, { xLabel: s.x_label, yLabel: s.y_label, legend })
  const ax = yAxis(f, sc, s.y_label)
  let body = (legend ? legendRow(s.series.map((x, i) => ({ name: x.name, color: colors[i] })), 18, topOf(s.title) + 2, w - 36) : '') + ax.body
  const numeric = s.x.every((v) => typeof v === 'number')
  const xs = s.x.map((v) => Number(v))
  const xmin = Math.min(...xs), xmax = Math.max(...xs)
  const px = (i: number) => (numeric && xmax > xmin ? f.l + 14 + ((xs[i] - xmin) / (xmax - xmin)) * (f.r - f.l - 28) : f.l + 14 + (n === 1 ? (f.r - f.l - 28) / 2 : (i / (n - 1)) * (f.r - f.l - 28)))
  const every = Math.max(1, Math.ceil((n * 40) / (f.r - f.l)))
  for (let i = 0; i < n; i += every) body += T(px(i), f.b + 17, numeric ? fmt(xs[i]) : shorten(String(s.x[i]), 12), { size: 12, anchor: 'middle' })
  s.series.forEach((sr, k) => {
    const pts = sr.values.slice(0, n).map((v, i) => [px(i), ax.y(v)] as const)
    body += `<polyline fill="none" stroke="${colors[k]}" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' ')}"/>`
    if (s.markers !== false) for (const p of pts) body += `<circle cx="${r2(p[0])}" cy="${r2(p[1])}" r="4" fill="#fff" stroke="${colors[k]}" stroke-width="2.5"/>`
  })
  if (s.x_label) body += T((f.l + f.r) / 2, h - 12, s.x_label, { size: 12, anchor: 'middle', fill: MUTED })
  return shell(w, h, s.title, body)
}

// ─── statistics helpers ───────────────────────────────────────────────────────

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1)
/** Linear-interpolation quantile (the usual spreadsheet definition). */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
export function histogramBins(values: number[], bins?: number): { edges: number[]; counts: number[] } {
  const v = values.filter(Number.isFinite)
  if (!v.length) return { edges: [0, 1], counts: [0] }
  const lo = Math.min(...v), hi = Math.max(...v)
  const k = Math.min(Math.max(bins ?? Math.ceil(Math.log2(v.length) + 1), 2), 40)
  const span = hi === lo ? 1 : hi - lo
  const step = span / k
  const edges = Array.from({ length: k + 1 }, (_, i) => lo + i * step)
  const counts = new Array(k).fill(0)
  for (const x of v) counts[Math.min(k - 1, Math.floor((x - lo) / step))]++
  return { edges, counts }
}
export function regression(pts: Array<[number, number]>): { slope: number; intercept: number; r: number } | null {
  const n = pts.length
  if (n < 2) return null
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]))
  let sxx = 0, sxy = 0, syy = 0
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2 }
  if (!sxx) return null
  return { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, r: syy ? sxy / Math.sqrt(sxx * syy) : 0 }
}

function histogramSvg(s: HistogramSpec, w: number, h: number): string {
  const v = s.values.filter(Number.isFinite)
  if (!v.length) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessun dato', { anchor: 'middle', fill: MUTED }))
  const { edges, counts } = histogramBins(v, s.bins)
  const sc = niceScale(0, Math.max(...counts) * 1.1, 5)
  const f = { ...axesFrame(w, h, s.title, { xLabel: s.x_label ?? 'valori', yLabel: 'frequenza' }), b: h - 66 }
  const ax = yAxis(f, sc, 'frequenza')
  let body = ax.body
  const bw = (f.r - f.l) / counts.length
  counts.forEach((c, i) => {
    body += `<rect x="${r2(f.l + i * bw + 1)}" y="${r2(ax.y(c))}" width="${r2(bw - 2)}" height="${r2(f.b - ax.y(c))}" rx="3" fill="${PALETTE[0]}" fill-opacity="0.85"/>`
    if (c > 0) body += T(f.l + i * bw + bw / 2, ax.y(c) - 5, c, { size: 11, weight: 600, anchor: 'middle' })
  })
  const every = Math.max(1, Math.ceil((edges.length * 38) / (f.r - f.l)))
  edges.forEach((e, i) => { if (i % every === 0) body += T(f.l + i * bw, f.b + 16, fmt(e, 2), { size: 11, anchor: 'middle', fill: MUTED }) })
  body += T((f.l + f.r) / 2, h - 32, s.x_label ?? 'valori', { size: 12, anchor: 'middle', fill: MUTED })
  const sorted = [...v].sort((a, b) => a - b)
  body += T((f.l + f.r) / 2, h - 10, s.guided ? `n = ${v.length}` : `n = ${v.length} · media ${fmt(mean(v))} · mediana ${fmt(quantile(sorted, 0.5))}`, { size: 11.5, anchor: 'middle', fill: MUTED })
  return shell(w, h, s.title, body)
}

function scatterSvg(s: ScatterSpec, w: number, h: number): string {
  const pts = s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (!pts.length) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessun dato', { anchor: 'middle', fill: MUTED }))
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const sx = niceScale(Math.min(...xs), Math.max(...xs), 6), sy = niceScale(Math.min(...ys), Math.max(...ys), 5)
  const f = axesFrame(w, h, s.title, { xLabel: s.x_label ?? ' ', yLabel: s.y_label })
  const ay = yAxis(f, sy, s.y_label)
  const px = (v: number) => f.l + ((v - sx.min) / (sx.max - sx.min)) * (f.r - f.l)
  let body = ay.body
  for (const t of sx.ticks) body += `<line x1="${r2(px(t))}" x2="${r2(px(t))}" y1="${f.t}" y2="${f.b}" stroke="${GRID}"/>` + T(px(t), f.b + 16, fmt(t), { size: 11, anchor: 'middle', fill: MUTED })
  if (s.x_label) body += T((f.l + f.r) / 2, h - 12, s.x_label, { size: 12, anchor: 'middle', fill: MUTED })
  const reg = s.regression ? regression(pts) : null
  if (reg) {
    const x0 = sx.min, x1 = sx.max
    body += `<line x1="${r2(px(x0))}" y1="${r2(ay.y(reg.slope * x0 + reg.intercept))}" x2="${r2(px(x1))}" y2="${r2(ay.y(reg.slope * x1 + reg.intercept))}" stroke="${PALETTE[1]}" stroke-width="2.5" stroke-dasharray="7 5"/>`
    if (!s.guided) body += T(w - 18, 28, `y = ${fmt(reg.slope, 3)}x ${reg.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(reg.intercept), 3)} · r = ${fmt(reg.r, 3)}`, { size: 12, weight: 600, anchor: 'end', fill: PALETTE[1] })
  }
  for (const [x, y] of pts) body += `<circle cx="${r2(px(x))}" cy="${r2(ay.y(y))}" r="5" fill="${PALETTE[0]}" fill-opacity="0.8" stroke="#fff" stroke-width="1.5"/>`
  return shell(w, h, s.title, body)
}

function boxplotSvg(s: BoxplotSpec, w: number, h: number): string {
  const groups = s.groups.filter((g) => g.values.some(Number.isFinite))
  if (!groups.length) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessun dato', { anchor: 'middle', fill: MUTED }))
  const stats = groups.map((g) => {
    const v = g.values.filter(Number.isFinite).sort((a, b) => a - b)
    const q1 = quantile(v, 0.25), med = quantile(v, 0.5), q3 = quantile(v, 0.75), iqr = q3 - q1
    const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr)
    return { q1, med, q3, lo: inside[0] ?? v[0], hi: inside[inside.length - 1] ?? v[v.length - 1], out: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) }
  })
  const all = stats.flatMap((st) => [st.lo, st.hi, ...st.out])
  const sc = niceScale(Math.min(...all), Math.max(...all), 5)
  const f = axesFrame(w, h, s.title, { yLabel: s.y_label })
  const ay = yAxis(f, sc, s.y_label)
  let body = ay.body
  const band = (f.r - f.l) / groups.length, bw = Math.min(70, band * 0.5)
  stats.forEach((st, i) => {
    const cx = f.l + i * band + band / 2, color = PALETTE[i % PALETTE.length]
    body += `<line x1="${r2(cx)}" x2="${r2(cx)}" y1="${r2(ay.y(st.hi))}" y2="${r2(ay.y(st.lo))}" stroke="${color}" stroke-width="2"/>`
    for (const v of [st.lo, st.hi]) body += `<line x1="${r2(cx - bw / 4)}" x2="${r2(cx + bw / 4)}" y1="${r2(ay.y(v))}" y2="${r2(ay.y(v))}" stroke="${color}" stroke-width="2"/>`
    body += `<rect x="${r2(cx - bw / 2)}" y="${r2(ay.y(st.q3))}" width="${r2(bw)}" height="${r2(Math.max(ay.y(st.q1) - ay.y(st.q3), 1))}" rx="4" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="2"/>`
    body += `<line x1="${r2(cx - bw / 2)}" x2="${r2(cx + bw / 2)}" y1="${r2(ay.y(st.med))}" y2="${r2(ay.y(st.med))}" stroke="${color}" stroke-width="3.5"/>`
    if (!s.guided) body += T(cx + bw / 2 + 6, ay.y(st.med), fmt(st.med), { size: 11, weight: 600, baseline: 'middle' })
    for (const o of st.out) body += `<circle cx="${r2(cx)}" cy="${r2(ay.y(o))}" r="3.5" fill="none" stroke="${color}" stroke-width="2"/>`
    body += T(cx, f.b + 17, shorten(groups[i].name, Math.max(3, Math.floor(band / 6.8))), { size: 12, anchor: 'middle' })
  })
  return shell(w, h, s.title, body)
}

// ─── normal distribution ─────────────────────────────────────────────────────

export function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
export const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))

function normalSvg(s: NormalSpec, w: number, h: number): string {
  const sd = s.sd > 0 ? s.sd : 1
  const xmin = s.mean - 4 * sd, xmax = s.mean + 4 * sd
  const f: Frame = { l: 24, t: topOf(s.title) + 8, r: w - 24, b: h - 66 }
  const px = (x: number) => f.l + ((x - xmin) / (xmax - xmin)) * (f.r - f.l)
  const pdf = (x: number) => Math.exp(-0.5 * ((x - s.mean) / sd) ** 2)
  const py = (x: number) => f.b - pdf(x) * (f.b - f.t - 10)
  const a = s.from == null ? null : Math.max(s.from, xmin), b = s.to == null ? null : Math.min(s.to, xmax)
  const lo = a ?? (b == null ? null : xmin), hi = b ?? (a == null ? null : xmax)
  const curve = Array.from({ length: 121 }, (_, i) => xmin + (i / 120) * (xmax - xmin))
  let body = ''
  let prob: number | null = null
  if (lo != null && hi != null && hi > lo) {
    const seg = curve.filter((x) => x > lo && x < hi)
    const pts = [lo, ...seg, hi]
    body += `<path d="M ${r2(px(lo))} ${r2(f.b)} ${pts.map((x) => `L ${r2(px(x))} ${r2(py(x))}`).join(' ')} L ${r2(px(hi))} ${r2(f.b)} Z" fill="${PALETTE[1]}" fill-opacity="0.35"/>`
    prob = normalCdf(((s.to == null ? Infinity : s.to) - s.mean) / sd) - normalCdf(((s.from == null ? -Infinity : s.from) - s.mean) / sd)
  }
  body += `<path d="M ${curve.map((x) => `${r2(px(x))} ${r2(py(x))}`).join(' L ')}" fill="none" stroke="${PALETTE[0]}" stroke-width="3" stroke-linejoin="round"/>`
  body += `<line x1="${f.l}" x2="${f.r}" y1="${f.b}" y2="${f.b}" stroke="#94a3b8" stroke-width="1.5"/>`
  for (let k = -3; k <= 3; k++) {
    const x = s.mean + k * sd
    body += `<line x1="${r2(px(x))}" x2="${r2(px(x))}" y1="${f.b}" y2="${f.b + 5}" stroke="#94a3b8"/>` + T(px(x), f.b + 19, fmt(x), { size: 11, anchor: 'middle', fill: MUTED })
    if (k !== 0) body += T(px(x), f.b + 33, `${k > 0 ? '+' : '−'}${Math.abs(k)}σ`, { size: 10.5, anchor: 'middle', fill: '#94a3b8' })
  }
  body += `<line x1="${r2(px(s.mean))}" x2="${r2(px(s.mean))}" y1="${r2(py(s.mean))}" y2="${f.b}" stroke="${PALETTE[0]}" stroke-dasharray="5 4"/>` + T(px(s.mean), f.b + 33, 'μ', { size: 12, weight: 600, anchor: 'middle', fill: PALETTE[0] })
  const head = `μ = ${fmt(s.mean)} · σ = ${fmt(sd)}` + (prob != null ? (s.guided ? ' · P = ?' : ` · P = ${fmt(prob * 100, 2)}%`) : '')
  body += T(w / 2, h - 8, head, { size: 12.5, weight: 600, anchor: 'middle', fill: prob != null ? PALETTE[1] : MUTED })
  return shell(w, h, s.title, body)
}

/** Wraps drawn content spanning [y0, y1] so that it sits in the vertical middle of [top, bottom]. */
const centered = (body: string, y0: number, y1: number, top: number, bottom: number) => {
  const dy = Math.max(0, top + (bottom - top - (y1 - y0)) / 2 - y0)
  return dy > 1 ? `<g transform="translate(0 ${r2(dy)})">${body}</g>` : body
}

// ─── fractions ────────────────────────────────────────────────────────────────

const FR_COLORS = ['#6366f1', '#e85c8d', '#0d9488', '#f59e0b']
const FR_SOFT = ['#e0e7ff', '#fce7f3', '#ccfbf1', '#fef3c7']

/** One bar of `units` unit-wide cells, each unit cut in `d` parts, `n` parts filled. */
function fracBar(x: number, y: number, unitW: number, hgt: number, units: number, d: number, n: number, color: string, soft: string): string {
  let out = ''
  const cell = unitW / d
  for (let i = 0; i < units * d; i++) out += `<rect x="${r2(x + i * cell)}" y="${y}" width="${r2(cell)}" height="${hgt}" fill="${i < n ? color : soft}" fill-opacity="${i < n ? 0.9 : 1}" stroke="#fff" stroke-width="1"/>`
  for (let u = 0; u <= units; u++) out += `<line x1="${r2(x + u * unitW)}" x2="${r2(x + u * unitW)}" y1="${y - 3}" y2="${y + hgt + 3}" stroke="#475569" stroke-width="2"/>`
  out += `<line x1="${x}" x2="${r2(x + units * unitW)}" y1="${y}" y2="${y}" stroke="#475569" stroke-width="2"/><line x1="${x}" x2="${r2(x + units * unitW)}" y1="${y + hgt}" y2="${y + hgt}" stroke="#475569" stroke-width="2"/>`
  return out
}
function fracPie(cx: number, cy: number, r: number, d: number, n: number, color: string, soft: string): string {
  if (d === 1) return `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r}" fill="${n >= 1 ? color : soft}" stroke="#475569" stroke-width="2"/>`
  let out = ''
  for (let i = 0; i < d; i++) {
    const a0 = -Math.PI / 2 + (i / d) * Math.PI * 2, a1 = -Math.PI / 2 + ((i + 1) / d) * Math.PI * 2
    out += `<path d="${arcPath(cx, cy, r, a0, a1)}" fill="${i < n ? color : soft}" fill-opacity="${i < n ? 0.9 : 1}" stroke="#fff" stroke-width="1.5"/>`
  }
  return out + `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r}" fill="none" stroke="#475569" stroke-width="2"/>`
}

function fractionSvg(s: FractionSpec, w: number, h: number): string {
  const fr = s.fractions.filter((f) => f[1] > 0 && Number.isFinite(f[0])).slice(0, 4)
  const top = topOf(s.title)
  if (!fr.length) return shell(w, h, s.title, T(w / 2, h / 2, 'Nessuna frazione', { anchor: 'middle', fill: MUTED }))
  const cap = (x: number, y: number, text: string, size = 14, color = INK, weight = 600) => T(x, y, text, { size, anchor: 'middle', weight, fill: color })
  const innerW = w - 40
  let body = ''

  if ((s.op === 'show' || s.op === 'compare') && (s.model ?? 'pie') === 'pie') {
    // pies: each fraction is as many whole pies as needed, every pie cut in `d` parts
    const blocks = fr.map((f) => ({ f, pies: Math.min(Math.max(Math.ceil(Math.abs(f[0]) / f[1]), 1), 6), d: Math.min(f[1], 24) }))
    const totalPies = blocks.reduce((a, b) => a + b.pies, 0)
    const gap = 14, groupGap = 34
    const r = Math.max(Math.min((innerW - (blocks.length - 1) * groupGap - (totalPies - blocks.length) * gap) / totalPies / 2, (h - top - 70) / 2, 80), 18)
    const rowW = totalPies * 2 * r + (totalPies - blocks.length) * gap + (blocks.length - 1) * groupGap
    let x = (w - rowW) / 2
    const cy = top + (h - top - 40) / 2
    blocks.forEach((b, gi) => {
      const start = x
      for (let p = 0; p < b.pies; p++) {
        const filled = Math.max(0, Math.min(b.f[0] - p * b.f[1], b.f[1]))
        body += fracPie(x + r, cy, r, b.d, filled, FR_COLORS[gi % 4], FR_SOFT[gi % 4])
        x += 2 * r + (p < b.pies - 1 ? gap : 0)
      }
      body += cap((start + x) / 2, cy + r + 24, fracText(b.f), 18, FR_COLORS[gi % 4])
      if (b.f[0] > b.f[1] && !s.guided) body += cap((start + x) / 2, cy + r + 42, `${Math.trunc(b.f[0] / b.f[1])} e ${b.f[0] % b.f[1]}/${b.f[1]} = ${fmt(fracValue(b.f), 3)}`, 12, MUTED, 400)
      x += groupGap
    })
    if (s.op === 'compare' && fr.length >= 2) {
      const a = fracValue(fr[0]), b = fracValue(fr[1])
      body += cap(w / 2, h - 12, s.guided ? `${fracText(fr[0])}  ?  ${fracText(fr[1])}` : `${fracText(fr[0])} ${a > b ? '>' : a < b ? '<' : '='} ${fracText(fr[1])}`, 15, INK)
    }
    return shell(w, h, s.title, body)
  }

  if (s.op === 'show' || s.op === 'compare') {
    // bars on the same unit scale, one per fraction
    const units = Math.max(...fr.map((f) => Math.max(Math.ceil(f[0] / f[1]), 1)))
    const unitW = Math.min((innerW - 30) / units, 260)
    const rowH = Math.min(46, (h - top - 50) / fr.length - 22)
    let y = top + 14
    const yStart = y
    fr.forEach((f, i) => {
      const x0 = (w - units * unitW) / 2
      body += fracBar(x0, y, unitW, rowH, Math.max(Math.ceil(f[0] / f[1]), 1) <= units ? Math.max(Math.ceil(f[0] / f[1]), 1) : units, Math.min(f[1], 24), f[0], FR_COLORS[i % 4], FR_SOFT[i % 4])
      body += T(x0 - 8, y + rowH / 2, fracText(f), { size: 16, weight: 600, anchor: 'end', fill: FR_COLORS[i % 4], baseline: 'middle' })
      y += rowH + 26
    })
    body = centered(body, yStart, y - 26 + rowH, top, s.op === 'compare' ? h - 36 : h - 8)
    if (s.op === 'compare' && fr.length >= 2) { const a = fracValue(fr[0]), b = fracValue(fr[1]); body += cap(w / 2, h - 12, s.guided ? `${fracText(fr[0])}  ?  ${fracText(fr[1])}` : `${fracText(fr[0])} ${a > b ? '>' : a < b ? '<' : '='} ${fracText(fr[1])}`, 15) }
    return shell(w, h, s.title, body)
  }

  const [a, b] = fr
  if (!b) return shell(w, h, s.title, T(w / 2, h / 2, 'Servono due frazioni', { anchor: 'middle', fill: MUTED }))

  if (s.op === 'multiply') {
    // area model: a/b of the width × c/d of the height; the overlap is the product
    const W = Math.max(Math.ceil(a[0] / a[1]), 1), H = Math.max(Math.ceil(b[0] / b[1]), 1)
    const cols = W * Math.min(a[1], 24), rows = H * Math.min(b[1], 24)
    const side = Math.max(Math.min((innerW - 40) / W, (h - top - 100) / H, 210), 40)
    const gx = (w - W * side) / 2, gy = top + 16
    const cw = (W * side) / cols, ch = (H * side) / rows
    const shadeC = Math.round((a[0] / a[1]) * Math.min(a[1], 24)), shadeR = Math.round((b[0] / b[1]) * Math.min(b[1], 24))
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const inC = i < shadeC, inR = j < shadeR
      const fill = inC && inR ? '#7c3aed' : inC ? '#a5b4fc' : inR ? '#f9a8d4' : '#f1f5f9'
      body += `<rect x="${r2(gx + i * cw)}" y="${r2(gy + j * ch)}" width="${r2(cw)}" height="${r2(ch)}" fill="${fill}" stroke="#fff" stroke-width="1"/>`
    }
    for (let u = 0; u <= W; u++) body += `<line x1="${r2(gx + u * side)}" x2="${r2(gx + u * side)}" y1="${gy}" y2="${r2(gy + H * side)}" stroke="#334155" stroke-width="2"/>`
    for (let u = 0; u <= H; u++) body += `<line y1="${r2(gy + u * side)}" y2="${r2(gy + u * side)}" x1="${gx}" x2="${r2(gx + W * side)}" stroke="#334155" stroke-width="2"/>`
    body += T(gx + (a[0] / a[1]) * side / 2, gy - 5, fracText(a), { size: 13, weight: 600, anchor: 'middle', fill: '#4f46e5' })
    body += T(gx - 8, gy + (b[0] / b[1]) * side / 2, fracText(b), { size: 13, weight: 600, anchor: 'end', fill: '#db2777', baseline: 'middle' })
    const prod: Frac = [a[0] * b[0], a[1] * b[1]]
    body += cap(w / 2, gy + H * side + 26, s.guided ? `${fracText(a)} × ${fracText(b)} = ?` : `${fracText(a)} × ${fracText(b)} = ${fracChain(prod)}`, 16)
    body += cap(w / 2, gy + H * side + 46, s.guided ? 'Quanti quadratini ci sono in tutto? Quanti sono viola? Che frazione dell’unità è ognuno?' : `la parte viola: ${a[0] * b[0]} quadratini, ognuno vale 1/${a[1] * b[1]} dell'unità`, 12, MUTED, 400)
    return shell(w, h, s.title, centered(body, gy - 18, gy + H * side + 52, top, h - 6))
  }

  if ((s.op === 'add' || s.op === 'sub') && s.guided) {
    // learner mode: the two quantities as they are, no common denominator and no result
    const units = Math.max(Math.ceil(a[0] / a[1]), Math.ceil(b[0] / b[1]), 1)
    const unitW = Math.min((innerW - 60) / units, 300), x0 = (w - units * unitW) / 2 + 10, rowH = Math.min(40, (h - top - 100) / 2)
    let y = top + 18
    for (const [i, f] of [a, b].entries()) { body += fracBar(x0, y, unitW, rowH, units, Math.min(f[1], 24), f[0], FR_COLORS[i], FR_SOFT[i]) + T(x0 - 8, y + rowH / 2, fracText(f), { size: 14, weight: 600, anchor: 'end', fill: FR_COLORS[i], baseline: 'middle' }); y += rowH + 14 }
    body += cap(w / 2, y + 14, `${fracText(a)} ${s.op === 'add' ? '+' : '−'} ${fracText(b)} = ?`, 16)
    body += cap(w / 2, y + 34, 'Le due barre hanno parti di grandezza diversa: come puoi tagliarle per poterle confrontare?', 12, MUTED, 400)
    return shell(w, h, s.title, centered(body, top + 10, y + 40, top, h - 6))
  }

  if (s.op === 'add' || s.op === 'sub') {
    // bars with a common denominator, then the result bar
    const D = lcm(a[1], b[1]), na = a[0] * (D / a[1]), nb = b[0] * (D / b[1])
    const res = s.op === 'add' ? na + nb : na - nb
    const units = Math.max(Math.ceil(Math.max(na, nb, Math.abs(res)) / D), 1)
    const unitW = Math.min((innerW - 60) / units, 300)
    const x0 = (w - units * unitW) / 2 + 10
    const rowH = Math.min(38, (h - top - 110) / 3)
    const cellsOk = D <= 48
    const bar = (y: number, n: number, color: string, soft: string, label: string, extra = '') => {
      body += cellsOk ? fracBar(x0, y, unitW, rowH, units, D, n, color, soft) : `<rect x="${x0}" y="${y}" width="${r2((n / D) * unitW)}" height="${rowH}" fill="${color}"/>`
      body += T(x0 - 8, y + rowH / 2, label, { size: 14, weight: 600, anchor: 'end', fill: color, baseline: 'middle' }) + extra
    }
    let y = top + 14
    bar(y, na, FR_COLORS[0], FR_SOFT[0], fracText(a)); y += rowH + 12
    bar(y, nb, FR_COLORS[1], FR_SOFT[1], fracText(b)); y += rowH + 20
    body += cap(w / 2, y, `stesso denominatore: ${na}/${D} ${s.op === 'add' ? '+' : '−'} ${nb}/${D} = ${res}/${D}`, 12.5, MUTED, 400); y += 12
    bar(y, Math.max(res, 0), FR_COLORS[2], FR_SOFT[2], '=')
    body += cap(w / 2, y + rowH + 28, `${fracText(a)} ${s.op === 'add' ? '+' : '−'} ${fracText(b)} = ${fracChain([res, D])}`, 16)
    return shell(w, h, s.title, centered(body, top + 8, y + rowH + 34, top, h - 6))
  }

  if (s.guided) {
    // learner mode: the quantity to share out and the size of one share, without the grouping or the count
    const unitsG = Math.max(Math.ceil(a[0] / a[1]), Math.ceil(b[0] / b[1]), 1)
    const unitWG = Math.min((innerW - 60) / unitsG, 300), x0G = (w - unitsG * unitWG) / 2, rowHG = 40
    let yG = top + 30
    body += fracBar(x0G, yG, unitWG, rowHG, unitsG, Math.min(a[1], 24), a[0], FR_COLORS[0], FR_SOFT[0]) + T(x0G, yG - 10, fracText(a), { size: 13, weight: 600, fill: FR_COLORS[0] })
    yG += rowHG + 34
    body += fracBar(x0G, yG, unitWG, rowHG, unitsG, Math.min(b[1], 24), b[0], FR_COLORS[1], FR_SOFT[1]) + T(x0G, yG - 10, fracText(b), { size: 13, weight: 600, fill: FR_COLORS[1] })
    body += cap(w / 2, yG + rowHG + 34, `${fracText(a)} ÷ ${fracText(b)} = ?`, 16)
    body += cap(w / 2, yG + rowHG + 54, `Quante volte ${fracText(b)} entra in ${fracText(a)}?`, 12, MUTED, 400)
    return shell(w, h, s.title, centered(body, top + 8, yG + rowHG + 60, top, h - 6))
  }
  // divide: how many times b fits in a, counted on a common-denominator bar
  const L = lcm(a[1], b[1]), na = a[0] * (L / a[1]), nb = Math.max(b[0] * (L / b[1]), 1)
  const units = Math.max(Math.ceil(na / L), 1)
  const unitW = Math.min((innerW - 60) / units, 300)
  const x0 = (w - units * unitW) / 2, rowH = 44, y = top + 28
  const cell = unitW / L
  const groups = Math.ceil(na / nb)
  for (let i = 0; i < units * L; i++) {
    const inA = i < na, g = Math.floor(i / nb)
    body += `<rect x="${r2(x0 + i * cell)}" y="${y}" width="${r2(cell)}" height="${rowH}" fill="${inA ? FR_COLORS[g % 2 ? 1 : 0] : '#f1f5f9'}" fill-opacity="${inA ? 0.85 : 1}" stroke="#fff" stroke-width="${L > 40 ? 0 : 1}"/>`
  }
  for (let g = 0; g <= groups; g++) { const xx = x0 + Math.min(g * nb, na) * cell; body += `<line x1="${r2(xx)}" x2="${r2(xx)}" y1="${y - 6}" y2="${y + rowH + 6}" stroke="#0f172a" stroke-width="2.5"/>` }
  for (let u = 0; u <= units; u++) body += `<line x1="${r2(x0 + u * unitW)}" x2="${r2(x0 + u * unitW)}" y1="${y - 14}" y2="${y - 6}" stroke="#475569" stroke-width="2"/>`
  body += T(x0, y - 18, `${fracText(a)} (unità tagliata in ${L} parti)`, { size: 12, fill: MUTED })
  const quotient: Frac = [a[0] * b[1], a[1] * b[0]]
  body += cap(w / 2, y + rowH + 34, `${fracText(a)} ÷ ${fracText(b)} = ${fracChain(quotient)}`, 16)
  body += cap(w / 2, y + rowH + 54, `${fracText(b)} entra ${fmt(fracValue(quotient), 3)} volte in ${fracText(a)}: ogni gruppo vale ${nb} ${nb === 1 ? 'parte' : 'parti'} su ${L}`, 12, MUTED, 400)
  body = centered(body, y - 34, y + rowH + 60, top, h - 6)
  return shell(w, h, s.title, body)
}

// ─── venn ─────────────────────────────────────────────────────────────────────

function vennSvg(s: VennSpec, w: number, h: number): string {
  const n = Math.min(Math.max(s.sets.length, 2), 3)
  const top = topOf(s.title)
  const R = n === 2 ? Math.min((w - 40) / 3.1, (h - top - 30) / 2.2) : Math.min((w - 40) / 3.2, (h - top - 66) / 2.96)
  const cx = w / 2, cy = n === 2 ? top + (h - top) / 2 : top + 22 + R * 1.32
  const d = R * (n === 2 ? 1.05 : 1.1)
  const centers: Array<[number, number]> = n === 2 ? [[cx - d / 2, cy], [cx + d / 2, cy]] : [[cx - d / 2, cy - d * 0.29], [cx + d / 2, cy - d * 0.29], [cx, cy + d * 0.58]]
  const g: [number, number] = [mean(centers.map((c) => c[0])), mean(centers.map((c) => c[1]))]
  const away = (p: [number, number], from: [number, number], k: number): [number, number] => { const dx = p[0] - from[0], dy = p[1] - from[1], l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * k, p[1] + (dy / l) * k] }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const pos: Record<string, [number, number]> = {}
  if (n === 2) { pos.A = [centers[0][0] - R * 0.42, cy]; pos.B = [centers[1][0] + R * 0.42, cy]; pos.AB = [cx, cy] }
  else {
    pos.A = away(centers[0], g, R * 0.52); pos.B = away(centers[1], g, R * 0.52); pos.C = away(centers[2], g, R * 0.52)
    pos.AB = away(mid(centers[0], centers[1]), centers[2], R * 0.3); pos.AC = away(mid(centers[0], centers[2]), centers[1], R * 0.3); pos.BC = away(mid(centers[1], centers[2]), centers[0], R * 0.3)
    pos.ABC = g
  }
  let body = ''
  centers.forEach((c, i) => { body += `<circle cx="${r2(c[0])}" cy="${r2(c[1])}" r="${r2(R)}" fill="${PALETTE[i]}" fill-opacity="0.22" stroke="${PALETTE[i]}" stroke-width="2.5"/>` })
  const labelPos: Array<[number, number, 'start' | 'middle' | 'end']> = n === 2
    ? [[centers[0][0] - R * 0.65, cy - R - 8, 'middle'], [centers[1][0] + R * 0.65, cy - R - 8, 'middle']]
    : [[centers[0][0] - R * 0.7, centers[0][1] - R - 6, 'middle'], [centers[1][0] + R * 0.7, centers[1][1] - R - 6, 'middle'], [cx, centers[2][1] + R + 18, 'middle']]
  s.sets.slice(0, n).forEach((st, i) => { body += T(labelPos[i][0], labelPos[i][1], shorten(st.label, 22), { size: 14, weight: 600, anchor: labelPos[i][2], fill: PALETTE[i] }) })
  const keyOf = (k: string) => k.toUpperCase().split('').filter((c) => 'ABC'.includes(c)).sort().join('')
  for (const rg of s.regions ?? []) {
    const p = pos[keyOf(rg.sets)]
    if (!p) continue
    const lines = rg.text.split(/\n|;\s*/).flatMap((l) => wrap(l, n === 2 ? 14 : 11)).slice(0, 7)
    lines.forEach((l, i) => { body += T(p[0], p[1] + (i - (lines.length - 1) / 2) * 15, l, { size: n === 2 ? 13 : 12, anchor: 'middle', baseline: 'middle', fill: INK }) })
  }
  if (s.outside) body += T(w - 22, h - 16, `fuori: ${shorten(s.outside, 40)}`, { size: 12, anchor: 'end', fill: MUTED })
  return shell(w, h, s.title, body)
}

// ─── number line ──────────────────────────────────────────────────────────────

function numberlineSvg(s: NumberlineSpec, w: number, h: number): string {
  const min = Math.min(s.min, s.max), max = Math.max(s.min, s.max)
  const sc = s.step && s.step > 0 ? { step: s.step } : niceScale(min, max, 10)
  const f = { l: 40, r: w - 40 }
  const y = topOf(s.title) + (h - topOf(s.title)) / 2
  const x = (v: number) => f.l + ((v - min) / (max - min || 1)) * (f.r - f.l)
  let body = `<line x1="${f.l - 18}" x2="${f.r + 18}" y1="${r2(y)}" y2="${r2(y)}" stroke="#334155" stroke-width="2.5"/>`
  body += `<path d="M ${f.r + 18} ${r2(y)} l -9 -5 v 10 Z M ${f.l - 18} ${r2(y)} l 9 -5 v 10 Z" fill="#334155"/>`
  const den = s.denominator && s.denominator > 0 ? Math.min(Math.round(s.denominator), 24) : 0
  const step = den ? 1 / den : sc.step
  const count = Math.round((max - min) / step)
  const every = Math.max(1, Math.ceil((count * 36) / (f.r - f.l)))
  for (let i = 0; i <= count; i++) {
    const v = min + i * step, major = den ? Math.abs(v - Math.round(v)) < 1e-9 : true
    body += `<line x1="${r2(x(v))}" x2="${r2(x(v))}" y1="${r2(y - (major ? 9 : 5))}" y2="${r2(y + (major ? 9 : 5))}" stroke="#334155" stroke-width="${major ? 2 : 1.5}"/>`
    if (i % every === 0 && (major || count <= 24)) {
      const label = den ? (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : fracText(reduce([Math.round(v * den), den]))) : fmt(v)
      body += T(x(v), y + 28, label, { size: 12, anchor: 'middle', fill: MUTED })
    }
  }
  ;(s.intervals ?? []).forEach((iv, k) => {
    const a = Math.max(min, Math.min(iv.from, iv.to)), b = Math.min(max, Math.max(iv.from, iv.to)), c = PALETTE[(k + 1) % PALETTE.length]
    body += `<line x1="${r2(x(a))}" x2="${r2(x(b))}" y1="${r2(y)}" y2="${r2(y)}" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.75"/>`
    for (const [v, open] of [[a, iv.from_open], [b, iv.to_open]] as Array<[number, boolean | undefined]>) body += `<circle cx="${r2(x(v))}" cy="${r2(y)}" r="7" fill="${open ? '#fff' : c}" stroke="${c}" stroke-width="3"/>`
    if (iv.label) body += T((x(a) + x(b)) / 2, y - 22, iv.label, { size: 13, weight: 600, anchor: 'middle', fill: c })
  })
  ;(s.points ?? []).forEach((p, k) => {
    const c = PALETTE[k % PALETTE.length]
    body += `<circle cx="${r2(x(p.value))}" cy="${r2(y)}" r="7.5" fill="${p.open ? '#fff' : c}" stroke="${c}" stroke-width="3"/>`
    body += T(x(p.value), y - 18 - (k % 2) * 16, p.label ?? fmt(p.value, 3), { size: 13, weight: 600, anchor: 'middle', fill: c })
  })
  return shell(w, h, s.title, body)
}

// ─── truth table (small boolean parser) ──────────────────────────────────────

type BoolNode = { t: 'var'; name: string } | { t: 'const'; v: boolean } | { t: 'not'; a: BoolNode } | { t: 'bin'; op: 'and' | 'or' | 'xor' | 'imp' | 'iff'; a: BoolNode; b: BoolNode }

function tokenize(src: string): string[] | null {
  const out: string[] = []
  const s = src.replace(/\s+/g, ' ')
  let i = 0
  const ops: Array<[RegExp, string]> = [
    [/^(<->|<=>|↔|⇔)/, 'iff'], [/^(->|=>|→|⇒)/, 'imp'], [/^(&&|&|∧|\bAND\b|\bE\b)/i, 'and'], [/^(\|\||\||∨|\bOR\b|\bO\b)/i, 'or'],
    [/^(\^|⊕|\bXOR\b)/i, 'xor'], [/^(¬|!|~|\bNOT\b|\bNON\b)/i, 'not'], [/^\(/, '('], [/^\)/, ')'],
  ]
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue }
    const rest = s.slice(i)
    let hit = false
    for (const [re, name] of ops) { const m = rest.match(re); if (m) { out.push(name); i += m[0].length; hit = true; break } }
    if (hit) continue
    const id = rest.match(/^[A-Za-z_][A-Za-z0-9_]*|^[01]\b/)
    if (!id) return null
    out.push(`v:${id[0]}`); i += id[0].length
  }
  return out
}

export function parseBool(src: string): BoolNode | null {
  const toks = tokenize(src)
  if (!toks?.length) return null
  let p = 0
  const peek = () => toks[p]
  const level = (names: Array<'iff' | 'imp' | 'or' | 'xor' | 'and'>, next: () => BoolNode | null, right = false): BoolNode | null => {
    let left = next()
    if (!left) return null
    while (peek() && (names as string[]).includes(peek())) {
      const op = toks[p++] as 'iff' | 'imp' | 'or' | 'xor' | 'and'
      const rhs = right ? level(names, next, true) : next()
      if (!rhs) return null
      left = { t: 'bin', op, a: left, b: rhs }
      if (right) break
    }
    return left
  }
  const atom = (): BoolNode | null => {
    const t = toks[p++]
    if (!t) return null
    if (t === 'not') { const a = atom(); return a ? { t: 'not', a } : null }
    if (t === '(') { const e = iff(); if (toks[p++] !== ')') return null; return e }
    if (t.startsWith('v:')) { const n = t.slice(2); if (n === '1' || n === '0') return { t: 'const', v: n === '1' }; if (/^(true|vero|v)$/i.test(n) && n.length > 1) return { t: 'const', v: true }; if (/^(false|falso)$/i.test(n)) return { t: 'const', v: false }; return { t: 'var', name: n } }
    return null
  }
  const and = (): BoolNode | null => level(['and'], atom)
  const xor = (): BoolNode | null => level(['xor'], and)
  const or = (): BoolNode | null => level(['or'], xor)
  const imp = (): BoolNode | null => level(['imp'], or, true)
  const iff = (): BoolNode | null => level(['iff'], imp, true)
  const tree = iff()
  return tree && p === toks.length ? tree : null
}
export function evalBool(n: BoolNode, env: Record<string, boolean>): boolean {
  switch (n.t) {
    case 'const': return n.v
    case 'var': return env[n.name] ?? false
    case 'not': return !evalBool(n.a, env)
    case 'bin': {
      const a = evalBool(n.a, env), b = evalBool(n.b, env)
      return n.op === 'and' ? a && b : n.op === 'or' ? a || b : n.op === 'xor' ? a !== b : n.op === 'imp' ? !a || b : a === b
    }
  }
}
export function boolVars(n: BoolNode, acc = new Set<string>()): Set<string> {
  if (n.t === 'var') acc.add(n.name)
  else if (n.t === 'not') boolVars(n.a, acc)
  else if (n.t === 'bin') { boolVars(n.a, acc); boolVars(n.b, acc) }
  return acc
}

export function truthTable(variables: string[], expressions: string[]): { rows: boolean[][]; results: Array<boolean[] | null>; errors: string[] } {
  const vars = variables.slice(0, 4)
  const rows: boolean[][] = []
  for (let i = 0; i < 2 ** vars.length; i++) rows.push(vars.map((_, k) => !((i >> (vars.length - 1 - k)) & 1)))  // true first, as in textbooks
  const errors: string[] = []
  const results = expressions.slice(0, 4).map((e) => {
    const tree = parseBool(e)
    if (!tree) { errors.push(e); return null }
    return rows.map((r) => evalBool(tree, Object.fromEntries(vars.map((v, k) => [v, r[k]]))))
  })
  return { rows, results, errors }
}

function truthSvg(s: TruthTableSpec, w: number, h: number): string {
  const vars = s.variables.slice(0, 4), exprs = s.expressions.slice(0, 4)
  const { rows, results } = truthTable(vars, exprs)
  const sym = (v: boolean) => (s.symbols === '10' ? (v ? '1' : '0') : v ? 'V' : 'F')
  const top = topOf(s.title)
  const cols = vars.length + exprs.length
  const colW = Math.min(110, (w - 40) / Math.max(cols, 1))
  const exprW = (e: string) => Math.max(colW, Math.min(textW(e, 12.5) + 20, 170))
  const widths = [...vars.map(() => Math.min(colW, 64)), ...exprs.map(exprW)]
  const total = widths.reduce((a, b) => a + b, 0)
  const x0 = (w - total) / 2
  const rowH = Math.min(30, (h - top - 56) / (rows.length + 1))
  let body = ''
  let x = x0
  const heads = [...vars, ...exprs]
  heads.forEach((hd, i) => {
    body += `<rect x="${r2(x)}" y="${top}" width="${r2(widths[i])}" height="${r2(rowH)}" fill="${i < vars.length ? '#e0e7ff' : '#fce7f3'}"/>` + T(x + widths[i] / 2, top + rowH / 2, shorten(hd, Math.floor(widths[i] / 6.8)), { size: 12.5, weight: 600, anchor: 'middle', baseline: 'middle', fill: INK })
    x += widths[i]
  })
  rows.forEach((r, ri) => {
    let cx = x0
    const y = top + rowH * (ri + 1)
    const cells = [...r, ...results.map((res) => (res ? res[ri] : null))]
    cells.forEach((v, ci) => {
      const isRes = ci >= vars.length
      const hide = !!s.guided && isRes
      const fill = hide ? '#fffbeb' : v === null ? '#f1f5f9' : isRes ? (v ? '#dcfce7' : '#fee2e2') : ri % 2 ? '#f8fafc' : '#ffffff'
      body += `<rect x="${r2(cx)}" y="${r2(y)}" width="${r2(widths[ci])}" height="${r2(rowH)}" fill="${fill}" stroke="#e2e8f0"/>` + T(cx + widths[ci] / 2, y + rowH / 2, hide || v === null ? '?' : sym(v), { size: 13, weight: isRes ? 600 : 400, anchor: 'middle', baseline: 'middle', fill: v === null ? MUTED : isRes ? (v ? '#166534' : '#991b1b') : INK })
      cx += widths[ci]
    })
  })
  const notes: string[] = []
  results.forEach((res, i) => { if (res?.every(Boolean)) notes.push(`«${shorten(exprs[i], 24)}» è una tautologia`); else if (res && res.every((v) => !v)) notes.push(`«${shorten(exprs[i], 24)}» è una contraddizione`) })
  if (results.length === 2 && results[0] && results[1] && results[0].every((v, i) => v === results[1]![i])) notes.push('le due espressioni sono equivalenti')
  results.forEach((res, i) => { if (!res) notes.push(`«${shorten(exprs[i], 24)}» non si legge`) })
  if (notes.length && !s.guided) body += T(w / 2, h - 12, notes.join(' · '), { size: 12, weight: 600, anchor: 'middle', fill: PALETTE[1] })
  return shell(w, h, s.title, body)
}

// ─── probability tree ─────────────────────────────────────────────────────────

export function parseProb(p: number | string | undefined): { frac: Frac | null; value: number } | null {
  if (p === undefined) return null
  if (typeof p === 'number') return Number.isFinite(p) ? { frac: null, value: p } : null
  const m = p.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  if (m && Number(m[2]) > 0) return { frac: reduce([Number(m[1]), Number(m[2])]), value: Number(m[1]) / Number(m[2]) }
  const pc = p.trim().match(/^([\d.,]+)\s*%$/)
  if (pc) return { frac: null, value: Number(pc[1].replace(',', '.')) / 100 }
  const v = Number(p.replace(',', '.'))
  return Number.isFinite(v) ? { frac: null, value: v } : null
}

function treeSvg(s: TreeSpec, w: number, h: number): string {
  type Placed = { node: TreeNode; depth: number; y: number; parent?: Placed; frac: Frac | null; value: number; path: string[] }
  const leaves: Placed[] = []
  const all: Placed[] = []
  let leafIdx = 0
  let depthMax = 0
  const walk = (node: TreeNode, depth: number, parent: Placed | undefined, frac: Frac | null, value: number, path: string[]): Placed => {
    const p: Placed = { node, depth, y: 0, parent, frac, value, path }
    all.push(p); depthMax = Math.max(depthMax, depth)
    const kids = node.children ?? []
    if (!kids.length) { p.y = leafIdx++; leaves.push(p) }
    else {
      const placed = kids.map((c) => {
        const pr = parseProb(c.p)
        const cf = frac && pr?.frac ? fMul(frac, pr.frac) : null
        return walk(c, depth + 1, p, cf, value * (pr?.value ?? 1), [...path, c.label])
      })
      p.y = (placed[0].y + placed[placed.length - 1].y) / 2
    }
    return p
  }
  walk(s.root, 0, undefined, [1, 1], 1, [])
  const top = topOf(s.title)
  const rightPad = 130
  const colW = (w - 70 - rightPad) / Math.max(depthMax, 1)
  const rowH = Math.min(46, (h - top - 20) / Math.max(leafIdx, 1))
  const X = (d: number) => 46 + d * colW
  const Y = (v: number) => top + 14 + v * rowH + rowH / 2
  let body = ''
  for (const p of all) {
    if (!p.parent) continue
    const x1 = X(p.parent.depth) + 8, y1 = Y(p.parent.y), x2 = X(p.depth) - 8, y2 = Y(p.y)
    body += `<path d="M ${r2(x1)} ${r2(y1)} C ${r2((x1 + x2) / 2)} ${r2(y1)} ${r2((x1 + x2) / 2)} ${r2(y2)} ${r2(x2)} ${r2(y2)}" fill="none" stroke="#94a3b8" stroke-width="2"/>`
    const pr = parseProb(p.node.p)
    if (pr) body += `<rect x="${r2((x1 + x2) / 2 - 20)}" y="${r2((y1 + y2) / 2 - 9)}" width="40" height="18" rx="9" fill="#fff"/>` + T((x1 + x2) / 2, (y1 + y2) / 2, typeof p.node.p === 'string' ? p.node.p : fmt(pr.value, 3), { size: 11.5, weight: 600, anchor: 'middle', baseline: 'middle', fill: PALETTE[1] })
  }
  for (const p of all) {
    const label = shorten(p.node.label, 14)
    const wd = Math.max(textW(label, 12.5) + 18, 34)
    body += `<rect x="${r2(X(p.depth) - wd / 2)}" y="${r2(Y(p.y) - 12)}" width="${r2(wd)}" height="24" rx="12" fill="${p.depth === 0 ? '#e0e7ff' : '#f1f5f9'}" stroke="${PALETTE[0]}" stroke-width="1.5"/>` + T(X(p.depth), Y(p.y), label, { size: 12.5, weight: 600, anchor: 'middle', baseline: 'middle', fill: INK })
  }
  let warn = false
  for (const p of all) {
    const kids = p.node.children ?? []
    if (kids.length && kids.every((k) => parseProb(k.p))) { const sum = kids.reduce((a, k) => a + (parseProb(k.p)?.value ?? 0), 0); if (Math.abs(sum - 1) > 0.01) warn = true }
  }
  for (const l of leaves) {
    const txt = s.guided ? 'P = ?' : l.frac ? `P = ${fracText(l.frac)}${l.frac[1] !== 1 ? ` = ${fmt(l.value, 4)}` : ''}` : `P = ${fmt(l.value, 4)}`
    body += T(X(l.depth) + 44, Y(l.y), txt, { size: 12, weight: 600, baseline: 'middle', fill: PALETTE[2] })
  }
  if (warn) body += T(w / 2, h - 8, 'attenzione: le probabilità di un nodo non sommano 1', { size: 11.5, weight: 600, anchor: 'middle', fill: '#b91c1c' })
  return shell(w, h, s.title, body)
}

// ─── entry points ─────────────────────────────────────────────────────────────

export const DEFAULT_SIZES: Record<FigureSpec['fig'], [number, number]> = {
  pie: [520, 340], bar: [560, 360], line: [560, 360], histogram: [560, 360], scatter: [560, 380], boxplot: [520, 380], normal: [560, 340],
  fraction: [620, 340], venn: [520, 380], numberline: [640, 180], truth_table: [560, 340], tree: [640, 380], vega: [560, 380], jsxgraph: [520, 420],
}
export function defaultFigureSize(spec: FigureSpec): [number, number] {
  if (spec.fig === 'truth_table') return [Math.max(380, 90 * (spec.variables.length + spec.expressions.length) + 80), Math.min(520, 120 + 30 * 2 ** Math.min(spec.variables.length, 4))]
  if (spec.fig === 'tree') { const leaves = (n: TreeNode): number => (n.children?.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1); return [640, Math.min(620, 90 + 46 * leaves(spec.root))] }
  if (spec.fig === 'fraction') return spec.op === 'multiply' ? [560, 420] : [620, spec.op === 'show' || spec.op === 'compare' ? 300 : 330]
  return DEFAULT_SIZES[spec.fig] ?? [520, 360]
}

/** Self-contained SVG for the built-in figures; the declarative engines (vega, jsxgraph) are drawn by their own components. */
export function figureSvg(spec: FigureSpec, w: number, h: number): string {
  const wd = Math.max(Math.round(w), 200), hd = Math.max(Math.round(h), 120)
  try {
    switch (spec.fig) {
      case 'pie': return pieSvg(spec, wd, hd)
      case 'bar': return barSvg(spec, wd, hd)
      case 'line': return lineSvg(spec, wd, hd)
      case 'histogram': return histogramSvg(spec, wd, hd)
      case 'scatter': return scatterSvg(spec, wd, hd)
      case 'boxplot': return boxplotSvg(spec, wd, hd)
      case 'normal': return normalSvg(spec, wd, hd)
      case 'fraction': return fractionSvg(spec, wd, hd)
      case 'venn': return vennSvg(spec, wd, hd)
      case 'numberline': return numberlineSvg(spec, wd, hd)
      case 'truth_table': return truthSvg(spec, wd, hd)
      case 'tree': return treeSvg(spec, wd, hd)
      default: return shell(wd, hd, spec.title, T(wd / 2, hd / 2, 'Figura interattiva', { anchor: 'middle', fill: MUTED }))
    }
  } catch {
    return shell(wd, hd, undefined, T(wd / 2, hd / 2, 'Figura non valida', { anchor: 'middle', fill: '#b91c1c' }))
  }
}

export const figureDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** One-line description for the assistant's list of board elements. */
export function describeFigure(spec: FigureSpec): string {
  switch (spec.fig) {
    case 'pie': return `grafico a torta${spec.title ? ` «${spec.title}»` : ''}: ${spec.slices.map((x) => `${x.label} ${x.value}`).join(', ')}`
    case 'bar': return `grafico a barre${spec.title ? ` «${spec.title}»` : ''}: ${spec.categories.join(', ')}; serie ${spec.series.map((x) => x.name).join(', ')}`
    case 'line': return `grafico a linee${spec.title ? ` «${spec.title}»` : ''}: serie ${spec.series.map((x) => x.name).join(', ')}`
    case 'histogram': return `istogramma di ${spec.values.length} valori${spec.title ? ` «${spec.title}»` : ''}`
    case 'scatter': return `diagramma di dispersione di ${spec.points.length} punti${spec.regression ? ' con retta di regressione' : ''}`
    case 'boxplot': return `box plot: ${spec.groups.map((g) => g.name).join(', ')}`
    case 'normal': return `distribuzione normale μ=${spec.mean} σ=${spec.sd}${spec.from != null || spec.to != null ? ` area tra ${spec.from ?? '−∞'} e ${spec.to ?? '+∞'}` : ''}`
    case 'fraction': return `modello di frazioni (${spec.op}): ${spec.fractions.map(fracText).join(', ')}`
    case 'venn': return `diagramma di Venn: ${spec.sets.map((x) => x.label).join(', ')}`
    case 'numberline': return `retta numerica da ${spec.min} a ${spec.max}`
    case 'truth_table': return `tabella di verità: ${spec.expressions.join('; ')}`
    case 'tree': return `albero di probabilità «${spec.root.label}»`
    case 'vega': return `grafico Vega-Lite${spec.title ? ` «${spec.title}»` : ''}`
    case 'jsxgraph': return `costruzione geometrica interattiva${spec.title ? ` «${spec.title}»` : ''}`
  }
}

// ─── fill-in tables: checking an answer without ever holding the key ─────────────────────────────────

/** Compact SHA-256 (hex): keys are stored as salted hashes, and crypto.subtle is missing on plain-http origins. */
export function sha256Hex(message: string): string {
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2])
  const bytes = new TextEncoder().encode(message)
  const len = bytes.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(bytes); padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, (len * 8) >>> 0); view.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296))
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0 }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('')
}

/** Canonical form of an answer (the server uses the same rules): 0,5 = 1/2 = 2/4; text is lower-cased with single spaces. */
export function normAnswer(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[−–]/g, '-')
  const compact = s.replace(/\s+/g, '').replace(',', '.').replace(/^\+/, '')
  const out = (n: number, d: number) => { const g = gcd(n, d); const nn = n / g, dd = d / g; return dd === 1 ? String(nn) : `${nn}/${dd}` }
  const frac = compact.match(/^(-?\d+)\/(\d+)$/)
  if (frac && Number(frac[2]) > 0) return out(Number(frac[1]), Number(frac[2]))
  const dec = compact.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (dec) { const decimals = dec[3] || ''; return out(Number(`${dec[1]}${dec[2]}${decimals}`), 10 ** decimals.length) }
  return s.split(/\s+/).join(' ').replace(/\.+$/, '')
}

export const answerHash = (salt: string, raw: string) => sha256Hex(`${salt}:${normAnswer(raw)}`)
