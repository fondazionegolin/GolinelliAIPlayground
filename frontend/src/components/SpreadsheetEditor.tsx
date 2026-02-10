import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Download, FileUp, Loader2, Plus, Trash2, Sigma, Wand2 } from 'lucide-react'
import { HyperFormula } from 'hyperformula'
import * as XLSX from 'xlsx'
import { llmApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

type CellPos = { row: number; col: number }
type SelectionRange = { startRow: number; endRow: number; startCol: number; endCol: number }

const MIN_ROWS = 20
const MIN_COLS = 8
const MAX_ROWS = 200
const MAX_COLS = 50

function normalizeGrid(input: string[][], minRows = MIN_ROWS, minCols = MIN_COLS): string[][] {
  const rows = Math.max(minRows, input.length)
  const cols = Math.max(minCols, input.reduce((acc, row) => Math.max(acc, row.length), 0))
  return Array.from({ length: rows }, (_, rIdx) =>
    Array.from({ length: cols }, (_, cIdx) => input[rIdx]?.[cIdx] ?? '')
  )
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
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeRange(range: SelectionRange): SelectionRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    endRow: Math.max(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endCol: Math.max(range.startCol, range.endCol),
  }
}

function rangeToA1(range: SelectionRange): string {
  const a = `${columnName(range.startCol)}${range.startRow + 1}`
  const b = `${columnName(range.endCol)}${range.endRow + 1}`
  return `${a}:${b}`
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

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  const meanY = sumY / n
  const ssTot = points.reduce((acc, p) => acc + (p.y - meanY) ** 2, 0)
  const ssRes = points.reduce((acc, p) => acc + (p.y - (slope * p.x + intercept)) ** 2, 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  const minX = Math.min(...points.map(p => p.x))
  const maxX = Math.max(...points.map(p => p.x))

  return {
    slope,
    intercept,
    r2,
    line: [
      { x: minX, y: slope * minX + intercept },
      { x: maxX, y: slope * maxX + intercept },
    ],
  }
}

export function SpreadsheetEditor({
  data,
  onDataChange,
  chartConfig,
  onChartConfigChange,
}: SpreadsheetEditorProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const normalizedData = useMemo(() => normalizeGrid(data), [data])

  const [selectedCell, setSelectedCell] = useState<CellPos | null>({ row: 0, col: 0 })
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  const [selectionAnchor, setSelectionAnchor] = useState<CellPos | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [activeContextMenu, setActiveContextMenu] = useState<'none' | 'chart' | 'fill'>('none')
  const [fillInstruction, setFillInstruction] = useState('')
  const [useFirstRowAsHeader, setUseFirstRowAsHeader] = useState(true)
  const [aiFillLoading, setAiFillLoading] = useState(false)

  useEffect(() => {
    const onMouseUp = () => {
      setIsSelecting(false)
      setSelectionAnchor(null)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

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

  const normalizedSelection = useMemo(() => (selectionRange ? normalizeRange(selectionRange) : null), [selectionRange])

  const selectedRangeLabel = useMemo(() => {
    if (!normalizedSelection) return '-'
    return rangeToA1(normalizedSelection)
  }, [normalizedSelection])

  const setCellValue = (row: number, col: number, value: string) => {
    const next = normalizedData.map(r => [...r])
    next[row][col] = value
    onDataChange(next)
  }

  const applyToSelection = (range: SelectionRange, computeValue: (row: number, col: number, idx: number, total: number) => string) => {
    const next = normalizedData.map(r => [...r])
    const normalized = normalizeRange(range)
    const cells: Array<{ row: number; col: number }> = []
    for (let row = normalized.startRow; row <= normalized.endRow; row += 1) {
      for (let col = normalized.startCol; col <= normalized.endCol; col += 1) {
        cells.push({ row, col })
      }
    }
    const total = cells.length
    cells.forEach((cell, idx) => {
      next[cell.row][cell.col] = computeValue(cell.row, cell.col, idx, total)
    })
    onDataChange(next)
  }

  const moveToCell = (row: number, col: number) => {
    const maxRow = normalizedData.length - 1
    const maxCol = (normalizedData[0]?.length || 1) - 1
    const nextRow = Math.max(0, Math.min(maxRow, row))
    const nextCol = Math.max(0, Math.min(maxCol, col))
    setSelectedCell({ row: nextRow, col: nextCol })
    setSelectionRange({ startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol })
    setTimeout(() => {
      const key = `${nextRow}-${nextCol}`
      cellInputRefs.current[key]?.focus()
    }, 0)
  }

  const applyNaturalFill = () => {
    if (!normalizedSelection || !fillInstruction.trim()) return
    const instruction = fillInstruction.trim().toLowerCase()

    const rangeMatch = instruction.match(/da\s+(-?\d+(?:[\.,]\d+)?)\s+a\s+(-?\d+(?:[\.,]\d+)?)/)
    if (rangeMatch) {
      const from = Number(rangeMatch[1].replace(',', '.'))
      const to = Number(rangeMatch[2].replace(',', '.'))
      applyToSelection(normalizedSelection, (_row, _col, idx, total) => {
        if (total <= 1) return String(from)
        const value = from + ((to - from) * idx) / (total - 1)
        return Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(2)
      })
      return
    }

    const randomMatch = instruction.match(/casual|random/)
    if (randomMatch) {
      const bounds = instruction.match(/tra\s+(-?\d+)\s+e\s+(-?\d+)/)
      const min = bounds ? Number(bounds[1]) : 1
      const max = bounds ? Number(bounds[2]) : 100
      applyToSelection(normalizedSelection, () => String(Math.floor(Math.random() * (max - min + 1)) + min))
      return
    }

    const formulaMatch = fillInstruction.match(/formula\s*:\s*(.+)$/i)
    if (formulaMatch) {
      const formula = formulaMatch[1].trim()
      applyToSelection(normalizedSelection, (row) => formula.replace(/\{row\}/gi, String(row + 1)))
      return
    }

    const valueMatch = fillInstruction.match(/(?:con|valore)\s+(.+)$/i)
    const constant = valueMatch ? valueMatch[1].trim() : fillInstruction
    applyToSelection(normalizedSelection, () => constant)
  }

  const applyAIFill = async () => {
    if (!normalizedSelection || !fillInstruction.trim()) return
    setAiFillLoading(true)
    try {
      const matrix: string[][] = []
      for (let r = normalizedSelection.startRow; r <= normalizedSelection.endRow; r += 1) {
        const row: string[] = []
        for (let c = normalizedSelection.startCol; c <= normalizedSelection.endCol; c += 1) {
          row.push(normalizedData[r]?.[c] ?? '')
        }
        matrix.push(row)
      }

      const prompt = `Sei un assistente per fogli di calcolo.
Devi riempire/modificare SOLO la selezione indicata in base all'istruzione utente.
Istruzione: "${fillInstruction.trim()}"
Intervallo: ${rangeToA1(normalizedSelection)}
Dimensioni: ${matrix.length} righe x ${matrix[0]?.length || 0} colonne
Valori correnti (JSON): ${JSON.stringify(matrix)}

Rispondi SOLO con JSON valido in questo formato:
{"values":[["..."]]}
Dove values deve avere esattamente le stesse dimensioni della selezione.
Puoi inserire numeri, testo o formule (es. "=A2*2").`

      const response = await llmApi.teacherChat(prompt, [], 'teacher_support')
      const raw = response.data?.response || response.data?.content || ''
      const jsonBlock = raw.match(/\{[\s\S]*\}/)
      if (!jsonBlock) throw new Error('Nessun JSON in risposta')
      const parsed = JSON.parse(jsonBlock[0])
      const values = parsed?.values
      if (!Array.isArray(values) || values.length !== matrix.length) throw new Error('Dimensioni risposta non valide')
      for (let i = 0; i < values.length; i += 1) {
        if (!Array.isArray(values[i]) || values[i].length !== matrix[i].length) {
          throw new Error('Dimensioni risposta non valide')
        }
      }

      const next = normalizedData.map(r => [...r])
      for (let r = normalizedSelection.startRow; r <= normalizedSelection.endRow; r += 1) {
        for (let c = normalizedSelection.startCol; c <= normalizedSelection.endCol; c += 1) {
          next[r][c] = String(values[r - normalizedSelection.startRow][c - normalizedSelection.startCol] ?? '')
        }
      }
      onDataChange(next)
      toast({ title: 'Riempimento AI completato' })
    } catch (error) {
      console.error('AI fill failed', error)
      applyNaturalFill()
      toast({ title: 'Fallback locale applicato', description: 'Risposta AI non disponibile, ho usato il riempimento guidato.' })
    } finally {
      setAiFillLoading(false)
    }
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
    if (!selectedCell || normalizedData.length <= 1) return
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
    setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  }

  const importSheet = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false }) as Array<Array<string | number | boolean | null>>
    const asString = aoa.map(row => row.map(cell => (cell ?? '').toString()))
    onDataChange(normalizeGrid(asString))
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
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

  const handleCellMouseDown = (row: number, col: number, event: ReactMouseEvent) => {
    if (event.button !== 0) return
    setIsSelecting(true)
    setSelectionAnchor({ row, col })
    setSelectedCell({ row, col })
    setSelectionRange({ startRow: row, endRow: row, startCol: col, endCol: col })
  }

  const handleCellMouseEnter = (row: number, col: number) => {
    if (!isSelecting || !selectionAnchor) return
    setSelectionRange({
      startRow: selectionAnchor.row,
      startCol: selectionAnchor.col,
      endRow: row,
      endCol: col,
    })
  }

  const isCellInSelection = (row: number, col: number) => {
    if (!normalizedSelection) return false
    return row >= normalizedSelection.startRow && row <= normalizedSelection.endRow && col >= normalizedSelection.startCol && col <= normalizedSelection.endCol
  }

  const selectedRawValue = selectedCell ? normalizedData[selectedCell.row]?.[selectedCell.col] ?? '' : ''

  const setFormulaInSelectedCell = (formula: string) => {
    if (!selectedCell) return
    setCellValue(selectedCell.row, selectedCell.col, formula)
  }

  const insertFunctionFormula = (fnName: 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'ROUND' | 'CONCAT') => {
    if (!selectedCell) return
    const reference = normalizedSelection ? rangeToA1(normalizedSelection) : `${columnName(selectedCell.col)}${selectedCell.row + 1}`
    if (fnName === 'ROUND') {
      setFormulaInSelectedCell(`=ROUND(${reference.split(':')[0]},2)`)
      return
    }
    if (fnName === 'CONCAT') {
      setFormulaInSelectedCell(`=CONCAT(${reference.split(':')[0]})`)
      return
    }
    setFormulaInSelectedCell(`=${fnName}(${reference})`)
  }

  const selectedRowsForCharts = useMemo(() => {
    if (!normalizedSelection) return [] as string[][]
    const rows: string[][] = []
    for (let row = normalizedSelection.startRow; row <= normalizedSelection.endRow; row += 1) {
      rows.push(evaluatedData[row] || [])
    }
    return rows
  }, [normalizedSelection, evaluatedData])

  const effectiveRows = useMemo(() => {
    if (!selectedRowsForCharts.length) return [] as string[][]
    if (!useFirstRowAsHeader) return selectedRowsForCharts
    return selectedRowsForCharts.slice(1)
  }, [selectedRowsForCharts, useFirstRowAsHeader])

  const selectedHeaderRow = useMemo(() => {
    if (!normalizedSelection) return [] as string[]
    if (useFirstRowAsHeader && selectedRowsForCharts.length > 0) {
      return selectedRowsForCharts[0].slice(normalizedSelection.startCol, normalizedSelection.endCol + 1)
    }
    return Array.from({ length: normalizedSelection.endCol - normalizedSelection.startCol + 1 }, (_, idx) => `Colonna ${columnName(normalizedSelection.startCol + idx)}`)
  }, [normalizedSelection, selectedRowsForCharts, useFirstRowAsHeader])

  const selectedColumnOptions = useMemo(() => {
    if (!normalizedSelection) return [] as Array<{ index: number; label: string }>
    const out: Array<{ index: number; label: string }> = []
    for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
      const rel = col - normalizedSelection.startCol
      const header = selectedHeaderRow[rel] || `Colonna ${columnName(col)}`
      out.push({ index: col, label: `${columnName(col)} - ${header}` })
    }
    return out
  }, [normalizedSelection, selectedHeaderRow])

  const chartRows = useMemo(() => {
    return effectiveRows
      .map(row => ({
        x: row[chartConfig.xCol] ?? '',
        y: row[chartConfig.yCol] ?? '',
      }))
      .filter(r => r.x !== '' && r.y !== '')
  }, [effectiveRows, chartConfig.xCol, chartConfig.yCol])

  const lineBarData = useMemo(() => {
    return chartRows
      .map(r => ({ x: String(r.x), y: toNumber(String(r.y)) }))
      .filter(r => r.y !== null) as Array<{ x: string; y: number }>
  }, [chartRows])

  const pieData = useMemo(() => {
    return chartRows
      .map(r => ({ name: String(r.x), value: toNumber(String(r.y)) }))
      .filter(r => r.value !== null) as Array<{ name: string; value: number }>
  }, [chartRows])

  const scatterData = useMemo(() => {
    return chartRows
      .map(r => ({ x: toNumber(String(r.x)), y: toNumber(String(r.y)) }))
      .filter(r => r.x !== null && r.y !== null) as Array<{ x: number; y: number }>
  }, [chartRows])

  const regression = useMemo(() => computeRegression(scatterData), [scatterData])

  const summary = useMemo(() => {
    const numeric = lineBarData.map(r => r.y)
    if (numeric.length === 0) return { count: 0, sum: 0, avg: 0, min: 0, max: 0 }
    const sum = numeric.reduce((acc, n) => acc + n, 0)
    return {
      count: numeric.length,
      sum,
      avg: sum / numeric.length,
      min: Math.min(...numeric),
      max: Math.max(...numeric),
    }
  }, [lineBarData])

  const openChartFromSelection = (scatterWithRegression = false) => {
    if (!normalizedSelection) return
    const startCol = normalizedSelection.startCol
    const xCol = startCol
    const yCol = Math.min(startCol + 1, normalizedSelection.endCol)
    onChartConfigChange({
      ...chartConfig,
      xCol,
      yCol,
      type: scatterWithRegression ? 'scatter' : chartConfig.type,
      showRegression: scatterWithRegression ? true : chartConfig.showRegression,
      title: chartConfig.title || `Grafico ${selectedRangeLabel}`,
    })
    setActiveContextMenu('chart')
  }

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

          <Button variant="outline" size="sm" onClick={addRow}><Plus className="mr-2 h-4 w-4" />Riga</Button>
          <Button variant="outline" size="sm" onClick={addColumn}><Plus className="mr-2 h-4 w-4" />Colonna</Button>
          <Button variant="outline" size="sm" onClick={removeSelectedRow} disabled={!selectedCell}><Trash2 className="mr-2 h-4 w-4" />Elimina riga</Button>
          <Button variant="outline" size="sm" onClick={removeSelectedColumn} disabled={!selectedCell}><Trash2 className="mr-2 h-4 w-4" />Elimina colonna</Button>
          <Button variant="outline" size="sm" onClick={clearSheet}>Pulisci foglio</Button>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">Barra formula (cella attiva)</span>
            <span className="text-slate-500">Selezione: {selectedRangeLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-20 rounded border bg-white px-2 py-1 text-xs text-slate-600">
              {selectedCell ? `${columnName(selectedCell.col)}${selectedCell.row + 1}` : '-'}
            </div>
            <Input
              value={selectedRawValue}
              onChange={(e) => {
                if (!selectedCell) return
                setCellValue(selectedCell.row, selectedCell.col, e.target.value)
              }}
              placeholder="Valore o formula (es. =SUM(A2:A10))"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ROUND', 'CONCAT'] as const).map(fn => (
              <button
                key={fn}
                onClick={() => insertFunctionFormula(fn)}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
              >
                {fn}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            La barra formula modifica il contenuto grezzo della cella selezionata. Se selezioni più celle, i pulsanti funzione usano l'intervallo.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[68vh] overflow-auto select-none">
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
                  {row.map((_cell, colIdx) => {
                    const selected = isCellInSelection(rowIdx, colIdx)
                    const display = evaluatedData[rowIdx]?.[colIdx] ?? ''
                    return (
                      <td
                        key={colIdx}
                        className={`border border-slate-200 p-0 ${selected ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-500' : ''}`}
                        onMouseDown={(e) => handleCellMouseDown(rowIdx, colIdx, e)}
                        onMouseEnter={() => handleCellMouseEnter(rowIdx, colIdx)}
                      >
                        <input
                          ref={(el) => { cellInputRefs.current[`${rowIdx}-${colIdx}`] = el }}
                          onMouseDown={(e) => {
                            handleCellMouseDown(rowIdx, colIdx, e)
                            e.preventDefault()
                            ;(e.currentTarget as HTMLInputElement).focus()
                          }}
                          onMouseEnter={() => handleCellMouseEnter(rowIdx, colIdx)}
                          value={normalizedData[rowIdx][colIdx]}
                          onFocus={() => {
                            setSelectedCell({ row: rowIdx, col: colIdx })
                            setSelectionRange({ startRow: rowIdx, endRow: rowIdx, startCol: colIdx, endCol: colIdx })
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              moveToCell(rowIdx + 1, colIdx)
                            }
                          }}
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

      {normalizedSelection && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs text-slate-300">Azioni contestuali</p>
              <p className="text-sm">Selezione: <span className="font-semibold">{selectedRangeLabel}</span></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => openChartFromSelection(false)}
                className="rounded-md bg-white/10 px-2.5 py-1.5 text-left text-white transition-colors hover:bg-white/20"
              >
                <span className="block text-xs font-medium leading-tight">Grafico</span>
                <span className="block text-[10px] leading-tight text-slate-300">Crea da selezione</span>
              </button>
              <button
                onClick={() => openChartFromSelection(true)}
                className="rounded-md bg-white/10 px-2.5 py-1.5 text-left text-white transition-colors hover:bg-white/20"
              >
                <span className="block text-xs font-medium leading-tight">Regressione</span>
                <span className="block text-[10px] leading-tight text-slate-300">Linea + formula</span>
              </button>
              <button
                onClick={() => setActiveContextMenu('fill')}
                className="rounded-md bg-white/10 px-2.5 py-1.5 text-left text-white transition-colors hover:bg-white/20"
              >
                <span className="block text-xs font-medium leading-tight">Riempi celle</span>
                <span className="block text-[10px] leading-tight text-slate-300">Linguaggio naturale</span>
              </button>
              <button
                onClick={() => setActiveContextMenu('none')}
                className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                Chiudi
              </button>
            </div>
          </div>

          {activeContextMenu === 'fill' && (
            <div className="mt-3 border-t border-slate-700 pt-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-300">
                <Wand2 className="h-3.5 w-3.5" />
                Suggerimenti: "Riempi con presente", "Da 1 a 100", "Valori casuali tra 10 e 50", "Formula: =A{'{row}'}*2"
              </div>
              <div className="flex gap-2">
                <Input
                  value={fillInstruction}
                  onChange={(e) => setFillInstruction(e.target.value)}
                  placeholder="Descrivi come riempire l'intervallo"
                  className="bg-slate-800 text-slate-100 border-slate-600 placeholder:text-slate-400"
                />
                <Button onClick={applyNaturalFill} variant="outline" className="border-slate-500 bg-transparent text-white hover:bg-slate-700">Guidato</Button>
                <Button onClick={applyAIFill} className="bg-blue-600 hover:bg-blue-500 text-white" disabled={aiFillLoading}>
                  {aiFillLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'AI'}
                </Button>
              </div>
            </div>
          )}

          {activeContextMenu === 'chart' && (
            <div className="mt-3 border-t border-slate-700 pt-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Tipo grafico</label>
                  <select
                    className="h-9 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100"
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
                  <label className="mb-1 block text-xs text-slate-300">Asse X</label>
                  <select
                    className="h-9 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100"
                    value={chartConfig.xCol}
                    onChange={(e) => onChartConfigChange({ ...chartConfig, xCol: Number(e.target.value) })}
                  >
                    {selectedColumnOptions.map(opt => (
                      <option key={opt.index} value={opt.index}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Asse Y</label>
                  <select
                    className="h-9 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100"
                    value={chartConfig.yCol}
                    onChange={(e) => onChartConfigChange({ ...chartConfig, yCol: Number(e.target.value) })}
                  >
                    {selectedColumnOptions.map(opt => (
                      <option key={opt.index} value={opt.index}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">Titolo</label>
                  <Input
                    value={chartConfig.title}
                    onChange={(e) => onChartConfigChange({ ...chartConfig, title: e.target.value })}
                    className="bg-slate-800 text-slate-100 border-slate-600"
                  />
                </div>
              </div>

              <div className="mt-2 flex items-center gap-3 text-xs text-slate-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useFirstRowAsHeader}
                    onChange={(e) => setUseFirstRowAsHeader(e.target.checked)}
                  />
                  Usa prima riga come intestazione
                </label>
                {chartConfig.type === 'scatter' && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chartConfig.showRegression}
                      onChange={(e) => onChartConfigChange({ ...chartConfig, showRegression: e.target.checked })}
                    />
                    Mostra regressione lineare
                  </label>
                )}
              </div>

              <div className="mt-3 h-72 rounded-lg border border-slate-700 bg-slate-950 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  {chartConfig.type === 'line' ? (
                    <LineChart data={lineBarData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="y" stroke="#93c5fd" dot={false} />
                    </LineChart>
                  ) : chartConfig.type === 'bar' ? (
                    <BarChart data={lineBarData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="y" fill="#60a5fa" />
                    </BarChart>
                  ) : chartConfig.type === 'pie' ? (
                    <PieChart>
                      <Tooltip />
                      <Legend />
                      <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={95}>
                        {pieData.map((entry, idx) => (
                          <Cell key={`${entry.name}-${idx}`} fill={['#93c5fd', '#86efac', '#fca5a5', '#d8b4fe', '#fde68a'][idx % 5]} />
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
                      <Scatter name="Dati" data={scatterData} fill="#93c5fd" />
                      {chartConfig.showRegression && regression && (
                        <Line name="Regressione" data={regression.line} dataKey="y" type="linear" stroke="#f87171" dot={false} legendType="line" />
                      )}
                    </ScatterChart>
                  )}
                </ResponsiveContainer>
              </div>

              <div className="mt-3 rounded border border-slate-700 bg-slate-800 p-2 text-xs text-slate-200">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <Sigma className="h-3.5 w-3.5" />
                  Operazioni su Y
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <div>COUNT: <strong>{summary.count}</strong></div>
                  <div>SUM: <strong>{summary.sum.toFixed(2)}</strong></div>
                  <div>AVERAGE: <strong>{summary.avg.toFixed(2)}</strong></div>
                  <div>MIN: <strong>{summary.min.toFixed(2)}</strong></div>
                  <div>MAX: <strong>{summary.max.toFixed(2)}</strong></div>
                </div>
                {chartConfig.type === 'scatter' && chartConfig.showRegression && regression && (
                  <div className="mt-2 rounded border border-rose-300/40 bg-rose-500/10 p-2">
                    y = {regression.slope.toFixed(4)}x + {regression.intercept.toFixed(4)} | R² = {regression.r2.toFixed(4)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
