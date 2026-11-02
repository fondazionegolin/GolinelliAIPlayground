import { describe, expect, it } from 'vitest'
import { explicitFunction, graphWindow, looksLikeLatex, plainToLatex } from './canvasMath'

describe('plainToLatex', () => {
  it.each([
    ['y = 3x^2 + 3', 'y=3x^{2}+3'],
    ['x^2 - 5x + 6 = 0', 'x^{2}-5x+6=0'],
    ['y = (x+1)/(x-1)', 'y=\\frac{x+1}{x-1}'],
    ['y = sqrt(x) + 2', 'y=\\sqrt{x}+2'],
    ['a <= b', 'a\\le b'],
    ['y = 2(x+1)', 'y=2\\left(x+1\\right)'],
    ['y = sin(x)', 'y=\\sin\\left(x\\right)'],
  ])('%s', (plain, tex) => expect(plainToLatex(plain)).toBe(tex))

  it('rejects what it cannot read and recognises LaTeX', () => {
    expect(plainToLatex('foo(')).toBeNull()
    expect(looksLikeLatex('\\frac{a}{b}')).toBe(true)
    expect(looksLikeLatex('y = 3x')).toBe(false)
  })
})

describe('graph', () => {
  it('finds the function and a window that contains the vertex', () => {
    const f = explicitFunction('y = 3x^2 + 3')!
    expect(f).not.toBeNull()
    const w = graphWindow(f, 'y = 3x^2 + 3')
    expect(w.yMin).toBeLessThanOrEqual(0)
    expect(w.yMax).toBeGreaterThanOrEqual(30)
    expect(explicitFunction('x^2 + y^2 = 4')).toBeNull()
  })
})
