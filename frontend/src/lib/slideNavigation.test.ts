import { afterEach, describe, expect, it, vi } from 'vitest'
import { recalledSlideIndex, rememberSlide, reorderSlides } from './slideNavigation'

const slides = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
const ids = (result: typeof slides) => result.map(slide => slide.id).join('')

afterEach(() => vi.unstubAllGlobals())

describe('slide insertion slots', () => {
  it('inserts above or below the target in either drag direction', () => {
    expect(ids(reorderSlides(slides, ['b'], 3))).toBe('acbde')
    expect(ids(reorderSlides(slides, ['b'], 4))).toBe('acdbe')
    expect(ids(reorderSlides(slides, ['d'], 1))).toBe('adbce')
    expect(ids(reorderSlides(slides, ['d'], 2))).toBe('abdce')
    expect(ids(slides)).toBe('abcde')
  })
  it('supports both end slots and preserves the order of multiple selected slides', () => {
    expect(ids(reorderSlides(slides, ['b', 'd'], 5))).toBe('acebd')
    expect(ids(reorderSlides(slides, ['d', 'b'], 0))).toBe('bdace')
    expect(ids(reorderSlides(slides, ['b', 'd'], 3))).toBe('acbde')
  })
  it('does not move a slide dropped on either of its own boundaries', () => {
    expect(reorderSlides(slides, ['c'], 2)).toBe(slides)
    expect(reorderSlides(slides, ['c'], 3)).toBe(slides)
    expect(reorderSlides(slides, ['b', 'c'], 2)).toBe(slides)
    expect(reorderSlides(slides, ['missing'], 0)).toBe(slides)
  })
})

describe('remembering the last open slide', () => {
  function storage() {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    return values
  }
  it('follows the slide identity after reordering and isolates documents and viewers', () => {
    storage()
    rememberSlide('teacher:1', 'deck', 'c', 2)
    expect(recalledSlideIndex('teacher:1', 'deck', slides)).toBe(2)
    expect(recalledSlideIndex('teacher:1', 'deck', reorderSlides(slides, ['c'], 5))).toBe(4)
    expect(recalledSlideIndex('teacher:2', 'deck', slides)).toBe(0)
    expect(recalledSlideIndex('teacher:1', 'another-deck', slides)).toBe(0)
  })
  it('falls back to the nearest index if the saved slide was deleted', () => {
    storage()
    rememberSlide('student:1', 'deck', 'e', 4)
    expect(recalledSlideIndex('student:1', 'deck', slides.slice(0, 2))).toBe(1)
    expect(recalledSlideIndex('student:1', 'deck', [])).toBe(0)
  })
  it('tolerates unavailable or corrupt browser storage', () => {
    const values = storage()
    values.set('documents:last-slide:teacher:1:deck', 'invalid json')
    expect(recalledSlideIndex('teacher:1', 'deck', slides)).toBe(0)
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') } })
    expect(() => rememberSlide('teacher:1', 'deck', 'b', 1)).not.toThrow()
    expect(recalledSlideIndex('teacher:1', 'deck', slides)).toBe(0)
  })
})
