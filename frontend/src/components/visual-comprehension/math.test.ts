import { describe, expect, it } from 'vitest'
import { MathError, classify, contour, evaluate, judge, parse, parseEquation, samples } from './mathExpr'

describe('safe math language', () => {
  it('reads what students type: implicit products, powers, superscripts, Italian decimals, unicode minus', () => {
    expect(evaluate(parse('3x^2 - 5'), { x: 2 })).toBe(7)
    expect(evaluate(parse('2(x+1)'), { x: 1 })).toBe(4)
    expect(evaluate(parse('x²/9'), { x: 3 })).toBe(1)
    expect(evaluate(parse('0,5x − 1'), { x: 4 })).toBe(1)
    expect(evaluate(parse('A sin(kx + φ)'), { A: 2, k: 1, phi: 0, x: Math.PI / 2 })).toBeCloseTo(2)
    expect(evaluate(parse('xy'), { x: 3, y: 4 })).toBe(12)
  })

  it('refuses code and explains broken input', () => {
    expect(() => evaluate(parse('alert(1)'), { x: 1 })).toThrow(/Non so quanto vale/)  // letters, not code: never executed
    expect(() => parse('x = 1')).toThrow(MathError)
    expect(() => parse('3x +')).toThrow(/incompleta/)
    expect(() => parse('(x+1')).toThrow(/parentesi/)
    expect(() => parse('x; 1')).toThrow(/non riconosciuto/)
  })
})

describe('what the student drew', () => {
  const kind = (text: string) => classify(parseEquation(text)).family
  it('recognises the curve families', () => {
    expect(kind('y = 3x + 4')).toBe('retta')
    expect(kind('y = 3x^2 - 5')).toBe('parabola')
    expect(kind('x^2 + y^2 = 4')).toBe('circonferenza')
    expect(kind('x^2/9 + y^2/4 = 1')).toBe('ellisse')
    expect(kind('y^2/9 - x^2/16 = 1')).toBe('iperbole')
    expect(kind('xy = 1')).toBe('iperbole')
    expect(kind('y = 2sin(x)')).toBe('sinusoide')
  })

  it('reads the facts a teacher points at', () => {
    expect(classify(parseEquation('y^2/9 - x^2/16 = 1')).facts).toEqual(['rami in alto e in basso', 'vertici in y = -3 e y = 3'])
    expect(classify(parseEquation('x^2 - y^2 = 4')).facts).toContain('vertici in x = -2 e x = 2')
  })
})

describe('feedback on an attempt', () => {
  const target = parseEquation('y^2/9 - x^2/16 = 1')
  it('accepts any equivalent form of the right curve', () => {
    expect(judge(parseEquation('16y^2 - 9x^2 = 144'), target).correct).toBe(true)
  })
  it('says what was drawn instead', () => {
    expect(judge(parseEquation('y = 3x^4 - 5'), target).message).toMatch(/stai disegnando un polinomio.*non un'iperbole/)
    expect(judge(parseEquation('y = 3x + 1'), target).message).toMatch(/stai disegnando una retta/)
  })
  it('points at the difference within the right family', () => {
    expect(judge(parseEquation('y^2/16 - x^2/9 = 1'), target).message).toMatch(/y = -4 e y = 4.*y = -3 e y = 3/)
    expect(judge(parseEquation('x^2/9 - y^2/16 = 1'), target).message).toMatch(/a sinistra e a destra.*in alto e in basso/)
  })
})

describe('plotting', () => {
  it('traces an implicit hyperbola and splits an explicit function at its pole', () => {
    const segs = contour(parseEquation('y^2/9 - x^2/16 = 1').f, {}, { x0: -8, x1: 8, y0: -8, y1: 8 })
    expect(segs.length).toBeGreaterThan(100)
    expect(segs.every(([, y1]) => Math.abs(y1) >= 2.9)).toBe(true)
    expect(samples(parse('1/x'), {}, { x0: -5, x1: 5, y0: -5, y1: 5 }).length).toBe(2)
  })
})
