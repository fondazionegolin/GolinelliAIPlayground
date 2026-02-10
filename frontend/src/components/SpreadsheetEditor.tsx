import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Download, FileUp, Plus, Trash2, BarChart3, Sigma } from 'lucide-react'
import { HyperFormula } from 'hyperformula'
import * as XLSX from 'xlsx'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Legend,
} from 'recharts'

export type SheetChartType = 'line' | 'bar' | 'scatter' | 'pie'

export interface SheetChartConfig {
  type: SheetChartType
  title: string
  xCol: number
  yCol: number
  showRegression: boolean
}

interface SpreadsheetEditorProps {
  data: string[][]
  onDataChange: (next: string[][]) => void
  chartConfig: SheetChartConfig
  onChartConfigChange: (next: SheetChartConfig) => void
}

const MIN_ROWS = 20
const MIN_COLS = 8
const MAX_ROWS = 200
const MAX_COLS = 50

function normalizeGrid(input: string[][], minRows = MIN_ROWS, minCols = MIN_COLS): string[][] {
  const rows = Math.max(minRows, input.length)
  const cols = Math.max(minCols, input.reduce((acc, row) => Math.max(acc, row.length), 0))
  const out: string[][] = Array.from({ length: rows }, (_, rIdx) =>
    Array.from({ length: cols }, (_, cIdx) => input[rIdx]?.[cIdx] ?? '')
  )
  return out
}

function columnName(index: number): string {
  let n = index
  let name = ''
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') {
    const maybeError = (value as { value?: string }).value
    return maybeError ? `#${maybeError}` : '#ERROR'
  }
  return String(value)
}

function toNumber(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function computeRegression(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return null
  const n = points.length
  const sumX = points.reduce((a, p) => a + p.x, 0)
  const sumY = points.reduce((a, p) => a + p.y, 0)
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0)
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0)
  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) return null

  const m = (n * sumXY - sumX * sumY) / denominator
  const q = (sumY - m * sumX) / n

  const meanY = sumY / n
  const ssTot = points.reduce((acc, p) => acc + (p.y - meanY) ** 2, 0)
  const ssRes = points.reduce((acc, p) => acc + (p.y - (m * p.x + q)) ** 2, 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  const minX = Math.min(...points.map(p => p.x))
  const maxX = Math.max(...points.map(p => p.x))

  return {
    slope: m,
    intercept: q,
    r2,
    line: [
      { x: minX, y: m * minX + q },
      { x: maxX, y: m * maxX + q },
    ],
  }
}

function defaultHeaders(cols: number): string[] {
  return Array.from({ length: cols }, (_, idx) => `Colonna ${columnName(idx)}`)
}

export function SpreadsheetEditor({
  data,
  onDataChange,
  chartConfig,
  onChartConfigChange,
}: SpreadsheetEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const normalizedData = useMemo(() => normalizeGrid(data), [data])
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>({ row: 0, col: 0 })

  const evaluatedData = useMemo(() => {
    try {
      const engine = HyperFormula.buildFromArray(normalizedData, { licenseKey: 'gpl-v3' })
      const values = engine.getSheetValues(0)
      return values.map(row => row.map(toDisplayValue))
    } catch (error) {
      console.error('Formula evaluation error', error)
      return normalizedData
    }
  }, [normalizedData])

  const headers = useMemo(() => {
    const headerRow = evaluatedData[0] || []
    return headerRow.map((h, idx) => h || `Colonna ${columnName(idx)}`)
  }, [evaluatedData])

  const columnOptions = useMemo(() => {
    const labels = headers.length > 0 ? headers : defaultHeaders(normalizedData[0]?.length || MIN_COLS)
    return labels.map((label, index) => ({
      index,
      label: `${columnName(index)} - ${label}`,
    }))
  }, [headers, normalizedData])

  const setCellValue = (row: number, col: number, value: string) => {
    const next = normalizedData.map(r => [...r])
    next[row][col] = value
    onDataChange(next)
  }

  const addRow = () => {
    if (normalizedData.length >= MAX_ROWS) return
    const cols = normalizedData[0]?.length || MIN_COLS
    onDataChange([...normalizedData, Array.from({ length: cols }, () => '')])
  }

  const addColumn = () => {
    const cols = normalizedData[0]?.length || MIN_COLS
    if (cols >= MAX_COLS) return
    onDataChange(normalizedData.map(row => [...row, '']))
  }

  const removeSelectedRow = () => {
    if (!selectedCell) return
    if (normalizedData.length <= 1) return
    onDataChange(normalizedData.filter((_, idx) => idx !== selectedCell.row))
    setSelectedCell({ row: Math.max(0, selectedCell.row - 1), col: selectedCell.col })
  }

  const removeSelectedColumn = () => {
    if (!selectedCell) return
    const cols = normalizedData[0]?.length || 0
    if (cols <= 1) return
    onDataChange(normalizedData.map(row => row.filter((_, idx) => idx !== selectedCell.col)))
    setSelectedCell({ row: selectedCell.row, col: Math.max(0, selectedCell.col - 1) })
  }

  const clearSheet = () => {
    onDataChange(normalizeGrid([]))
    setSelectedCell({ row: 0, col: 0 })
  }

  const importSheet = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false }) as Array<Array<string | number | boolean | null>>
    const asString = aoa.map(row => row.map(cell => (cell ?? '').toString()))
    onDataChange(normalizeGrid(asString))
    setSelectedCell({ row: 0, col: 0 })
  }

  const exportCsv = () => {
    const sheet = XLSX.utils.aoa_to_sheet(normalizedData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Foglio')
    XLSX.writeFile(wb, 'foglio.csv', { bookType: 'csv' })
  }

  const exportXlsx = () => {
    const sheet = XLSX.utils.aoa_to_sheet(normalizedData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Foglio')
    XLSX.writeFile(wb, 'foglio.xlsx')
  }

  const selectedRawValue = selectedCell ? normalizedData[selectedCell.row]?.[selectedCell.col] ?? '' : ''

  const chartRows = useMemo(() => {
    const rows = evaluatedData.slice(1)
    return rows
      .map(row => {
        const xValue = row[chartConfig.xCol] ?? ''
        const yValue = row[chartConfig.yCol] ?? ''
        return { x: xValue, y: yValue }
      })
      .filter(r => r.x !== '' && r.y !== '')
  }, [evaluatedData, chartConfig.xCol, chartConfig.yCol])

  const lineBarData = useMemo(() => {
    return chartRows
      .map(r => ({ x: r.x, y: toNumber(r.y) }))
      .filter(r => r.y !== null) as Array<{ x: string; y: number }>
  }, [chartRows])

  const pieData = useMemo(() => {
    return chartRows
      .map(r => ({ name: String(r.x), value: toNumber(r.y) }))
      .filter(r => r.value !== null) as Array<{ name: string; value: number }>
  }, [chartRows])

  const scatterData = useMemo(() => {
    return chartRows
      .map(r => ({ x: toNumber(r.x), y: toNumber(r.y) }))
      .filter(r => r.x !== null && r.y !== null) as Array<{ x: number; y: number }>
  }, [chartRows])

  const regression = useMemo(() => computeRegression(scatterData), [scatterData])

  const summary = useMemo(() => {
    const numeric = lineBarData.map(r => r.y)
    if (numeric.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0 }
    }
    const sum = numeric.reduce((acc, n) => acc + n, 0)
    return {
      count: numeric.length,
      sum,
      avg: sum / numeric.length,
      min: Math.min(...numeric),
      max: Math.max(...numeric),
    }
  }, [lineBarData])

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="mr-2 h-4 w-4" />
            Importa CSV/XLSX
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              await importSheet(file)
              e.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Esporta CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportXlsx}>
            <Download className="mr-2 h-4 w-4" />
            Esporta XLSX
          </Button>

          <div className="mx-1 h-5 w-px bg-slate-200" />

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-2 h-4 w-4" />
            Riga
          </Button>
          <Button variant="outline" size="sm" onClick={addColumn}>
            <Plus className="mr-2 h-4 w-4" />
            Colonna
          </Button>
          <Button variant="outline" size="sm" onClick={removeSelectedRow} disabled={!selectedCell}>
            <Trash2 className="mr-2 h-4 w-4" />
            Elimina riga
          </Button>
          <Button variant="outline" size="sm" onClick={removeSelectedColumn} disabled={!selectedCell}>
            <Trash2 className="mr-2 h-4 w-4" />
            Elimina colonna
          </Button>
          <Button variant="outline" size="sm" onClick={clearSheet}>
            Pulisci foglio
          </Button>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 text-xs font-medium text-slate-600">Barra formula</div>
          <div className="flex items-center gap-2">
            <div className="w-16 rounded border bg-white px-2 py-1 text-xs text-slate-600">
              {selectedCell ? `${columnName(selectedCell.col)}${selectedCell.row + 1}` : '-'}
            </div>
            <Input
              value={selectedRawValue}
              onChange={(e) => {
                if (!selectedCell) return
                setCellValue(selectedCell.row, selectedCell.col, e.target.value)
              }}
              placeholder="Inserisci valore o formula (es. =SUM(A2:A10))"
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Formule supportate (HyperFormula): SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, CONCAT.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[1.35fr,1fr]">
        <div className="min-h-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <th className="w-12 border border-slate-200 px-2 py-1.5 text-xs text-slate-500">#</th>
                  {normalizedData[0]?.map((_, colIdx) => (
                    <th key={colIdx} className="min-w-[120px] border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700">
                      {columnName(colIdx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {normalizedData.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    <td className="border border-slate-200 bg-slate-50 px-2 text-xs text-slate-500">{rowIdx + 1}</td>
                    {row.map((_, colIdx) => {
                      const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx
                      const display = evaluatedData[rowIdx]?.[colIdx] ?? ''
                      return (
                        <td
                          key={colIdx}
                          className={`border border-slate-200 p-0 ${isSelected ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}
                          onClick={() => setSelectedCell({ row: rowIdx, col: colIdx })}
                        >
                          <input
                            value={normalizedData[rowIdx][colIdx]}
                            onChange={(e) => setCellValue(rowIdx, colIdx, e.target.value)}
                            className="h-9 w-full border-0 bg-transparent px-2 text-sm text-slate-800 focus:outline-none"
                            title={normalizedData[rowIdx][colIdx].startsWith('=') ? `Risultato: ${display}` : ''}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-800">Grafici e analisi</h3>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-600">Tipo grafico</label>
              <select
                className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm"
                value={chartConfig.type}
                onChange={(e) => onChartConfigChange({ ...chartConfig, type: e.target.value as SheetChartType })}
              >
                <option value="line">Linea</option>
                <option value="bar">Barre</option>
                <option value="scatter">Scatter</option>
                <option value="pie">Torta</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Titolo</label>
              <Input
                value={chartConfig.title}
                onChange={(e) => onChartConfigChange({ ...chartConfig, title: e.target.value })}
                placeholder="Titolo grafico"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Asse X</label>
              <select
                className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm"
                value={chartConfig.xCol}
                onChange={(e) => onChartConfigChange({ ...chartConfig, xCol: Number(e.target.value) })}
              >
                {columnOptions.map(opt => (
                  <option key={opt.index} value={opt.index}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">Asse Y</label>
              <select
                className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm"
                value={chartConfig.yCol}
                onChange={(e) => onChartConfigChange({ ...chartConfig, yCol: Number(e.target.value) })}
              >
                {columnOptions.map(opt => (
                  <option key={opt.index} value={opt.index}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {chartConfig.type === 'scatter' && (
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={chartConfig.showRegression}
                onChange={(e) => onChartConfigChange({ ...chartConfig, showRegression: e.target.checked })}
              />
              Mostra retta di regressione lineare
            </label>
          )}

          <div className="mt-4 h-72 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <ResponsiveContainer width="100%" height="100%">
              {chartConfig.type === 'line' ? (
                <LineChart data={lineBarData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="y" stroke="#334155" dot={false} />
                </LineChart>
              ) : chartConfig.type === 'bar' ? (
                <BarChart data={lineBarData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="y" fill="#475569" />
                </BarChart>
              ) : chartConfig.type === 'pie' ? (
                <PieChart>
                  <Tooltip />
                  <Legend />
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={95}>
                    {pieData.map((entry, idx) => (
                      <Cell key={`${entry.name}-${idx}`} fill={['#334155', '#0f766e', '#2563eb', '#7c3aed', '#be123c'][idx % 5]} />
                    ))}
                  </Pie>
                </PieChart>
              ) : (
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="x" type="number" />
                  <YAxis dataKey="y" type="number" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Legend />
                  <Scatter name="Dati" data={scatterData} fill="#334155" />
                  {chartConfig.showRegression && regression && (
                    <Line
                      name="Regressione"
                      data={regression.line}
                      dataKey="y"
                      type="linear"
                      stroke="#dc2626"
                      dot={false}
                      legendType="line"
                    />
                  )}
                </ScatterChart>
              )}
            </ResponsiveContainer>
          </div>

          {chartConfig.title && (
            <p className="mt-2 text-xs font-medium text-slate-700">{chartConfig.title}</p>
          )}

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <Sigma className="h-3.5 w-3.5" />
              Operazioni colonna Y
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
              <div>COUNT: <span className="font-semibold">{summary.count}</span></div>
              <div>SUM: <span className="font-semibold">{summary.sum.toFixed(2)}</span></div>
              <div>AVERAGE: <span className="font-semibold">{summary.avg.toFixed(2)}</span></div>
              <div>MIN: <span className="font-semibold">{summary.min.toFixed(2)}</span></div>
              <div>MAX: <span className="font-semibold">{summary.max.toFixed(2)}</span></div>
            </div>

            {chartConfig.type === 'scatter' && chartConfig.showRegression && regression && (
              <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                Regressione: <strong>y = {regression.slope.toFixed(4)}x + {regression.intercept.toFixed(4)}</strong><br />
                R²: <strong>{regression.r2.toFixed(4)}</strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
