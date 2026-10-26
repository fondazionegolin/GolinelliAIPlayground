import type { Region } from './types'
import { boxInFrame, pointInFrame, type AnchorAt, type DrawingLayout, type DrawingMark, type DrawingScene, type Frame, type Point, type ScenePoint } from './blackboard'

export type XY = { x: number; y: number }

export const TEXT_KINDS = new Set(['text', 'number', 'formula'])
const CHAR_WIDTH = 0.55
const LINE_HEIGHT = 1.22

/** Wrap text into a box, shrinking the font until it fits. Shared by the renderer and the linter so both measure alike. */
export function fitText(text: string, width: number, height: number, size: number, minFont = 0): { font: number; lines: string[] } {
  let font = Math.max(size, minFont), lines: string[] = []
  for (let attempt = 0; attempt < 5; attempt++) {
    const limit = Math.max(1, Math.floor(width / (font * CHAR_WIDTH)))
    lines = text.split('\n').flatMap(paragraph => {
      const result: string[] = []; let line = ''
      for (const word of paragraph.split(/\s+/)) {
        if ((line + ' ' + word).trim().length > limit && line) { result.push(line); line = word } else line = (line + ' ' + word).trim()
      }
      result.push(line); return result
    })
    if (lines.length * font * LINE_HEIGHT <= height) break
    font = Math.max(minFont, Math.min(font * .85, height / (lines.length * LINE_HEIGHT)))
    if (font === minFont && minFont > 0) break
  }
  return { font, lines }
}

/** Natural size of a label wrapped at maxWidth. */
export function measureLabel(text: string, size: number, maxWidth: number): { width: number; height: number; lines: string[] } {
  const limit = Math.max(4, Math.floor(maxWidth / (size * CHAR_WIDTH)))
  const { lines } = fitText(text, maxWidth, Infinity, size)
  const longest = Math.max(1, ...lines.map(l => l.length))
  return { width: Math.min(maxWidth, Math.min(longest, limit) * size * CHAR_WIDTH) + size * .5, height: lines.length * size * LINE_HEIGHT + size * .3, lines }
}

export function rectAt(rect: Frame, at: AnchorAt): XY {
  const fx = at.includes('left') ? 0 : at.includes('right') ? 1 : .5
  const fy = at.includes('top') ? 0 : at.includes('bottom') ? 1 : .5
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }
}

export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y)

function lineIntersection(a: XY, b: XY, c: XY, d: XY): XY | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y }
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-9) return null
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator
  return { x: a.x + t * r.x, y: a.y + t * r.y }
}

function footOfPerpendicular(p: XY, a: XY, b: XY): XY {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  if (length2 < 1e-9) return a
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/**
 * Turns the model's declarative scene (named points, anchors) into absolute layout coordinates.
 * Derived points (midpoint, foot, intersection) are computed here, never estimated by the model.
 */
export class SceneGeometry {
  readonly scene: DrawingScene
  readonly layout: DrawingLayout
  private readonly regions: Map<string, Region>
  private readonly points: Map<string, ScenePoint>
  private readonly marks: Map<string, DrawingMark>
  private readonly pointCache = new Map<string, XY>()
  private readonly boundsCache = new Map<string, Frame>()
  private readonly resolving = new Set<string>()
  /** Final label rectangles chosen by the placer; callout bounds fall back to a default beside the target. */
  readonly labels = new Map<string, Frame>()
  /** Font sizes raised by the linter so text stays legible at the current display scale. */
  readonly fonts = new Map<string, number>()

  constructor(scene: DrawingScene, regions: Region[], layout: DrawingLayout) {
    this.scene = scene; this.layout = layout
    this.regions = new Map(regions.map(r => [r.id, r]))
    this.points = new Map((scene.points ?? []).map(p => [p.id, p]))
    this.marks = new Map(scene.elements.map(m => [m.id, m]))
    const heights = regions.filter(r => r.text.trim() && r.box.height < 12).map(r => r.box.height * layout.image.height / 100 * .75).sort((a, b) => a - b)
    this.textHeight = heights.length >= 2 ? heights[Math.floor(heights.length / 2)] : null
  }

  frame(m: { space: string }): Frame { return this.layout.frames[m.space] ?? (m.space === 'board' ? this.layout.board : null) ?? this.layout.image }
  isRegionPoint(pointId: string | undefined): boolean { return !!pointId && this.points.get(pointId)?.kind === 'region' }
  /** Number read on the source at a region-anchored point (e.g. a tick label "2"), if any. */
  numberAt(pointId: string): number | null {
    const p = this.points.get(pointId), text = p?.kind === 'region' && p.region ? this.regions.get(p.region)?.text.trim() : ''
    const value = text && /^[-−+]?\d+([.,]\d+)?$/.test(text) ? Number(text.replace('−', '-').replace(',', '.')) : NaN
    return Number.isFinite(value) && value !== 0 ? value : null
  }
  regionRect(id: string): Frame | null { const r = this.regions.get(id); return r ? boxInFrame(r.box, this.layout.image) : null }
  /** Typical height of the source's own text, so labels on the image match its typography instead of shouting over it. */
  readonly textHeight: number | null
  fontSize(m: DrawingMark): number {
    const raised = this.fonts.get(m.id)
    if (raised) return raised
    const size = this.frame(m).width * m.font_size / 100
    return m.space === 'image' && this.textHeight ? Math.min(size, this.textHeight * 1.5) : size
  }
  setLabel(id: string, rect: Frame) { this.labels.set(id, rect); this.boundsCache.delete(id) }

  point(id: string): XY {
    const cached = this.pointCache.get(id)
    if (cached) return cached
    const spec = this.points.get(id)
    const fallback = { x: this.layout.image.x + this.layout.image.width / 2, y: this.layout.image.y + this.layout.image.height / 2 }
    if (!spec || this.resolving.has(`p:${id}`)) return fallback
    this.resolving.add(`p:${id}`)
    const value = this.compute(spec) ?? fallback
    this.resolving.delete(`p:${id}`)
    this.pointCache.set(id, value)
    return value
  }

  private compute(p: ScenePoint): XY | null {
    const f = this.frame(p)
    const offset = (v: XY): XY => ({ x: v.x + p.dx * f.width / 100, y: v.y + p.dy * f.height / 100 })
    const ref = (i: number) => this.point(p.refs[i])
    switch (p.kind) {
      case 'xy': return p.x === null || p.y === null ? null : offset(pointInFrame({ x: p.x, y: p.y }, f))
      case 'region': { const r = p.region ? this.regionRect(p.region) : null; return r ? offset(rectAt(r, p.at)) : null }
      case 'element': { const m = p.element ? this.marks.get(p.element) : null; return m ? offset(rectAt(this.bounds(m), p.at)) : null }
      case 'midpoint': return offset({ x: (ref(0).x + ref(1).x) / 2, y: (ref(0).y + ref(1).y) / 2 })
      case 'lerp': { const t = p.t ?? .5, a = ref(0), b = ref(1); return offset({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) }
      case 'foot': return offset(footOfPerpendicular(ref(0), ref(1), ref(2)))
      case 'intersection': return offset(lineIntersection(ref(0), ref(1), ref(2), ref(3)) ?? { x: (ref(0).x + ref(1).x) / 2, y: (ref(0).y + ref(1).y) / 2 })
    }
  }

  /** Absolute points of a mark, from anchors or from legacy percentage points. */
  markPoints(m: DrawingMark): XY[] {
    if (m.anchors?.length) return m.anchors.map(id => this.point(id))
    const f = this.frame(m)
    return m.points.map((p: Point) => pointInFrame(p, f))
  }

  bounds(m: DrawingMark): Frame {
    const cached = this.boundsCache.get(m.id)
    if (cached) return cached
    if (this.resolving.has(`e:${m.id}`)) return this.layout.image
    this.resolving.add(`e:${m.id}`)
    const result = this.computeBounds(m)
    this.resolving.delete(`e:${m.id}`)
    this.boundsCache.set(m.id, result)
    return result
  }

  private computeBounds(m: DrawingMark): Frame {
    const f = this.frame(m)
    if (m.kind === 'callout') return this.labels.get(m.id) ?? this.defaultLabel(m)
    if (m.kind === 'highlight' && !m.box && m.from_region_id) return this.regionRect(m.from_region_id) ?? this.layout.image
    if (m.box && TEXT_KINDS.has(m.kind) && m.anchors?.length === 1) {
      const c = this.point(m.anchors[0]), size = boxInFrame(m.box, f)
      return { x: c.x - size.width / 2, y: c.y - size.height / 2, width: size.width, height: size.height }
    }
    if (m.box) return boxInFrame(m.box, f)
    const pts = this.markPoints(m)
    if (!pts.length) return this.layout.image
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) }
  }

  /** Label of a dimension line or angle arc: fixed beside the figure, so the placer treats it as an obstacle. */
  fixedLabel(m: DrawingMark): Frame {
    const pts = this.markPoints(m), size = this.fontSize(m), f = this.frame(m)
    const { width, height } = measureLabel(m.text || '', size, f.width * .2)
    let center: XY
    if (m.kind === 'arc' && pts.length === 3) {
      const unit = (from: XY, to: XY) => { const d = dist(from, to) || 1; return { x: (to.x - from.x) / d, y: (to.y - from.y) / d } }
      const u = unit(pts[1], pts[0]), w = unit(pts[1], pts[2])
      const bis = { x: u.x + w.x, y: u.y + w.y }, n = Math.hypot(bis.x, bis.y) || 1
      const reach = (m.radius ?? 4) * f.width / 100 * 1.5 + Math.max(width, height) / 2
      center = { x: pts[1].x + bis.x / n * reach, y: pts[1].y + bis.y / n * reach }
    } else {
      const a = pts[0], b = pts[1] ?? pts[0], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
      let nx = -dy / length, ny = dx / length
      if (ny > 0) { nx = -nx; ny = -ny }
      const away = size * .6 + (Math.abs(nx) * width + Math.abs(ny) * height) / 2
      center = { x: (a.x + b.x) / 2 + nx * away, y: (a.y + b.y) / 2 + ny * away }
    }
    return { x: center.x - width / 2, y: center.y - height / 2, width, height }
  }

  /** Label pill at the tip of a brace, before collision placement. Shared by renderer and linter. */
  braceLabel(m: DrawingMark): { rect: Frame; tip: XY; normal: XY } | null {
    const pts = this.markPoints(m)
    if (m.kind !== 'brace' || !m.text || pts.length !== 2) return null
    const size = this.fontSize(m), f = this.frame(m)
    const length = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1
    const dx = (pts[0].x - pts[1].x) / length, dy = (pts[0].y - pts[1].y) / length
    const depth = Math.min(Math.max(length * .09, size * .45), size * 1.4)
    const normal = { x: dy, y: -dx }
    const tip = { x: (pts[0].x + pts[1].x) / 2 + normal.x * depth, y: (pts[0].y + pts[1].y) / 2 + normal.y * depth }
    const width = Math.min(f.width * .4, m.text.length * size * .58 + size), height = size * 1.55, gap = size * .35
    const away = gap + (Math.abs(normal.x) * width + Math.abs(normal.y) * height) / 2
    const c = { x: tip.x + normal.x * away, y: tip.y + normal.y * away }
    return { rect: this.labels.get(m.id) ?? { x: c.x - width / 2, y: c.y - height / 2, width, height }, tip, normal }
  }

  defaultLabel(m: DrawingMark): Frame {
    const target = m.target ? this.point(m.target) : rectAt(this.layout.image, 'center')
    const size = this.fontSize(m), { width, height } = measureLabel(m.text, size, this.frame(m).width * .28)
    return { x: target.x + size * 1.5, y: target.y - height / 2, width, height }
  }
}

export const intersects = (a: Frame, b: Frame) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
export function overlapArea(a: Frame, b: Frame): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
