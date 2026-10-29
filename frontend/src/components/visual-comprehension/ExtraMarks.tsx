import { INKS, curveValue, edgePoints, type DrawingMark, type Frame, type NumberLineData } from './blackboard'
import { dist, type SceneGeometry, type XY } from './sceneGeometry'
import { tl } from '@/i18n/tl'

const unit = (from: XY, to: XY): XY => { const d = dist(from, to) || 1; return { x: (to.x - from.x) / d, y: (to.y - from.y) / d } }
const fmt = (n: number) => Number(n.toFixed(2))

/** Stroke geometry of the v2 tools; the caller draws it with the shared pen-stroke animation. */
export function extraPath(m: DrawingMark, g: SceneGeometry): string {
  const f = g.frame(m), pts = g.markPoints(m), r = (m.radius ?? 4) * f.width / 100
  if (m.kind === 'polygon') return pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ') + ' Z'
  if (m.kind === 'dimension') return `M${fmt(pts[0].x)} ${fmt(pts[0].y)}L${fmt(pts[1].x)} ${fmt(pts[1].y)}`
  if (m.kind === 'arc') {
    const [a, v, c] = pts, u = unit(v, a), w = unit(v, c)
    const sweep = u.x * w.y - u.y * w.x > 0 ? 1 : 0
    return `M${fmt(v.x + u.x * r)} ${fmt(v.y + u.y * r)}A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(v.x + w.x * r)} ${fmt(v.y + w.y * r)}`
  }
  if (m.kind === 'right_angle') {
    const [a, v, c] = pts, u = unit(v, a), w = unit(v, c), s = r * .7
    return `M${fmt(v.x + u.x * s)} ${fmt(v.y + u.y * s)}L${fmt(v.x + (u.x + w.x) * s)} ${fmt(v.y + (u.y + w.y) * s)}L${fmt(v.x + w.x * s)} ${fmt(v.y + w.y * s)}`
  }
  if (m.kind === 'tick') {
    const [a, b] = pts, d = unit(a, b), n = { x: -d.y, y: d.x }, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const count = m.count ?? 1, gap = f.width * .008, len = f.width * .01
    return Array.from({ length: count }, (_, i) => {
      const o = (i - (count - 1) / 2) * gap
      return `M${fmt(mid.x + d.x * o - n.x * len)} ${fmt(mid.y + d.y * o - n.y * len)}L${fmt(mid.x + d.x * o + n.x * len)} ${fmt(mid.y + d.y * o + n.y * len)}`
    }).join('')
  }
  if (m.kind === 'callout') {
    const label = g.bounds(m), target = g.point(m.target!)
    const from = { x: Math.min(label.x + label.width, Math.max(label.x, target.x)), y: Math.min(label.y + label.height, Math.max(label.y, target.y)) }
    return from.x === target.x && from.y === target.y ? '' : `M${fmt(from.x)} ${fmt(from.y)}L${fmt(target.x)} ${fmt(target.y)}`
  }
  return ''
}

export const labelRectFor = (m: DrawingMark, g: SceneGeometry): Frame | null =>
  (m.kind === 'dimension' || m.kind === 'arc') && m.text ? g.fixedLabel(m) : m.kind === 'callout' ? g.bounds(m) : null

export function NumberLineWidget({ data, color }: { data: NumberLineData; color: string }) {
  const left = 60, right = 940, y = 190
  const x = (v: number) => left + (v - data.min) * (right - left) / (data.max - data.min)
  const count = Math.round((data.max - data.min) / data.step), every = Math.max(1, Math.ceil((count + 1) / 14))
  return <svg viewBox="0 0 1000 340" width="100%" height="100%" overflow="hidden" aria-label={tl("Linea dei numeri")}>
    <path d={`M${left - 20} ${y}H${right + 25}`} stroke={INKS.ink} strokeWidth="4" />
    {Array.from({ length: count + 1 }, (_, i) => {
      const v = data.min + i * data.step
      return <g key={i}><path d={`M${x(v)} ${y - 14}V${y + 14}`} stroke={INKS.ink} strokeWidth="3" />{i % every === 0 && <text x={x(v)} y={y + 52} textAnchor="middle" fontSize="30" fill={INKS.ink}>{Number(v.toPrecision(6))}</text>}</g>
    })}
    {data.jumps.map((j, i) => {
      const a = x(j.start), b = x(j.end), lift = Math.min(110, 30 + Math.abs(b - a) * .25), mid = (a + b) / 2
      return <g key={i}><path d={`M${a} ${y - 14}Q${mid} ${y - 14 - lift * 2} ${b} ${y - 14}`} fill="none" stroke={INKS[j.color]} strokeWidth="5" strokeLinecap="round" />
        <path d={`M${b - 12} ${y - 32}L${b} ${y - 14}L${b + 14} ${y - 30}`} fill="none" stroke={INKS[j.color]} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {j.label && <text x={mid} y={y - 14 - lift * 1.05 - 14} textAnchor="middle" fontSize="34" fontWeight="700" fill={INKS[j.color]}>{j.label}</text>}</g>
    })}
    {data.marks.map((mark, i) => <g key={i}><circle cx={x(mark.value)} cy={y} r="13" fill={mark.color === 'ink' ? color : INKS[mark.color]} />{mark.label && <text x={x(mark.value)} y={y + 100} textAnchor="middle" fontSize="32" fontWeight="700" fill={mark.color === 'ink' ? color : INKS[mark.color]}>{mark.label}</text>}</g>)}
  </svg>
}

/** Magnified copy of a source region: a real zoom of the pixels, not a redrawn approximation. */
export function Lens({ region, box, image, color }: { region: Frame; box: Frame; image: { url: string; frame: Frame }; color: string }) {
  const [a, b] = edgePoints(region, box)
  return <g>
    <path d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={color} strokeWidth={Math.max(2, box.width * .004)} strokeDasharray="8 6" fill="none" />
    <rect {...region} fill="none" stroke={color} strokeWidth={Math.max(2, box.width * .005)} rx="4" />
    <rect {...box} fill="white" />
    <svg x={box.x} y={box.y} width={box.width} height={box.height} viewBox={`${region.x} ${region.y} ${region.width} ${region.height}`} preserveAspectRatio="xMidYMid meet" overflow="hidden">
      <image href={image.url} x={image.frame.x} y={image.frame.y} width={image.frame.width} height={image.frame.height} />
    </svg>
    <rect {...box} fill="none" stroke={color} strokeWidth={Math.max(2, box.width * .006)} rx="6" />
  </g>
}

export const isCalibratedPlot = (m: DrawingMark) => m.kind === 'plot' && !m.box && [2, 3].includes(m.anchors?.length ?? 0)

/**
 * A function drawn on the axes that are already in the image: anchors are [origin, tick on x at x_ref, tick on y at y_ref],
 * so data coordinates map onto the source with an affine transform (works for skewed photos too).
 */
export function calibratedPlot(m: DrawingMark, g: SceneGeometry) {
  const data = m.plot!, [o, u, given] = g.markPoints(m), ids = m.anchors!
  // The tick label read on the image beats the model's guess of the reference value.
  const xr = g.numberAt(ids[1]) ?? (data.x_ref || 1), yr = (ids[2] ? g.numberAt(ids[2]) : null) ?? (data.y_ref || 1)
  // A y tick counts only if it is a real source region off the x axis; otherwise same scale as x, perpendicular, pointing up.
  const ux = u.x - o.x, uy = u.y - o.y
  const usable = given && g.isRegionPoint(ids[2]) && Math.abs(ux * (given.y - o.y) - uy * (given.x - o.x)) > (ux * ux + uy * uy) * .05
  const v = usable ? given : { x: o.x + uy * yr / xr, y: o.y - ux * yr / xr }
  const map = (x: number, y: number): XY => ({ x: o.x + x / xr * (u.x - o.x) + y / yr * (v.x - o.x), y: o.y + x / xr * (u.y - o.y) + y / yr * (v.y - o.y) })
  const curves = data.curves.map(curve => {
    let d = '', open = false, last: XY | null = null
    for (let i = 0; i <= 160; i++) {
      const x = data.x_min + i * (data.x_max - data.x_min) / 160, y = curveValue(curve, x)
      if (y === null || y < data.y_min || y > data.y_max) { open = false; continue }
      const p = map(x, y); last = p
      d += `${open ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)} `; open = true
    }
    return { d, color: INKS[curve.color], label: curve.label, end: last }
  })
  const series = data.series.map(s => ({ color: INKS[s.color], mode: s.mode, label: s.label, points: s.points.map(p => map(p.x, p.y)) }))
  return { curves, series }
}
