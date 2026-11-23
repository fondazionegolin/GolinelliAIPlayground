/**
 * Flags ("bandierine") that name the parts of a pasted image. The recognizer returns, for every part, the exact point on the
 * image in % of its box; here the flags are laid out in the margins around the image (left/right, ordered top to bottom so
 * the leader lines do not cross) and each one keeps a link to its image, so the target follows when the image moves.
 */
import type { AiOp } from './canvasAi'
import type { CanvasItem } from './CollaborativeCanvas'

type ImageItem = Extract<CanvasItem, { type: 'image' }>
export type CalloutItem = Extract<CanvasItem, { type: 'callout' }>

export const CALLOUT_H = 30
/** Intense dark orange: the leader line, the target ring and the card outline. */
export const CALLOUT_COLOR = '#c2410c'
/** Flags made before the orange default were red: they are drawn orange too. */
export const calloutInk = (color: string) => (color === '#e11d48' ? CALLOUT_COLOR : color)
const GAP = 56
const SPACING = 8

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const calloutWidth = (text: string) => clamp(Math.round(text.length * 7.4 + 30), 72, 260)

/** Where the flag points, in world pixels: on the image when it is still there, else where it was last placed. */
export function calloutTarget(item: CalloutItem, items: CanvasItem[]): { x: number; y: number } {
  const host = item.imageId ? items.find((i): i is Exclude<CanvasItem, { type: 'connector' }> => i.id === item.imageId && 'w' in i) : undefined
  return host ? { x: host.x + item.rx * host.w, y: host.y + item.ry * host.h } : { x: item.tx, y: item.ty }
}

export type Rect = { x: number; y: number; w: number; h: number }
const hits = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.w + gap && a.x + a.w > b.x - gap && a.y < b.y + b.h + gap && a.y + a.h > b.y - gap

/** What a flag must not cover: every visible element except frames (containers), flags, drawings and `ignore`d ones. */
export function flagObstacles(items: CanvasItem[], ignore: Set<string> = new Set()): Rect[] {
  return items
    .filter((i): i is Exclude<CanvasItem, { type: 'connector' }> => 'w' in i && i.type !== 'frame' && i.type !== 'callout' && i.type !== 'path' && i.type !== 'line' && !ignore.has(i.id))
    .map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))
}

/**
 * The free spot nearest to `idealY` for a flag of w×h: tries each candidate column x in turn at growing vertical offsets
 * (down, up, further down…), so a flag moves aside rather than landing on content or on another flag. Falls back to the ideal spot.
 */
export function placeFlag(xs: number[], idealY: number, w: number, h: number, obstacles: Rect[], taken: Rect[]): { x: number; y: number } {
  const step = h + 8
  for (let k = 0; k <= 16; k += 1) {
    for (const dir of k === 0 ? [0] : [1, -1]) {
      const y = idealY + dir * k * step
      for (const x of xs) {
        const rect = { x, y, w, h }
        if (!obstacles.some((o) => hits(rect, o, 8)) && !taken.some((t) => hits(rect, t, 6))) return { x, y }
      }
    }
  }
  return { x: xs[0], y: idealY }
}

/** Point on the flag's border facing `target` (leader line start), in the flag's own coordinates. */
export function leaderStart(w: number, h: number, target: { x: number; y: number }): { x: number; y: number } {
  const cx = w / 2, cy = h / 2
  const dx = target.x - cx, dy = target.y - cy
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: cy }
  const t = Math.min(dx ? (w / 2) / Math.abs(dx) : Infinity, dy ? (h / 2) / Math.abs(dy) : Infinity)
  return { x: cx + dx * t, y: cy + dy * t }
}

type Pending = { op: AiOp; rx: number; ry: number; text: string; side: 'left' | 'right'; w: number }

/** Callout ops carry `on` (image id), x/y = the point in % of the image and `text` = the name. */
export function layoutCallouts(items: CanvasItem[], ops: AiOp[], newId: () => string): { items: CanvasItem[]; created: string[]; idMap: Record<string, string> } {
  const created: string[] = []
  const idMap: Record<string, string> = {}
  let out = [...items]
  const byImage = new Map<string, AiOp[]>()
  for (const op of ops) {
    if (op.kind !== 'callout' || !op.on || op.x === undefined || op.y === undefined || !op.text?.trim()) continue
    byImage.set(op.on, [...(byImage.get(op.on) || []), op])
  }
  for (const [imageId, group] of byImage) {
    const image = out.find((i): i is ImageItem => i.id === imageId && i.type === 'image')
    if (!image) continue
    // Labelling again replaces the flags made earlier, except the ones the user renamed.
    out = out.filter((i) => !(i.type === 'callout' && i.ai && i.imageId === imageId && !i.edited))
    const pending: Pending[] = group.map((op) => {
      const rx = clamp(op.x! / 100, 0, 1), ry = clamp(op.y! / 100, 0, 1)
      const text = op.text!.trim().slice(0, 60)
      return { op, rx, ry, text, side: rx < 0.5 ? 'left' : 'right', w: calloutWidth(text) }
    })
    // Keep both margins comparably full: move the most central flags of the crowded side to the other.
    for (;;) {
      const left = pending.filter((p) => p.side === 'left'), right = pending.filter((p) => p.side === 'right')
      if (Math.abs(left.length - right.length) <= 2) break
      const from = left.length > right.length ? left : right
      const move = [...from].sort((a, b) => Math.abs(a.rx - 0.5) - Math.abs(b.rx - 0.5))[0]
      move.side = move.side === 'left' ? 'right' : 'left'
    }
    const minTop = image.y - 24
    const obstacles = flagObstacles(out, new Set([imageId]))
    const taken: Rect[] = out.filter((i) => i.type === 'callout').map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h }))
    for (const side of ['left', 'right'] as const) {
      const column = pending.filter((p) => p.side === side).sort((a, b) => a.ry - b.ry)
      if (!column.length) continue
      const maxBottom = Math.max(image.y + image.h + 24, minTop + column.length * (CALLOUT_H + SPACING))
      const tops = column.map((p) => image.y + p.ry * image.h - CALLOUT_H / 2)
      for (let i = 0; i < tops.length; i += 1) tops[i] = Math.max(tops[i], i ? tops[i - 1] + CALLOUT_H + SPACING : minTop)
      if (tops[tops.length - 1] + CALLOUT_H > maxBottom) {
        for (let i = tops.length - 1; i >= 0; i -= 1) tops[i] = Math.min(tops[i], maxBottom - CALLOUT_H - (tops.length - 1 - i) * (CALLOUT_H + SPACING))
      }
      column.forEach((p, i) => {
        const id = newId()
        if (p.op.id) idMap[p.op.id] = id
        const x = side === 'left' ? image.x - GAP - p.w : image.x + image.w + GAP
        const altX = side === 'left' ? image.x + image.w + GAP : image.x - GAP - p.w
        const spot = placeFlag([x, altX], tops[i], p.w, CALLOUT_H, obstacles, taken)
        taken.push({ x: spot.x, y: spot.y, w: p.w, h: CALLOUT_H })
        out.push({ id, ai: true, type: 'callout', x: spot.x, y: spot.y, w: p.w, h: CALLOUT_H, text: p.text, color: CALLOUT_COLOR,
          imageId, rx: p.rx, ry: p.ry, tx: image.x + p.rx * image.w, ty: image.y + p.ry * image.h })
        created.push(id)
      })
    }
  }
  return { items: out, created, idMap }
}
