import { describe, expect, it } from 'vitest'
import { DEMOS } from './library'
import { captionAt, color, envAt, frames, num, type Scene } from './spec'

const env = (t: number, D = 10) => ({ t, D, p: t / D })

describe('values', () => {
  it('evaluates numbers, expressions of t/p and eased keyframes', () => {
    expect(num(5, env(1), 0)).toBe(5)
    expect(num('100+50*cos(2*pi*p)', env(0), 0)).toBeCloseTo(150)
    expect(num('100+50*cos(2*pi*p)', env(5), 0)).toBeCloseTo(50)
    const keys = { keys: [[0, 0], [4, 100]] as Array<[number, number]>, ease: 'linear' as const }
    expect(num(keys, env(2), 0)).toBeCloseTo(50)
    expect(num(keys, env(9), 0)).toBe(100)
    expect(num('1/(t-1', env(1), 7)).toBe(7) // unreadable → fallback, never a crash
  })

  it('blends colours in RGB and holds the ends', () => {
    const c = { keys: [[0, '#000000'], [2, '#ffffff']] as Array<[number, string]>, ease: 'linear' as const }
    expect(color(c, env(1), '#f00')).toBe('#808080')
    expect(color(c, env(5), '#f00')).toBe('#ffffff')
  })
})

describe('scene', () => {
  const scene: Scene = {
    title: 't', width: 800, height: 450, duration: 8, loop: true, background: 'dark',
    entities: [
      { id: 'g', type: 'circle', x: 100, y: 100, rotate: 90, scale: 2 },
      { id: 'c', type: 'circle', parent: 'g', x: 10, y: 0, opacity: 0.5 },
    ],
    steps: [{ at: 0, text: 'uno' }, { at: 4, text: 'due' }],
  }

  it('composes parent transforms into children', () => {
    const f = frames(scene, env(0, 8)).get('c')!
    expect(f.x).toBeCloseTo(100, 5)      // (10,0) rotated 90° and doubled → (0,20)
    expect(f.y).toBeCloseTo(120, 5)
    expect(f.scale).toBe(2)
  })

  it('loops time and picks the caption in force', () => {
    expect(envAt(scene, 9).t).toBeCloseTo(1)
    expect(captionAt(scene, 1)).toBe('uno')
    expect(captionAt(scene, 5)).toBe('due')
  })

  it('every bundled demo is well formed: unique ids, valid parents and bond ends, captions inside the duration', () => {
    for (const d of DEMOS) {
      const ids = d.scene.entities.map((e) => e.id)
      expect(new Set(ids).size, d.key).toBe(ids.length)
      d.scene.entities.forEach((e) => {
        if (e.parent) expect(ids, `${d.key}.${e.id}.parent`).toContain(e.parent)
        if (e.type === 'bond') { expect(ids).toContain(e.a); expect(ids).toContain(e.b) }
      })
      d.scene.steps.forEach((s) => expect(s.at).toBeLessThanOrEqual(d.scene.duration))
    }
  })
})
