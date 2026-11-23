import { describe, expect, it } from 'vitest'
import { removeBackground } from './canvasCutout'

function scene(w: number, h: number, bg: (x: number, y: number) => [number, number, number], subject: (x: number, y: number) => [number, number, number] | null) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = subject(x, y) ?? bg(x, y)
    const i = (y * w + x) * 4
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
  }
  return data
}
const disc = (cx: number, cy: number, r: number, c: [number, number, number]) => (x: number, y: number) => ((x - cx) ** 2 + (y - cy) ** 2 < r * r ? c : null)

describe('removeBackground', () => {
  it('removes a plain white background and keeps the subject opaque', () => {
    const data = scene(120, 100, () => [250, 250, 250], disc(60, 50, 30, [200, 40, 40]))
    const r = removeBackground(data, 120, 100)
    expect(r.confident).toBe(true)
    expect(r.data[(50 * 120 + 60) * 4 + 3]).toBe(255)
    expect(r.data[(2 * 120 + 2) * 4 + 3]).toBe(0)
    expect(r.coverage).toBeGreaterThan(0.22)
    expect(r.coverage).toBeLessThan(0.30)
    expect(Math.abs(r.box.w - 60)).toBeLessThanOrEqual(3)
  })

  it('crosses a soft gradient background but stops at the subject edge', () => {
    const data = scene(140, 100, (x) => [200 + x / 6, 205 + x / 8, 215], disc(70, 50, 28, [30, 90, 160]))
    const r = removeBackground(data, 140, 100)
    expect(r.data[(50 * 140 + 70) * 4 + 3]).toBe(255)
    expect(r.data[(5 * 140 + 130) * 4 + 3]).toBe(0)
  })

  it('keeps an enclosed hole of background colour inside the subject (it is not reachable from the border)', () => {
    const ring = (x: number, y: number): [number, number, number] | null => {
      const d = Math.hypot(x - 60, y - 50)
      return d < 34 && d > 14 ? [20, 120, 60] : null
    }
    const r = removeBackground(scene(120, 100, () => [255, 255, 255], ring), 120, 100)
    expect(r.data[(50 * 120 + 60) * 4 + 3]).toBeGreaterThan(0)
  })

  it('flags a busy background as not confident', () => {
    const noise = (x: number, y: number): [number, number, number] => { const v = ((x * 7919 + y * 104729) % 255); return [v, 255 - v, (v * 3) % 255] }
    const r = removeBackground(scene(100, 100, noise, disc(50, 50, 25, [10, 10, 10])), 100, 100)
    expect(r.confident).toBe(false)
  })
})
