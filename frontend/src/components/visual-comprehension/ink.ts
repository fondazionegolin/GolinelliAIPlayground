import type { XY } from './sceneGeometry'

/** Geometry of the refined strokes: smooth curves, bent arrows with tangent-aligned heads, curly braces. */

const f = (n: number) => Number(n.toFixed(2))
const pt = (p: XY) => `${f(p.x)} ${f(p.y)}`

/** Catmull-Rom spline through the points, as cubic Béziers (a soft, hand-drawn stroke instead of a zig-zag). */
export function smoothPath(points: XY[], closed = false): string {
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join(' ')
  const at = (i: number) => closed ? points[(i + points.length) % points.length] : points[Math.max(0, Math.min(points.length - 1, i))]
  const last = closed ? points.length : points.length - 1
  let d = `M${pt(points[0])}`
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C${pt(c1)} ${pt(c2)} ${pt(p2)}`
  }
  return closed ? d + ' Z' : d
}

/** Quadratic arc from a to b bulging sideways by `bend` × length; returns the control point for tangents. */
export function bentPath(a: XY, b: XY, bend: number): { d: string; control: XY } {
  const dx = b.x - a.x, dy = b.y - a.y
  const control = { x: (a.x + b.x) / 2 - dy * bend / 2, y: (a.y + b.y) / 2 + dx * bend / 2 }
  return { d: `M${pt(a)} Q${pt(control)} ${pt(b)}`, control }
}

/** Slim, slightly swept arrowhead pointing along from→tip, sized from the stroke width. */
export function arrowHead(tip: XY, from: XY, size: number): string {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1
  const ux = (tip.x - from.x) / len, uy = (tip.y - from.y) / len, nx = -uy, ny = ux
  const back = { x: tip.x - ux * size, y: tip.y - uy * size }
  const l = { x: back.x + nx * size * .48, y: back.y + ny * size * .48 }, r = { x: back.x - nx * size * .48, y: back.y - ny * size * .48 }
  const notch = { x: tip.x - ux * size * .72, y: tip.y - uy * size * .72 }
  return `M${pt(tip)} L${pt(l)} Q${pt(notch)} ${pt(r)} Z`
}

/**
 * Curly brace between a and b with its tip `depth` away from the segment. Drawn left→right it opens downward
 * (under a term), right→left upward. Returns the path and the tip, where a label goes.
 */
export function curlyBrace(a: XY, b: XY, depth: number, curl = .6): { d: string; tip: XY; normal: XY } {
  let dx = a.x - b.x, dy = a.y - b.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len; dy /= len
  const w = depth, q = curl
  const q1 = { x: a.x + q * w * dy, y: a.y - q * w * dx }
  const q2 = { x: a.x - .25 * len * dx + (1 - q) * w * dy, y: a.y - .25 * len * dy - (1 - q) * w * dx }
  const tip = { x: a.x - .5 * len * dx + w * dy, y: a.y - .5 * len * dy - w * dx }
  const q3 = { x: b.x + q * w * dy, y: b.y - q * w * dx }
  const q4 = { x: a.x - .75 * len * dx + (1 - q) * w * dy, y: a.y - .75 * len * dy - (1 - q) * w * dx }
  return { d: `M${pt(a)} Q${pt(q1)} ${pt(q2)} T${pt(tip)} M${pt(b)} Q${pt(q3)} ${pt(q4)} T${pt(tip)}`, tip, normal: { x: dy, y: -dx } }
}

/** Point where the segment from a rect's centre towards `toward` leaves the rect (for leaders that start at a pill). */
export function rectExit(r: { x: number; y: number; width: number; height: number }, toward: XY): XY {
  const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }, dx = toward.x - c.x, dy = toward.y - c.y
  const t = Math.min(Math.abs(dx) > 1e-6 ? r.width / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? r.height / 2 / Math.abs(dy) : Infinity, 1)
  return { x: c.x + dx * t, y: c.y + dy * t }
}
