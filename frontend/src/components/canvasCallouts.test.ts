import { describe, expect, it } from 'vitest'
import type { AiOp } from './canvasAi'
import { calloutTarget, layoutCallouts, leaderStart, CALLOUT_H, type CalloutItem } from './canvasCallouts'
import type { CanvasItem } from './CollaborativeCanvas'

const image: CanvasItem = { id: 'img', type: 'image', x: 100, y: 50, w: 400, h: 300, src: 'x' }
let n = 0
const newId = () => `c${++n}`
const op = (text: string, x: number, y: number): AiOp => ({ kind: 'callout', id: `o-${text}`, on: 'img', x, y, text })

describe('callout layout', () => {
  const ops = [op('Alto sx', 10, 10), op('Basso sx', 15, 90), op('Centro dx', 80, 50), op('Alto dx', 90, 12), op('Centro', 52, 48)]
  const { items, created } = layoutCallouts([image], ops, newId)
  const flags = items.filter((i): i is CalloutItem => i.type === 'callout')

  it('creates one flag per part, targeting the exact point on the image', () => {
    expect(created).toHaveLength(5)
    const a = flags.find((f) => f.text === 'Alto sx')!
    expect(calloutTarget(a, items)).toEqual({ x: 100 + 0.1 * 400, y: 50 + 0.1 * 300 })
  })

  it('puts flags outside the image, none overlapping in a column', () => {
    for (const f of flags) expect(f.x + f.w <= image.x || f.x >= image.x + 400).toBe(true)
    for (const side of [(f: CalloutItem) => f.x < image.x, (f: CalloutItem) => f.x > image.x]) {
      const col = flags.filter(side).sort((a, b) => a.y - b.y)
      for (let i = 1; i < col.length; i += 1) expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y + CALLOUT_H)
    }
  })

  it('keeps the order top-to-bottom so leaders do not cross', () => {
    const left = flags.filter((f) => f.x < image.x).sort((a, b) => a.y - b.y)
    const ry = left.map((f) => f.ry)
    expect([...ry].sort((a, b) => a - b)).toEqual(ry)
  })

  it('follows the image when it moves and replaces earlier flags on re-label', () => {
    const moved = items.map((i) => (i.id === 'img' ? { ...i, x: 300, y: 80 } : i))
    const a = flags.find((f) => f.text === 'Alto sx')!
    expect(calloutTarget(a, moved)).toEqual({ x: 300 + 40, y: 80 + 30 })
    const again = layoutCallouts(items, [op('Nuovo', 50, 50)], newId).items.filter((i) => i.type === 'callout')
    expect(again).toHaveLength(1)
  })

  it('leader starts on the border facing the target', () => {
    expect(leaderStart(100, 30, { x: 300, y: 15 })).toEqual({ x: 100, y: 15 })
    expect(leaderStart(100, 30, { x: -200, y: 15 })).toEqual({ x: 0, y: 15 })
  })
})
