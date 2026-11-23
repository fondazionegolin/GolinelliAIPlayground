import { describe, expect, it } from 'vitest'
import { answerHash, boolVars, defaultFigureSize, erf, figureSvg, fracChain, fAdd, fDiv, fMul, histogramBins, niceScale, normAnswer, normalCdf, parseBool, parseProb, quantile, regression, sha256Hex, truthTable, type FigureSpec } from './canvasFigures'
import { parseFigureSpec, textHeight } from './canvasAi'
import { sanitizeVega } from './canvasFigureEngines'

describe('exact fractions', () => {
  it('multiplies, adds, divides and explains the result', () => {
    expect(fMul([3, 2], [4, 5])).toEqual([6, 5])
    expect(fAdd([1, 3], [1, 4])).toEqual([7, 12])
    expect(fDiv([3, 4], [1, 8])).toEqual([6, 1])
    expect(fracChain([12, 10])).toBe('12/10 = 6/5 = 1 e 1/5 = 1,2')
  })
})

describe('statistics', () => {
  it('quartiles, bins, regression and the normal curve', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75)
    const { counts } = histogramBins([1, 2, 2, 3, 3, 3, 4, 4, 5], 4)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(9)
    const r = regression([[1, 2], [2, 4], [3, 6]])!
    expect(r.slope).toBeCloseTo(2); expect(r.intercept).toBeCloseTo(0); expect(r.r).toBeCloseTo(1)
    expect(erf(0)).toBeCloseTo(0, 6)
    expect(normalCdf(1) - normalCdf(-1)).toBeCloseTo(0.6827, 3)
    expect(niceScale(0, 23).max).toBe(25)
  })
})

describe('logic', () => {
  it('parses precedence and builds truth tables', () => {
    expect(boolVars(parseBool('A AND NOT B OR C')!)).toEqual(new Set(['A', 'B', 'C']))
    expect(parseBool('A AND')).toBeNull()
    const t = truthTable(['A', 'B'], ['NOT (A AND B)', 'NOT A OR NOT B', 'A -> B'])
    expect(t.rows).toHaveLength(4)
    expect(t.results[0]).toEqual(t.results[1])          // De Morgan
    expect(t.results[2]).toEqual([true, false, true, true]) // A→B
    expect(truthTable(['A'], ['A OR NOT A']).results[0]).toEqual([true, true])
  })
  it('reads probabilities as fractions, decimals and percents', () => {
    expect(parseProb('3/5')?.frac).toEqual([3, 5])
    expect(parseProb(0.25)?.value).toBe(0.25)
    expect(parseProb('40%')?.value).toBeCloseTo(0.4)
  })
})

describe('svg output', () => {
  const specs: FigureSpec[] = [
    { fig: 'pie', slices: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }] },
    { fig: 'bar', categories: ['x', 'y'], series: [{ name: 's', values: [1, 2] }] },
    { fig: 'fraction', op: 'multiply', fractions: [[3, 2], [4, 5]] },
    { fig: 'venn', sets: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], regions: [{ sets: 'ABC', text: '1' }] },
    { fig: 'tree', root: { label: 'r', children: [{ label: 'a', p: '1/2' }, { label: 'b', p: '1/2' }] } },
  ]
  it('is well-formed and escapes user text', () => {
    for (const s of specs) {
      const svg = figureSvg(s, ...defaultFigureSize(s))
      expect(svg.startsWith('<svg')).toBe(true); expect(svg.endsWith('</svg>')).toBe(true)
    }
    const evil = figureSvg({ fig: 'pie', title: '<img onerror=x>', slices: [{ label: '"><script>', value: 1 }] }, 400, 300)
    expect(evil).not.toContain('<script'); expect(evil).not.toContain('<img')
  })
  it('never throws on empty data', () => {
    expect(figureSvg({ fig: 'pie', slices: [] }, 300, 200)).toContain('Nessun dato')
  })
})

describe('model output handling', () => {
  it('parses figure specs and rejects network access in vega', () => {
    expect(parseFigureSpec('{"fig":"pie","slices":[{"label":"a","value":1}]}')?.fig).toBe('pie')
    expect(parseFigureSpec('not json')).toBeNull()
    expect(parseFigureSpec('{"fig":"vega","def":{"data":{"url":"x"}}}')).toBeNull()      // no mark left after cleaning
    const clean = sanitizeVega({ mark: 'bar', data: { url: 'http://evil', values: [{ a: 1 }] } })!
    expect(JSON.stringify(clean)).not.toContain('evil')
  })
  it('grows a text box to hold its text', () => {
    expect(textHeight('3/2 = due torte divise a metà e ancora un po di testo per andare a capo', 200, 16, true)).toBeGreaterThan(60)
    expect(textHeight('ok', 280, 16, false)).toBeLessThan(60)
  })
})

describe('learner (guided) mode never shows results', () => {
  const size = (s: FigureSpec) => defaultFigureSize(s)
  const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
  it('fractions keep the model but not the answer', () => {
    for (const op of ['multiply', 'add', 'sub', 'divide', 'compare'] as const) {
      const s: FigureSpec = { fig: 'fraction', op, fractions: [[3, 2], [4, 5]], guided: true }
      const svg = figureSvg(s, ...size(s))
      const all = texts(svg).join(' | ')
      expect(all).toContain('?')
      expect(all).not.toMatch(/6\/5|12\/10|23\/10|7\/10|15\/8|= 1,2|&gt;|&lt;/)
    }
    const open = figureSvg({ fig: 'fraction', op: 'multiply', fractions: [[3, 2], [4, 5]] }, 560, 420)
    expect(open).toContain('6/5')
  })
  it('truth tables, trees, normals and plots hide computed values', () => {
    const tt = figureSvg({ fig: 'truth_table', variables: ['A'], expressions: ['NOT A'], guided: true }, 400, 300)
    const cells = texts(tt)
    expect(cells.filter((t) => t === 'V' || t === 'F')).toHaveLength(2)  // only the input column: the results are left to the learner
    expect(cells).toContain('?')
    const tree = figureSvg({ fig: 'tree', guided: true, root: { label: 'r', children: [{ label: 'a', p: '1/2' }, { label: 'b', p: '1/2' }] } }, 640, 300)
    expect(tree).toContain('P = ?'); expect(tree).not.toContain('P = 1/2')
    const normal = figureSvg({ fig: 'normal', mean: 0, sd: 1, from: -1, to: 1, guided: true }, 560, 340)
    expect(normal).toContain('P = ?'); expect(normal).not.toContain('68,27')
  })
})

describe('fill-in answers', () => {
  it('normalises equivalent answers to the same form (same rules as the server)', () => {
    expect(['1,5', '3/2', '1.50', '6/4', ' +3/2 '].map(normAnswer)).toEqual(['3/2', '3/2', '3/2', '3/2', '3/2'])
    expect(['26', ' 26 ', '26,0'].map(normAnswer)).toEqual(['26', '26', '26'])
    expect(normAnswer('−3')).toBe('-3'); expect(normAnswer('Quattro.')).toBe('quattro')
  })
  it('hashes like Python hashlib.sha256', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(answerHash('4e3ab409b039', '11')).toBe(answerHash('4e3ab409b039', '11,0'))
    expect(answerHash('4e3ab409b039', '11')).toBe('3696a459a9024300fce62299511a1fac979a05d81cd70c477794dd3b4af5aa3d') // the value Python's harden_spec produced
  })
})
