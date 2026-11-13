export type TableValue = { columns?: string[]; rows: Array<Record<string, unknown>>; rowCount?: number }
export type PlotValue = { kind: 'scatter' | 'histogram' | 'scatter3d' | 'bar' | 'line'; x: Array<number | string>; xType?: 'date' | 'number' | 'index'; lower?: Array<number | null>; upper?: Array<number | null>; xEnd?: number[]; y: number[]; z?: number[]; color?: unknown[]; labels?: Record<string, string>; title?: string }
export type PlotAxes = { x: string; y: string; z: string; color?: string }

export function plotNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function plotColumns(table: TableValue) {
  const columns = [...new Set([...(table.columns || []), ...table.rows.flatMap(Object.keys)])]
  const numeric = columns.filter(column => {
    const values = table.rows.map(row => row[column]).filter(value => value !== null && value !== undefined && value !== '')
    return values.length > 0 && values.every(value => plotNumber(value) !== null)
  })
  return { columns, numeric }
}

/** Older outputs still support swapping their existing axes without re-running upstream nodes. */
export function tableFromPlot(plot: PlotValue): TableValue {
  const x = plot.labels?.x || 'x', y = plot.labels?.y || 'y', z = plot.labels?.z || 'z'
  return { columns: [x, y, ...(plot.z ? [z] : [])], rows: plot.x.map((value, i) => ({ [x]: value, [y]: plot.y[i], ...(plot.z ? { [z]: plot.z[i] } : {}) })) }
}

/** Rebuild only the visualisation, retaining row alignment across coordinates and groups. */
export function plotWithAxes(base: PlotValue, table: TableValue, axes: PlotAxes): PlotValue {
  if (base.kind === 'histogram') {
    const values = table.rows.map(row => plotNumber(row[axes.x])).filter((value): value is number => value !== null)
    if (!values.length) return { ...base, x: [], xEnd: [], y: [], labels: { x: axes.x, y: base.labels?.y || 'conteggio' } }
    let lo = Math.min(...values), hi = Math.max(...values)
    if (lo === hi) { lo -= .5; hi += .5 }
    const count = Math.max(1, base.x.length), width = (hi - lo) / count
    const bins = Array.from({ length: count }, (_, i) => lo + i * width), counts = bins.map(() => 0)
    values.forEach(value => { counts[Math.min(count - 1, Math.floor((value - lo) / width))]++ })
    return { ...base, x: bins, xEnd: bins.map(value => value + width), y: counts, labels: { x: axes.x, y: base.labels?.y || 'conteggio' } }
  }
  const rows = table.rows.flatMap((row, index) => {
    const x = base.kind === 'bar' ? row[axes.x] : plotNumber(row[axes.x])
    const y = plotNumber(row[axes.y]), z = axes.z ? plotNumber(row[axes.z]) : undefined
    if (x === null || x === undefined || x === '' || y === null || z === null) return []
    return [{ x: base.kind === 'bar' ? String(x) : Number(x), y, z, color: axes.color ? row[axes.color] : base.color?.[index] }]
  })
  return { ...base, kind: base.kind === 'bar' ? 'bar' : axes.z ? 'scatter3d' : 'scatter',
    x: rows.map(row => row.x), y: rows.map(row => row.y), z: axes.z ? rows.map(row => row.z!) : undefined,
    color: axes.color || base.color ? rows.map(row => row.color) : undefined,
    labels: { x: axes.x, y: axes.y, ...(axes.z ? { z: axes.z } : {}) } }
}
