import { describe, expect, it } from 'vitest'
import { plotColumns, plotNumber, plotWithAxes, tableFromPlot, type PlotValue } from './plotData'

const plot: PlotValue = { kind: 'scatter', x: [3, 9, 5], y: [8, 1, 4], color: ['A', 'B', 'A'], labels: { x: 'italiano', y: 'criticita' } }
const table = { columns: ['studente', 'italiano', 'criticita', 'fratelli'], rows: [
  { studente: 'Ada', italiano: 3, criticita: 8, fratelli: 2 },
  { studente: 'Bea', italiano: 9, criticita: 1, fratelli: 0 },
  { studente: 'Carlo', italiano: 5, criticita: 4, fratelli: 1 },
] }

describe('plot axis selection', () => {
  it('offers all source columns and limits numeric axes to numeric values', () => {
    expect(plotColumns(table)).toEqual({ columns: table.columns, numeric: ['italiano', 'criticita', 'fratelli'] })
    expect(plotNumber(null)).toBeNull()
    expect(plotNumber('')).toBeNull()
    expect(plotNumber('  ')).toBeNull()
    expect(plotNumber(false)).toBeNull()
    expect(plotNumber('0')).toBe(0)
  })

  it('uses additional source columns, switches to 3D, and keeps rows and groups aligned', () => {
    const result = plotWithAxes(plot, table, { x: 'fratelli', y: 'italiano', z: 'criticita' })
    expect(result).toMatchObject({ kind: 'scatter3d', x: [2, 0, 1], y: [3, 9, 5], z: [8, 1, 4], color: plot.color,
      labels: { x: 'fratelli', y: 'italiano', z: 'criticita' } })
    expect(plotWithAxes(result, table, { x: 'italiano', y: 'criticita', z: '' })).toMatchObject({ kind: 'scatter', z: undefined })
    expect(plot.x).toEqual([3, 9, 5])
  })

  it('never turns missing or invalid coordinates into zero or misaligns group labels', () => {
    const source = { rows: [{ a: null, b: 1, c: 3 }, { a: 2, b: 4, c: null }, { a: 3, b: 5, c: 6 }] }
    const result = plotWithAxes(plot, source, { x: 'a', y: 'b', z: 'c' })
    expect(result).toMatchObject({ x: [3], y: [5], z: [6], color: ['A'] })
    expect(plotWithAxes(plot, { rows: [{ a: '', b: false }, { a: 0, b: '0' }] }, { x: 'a', y: 'b', z: '' })).toMatchObject({ x: [0], y: [0] })
  })

  it('preserves categorical student labels in a bar chart', () => {
    const result = plotWithAxes({ ...plot, kind: 'bar' }, table, { x: 'studente', y: 'fratelli', z: '' })
    expect(result).toMatchObject({ kind: 'bar', x: ['Ada', 'Bea', 'Carlo'], y: [2, 0, 1] })
  })

  it('recomputes histogram counts from source rows, including the maximum value', () => {
    const histogram: PlotValue = { kind: 'histogram', x: [0, 1], xEnd: [1, 2], y: [2, 1], labels: { x: 'a', y: 'conteggio' } }
    const result = plotWithAxes(histogram, { rows: [{ b: 0 }, { b: 2 }, { b: 4 }, { b: null }] }, { x: 'b', y: '', z: '' })
    expect(result).toMatchObject({ x: [0, 2], xEnd: [2, 4], y: [1, 2], labels: { x: 'b', y: 'conteggio' } })
    expect(plotWithAxes(histogram, { rows: [{ b: 3 }, { b: 3 }] }, { x: 'b', y: '', z: '' }).y.reduce((a, b) => a + b)).toBe(2)
  })

  it('can swap existing coordinates in older outputs without a retained source table', () => {
    const source = tableFromPlot(plot)
    expect(plotWithAxes(plot, source, { x: 'criticita', y: 'italiano', z: '' })).toMatchObject({ x: [8, 1, 4], y: [3, 9, 5] })
  })
})
