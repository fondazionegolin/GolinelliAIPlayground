/**
 * Asking about a selected area. The user draws a free-form outline; the board region around it is rendered (the outline in
 * full colour, the rest faded) and sent with the question. The answer comes with flags (name + a short contextual note,
 * pinpointed in % of that region); here they become `callout` items laid out in the margins beside the area.
 */
import { describeDoc, type SceneItem } from './canvasAi'
import type { CanvasDoc, CanvasItem } from './CollaborativeCanvas'

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
export type AreaLabelResult = { name: string; note?: string; x: number; y: number }

export const AREA_FLAG_H = 46
export const AREA_FLAG_W = 224
export const AREA_FLAG_COLOR = '#e11d48'
const GAP = 48
const SPACING = 10

export function pointsBox(points: Pt[], pad = 0): Box {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Keeps a lasso light: drops points closer than `min` to the previous kept one (the closing edge is implicit). */
export function thin(points: Pt[], min: number): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push(p)
  }
  return out
}

const overlaps = (a: Box, b: Box, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w > b.x - gap && a.y < b.y + b.h + gap && a.y + a.h > b.y - gap

/** The board elements around the area (text and kind), so the model can use what is written next to the selection. */
export function areaContext(doc: CanvasDoc, box: Box, polygon: Pt[]): string {
  const { items } = describeDoc({ ...doc, items: doc.items.filter((i) => i.type !== 'callout') })
  const near = items.filter((i: SceneItem) => i.x !== undefined && i.y !== undefined && i.w !== undefined && i.h !== undefined
    && overlaps({ x: i.x, y: i.y, w: i.w, h: i.h }, { x: box.x - 60, y: box.y - 60, w: box.w + 120, h: box.h + 120 }))
  return near.slice(0, 40).map((i) => {
    const inside = inPolygon({ x: i.x! + i.w! / 2, y: i.y! + i.h! / 2 }, polygon) ? 'dentro l’area' : 'vicino all’area'
    return `- ${i.type} (${inside})${i.text ? `: ${i.text}` : ''}${i.detail ? ` [${i.detail}]` : ''}`
  }).join('\n')
}

/**
 * Flags for the labels, in columns left and right of the area, ordered by height so the leader lines do not cross. A point
 * that falls on an image stays attached to it (the flag keeps pointing when the image moves).
 */
export function layoutAreaCallouts(items: CanvasItem[], box: Box, labels: AreaLabelResult[], newId: () => string): { items: CanvasItem[]; created: string[] } {
  const created: string[] = []
  const out = [...items]
  const pending = labels
    .filter((l) => l.name.trim())
    .map((l) => {
      const wx = box.x + Math.min(Math.max(l.x, 0), 100) / 100 * box.w, wy = box.y + Math.min(Math.max(l.y, 0), 100) / 100 * box.h
      const note = (l.note || '').trim()
      return { wx, wy, text: (note ? `${l.name.trim()}: ${note}` : l.name.trim()).slice(0, 110), side: wx < box.x + box.w / 2 ? 'left' as const : 'right' as const }
    })
    .sort((a, b) => a.wy - b.wy)
  for (;;) { // keep the columns comparably full
    const left = pending.filter((p) => p.side === 'left'), right = pending.filter((p) => p.side === 'right')
    if (Math.abs(left.length - right.length) <= 1) break
    const from = left.length > right.length ? left : right
    const mid = box.x + box.w / 2
    const move = [...from].sort((a, b) => Math.abs(a.wx - mid) - Math.abs(b.wx - mid))[0]
    move.side = move.side === 'left' ? 'right' : 'left'
  }
  const taken = (rect: Box) => out.some((i) => i.type === 'callout' && overlaps(rect, { x: i.x, y: i.y, w: i.w, h: i.h }, 6))
  for (const side of ['left', 'right'] as const) {
    let floor = -Infinity
    for (const p of pending.filter((q) => q.side === side)) {
      const x = side === 'left' ? box.x - GAP - AREA_FLAG_W : box.x + box.w + GAP
      let y = Math.max(p.wy - AREA_FLAG_H / 2, floor)
      for (let guard = 0; guard < 24 && taken({ x, y, w: AREA_FLAG_W, h: AREA_FLAG_H }); guard += 1) y += AREA_FLAG_H + SPACING
      floor = y + AREA_FLAG_H + SPACING
      const image = [...out].reverse().find((i) => i.type === 'image' && p.wx >= i.x && p.wx <= i.x + i.w && p.wy >= i.y && p.wy <= i.y + i.h)
      const id = newId()
      out.push({
        id, ai: true, type: 'callout', x, y, w: AREA_FLAG_W, h: AREA_FLAG_H, text: p.text, color: AREA_FLAG_COLOR,
        imageId: image?.id, rx: image && 'w' in image ? (p.wx - image.x) / image.w : 0, ry: image && 'h' in image ? (p.wy - image.y) / image.h : 0, tx: p.wx, ty: p.wy,
      } as CanvasItem)
      created.push(id)
    }
  }
  return { items: out, created }
}
