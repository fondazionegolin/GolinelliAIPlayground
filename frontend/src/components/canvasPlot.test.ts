import { describe, expect, it } from 'vitest'
import { compileFn, fitWindow, formatValue, integrate, plotGeometry, type PlotSpec } from './canvasPlot'

const base: PlotSpec = { w: 520, h: 420, expr: 'x^2', xMin: -1, xMax: 4, yMin: -1, yMax: 10 }

describe('canvasPlot', () => {
  it('integrates exactly (x^2 on [1,3] = 26/3)', () => {
    const f = compileFn('x^2')!
    expect(integrate(f, 1, 3)).toBeCloseTo(26 / 3, 6)
    expect(formatValue(26 / 3)).toBe('26/3 ≈ 8.6667')
    expect(formatValue(4)).toBe('4')
  })

  it('shades exactly the region under the curve, with limits and the computed value', () => {
    const geo = plotGeometry({ ...base, areas: [{ from: 1, to: 3 }] })
    expect(geo.areas).toHaveLength(1)
    expect(geo.areas[0].value).toBeCloseTo(26 / 3, 6)
    expect(geo.areas[0].label).toContain('26/3')
    // polygon vertices lie inside the plot frame and only between the two limits
    const xs = [...geo.areas[0].d.matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g)].map((m) => Number(m[1]))
    const left = geo.vlines.find((v) => v.label === '1')!, right = geo.vlines.find((v) => v.label === '3')!
    expect(Math.min(...xs)).toBeCloseTo(left.x1, 1)
    expect(Math.max(...xs)).toBeCloseTo(right.x1, 1)
  })

  it('area between two curves', () => {
    const geo = plotGeometry({ ...base, expr: 'x', areas: [{ from: 0, to: 2, below: 'x^2/2' }] })
    expect(geo.areas[0].value).toBeCloseTo(2 - 8 / 6, 6)
  })

  it('riemann rectangles follow the function', () => {
    const geo = plotGeometry({ ...base, riemann: { from: 0, to: 2, n: 4, kind: 'left' } })
    expect(geo.rects).toHaveLength(4)
    expect(geo.riemannLabel?.text).toContain('Riemann')
  })

  it('fitWindow grows the window to show the whole shaded region', () => {
    const fit = fitWindow({ ...base, xMax: 2, yMax: 3, areas: [{ from: 1, to: 3 }] })
    expect(fit.xMax).toBeGreaterThanOrEqual(3)
    expect(fit.yMax).toBeGreaterThanOrEqual(9)
  })
})
