import { describe, expect, it } from 'vitest'
import { plotGeometry, type PlotSpec } from './canvasPlot'

const base: PlotSpec = { w: 480, h: 400, expr: 'x^2', xMin: -3, xMax: 3, yMin: -1, yMax: 10, areas: [{ from: 0, to: 2 }], marks: [{ x: 0, y: 0, label: '(0, 0)' }], riemann: { from: 0, to: 2, n: 4, kind: 'left' } }
describe('plot in learner mode', () => {
  it('shows the region but not the integral, the sum or the notable points', () => {
    const open = plotGeometry(base)
    expect(open.areas[0].label).toContain('8/3')
    expect(open.marks).toHaveLength(1)
    const guided = plotGeometry({ ...base, guided: true })
    expect(guided.areas[0].label).toBe('area da calcolare')
    expect(guided.marks).toHaveLength(0)
    expect(guided.riemannLabel?.text).not.toContain('≈')
  })
})
