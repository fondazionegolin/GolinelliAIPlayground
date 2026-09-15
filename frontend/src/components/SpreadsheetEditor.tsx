import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlignCenter, AlignLeft, AlignRight, BarChart3, Bold, Check, ClipboardPaste, Copy, Download, Eraser, FileUp, Italic, Loader2, Plus, Scissors, Sigma, Trash2, TrendingUp, Wand2 } from 'lucide-react'
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

export interface SheetCellStyle {
  fontFamily?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  textAlign?: 'left' | 'center' | 'right'
}

export type SheetCellStyles = Record<string, SheetCellStyle>

export interface SheetDimensions {
  columnWidths: number[]
  rowHeights: number[]
}

interface SpreadsheetEditorProps {
  data: string[][]
  onDataChange: (next: string[][]) => void
  chartConfig: SheetChartConfig
  onChartConfigChange: (next: SheetChartConfig) => void
  styles?: SheetCellStyles
  onStylesChange?: (next: SheetCellStyles) => void
  dimensions?: Partial<SheetDimensions>
  onDimensionsChange?: (next: SheetDimensions) => void
}

type CellPos = { row: number; col: number }
type SelectionRange = { startRow: number; endRow: number; startCol: number; endCol: number }
type SelectionMode = 'cell' | 'row' | 'column' | 'all'
type StatFunction = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'MEDIAN' | 'STDEV.S'
type SmartDirection = 'row' | 'column'

const FORMULA_FUNCTIONS: Array<{ name: StatFunction | 'IF' | 'ROUND' | 'COUNTA'; label: string; hint: string }> = [
  { name: 'SUM', label: 'Somma', hint: 'Somma i valori' },
  { name: 'AVERAGE', label: 'Media', hint: 'Calcola la media' },
  { name: 'MIN', label: 'Minimo', hint: 'Trova il valore minimo' },
  { name: 'MAX', label: 'Massimo', hint: 'Trova il valore massimo' },
  { name: 'COUNT', label: 'Conta numeri', hint: 'Conta le celle numeriche' },
  { name: 'MEDIAN', label: 'Mediana', hint: 'Calcola la mediana' },
  { name: 'STDEV.S', label: 'Deviazione std.', hint: 'Deviazione standard campionaria' },
  { name: 'IF', label: 'Se', hint: 'Applica una condizione' },
  { name: 'ROUND', label: 'Arrotonda', hint: 'Arrotonda un valore' },
  { name: 'COUNTA', label: 'Conta valori', hint: 'Conta le celle non vuote' },
]

function IconTool({ label, onClick, disabled = false, active = false, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'border-indigo-300 bg-indigo-100 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900'}`}
      >
        {children}
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block">
        {label}
      </span>
    </div>
  )
}

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
  if (String(value).trim() === '') return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function gridCellFromWorksheet(cell: XLSX.CellObject | undefined): string {
  if (!cell) return ''
  if (cell.f) return `=${cell.f}`
  if (cell.v === null || cell.v === undefined) return ''
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE'
  return String(cell.v)
}

function worksheetToGrid(sheet: XLSX.WorkSheet): string[][] {
  if (!sheet['!ref']) return [['']]
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const endRow = Math.min(range.e.r, MAX_ROWS - 1)
  const endCol = Math.min(range.e.c, MAX_COLS - 1)
  return Array.from({ length: endRow + 1 }, (_, row) =>
    Array.from({ length: endCol + 1 }, (_, col) => gridCellFromWorksheet(sheet[XLSX.utils.encode_cell({ r: row, c: col })]))
  )
}

function xlsxCellValue(raw: string): XLSX.CellObject | string | number | boolean {
  const value = raw.trim()
  if (value.startsWith('=') && value.length > 1) return { t: 'n', f: value.slice(1) }
  if (/^(TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === 'TRUE'
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) && !/^[-+]?0\d+/.test(value)) return Number(value)
  return raw
}

function gridToWorksheet(data: string[][], dimensions?: Partial<SheetDimensions>): XLSX.WorkSheet {
  const typed = data.map(row => row.map(xlsxCellValue))
  const sheet = XLSX.utils.aoa_to_sheet(typed)
  if (dimensions?.columnWidths?.length) sheet['!cols'] = dimensions.columnWidths.map(width => ({ wpx: width }))
  if (dimensions?.rowHeights?.length) sheet['!rows'] = dimensions.rowHeights.map(height => ({ hpx: height }))
  return sheet
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
  styles = {},
  onStylesChange,
  dimensions = {},
  onDimensionsChange,
}: SpreadsheetEditorProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cellInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const normalizedData = useMemo(() => normalizeGrid(data), [data])
  const columnWidths = useMemo(() => normalizedData[0].map((_, index) => dimensions.columnWidths?.[index] || 120), [dimensions.columnWidths, normalizedData])
  const rowHeights = useMemo(() => normalizedData.map((_, index) => dimensions.rowHeights?.[index] || 36), [dimensions.rowHeights, normalizedData])

  const [selectedCell, setSelectedCell] = useState<CellPos | null>({ row: 0, col: 0 })
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('cell')
  const [selectionAnchor, setSelectionAnchor] = useState<CellPos | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [activeContextMenu, setActiveContextMenu] = useState<'none' | 'chart' | 'fill'>('none')
  const [fillInstruction, setFillInstruction] = useState('')
  const [useFirstRowAsHeader, setUseFirstRowAsHeader] = useState(true)
  const [aiFillLoading, setAiFillLoading] = useState(false)
  const [operation, setOperation] = useState<'+' | '-' | '*' | '/'>('+')
  const [operationValue, setOperationValue] = useState('1')
  const [statFunction, setStatFunction] = useState<StatFunction>('SUM')
  const [editingCell, setEditingCell] = useState<string | null>(null)

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

  const smartSelection = useMemo(() => {
    if (!normalizedSelection) return null
    const numericCells: Array<CellPos & { value: number }> = []
    for (let row = normalizedSelection.startRow; row <= normalizedSelection.endRow; row += 1) {
      for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
        const numeric = toNumber(evaluatedData[row]?.[col] || '')
        if (numeric !== null) numericCells.push({ row, col, value: numeric })
      }
    }
    if (!numericCells.length) return null
    const values = numericCells.map(cell => cell.value)
    const sum = values.reduce((total, value) => total + value, 0)
    const bounds: SelectionRange = {
      startRow: Math.min(...numericCells.map(cell => cell.row)),
      endRow: Math.max(...numericCells.map(cell => cell.row)),
      startCol: Math.min(...numericCells.map(cell => cell.col)),
      endCol: Math.max(...numericCells.map(cell => cell.col)),
    }
    const height = bounds.endRow - bounds.startRow + 1
    const width = bounds.endCol - bounds.startCol + 1
    const direction: SmartDirection = height === 1 || (width > 1 && width > height) ? 'row' : 'column'
    return { count: values.length, sum, average: sum / values.length, bounds, direction }
  }, [evaluatedData, normalizedSelection])

  const isMultipleSelection = Boolean(normalizedSelection && (
    normalizedSelection.startRow !== normalizedSelection.endRow || normalizedSelection.startCol !== normalizedSelection.endCol
  ))

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
    setSelectionMode('cell')
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
    const insertAt = selectionMode === 'row' && normalizedSelection ? normalizedSelection.endRow + 1 : normalizedData.length
    const next = normalizedData.map(row => [...row])
    next.splice(insertAt, 0, Array.from({ length: cols }, () => ''))
    onDataChange(next)
    onDimensionsChange?.({ columnWidths, rowHeights: [...rowHeights.slice(0, insertAt), 36, ...rowHeights.slice(insertAt)] })
    if (onStylesChange) {
      const shifted: SheetCellStyles = {}
      Object.entries(styles).forEach(([key, style]) => {
        const [row, col] = key.split(':').map(Number)
        shifted[`${row >= insertAt ? row + 1 : row}:${col}`] = style
      })
      onStylesChange(shifted)
    }
    setSelectedCell({ row: insertAt, col: selectedCell?.col ?? 0 })
    setSelectionRange({ startRow: insertAt, endRow: insertAt, startCol: 0, endCol: cols - 1 })
    setSelectionMode('row')
  }

  const addColumn = () => {
    const cols = normalizedData[0]?.length || MIN_COLS
    if (cols >= MAX_COLS) return
    const insertAt = selectionMode === 'column' && normalizedSelection ? normalizedSelection.endCol + 1 : cols
    onDataChange(normalizedData.map(row => [...row.slice(0, insertAt), '', ...row.slice(insertAt)]))
    onDimensionsChange?.({ columnWidths: [...columnWidths.slice(0, insertAt), 120, ...columnWidths.slice(insertAt)], rowHeights })
    if (onStylesChange) {
      const shifted: SheetCellStyles = {}
      Object.entries(styles).forEach(([key, style]) => {
        const [row, col] = key.split(':').map(Number)
        shifted[`${row}:${col >= insertAt ? col + 1 : col}`] = style
      })
      onStylesChange(shifted)
    }
    setSelectedCell({ row: selectedCell?.row ?? 0, col: insertAt })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: insertAt, endCol: insertAt })
    setSelectionMode('column')
  }

  const removeSelectedRow = () => {
    if (!selectedCell || normalizedData.length <= 1) return
    const removeAt = selectionMode === 'row' && normalizedSelection ? normalizedSelection.startRow : selectedCell.row
    onDataChange(normalizedData.filter((_, idx) => idx !== removeAt))
    onDimensionsChange?.({ columnWidths, rowHeights: rowHeights.filter((_, idx) => idx !== removeAt) })
    if (onStylesChange) {
      const shifted: SheetCellStyles = {}
      Object.entries(styles).forEach(([key, style]) => {
        const [row, col] = key.split(':').map(Number)
        if (row !== removeAt) shifted[`${row > removeAt ? row - 1 : row}:${col}`] = style
      })
      onStylesChange(shifted)
    }
    const nextRow = Math.min(removeAt, normalizedData.length - 2)
    setSelectedCell({ row: nextRow, col: selectedCell.col })
    setSelectionRange({ startRow: nextRow, endRow: nextRow, startCol: 0, endCol: (normalizedData[0]?.length || 1) - 1 })
    setSelectionMode('row')
  }

  const removeSelectedColumn = () => {
    if (!selectedCell) return
    const cols = normalizedData[0]?.length || 0
    if (cols <= 1) return
    const removeAt = selectionMode === 'column' && normalizedSelection ? normalizedSelection.startCol : selectedCell.col
    onDataChange(normalizedData.map(row => row.filter((_, idx) => idx !== removeAt)))
    onDimensionsChange?.({ columnWidths: columnWidths.filter((_, idx) => idx !== removeAt), rowHeights })
    if (onStylesChange) {
      const shifted: SheetCellStyles = {}
      Object.entries(styles).forEach(([key, style]) => {
        const [row, col] = key.split(':').map(Number)
        if (col !== removeAt) shifted[`${row}:${col > removeAt ? col - 1 : col}`] = style
      })
      onStylesChange(shifted)
    }
    const nextCol = Math.min(removeAt, cols - 2)
    setSelectedCell({ row: selectedCell.row, col: nextCol })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: nextCol, endCol: nextCol })
    setSelectionMode('column')
  }

  const clearSheet = () => {
    onDataChange(normalizeGrid([]))
    onDimensionsChange?.({ columnWidths: [], rowHeights: [] })
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    setSelectionMode('cell')
  }

  const importSheet = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellFormula: true, cellDates: true })
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    onDataChange(normalizeGrid(worksheetToGrid(firstSheet)))
    onDimensionsChange?.({
      columnWidths: (firstSheet['!cols'] || []).map(column => column.wpx || (column.wch ? Math.round(column.wch * 7) : 120)),
      rowHeights: (firstSheet['!rows'] || []).map(row => row.hpx || (row.hpt ? Math.round(row.hpt * 4 / 3) : 36)),
    })
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    setSelectionMode('cell')
  }

  const exportCsv = () => {
    const sheet = XLSX.utils.aoa_to_sheet(evaluatedData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Tabelle')
    XLSX.writeFile(wb, 'tabelle.csv', { bookType: 'csv' })
  }

  const exportXlsx = () => {
    const sheet = gridToWorksheet(normalizedData, { columnWidths, rowHeights })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Tabelle')
    XLSX.writeFile(wb, 'tabelle.xlsx')
  }

  const handleCellMouseDown = (row: number, col: number, event: ReactMouseEvent) => {
    if (event.button !== 0) return
    setIsSelecting(true)
    setSelectionAnchor({ row, col })
    setSelectedCell({ row, col })
    setSelectionRange({ startRow: row, endRow: row, startCol: col, endCol: col })
    setSelectionMode('cell')
  }

  const selectColumn = (col: number) => {
    setEditingCell(null)
    setSelectedCell({ row: Math.min(selectedCell?.row ?? 0, normalizedData.length - 1), col })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: col, endCol: col })
    setSelectionMode('column')
  }

  const selectRow = (row: number) => {
    const lastCol = (normalizedData[0]?.length || 1) - 1
    setEditingCell(null)
    setSelectedCell({ row, col: Math.min(selectedCell?.col ?? 0, lastCol) })
    setSelectionRange({ startRow: row, endRow: row, startCol: 0, endCol: lastCol })
    setSelectionMode('row')
  }

  const selectAll = () => {
    const lastCol = (normalizedData[0]?.length || 1) - 1
    setEditingCell(null)
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: 0, endCol: lastCol })
    setSelectionMode('all')
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
  const selectedStyle = selectedCell ? styles[`${selectedCell.row}:${selectedCell.col}`] || {} : {}

  const adjacentFormulaRange = useMemo(() => {
    if (isMultipleSelection && smartSelection) return smartSelection.bounds
    if (!selectedCell) return null
    const { row, col } = selectedCell
    let startRow = row - 1
    while (startRow >= 0 && toNumber(evaluatedData[startRow]?.[col] || '') !== null) startRow -= 1
    if (startRow < row - 1) return { startRow: startRow + 1, endRow: row - 1, startCol: col, endCol: col }
    let startCol = col - 1
    while (startCol >= 0 && toNumber(evaluatedData[row]?.[startCol] || '') !== null) startCol -= 1
    if (startCol < col - 1) return { startRow: row, endRow: row, startCol: startCol + 1, endCol: col - 1 }
    return null
  }, [evaluatedData, isMultipleSelection, selectedCell, smartSelection])

  const formulaFunctionQuery = selectedRawValue.match(/^=([A-Za-z.]*)$/)?.[1]?.toUpperCase()
  const formulaCompletions = formulaFunctionQuery === undefined
    ? []
    : FORMULA_FUNCTIONS.filter(item => item.name.startsWith(formulaFunctionQuery)).slice(0, 7)

  const completeFormula = (name: typeof FORMULA_FUNCTIONS[number]['name']) => {
    if (!selectedCell) return
    const range = adjacentFormulaRange ? rangeToA1(adjacentFormulaRange) : ''
    const formula = name === 'IF'
      ? range ? `=IF(${range}>0,${range},0)` : '=IF(,,)'
      : name === 'ROUND'
        ? `=ROUND(${range},2)`
        : `=${name}(${range})`
    setCellValue(selectedCell.row, selectedCell.col, formula)
    setEditingCell(`${selectedCell.row}:${selectedCell.col}`)
    setTimeout(() => cellInputRefs.current[`${selectedCell.row}-${selectedCell.col}`]?.focus(), 0)
  }

  const selectionMatrix = () => {
    if (!normalizedSelection) return [] as string[][]
    return Array.from({ length: normalizedSelection.endRow - normalizedSelection.startRow + 1 }, (_, rowOffset) =>
      Array.from({ length: normalizedSelection.endCol - normalizedSelection.startCol + 1 }, (_, colOffset) =>
        normalizedData[normalizedSelection.startRow + rowOffset]?.[normalizedSelection.startCol + colOffset] ?? ''
      )
    )
  }

  const copySelection = async () => {
    const text = selectionMatrix().map(row => row.join('\t')).join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'Celle copiate' })
    } catch {
      toast({ title: 'Copia con Ctrl/Cmd+C', description: 'Il browser non ha concesso l’accesso diretto agli appunti.' })
    }
  }

  const pasteText = (text: string, start = selectedCell) => {
    if (!start || !text) return
    const incoming = text.replace(/\r/g, '').split('\n').filter((row, index, all) => row.length > 0 || index < all.length - 1).map(row => row.split('\t'))
    const neededRows = Math.min(MAX_ROWS, Math.max(normalizedData.length, start.row + incoming.length))
    const neededCols = Math.min(MAX_COLS, Math.max(normalizedData[0]?.length || 0, start.col + Math.max(0, ...incoming.map(row => row.length))))
    const next = normalizeGrid(normalizedData, neededRows, neededCols)
    incoming.forEach((row, rowOffset) => row.forEach((value, colOffset) => {
      if (start.row + rowOffset < MAX_ROWS && start.col + colOffset < MAX_COLS) next[start.row + rowOffset][start.col + colOffset] = value
    }))
    onDataChange(next)
  }

  const pasteSelection = async () => {
    try { pasteText(await navigator.clipboard.readText()) }
    catch { toast({ title: 'Incolla con Ctrl/Cmd+V', description: 'Il browser non ha concesso l’accesso diretto agli appunti.' }) }
  }

  const handleGridCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLInputElement
    if (editingCell && typeof target.selectionStart === 'number' && target.selectionStart !== target.selectionEnd) return
    const text = selectionMatrix().map(row => row.join('\t')).join('\n')
    if (!text) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', text)
  }

  const handleGridPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !selectedCell) return
    event.preventDefault()
    pasteText(event.clipboardData.getData('text/plain'), selectedCell)
  }

  const startResize = (kind: 'column' | 'row', index: number, event: ReactMouseEvent) => {
    if (!onDimensionsChange) return
    event.preventDefault()
    event.stopPropagation()
    const startPosition = kind === 'column' ? event.clientX : event.clientY
    const startSize = kind === 'column' ? columnWidths[index] : rowHeights[index]
    const onMove = (moveEvent: MouseEvent) => {
      const delta = (kind === 'column' ? moveEvent.clientX : moveEvent.clientY) - startPosition
      if (kind === 'column') {
        const next = [...columnWidths]
        next[index] = Math.max(56, Math.min(420, startSize + delta))
        onDimensionsChange({ columnWidths: next, rowHeights })
      } else {
        const next = [...rowHeights]
        next[index] = Math.max(24, Math.min(160, startSize + delta))
        onDimensionsChange({ columnWidths, rowHeights: next })
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const splitSelection = () => {
    if (!normalizedSelection) return
    const next = normalizedData.map(row => [...row])
    for (let row = normalizedSelection.startRow; row <= normalizedSelection.endRow; row += 1) {
      for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
        const raw = next[row]?.[col] || ''
        const delimiter = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : raw.includes(',') ? ',' : ' '
        raw.split(delimiter).map(value => value.trim()).forEach((value, offset) => {
          if (col + offset < MAX_COLS) next[row][col + offset] = value
        })
      }
    }
    onDataChange(normalizeGrid(next, next.length, Math.min(MAX_COLS, Math.max(...next.map(row => row.length)))))
  }

  const applyNumericOperation = () => {
    if (!normalizedSelection) return
    const operand = Number(operationValue.replace(',', '.'))
    if (!Number.isFinite(operand)) {
      toast({ title: 'Inserisci un numero valido', variant: 'destructive' })
      return
    }
    if (operation === '/' && operand === 0) {
      toast({ title: 'Non è possibile dividere per zero', variant: 'destructive' })
      return
    }
    const next = normalizedData.map(row => [...row])
    let changed = 0
    for (let row = normalizedSelection.startRow; row <= normalizedSelection.endRow; row += 1) {
      for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
        const value = toNumber(evaluatedData[row]?.[col] || '')
        if (value === null) continue
        next[row][col] = String(operation === '+' ? value + operand : operation === '-' ? value - operand : operation === '*' ? value * operand : value / operand)
        changed += 1
      }
    }
    if (!changed) {
      toast({ title: 'Nessun numero nella selezione', description: 'Seleziona una o più celle numeriche.', variant: 'destructive' })
      return
    }
    onDataChange(next)
    toast({ title: `${changed} ${changed === 1 ? 'cella aggiornata' : 'celle aggiornate'}` })
  }

  const insertSmartStatistic = (fn: StatFunction) => {
    if (!normalizedSelection || !smartSelection) return
    const { bounds, direction } = smartSelection
    let next = normalizedData.map(row => [...row])
    const targets: CellPos[] = []

    if (direction === 'row') {
      let targetCol = bounds.endCol + 1
      while (targetCol < MAX_COLS) {
        const occupied = Array.from({ length: bounds.endRow - bounds.startRow + 1 }, (_, offset) => next[bounds.startRow + offset]?.[targetCol]).some(Boolean)
        if (!occupied) break
        targetCol += 1
      }
      if (targetCol >= MAX_COLS) {
        toast({ title: 'Nessuno spazio per il risultato', variant: 'destructive' })
        return
      }
      next = normalizeGrid(next, next.length, Math.max(next[0]?.length || 0, targetCol + 1))
      for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
        const numericCols = Array.from({ length: bounds.endCol - bounds.startCol + 1 }, (_, offset) => bounds.startCol + offset)
          .filter(col => toNumber(evaluatedData[row]?.[col] || '') !== null)
        if (!numericCols.length) continue
        const from = Math.min(...numericCols)
        const to = Math.max(...numericCols)
        next[row][targetCol] = `=${fn}(${columnName(from)}${row + 1}:${columnName(to)}${row + 1})`
        targets.push({ row, col: targetCol })
      }
    } else {
      let targetRow = bounds.endRow + 1
      while (targetRow < MAX_ROWS) {
        const occupied = Array.from({ length: bounds.endCol - bounds.startCol + 1 }, (_, offset) => next[targetRow]?.[bounds.startCol + offset]).some(Boolean)
        if (!occupied) break
        targetRow += 1
      }
      if (targetRow >= MAX_ROWS) {
        toast({ title: 'Nessuno spazio per il risultato', variant: 'destructive' })
        return
      }
      next = normalizeGrid(next, Math.max(next.length, targetRow + 1), next[0]?.length || MIN_COLS)
      for (let col = bounds.startCol; col <= bounds.endCol; col += 1) {
        const numericRows = Array.from({ length: bounds.endRow - bounds.startRow + 1 }, (_, offset) => bounds.startRow + offset)
          .filter(row => toNumber(evaluatedData[row]?.[col] || '') !== null)
        if (!numericRows.length) continue
        const from = Math.min(...numericRows)
        const to = Math.max(...numericRows)
        next[targetRow][col] = `=${fn}(${columnName(col)}${from + 1}:${columnName(col)}${to + 1})`
        targets.push({ row: targetRow, col })
      }
    }

    if (!targets.length) return
    onDataChange(next)
    const first = targets[0]
    const last = targets[targets.length - 1]
    setSelectedCell(first)
    setSelectionRange({ startRow: first.row, endRow: last.row, startCol: first.col, endCol: last.col })
    setSelectionMode('cell')
    toast({
      title: 'Formula inserita',
      description: `${fn} · ${direction === 'row' ? 'risultato a destra' : 'risultato sotto'} (${targets.length} ${targets.length === 1 ? 'formula' : 'formule'})`,
    })
  }

  const applyStyle = (patch: SheetCellStyle) => {
    if (!normalizedSelection || !onStylesChange) return
    const next = { ...styles }
    for (let row = normalizedSelection.startRow; row <= normalizedSelection.endRow; row += 1) {
      for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
        const key = `${row}:${col}`
        next[key] = { ...(next[key] || {}), ...patch }
      }
    }
    onStylesChange(next)
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
    <div className="flex h-full min-h-[640px] flex-col gap-3" onCopy={handleGridCopy} onPaste={handleGridPaste}>
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <IconTool label="Importa CSV/XLSX" onClick={() => fileInputRef.current?.click()}><FileUp className="h-4 w-4" /></IconTool>
          <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={async (event) => { const file = event.target.files?.[0]; if (file) await importSheet(file); event.target.value = '' }} />
          <IconTool label="Esporta CSV" onClick={exportCsv}><span className="relative"><Download className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">C</span></span></IconTool>
          <IconTool label="Esporta XLSX" onClick={exportXlsx}><span className="relative"><Download className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">X</span></span></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label={selectionMode === 'row' ? 'Inserisci riga dopo la selezione' : 'Aggiungi riga'} onClick={addRow}><span className="relative"><Plus className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">R</span></span></IconTool>
          <IconTool label={selectionMode === 'column' ? 'Inserisci colonna dopo la selezione' : 'Aggiungi colonna'} onClick={addColumn}><span className="relative"><Plus className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">C</span></span></IconTool>
          <IconTool label="Elimina riga selezionata" onClick={removeSelectedRow} disabled={!selectedCell}><span className="relative"><Trash2 className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">R</span></span></IconTool>
          <IconTool label="Elimina colonna selezionata" onClick={removeSelectedColumn} disabled={!selectedCell}><span className="relative"><Trash2 className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">C</span></span></IconTool>
          <IconTool label="Pulisci tutta la tabella" onClick={clearSheet}><Eraser className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label="Copia selezione" onClick={() => void copySelection()} disabled={!normalizedSelection}><Copy className="h-4 w-4" /></IconTool>
          <IconTool label="Incolla" onClick={() => void pasteSelection()} disabled={!selectedCell}><ClipboardPaste className="h-4 w-4" /></IconTool>
          <IconTool label="Separa testo in colonne" onClick={splitSelection} disabled={!normalizedSelection}><Scissors className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label="Crea grafico dalla selezione" onClick={() => openChartFromSelection(false)} active={activeContextMenu === 'chart'}><BarChart3 className="h-4 w-4" /></IconTool>
          <IconTool label="Regressione lineare" onClick={() => openChartFromSelection(true)} active={activeContextMenu === 'chart' && chartConfig.type === 'scatter'}><TrendingUp className="h-4 w-4" /></IconTool>
          <IconTool label="Riempimento guidato o AI" onClick={() => setActiveContextMenu(activeContextMenu === 'fill' ? 'none' : 'fill')} active={activeContextMenu === 'fill'}><Wand2 className="h-4 w-4" /></IconTool>
          <span className="ml-auto rounded-md bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700">
            {selectionMode === 'column' && normalizedSelection
              ? `Colonna ${columnName(normalizedSelection.startCol)}`
              : selectionMode === 'row' && normalizedSelection
                ? `Riga ${normalizedSelection.startRow + 1}`
                : selectionMode === 'all' ? 'Tutta la tabella' : selectedRangeLabel}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="flex h-8 min-w-14 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-bold text-slate-600">{selectedCell ? `${columnName(selectedCell.col)}${selectedCell.row + 1}` : '-'}</span>
          <span className="text-xs font-black text-slate-400">fx</span>
          <div className="relative min-w-56 flex-1">
            <Input
              value={selectedRawValue}
              onChange={(event) => { if (selectedCell) setCellValue(selectedCell.row, selectedCell.col, event.target.value) }}
              onKeyDown={(event) => {
                if ((event.key === 'Tab' || event.key === 'Enter') && formulaCompletions.length > 0) {
                  event.preventDefault()
                  completeFormula(formulaCompletions[0].name)
                }
              }}
              placeholder="Valore oppure =FUNZIONE(A1:B5)"
              aria-label="Barra della formula"
              className="h-8 w-full font-mono text-sm"
            />
            {formulaCompletions.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                {formulaCompletions.map(item => (
                  <button
                    key={item.name}
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => completeFormula(item.name)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-violet-50"
                  >
                    <span className="font-mono text-xs font-bold text-violet-700">={item.name}(...)</span>
                    <span className="text-[11px] text-slate-500">{item.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select className="h-8 max-w-32 rounded-md border border-slate-200 bg-white px-2 text-xs" onChange={event => applyStyle({ fontFamily: event.target.value })} defaultValue="Arial"><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Times New Roman</option><option>Verdana</option><option>monospace</option></select>
          <select className="h-8 w-16 rounded-md border border-slate-200 bg-white px-1 text-xs" onChange={event => applyStyle({ fontSize: Number(event.target.value) })} defaultValue="14">{[10, 12, 14, 16, 18, 20, 24].map(size => <option key={size} value={size}>{size}</option>)}</select>
          <IconTool label="Grassetto" active={selectedStyle.fontWeight === 'bold'} onClick={() => applyStyle({ fontWeight: selectedStyle.fontWeight === 'bold' ? 'normal' : 'bold' })}><Bold className="h-4 w-4" /></IconTool>
          <IconTool label="Corsivo" active={selectedStyle.fontStyle === 'italic'} onClick={() => applyStyle({ fontStyle: selectedStyle.fontStyle === 'italic' ? 'normal' : 'italic' })}><Italic className="h-4 w-4" /></IconTool>
          <IconTool label="Allinea a sinistra" active={selectedStyle.textAlign === 'left'} onClick={() => applyStyle({ textAlign: 'left' })}><AlignLeft className="h-4 w-4" /></IconTool>
          <IconTool label="Centra" active={selectedStyle.textAlign === 'center'} onClick={() => applyStyle({ textAlign: 'center' })}><AlignCenter className="h-4 w-4" /></IconTool>
          <IconTool label="Allinea a destra" active={selectedStyle.textAlign === 'right'} onClick={() => applyStyle({ textAlign: 'right' })}><AlignRight className="h-4 w-4" /></IconTool>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-semibold text-slate-500">Calcola sulle celle</span>
          <select value={operation} onChange={event => setOperation(event.target.value as typeof operation)} className="h-8 w-12 rounded-md border border-slate-200 bg-white px-2 text-xs"><option>+</option><option>-</option><option>*</option><option>/</option></select>
          <Input value={operationValue} onChange={event => setOperationValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applyNumericOperation() }} className="h-8 w-20 text-xs" inputMode="decimal" />
          <IconTool label="Applica operazione ai valori selezionati" onClick={applyNumericOperation}><Check className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <span className="text-[11px] font-semibold text-slate-500">Formula rapida</span>
          <select value={statFunction} onChange={event => setStatFunction(event.target.value as typeof statFunction)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option>SUM</option><option>AVERAGE</option><option>MIN</option><option>MAX</option><option>COUNT</option><option>MEDIAN</option><option>STDEV.S</option></select>
          <IconTool label="Inserisci la formula nella posizione suggerita" onClick={() => insertSmartStatistic(statFunction)} disabled={!smartSelection}><Sigma className="h-4 w-4" /></IconTool>
          {smartSelection && <span className="ml-auto rounded-md bg-cyan-50 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-800">{smartSelection.count} valori · Somma {smartSelection.sum.toLocaleString('it-IT', { maximumFractionDigits: 4 })} · Media {smartSelection.average.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</span>}
        </div>

        {isMultipleSelection && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 p-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-violet-800"><Sigma className="h-3.5 w-3.5" /> Operazioni suggerite</span>
            {smartSelection ? (
              <>
                {FORMULA_FUNCTIONS.filter(item => ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(item.name)).map(item => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => insertSmartStatistic(item.name as StatFunction)}
                    className="rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-100"
                    title={`${item.hint}; inserisce il risultato ${smartSelection.direction === 'row' ? 'a destra' : 'sotto'} senza includere celle vuote esterne ai dati`}
                  >
                    {item.label}
                  </button>
                ))}
                <span className="ml-auto text-[11px] text-violet-700">
                  Dati rilevati in {rangeToA1(smartSelection.bounds)} · risultato {smartSelection.direction === 'row' ? 'a destra per ogni riga' : 'sotto per ogni colonna'}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-slate-600">La selezione non contiene valori numerici. Puoi comunque scrivere una formula nella barra fx.</span>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[68vh] overflow-auto select-none">
          <table className="min-w-full table-fixed border-collapse text-sm" style={{ width: 48 + columnWidths.reduce((total, width) => total + width, 0) }}>
            <colgroup>
              <col style={{ width: 48 }} />
              {columnWidths.map((width, index) => <col key={index} style={{ width }} />)}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <th className={`w-12 border border-slate-200 p-0 text-xs ${selectionMode === 'all' ? 'bg-violet-200 text-violet-800' : 'text-slate-500'}`}>
                  <button type="button" onClick={selectAll} className="h-full min-h-8 w-full px-2 py-1.5" aria-label="Seleziona tutta la tabella" title="Seleziona tutta la tabella">#</button>
                </th>
                {normalizedData[0]?.map((_, colIdx) => (
                  <th key={colIdx} className={`relative border border-slate-200 p-0 text-xs font-semibold ${selectionMode === 'column' && normalizedSelection?.startCol === colIdx ? 'bg-violet-200 text-violet-900' : 'text-slate-700'}`} style={{ width: columnWidths[colIdx] }}>
                    <button
                      type="button"
                      onClick={() => selectColumn(colIdx)}
                      className="h-full min-h-8 w-full px-2 py-1.5"
                      aria-label={`Seleziona tutta la colonna ${columnName(colIdx)}`}
                      title={`Seleziona tutta la colonna ${columnName(colIdx)}`}
                    >
                      {columnName(colIdx)}
                    </button>
                    {onDimensionsChange && <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Trascina per ridimensionare la colonna"
                      onMouseDown={(event) => startResize('column', colIdx, event)}
                      onDoubleClick={() => onDimensionsChange?.({ columnWidths: columnWidths.map((width, index) => index === colIdx ? 120 : width), rowHeights })}
                      className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-indigo-400/50"
                    />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedData.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ height: rowHeights[rowIdx] }}>
                  <td className={`relative border border-slate-200 p-0 text-xs ${selectionMode === 'row' && normalizedSelection?.startRow === rowIdx ? 'bg-violet-200 text-violet-900' : 'bg-slate-50 text-slate-500'}`}>
                    <button
                      type="button"
                      onClick={() => selectRow(rowIdx)}
                      className="h-full min-h-6 w-full px-2"
                      aria-label={`Seleziona tutta la riga ${rowIdx + 1}`}
                      title={`Seleziona tutta la riga ${rowIdx + 1}`}
                    >
                      {rowIdx + 1}
                    </button>
                    {onDimensionsChange && <span
                      role="separator"
                      aria-orientation="horizontal"
                      title="Trascina per ridimensionare la riga"
                      onMouseDown={(event) => startResize('row', rowIdx, event)}
                      onDoubleClick={() => onDimensionsChange?.({ columnWidths, rowHeights: rowHeights.map((height, index) => index === rowIdx ? 36 : height) })}
                      className="absolute -bottom-1 left-0 z-10 h-2 w-full cursor-row-resize hover:bg-indigo-400/50"
                    />}
                  </td>
                  {row.map((_cell, colIdx) => {
                    const selected = isCellInSelection(rowIdx, colIdx)
                    const display = evaluatedData[rowIdx]?.[colIdx] ?? ''
                    const cellKey = `${rowIdx}:${colIdx}`
                    const rawValue = normalizedData[rowIdx][colIdx]
                    const isEditing = editingCell === cellKey
                    return (
                      <td
                        key={colIdx}
                        className={`border border-slate-200 p-0 ${selected ? 'bg-violet-50 ring-1 ring-inset ring-violet-500' : ''}`}
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
                          value={!isEditing && rawValue.startsWith('=') ? display : rawValue}
                          onFocus={() => {
                            setEditingCell(cellKey)
                            setSelectedCell({ row: rowIdx, col: colIdx })
                            setSelectionRange({ startRow: rowIdx, endRow: rowIdx, startCol: colIdx, endCol: colIdx })
                            setSelectionMode('cell')
                          }}
                          onBlur={() => setEditingCell(current => current === cellKey ? null : current)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              moveToCell(rowIdx + 1, colIdx)
                            }
                          }}
                          onPaste={(event) => {
                            event.preventDefault()
                            pasteText(event.clipboardData.getData('text/plain'), { row: rowIdx, col: colIdx })
                          }}
                          onChange={(e) => setCellValue(rowIdx, colIdx, e.target.value)}
                          className="h-full min-h-6 w-full border-0 bg-transparent px-2 text-sm text-slate-800 focus:outline-none"
                          style={styles[cellKey]}
                          title={rawValue.startsWith('=') ? `${rawValue} → ${display}` : ''}
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

      {normalizedSelection && activeContextMenu !== 'none' && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">{activeContextMenu === 'chart' ? 'Grafico' : 'Riempimento'} · {selectedRangeLabel}</p>
            <button onClick={() => setActiveContextMenu('none')} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">Chiudi</button>
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
