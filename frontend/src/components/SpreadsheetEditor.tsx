import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, BarChart3, Bold, Check, ChevronDown, ClipboardPaste, Copy, Download, Eraser, FileUp, Filter, Italic, Loader2, Plus, Redo2, Scissors, Sigma, Trash2, TrendingUp, Underline, Undo2, Wand2 } from '@/components/icons'
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
import { tl } from '@/i18n/tl'
import {
  CURRENCY_FORMAT, DEFAULT_DATE_FORMAT, GENERAL_FORMAT, PERCENT_FORMAT, TEXT_FORMAT, columnName, compareCells, dateToSerial, deleteColumns, deleteRows,
  formatCellValue, hiddenRowSet, insertColumns, insertRows, isNumericText, lastDataRow, moveCellBlock, moveColumns, moveItems, moveRows, parseCellInput,
  parseLocaleNumber, positionAfterMove, rangeSize, rebaseRowFormula, remapStyles, seriesValue, shiftFormula, stepDecimals, type CellPos, type SelectionRange,
} from '@/lib/spreadsheetLogic'

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
  textDecoration?: 'none' | 'underline'
  color?: string
  backgroundColor?: string
  whiteSpace?: 'nowrap' | 'normal'
  /** Excel number format code; the cell itself always stores the machine value. */
  numberFormat?: string
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

type SelectionMode = 'cell' | 'row' | 'column' | 'all'
type StatFunction = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'MEDIAN' | 'STDEV.S'
type SmartDirection = 'row' | 'column'
type SheetSnapshot = { data: string[][]; styles: SheetCellStyles; dimensions: SheetDimensions }
/** Internal copy of the last copied cells: pasting them keeps formulas and formats, not just text. */
type SheetClipboard = { text: string; range: SelectionRange; rows: string[][]; styles: Array<Array<SheetCellStyle | undefined>>; cut: boolean }
type GridDrag =
  | { kind: 'select'; anchor: CellPos }
  | { kind: 'fill'; preview: SelectionRange | null }
  | { kind: 'move'; grab: CellPos; offset: CellPos }
  | { kind: 'select-columns'; anchor: number }
  | { kind: 'select-rows'; anchor: number }
  | { kind: 'reorder-column'; start: number; count: number; target: number | null }
  | { kind: 'reorder-row'; start: number; count: number; target: number | null }

const FORMULA_FUNCTIONS: Array<{ name: StatFunction | 'IF' | 'ROUND' | 'COUNTA'; label: string; hint: string }> = [
  { name: 'SUM', label: tl("Somma"), hint: tl("Somma i valori") },
  { name: 'AVERAGE', label: tl("Media"), hint: tl("Calcola la media") },
  { name: 'MIN', label: tl("Minimo"), hint: tl("Trova il valore minimo") },
  { name: 'MAX', label: tl("Massimo"), hint: tl("Trova il valore massimo") },
  { name: 'COUNT', label: tl("Conta numeri"), hint: tl("Conta le celle numeriche") },
  { name: 'MEDIAN', label: tl("Mediana"), hint: tl("Calcola la mediana") },
  { name: 'STDEV.S', label: tl("Deviazione std."), hint: tl("Deviazione standard campionaria") },
  { name: 'IF', label: 'Se', hint: tl("Applica una condizione") },
  { name: 'ROUND', label: tl("Arrotonda"), hint: tl("Arrotonda un valore") },
  { name: 'COUNTA', label: tl("Conta valori"), hint: tl("Conta le celle non vuote") },
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
const MAX_ROWS = 2000
const MAX_COLS = 200
const ROW_HEADER_WIDTH = 48
const OVERSCAN_ROWS = 12
const HISTORY_LIMIT = 100

const NUMBER_FORMATS: Array<{ label: string; code: string }> = [
  { label: tl("Generale"), code: GENERAL_FORMAT },
  { label: tl("Numero"), code: '#,##0.00' },
  { label: tl("Intero"), code: '#,##0' },
  { label: tl("Valuta €"), code: CURRENCY_FORMAT },
  { label: tl("Percentuale"), code: PERCENT_FORMAT },
  { label: tl("Data"), code: DEFAULT_DATE_FORMAT },
  { label: tl("Data e ora"), code: 'dd/mm/yyyy hh:mm' },
  { label: tl("Testo"), code: TEXT_FORMAT },
]

function normalizeGrid(input: string[][], minRows = MIN_ROWS, minCols = MIN_COLS): string[][] {
  const rows = Math.max(minRows, input.length)
  const cols = Math.max(minCols, input.reduce((acc, row) => Math.max(acc, row.length), 0))
  return Array.from({ length: rows }, (_, rIdx) =>
    Array.from({ length: cols }, (_, cIdx) => input[rIdx]?.[cIdx] ?? '')
  )
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
  return parseLocaleNumber(String(value))
}

/** What the formula engine sees. Stored text may be Italian ("12,5") or look like a date to HyperFormula,
 * which would turn it into a serial number: the leading apostrophe marks it as literal text. */
function engineValue(cell: string, numberFormat?: string): string | number | boolean | null {
  if (cell === '') return null
  if (cell.startsWith('=')) return cell
  if (numberFormat === TEXT_FORMAT) return `'${cell}`
  if (/^(TRUE|FALSE)$/i.test(cell.trim())) return cell.trim().toUpperCase() === 'TRUE'
  if (/^[-+]?0\d/.test(cell.trim())) return `'${cell}`
  return parseLocaleNumber(cell) ?? `'${cell}`
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

function gridToWorksheet(data: string[][], dimensions?: Partial<SheetDimensions>, styles: SheetCellStyles = {}): XLSX.WorkSheet {
  const typed = data.map(row => row.map(xlsxCellValue))
  const sheet = XLSX.utils.aoa_to_sheet(typed)
  Object.entries(styles).forEach(([key, style]) => {
    const [row, col] = key.split(':').map(Number)
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]
    if (cell && style.numberFormat) cell.z = style.numberFormat
  })
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
  onDataChange: emitData,
  chartConfig,
  onChartConfigChange,
  styles = {},
  onStylesChange: emitStyles,
  dimensions = {},
  onDimensionsChange,
}: SpreadsheetEditorProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const headRef = useRef<HTMLTableSectionElement | null>(null)
  const cellEditorRef = useRef<HTMLInputElement | null>(null)
  const formulaBarRef = useRef<HTMLInputElement | null>(null)
  const normalizedData = useMemo(() => normalizeGrid(data), [data])
  const columnWidths = useMemo(() => normalizedData[0].map((_, index) => dimensions.columnWidths?.[index] || 120), [dimensions.columnWidths, normalizedData])
  const rowHeights = useMemo(() => normalizedData.map((_, index) => dimensions.rowHeights?.[index] || 36), [dimensions.rowHeights, normalizedData])

  const [selectedCell, setSelectedCell] = useState<CellPos | null>({ row: 0, col: 0 })
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('cell')
  const [activeContextMenu, setActiveContextMenu] = useState<'none' | 'chart' | 'fill'>('none')
  const [fillInstruction, setFillInstruction] = useState('')
  const [useFirstRowAsHeader, setUseFirstRowAsHeader] = useState(true)
  const [aiFillLoading, setAiFillLoading] = useState(false)
  const [operation, setOperation] = useState<'+' | '-' | '*' | '/'>('+')
  const [operationValue, setOperationValue] = useState('1')
  const [statFunction, setStatFunction] = useState<StatFunction>('SUM')
  // Excel model: a cell is only an <input> while edited, everything else goes through the grid's keyboard.
  const [editing, setEditing] = useState<{ row: number; col: number; draft: string; typed?: boolean } | null>(null)
  const [drag, setDrag] = useState<GridDrag | null>(null)
  const [filtersOn, setFiltersOn] = useState(false)
  const [columnFilters, setColumnFilters] = useState<Record<number, Set<string>>>({})
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(640)
  const [headerHeight, setHeaderHeight] = useState(33)
  const clipboardRef = useRef<SheetClipboard | null>(null)
  const historyRef = useRef<{ past: SheetSnapshot[]; future: SheetSnapshot[]; lastPush: number }>({ past: [], future: [], lastPush: 0 })

  // One gesture may change data, styles and sizes in the same tick: that is a single undo step.
  const pushHistory = () => {
    const history = historyRef.current
    const now = Date.now()
    if (now - history.lastPush > 60) {
      history.past.push({ data: normalizedData, styles, dimensions: { columnWidths, rowHeights } })
      if (history.past.length > HISTORY_LIMIT) history.past.shift()
    }
    history.lastPush = now
    history.future = []
  }
  const onDataChange = (next: string[][]) => { pushHistory(); emitData(next) }
  const onStylesChange = emitStyles && ((next: SheetCellStyles) => { pushHistory(); emitStyles(next) })
  const restoreSnapshot = (from: SheetSnapshot[], to: SheetSnapshot[]) => {
    const snapshot = from.pop()
    if (!snapshot) return
    to.push({ data: normalizedData, styles, dimensions: { columnWidths, rowHeights } })
    emitData(snapshot.data)
    emitStyles?.(snapshot.styles)
    onDimensionsChange?.(snapshot.dimensions)
    setColumnFilters({})
  }
  const undo = () => restoreSnapshot(historyRef.current.past, historyRef.current.future)
  const redo = () => restoreSnapshot(historyRef.current.future, historyRef.current.past)

  const evaluatedData = useMemo(() => {
    try {
      const engine = HyperFormula.buildFromArray(
        normalizedData.map((row, rowIndex) => row.map((cell, colIndex) => engineValue(cell, styles[`${rowIndex}:${colIndex}`]?.numberFormat))),
        { licenseKey: 'gpl-v3' },
      )
      const values = engine.getSheetValues(0)
      return values.map(row => row.map(toDisplayValue))
    } catch (error) {
      console.error('Formula evaluation error', error)
      return normalizedData
    }
  }, [normalizedData, styles])

  const displayData = useMemo(
    () => evaluatedData.map((row, rowIndex) => row.map((value, colIndex) => formatCellValue(value, styles[`${rowIndex}:${colIndex}`]?.numberFormat))),
    [evaluatedData, styles],
  )

  const filterHeaderRow = useMemo(() => Math.max(0, normalizedData.findIndex(row => row.some(cell => cell !== ''))), [normalizedData])
  const hiddenRows = useMemo(() => filtersOn ? hiddenRowSet(displayData, filterHeaderRow, columnFilters) : new Set<number>(), [columnFilters, displayData, filterHeaderRow, filtersOn])
  const visibleRows = useMemo(() => normalizedData.map((_, index) => index).filter(index => !hiddenRows.has(index)), [hiddenRows, normalizedData])
  const rowOffsets = useMemo(() => {
    const offsets = [0]
    visibleRows.forEach(row => offsets.push(offsets[offsets.length - 1] + rowHeights[row]))
    return offsets
  }, [rowHeights, visibleRows])
  const columnOffsets = useMemo(() => {
    const offsets = [ROW_HEADER_WIDTH]
    columnWidths.forEach(width => offsets.push(offsets[offsets.length - 1] + width))
    return offsets
  }, [columnWidths])
  const visibleIndex = useMemo(() => new Map(visibleRows.map((row, index) => [row, index])), [visibleRows])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const measure = () => {
      setViewportHeight(scroller.clientHeight)
      setHeaderHeight(headRef.current?.offsetHeight ?? 33)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const renderWindow = useMemo(() => {
    const bottom = scrollTop + viewportHeight
    let first = 0
    while (first < visibleRows.length - 1 && rowOffsets[first + 1] <= scrollTop) first += 1
    let last = first
    while (last < visibleRows.length - 1 && rowOffsets[last + 1] < bottom) last += 1
    return { first: Math.max(0, first - OVERSCAN_ROWS), last: Math.min(visibleRows.length - 1, last + OVERSCAN_ROWS) }
  }, [rowOffsets, scrollTop, viewportHeight, visibleRows.length])

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

  const setCellValue = (row: number, col: number, input: string) => {
    const parsed = parseCellInput(input, styles[`${row}:${col}`]?.numberFormat)
    const next = normalizedData.map(r => [...r])
    next[row][col] = parsed.value
    onDataChange(next)
    if (parsed.numberFormat && onStylesChange) {
      const key = `${row}:${col}`
      if (styles[key]?.numberFormat !== parsed.numberFormat) onStylesChange({ ...styles, [key]: { ...(styles[key] || {}), numberFormat: parsed.numberFormat } })
    }
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

  const scrollCellIntoView = (row: number, col: number) => {
    const scroller = scrollRef.current
    const index = visibleIndex.get(row)
    if (!scroller || index === undefined) return
    const top = rowOffsets[index]
    const bottom = rowOffsets[index + 1]
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight - headerHeight) scroller.scrollTop = bottom - scroller.clientHeight + headerHeight
    const left = columnOffsets[col]
    const right = columnOffsets[col + 1]
    if (left - ROW_HEADER_WIDTH < scroller.scrollLeft) scroller.scrollLeft = left - ROW_HEADER_WIDTH
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
  }

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true })

  const moveToCell = (row: number, col: number) => {
    const maxRow = normalizedData.length - 1
    const maxCol = (normalizedData[0]?.length || 1) - 1
    const nextRow = Math.max(0, Math.min(maxRow, row))
    const nextCol = Math.max(0, Math.min(maxCol, col))
    setSelectedCell({ row: nextRow, col: nextCol })
    setSelectionRange({ startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol })
    setSelectionMode('cell')
    scrollCellIntoView(nextRow, nextCol)
  }

  /** Cell `steps` visible rows and `cols` columns away; hidden rows are skipped. */
  const offsetCell = (from: CellPos, steps: number, cols: number): CellPos => {
    const index = visibleIndex.get(from.row) ?? 0
    const nextIndex = Math.max(0, Math.min(visibleRows.length - 1, index + steps))
    return { row: visibleRows[nextIndex], col: Math.max(0, Math.min((normalizedData[0]?.length || 1) - 1, from.col + cols)) }
  }

  /** Ctrl+arrow target: the edge of the block of filled cells, as in Excel. */
  const jumpCell = (from: CellPos, rowStep: number, colStep: number): CellPos => {
    const filled = (pos: CellPos) => normalizedData[pos.row]?.[pos.col] !== ''
    let current = from
    let next = offsetCell(current, rowStep, colStep)
    const stuck = (a: CellPos, b: CellPos) => a.row === b.row && a.col === b.col
    if (stuck(current, next)) return current
    const startFilled = filled(current) && filled(next)
    while (!stuck(current, next) && filled(next) === startFilled) {
      current = next
      next = offsetCell(current, rowStep, colStep)
    }
    return startFilled || stuck(current, next) ? current : next
  }

  const startEditing = (initial?: string) => {
    if (!selectedCell) return
    setContextMenu(null)
    setEditing({ row: selectedCell.row, col: selectedCell.col, draft: initial ?? normalizedData[selectedCell.row]?.[selectedCell.col] ?? '', typed: initial !== undefined })
    setSelectionRange({ startRow: selectedCell.row, endRow: selectedCell.row, startCol: selectedCell.col, endCol: selectedCell.col })
    setSelectionMode('cell')
    setTimeout(() => cellEditorRef.current?.focus(), 0)
  }

  const commitEditing = (advance?: { rows: number; cols: number }) => {
    if (!editing) return
    const { row, col, draft } = editing
    setEditing(null)
    if (draft !== (normalizedData[row]?.[col] ?? '')) setCellValue(row, col, draft)
    if (advance) {
      const target = offsetCell({ row, col }, advance.rows, advance.cols)
      moveToCell(target.row, target.col)
    }
    focusGrid()
  }

  const cancelEditing = () => {
    setEditing(null)
    focusGrid()
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
      if (!Array.isArray(values) || values.length !== matrix.length) throw new Error(tl("Dimensioni risposta non valide"))
      for (let i = 0; i < values.length; i += 1) {
        if (!Array.isArray(values[i]) || values[i].length !== matrix[i].length) {
          throw new Error(tl("Dimensioni risposta non valide"))
        }
      }

      const next = normalizedData.map(r => [...r])
      for (let r = normalizedSelection.startRow; r <= normalizedSelection.endRow; r += 1) {
        for (let c = normalizedSelection.startCol; c <= normalizedSelection.endCol; c += 1) {
          next[r][c] = String(values[r - normalizedSelection.startRow][c - normalizedSelection.startCol] ?? '')
        }
      }
      onDataChange(next)
      toast({ title: tl("Riempimento AI completato") })
    } catch (error) {
      console.error('AI fill failed', error)
      applyNaturalFill()
      toast({ title: tl("Fallback locale applicato"), description: tl("Risposta AI non disponibile, ho usato il riempimento guidato.") })
    } finally {
      setAiFillLoading(false)
    }
  }

  const applyStructure = (
    next: string[][],
    mapRow: (row: number) => number | null,
    mapCol: (col: number) => number | null,
    sizes: Partial<SheetDimensions>,
  ) => {
    setEditing(null)
    setColumnFilters({})
    onDataChange(next)
    onDimensionsChange?.({ columnWidths: sizes.columnWidths ?? columnWidths, rowHeights: sizes.rowHeights ?? rowHeights })
    onStylesChange?.(remapStyles(styles, mapRow, mapCol))
  }

  const insertRowsAt = (at: number, count = 1) => {
    if (normalizedData.length + count > MAX_ROWS) return
    applyStructure(insertRows(normalizedData, at, count), row => row >= at ? row + count : row, col => col, { rowHeights: [...rowHeights.slice(0, at), ...Array<number>(count).fill(36), ...rowHeights.slice(at)] })
    const lastCol = (normalizedData[0]?.length || 1) - 1
    setSelectedCell({ row: at, col: selectedCell?.col ?? 0 })
    setSelectionRange({ startRow: at, endRow: at + count - 1, startCol: 0, endCol: lastCol })
    setSelectionMode('row')
  }

  const insertColumnsAt = (at: number, count = 1) => {
    if ((normalizedData[0]?.length || 0) + count > MAX_COLS) return
    applyStructure(insertColumns(normalizedData, at, count), row => row, col => col >= at ? col + count : col, { columnWidths: [...columnWidths.slice(0, at), ...Array<number>(count).fill(120), ...columnWidths.slice(at)] })
    setSelectedCell({ row: selectedCell?.row ?? 0, col: at })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: at, endCol: at + count - 1 })
    setSelectionMode('column')
  }

  const addRow = () => insertRowsAt(selectionMode === 'row' && normalizedSelection ? normalizedSelection.endRow + 1 : normalizedData.length)
  const addColumn = () => insertColumnsAt(selectionMode === 'column' && normalizedSelection ? normalizedSelection.endCol + 1 : normalizedData[0]?.length || MIN_COLS)

  const removeRows = (start: number, count: number) => {
    const safeCount = Math.min(count, normalizedData.length - 1)
    if (safeCount <= 0) return
    applyStructure(deleteRows(normalizedData, start, safeCount), row => row < start ? row : row < start + safeCount ? null : row - safeCount, col => col, { rowHeights: rowHeights.filter((_, index) => index < start || index >= start + safeCount) })
    const nextRow = Math.min(start, normalizedData.length - safeCount - 1)
    setSelectedCell({ row: nextRow, col: selectedCell?.col ?? 0 })
    setSelectionRange({ startRow: nextRow, endRow: nextRow, startCol: 0, endCol: (normalizedData[0]?.length || 1) - 1 })
    setSelectionMode('row')
  }

  const removeColumns = (start: number, count: number) => {
    const safeCount = Math.min(count, (normalizedData[0]?.length || 0) - 1)
    if (safeCount <= 0) return
    applyStructure(deleteColumns(normalizedData, start, safeCount), row => row, col => col < start ? col : col < start + safeCount ? null : col - safeCount, { columnWidths: columnWidths.filter((_, index) => index < start || index >= start + safeCount) })
    const nextCol = Math.min(start, (normalizedData[0]?.length || 1) - safeCount - 1)
    setSelectedCell({ row: selectedCell?.row ?? 0, col: nextCol })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: nextCol, endCol: nextCol })
    setSelectionMode('column')
  }

  const removeSelectedRow = () => {
    if (!normalizedSelection) return
    removeRows(normalizedSelection.startRow, rangeSize(normalizedSelection).rows)
  }

  const removeSelectedColumn = () => {
    if (!normalizedSelection) return
    removeColumns(normalizedSelection.startCol, rangeSize(normalizedSelection).cols)
  }

  /** Reorder columns: `target` is the index of the column they land before. */
  const reorderColumns = (start: number, count: number, target: number) => {
    if (target >= start && target <= start + count) return
    const mapCol = (col: number) => positionAfterMove(col, start, count, target)
    applyStructure(moveColumns(normalizedData, start, count, target), row => row, mapCol, { columnWidths: moveItems(columnWidths, start, count, target) })
    const nextStart = mapCol(start)
    setSelectedCell({ row: selectedCell?.row ?? 0, col: nextStart })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: nextStart, endCol: nextStart + count - 1 })
    setSelectionMode('column')
  }

  const reorderRows = (start: number, count: number, target: number) => {
    if (target >= start && target <= start + count) return
    const mapRow = (row: number) => positionAfterMove(row, start, count, target)
    applyStructure(moveRows(normalizedData, start, count, target), mapRow, col => col, { rowHeights: moveItems(rowHeights, start, count, target) })
    const nextStart = mapRow(start)
    setSelectedCell({ row: nextStart, col: selectedCell?.col ?? 0 })
    setSelectionRange({ startRow: nextStart, endRow: nextStart + count - 1, startCol: 0, endCol: (normalizedData[0]?.length || 1) - 1 })
    setSelectionMode('row')
  }

  /** Sort the table under the header row by one column; each row keeps its cells, formats and height. */
  const sortByColumn = (col: number, direction: 1 | -1) => {
    const first = filterHeaderRow + 1
    const last = lastDataRow(normalizedData)
    if (last <= first) return
    const order = Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
      .sort((a, b) => {
        const left = evaluatedData[a]?.[col] ?? ''
        const right = evaluatedData[b]?.[col] ?? ''
        if (left === '' || right === '') return compareCells(left, right)
        return compareCells(left, right) * direction || a - b
      })
    const destination = new Map(order.map((source, index) => [source, first + index]))
    const next = normalizedData.map(row => [...row])
    const nextHeights = [...rowHeights]
    order.forEach((source, index) => {
      const target = first + index
      next[target] = normalizedData[source].map(cell => rebaseRowFormula(cell, source, target))
      nextHeights[target] = rowHeights[source]
    })
    onDataChange(next)
    onDimensionsChange?.({ columnWidths, rowHeights: nextHeights })
    onStylesChange?.(remapStyles(styles, row => destination.get(row) ?? row, column => column))
    setFilterMenu(null)
  }

  const clearSheet = () => {
    onDataChange(normalizeGrid([]))
    onDimensionsChange?.({ columnWidths: [], rowHeights: [] })
    onStylesChange?.({})
    setColumnFilters({})
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    setSelectionMode('cell')
  }

  const importSheet = async (file: File) => {
    const buffer = await file.arrayBuffer()
    // cellDates off: dates stay Excel serials, shown through their own number format.
    const workbook = XLSX.read(buffer, { type: 'array', cellFormula: true, cellNF: true })
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    onDataChange(normalizeGrid(worksheetToGrid(firstSheet)))
    const importedStyles: SheetCellStyles = {}
    Object.entries(firstSheet).forEach(([address, cell]) => {
      if (address.startsWith('!')) return
      const code = (cell as XLSX.CellObject).z
      if (typeof code === 'string' && code !== GENERAL_FORMAT) {
        const { r, c } = XLSX.utils.decode_cell(address)
        importedStyles[`${r}:${c}`] = { numberFormat: code }
      }
    })
    onStylesChange?.(importedStyles)
    setColumnFilters({})
    onDimensionsChange?.({
      columnWidths: (firstSheet['!cols'] || []).map(column => column.wpx || (column.wch ? Math.round(column.wch * 7) : 120)),
      rowHeights: (firstSheet['!rows'] || []).map(row => row.hpx || (row.hpt ? Math.round(row.hpt * 4 / 3) : 36)),
    })
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    setSelectionMode('cell')
  }

  const exportCsv = () => {
    const sheet = XLSX.utils.aoa_to_sheet(displayData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, tl("Tabelle"))
    XLSX.writeFile(wb, 'tabelle.csv', { bookType: 'csv' })
  }

  const exportXlsx = () => {
    const sheet = gridToWorksheet(normalizedData, { columnWidths, rowHeights }, styles)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, tl("Tabelle"))
    XLSX.writeFile(wb, 'tabelle.xlsx')
  }

  const extendSelectionTo = (row: number, col: number) => {
    const anchor = selectedCell ?? { row, col }
    setSelectionRange({ startRow: anchor.row, startCol: anchor.col, endRow: row, endCol: col })
    setSelectionMode('cell')
  }

  const handleCellMouseDown = (row: number, col: number, event: ReactMouseEvent) => {
    setContextMenu(null)
    setFilterMenu(null)
    if (event.button !== 0) return
    if (editing) {
      // Clicking a cell while typing a formula inserts its reference, as in Excel.
      if (editing.draft.startsWith('=') && !(editing.row === row && editing.col === col)) {
        event.preventDefault()
        const reference = `${columnName(col)}${row + 1}`
        setEditing({ ...editing, draft: /[=(,;+\-*/^&<>]$/.test(editing.draft) ? editing.draft + reference : `${editing.draft}+${reference}` })
        cellEditorRef.current?.focus()
        return
      }
      commitEditing()
    }
    event.preventDefault()
    focusGrid()
    if (event.shiftKey) {
      extendSelectionTo(row, col)
      setDrag({ kind: 'select', anchor: selectedCell ?? { row, col } })
      return
    }
    setDrag({ kind: 'select', anchor: { row, col } })
    setSelectedCell({ row, col })
    setSelectionRange({ startRow: row, endRow: row, startCol: col, endCol: col })
    setSelectionMode('cell')
  }

  const selectColumns = (from: number, to: number) => {
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: Math.min(from, to), endCol: Math.max(from, to) })
    setSelectionMode('column')
  }

  const selectRows = (from: number, to: number) => {
    setSelectionRange({ startRow: Math.min(from, to), endRow: Math.max(from, to), startCol: 0, endCol: (normalizedData[0]?.length || 1) - 1 })
    setSelectionMode('row')
  }

  const handleColumnHeaderDown = (col: number, event: ReactMouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (editing) commitEditing()
    focusGrid()
    const inSelection = selectionMode === 'column' && normalizedSelection && col >= normalizedSelection.startCol && col <= normalizedSelection.endCol
    if (event.shiftKey && selectedCell) {
      selectColumns(selectedCell.col, col)
    } else if (inSelection) {
      setDrag({ kind: 'reorder-column', start: normalizedSelection.startCol, count: rangeSize(normalizedSelection).cols, target: null })
    } else {
      setSelectedCell({ row: visibleRows[0] ?? 0, col })
      selectColumns(col, col)
      setDrag({ kind: 'select-columns', anchor: col })
    }
  }

  const handleRowHeaderDown = (row: number, event: ReactMouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (editing) commitEditing()
    focusGrid()
    const inSelection = selectionMode === 'row' && normalizedSelection && row >= normalizedSelection.startRow && row <= normalizedSelection.endRow
    if (event.shiftKey && selectedCell) {
      selectRows(selectedCell.row, row)
    } else if (inSelection) {
      setDrag({ kind: 'reorder-row', start: normalizedSelection.startRow, count: rangeSize(normalizedSelection).rows, target: null })
    } else {
      setSelectedCell({ row, col: 0 })
      selectRows(row, row)
      setDrag({ kind: 'select-rows', anchor: row })
    }
  }

  const selectAll = () => {
    const lastCol = (normalizedData[0]?.length || 1) - 1
    setEditing(null)
    setSelectedCell({ row: 0, col: 0 })
    setSelectionRange({ startRow: 0, endRow: normalizedData.length - 1, startCol: 0, endCol: lastCol })
    setSelectionMode('all')
    focusGrid()
  }

  const handleCellMouseEnter = (row: number, col: number) => {
    if (!drag) return
    if (drag.kind === 'select') {
      setSelectionRange({ startRow: drag.anchor.row, startCol: drag.anchor.col, endRow: row, endCol: col })
    } else if (drag.kind === 'fill' && normalizedSelection) {
      const { startRow, endRow, startCol, endCol } = normalizedSelection
      const rowDistance = row > endRow ? row - endRow : row < startRow ? startRow - row : 0
      const colDistance = col > endCol ? col - endCol : col < startCol ? startCol - col : 0
      if (!rowDistance && !colDistance) setDrag({ kind: 'fill', preview: null })
      else if (rowDistance >= colDistance) setDrag({ kind: 'fill', preview: { startRow: Math.min(startRow, row), endRow: Math.max(endRow, row), startCol, endCol } })
      else setDrag({ kind: 'fill', preview: { startRow, endRow, startCol: Math.min(startCol, col), endCol: Math.max(endCol, col) } })
    } else if (drag.kind === 'move') {
      setDrag({ ...drag, offset: { row: row - drag.grab.row, col: col - drag.grab.col } })
    }
  }

  const handleColumnHeaderEnter = (col: number, event: ReactMouseEvent) => {
    if (!drag) return
    if (drag.kind === 'select-columns') selectColumns(drag.anchor, col)
    if (drag.kind === 'reorder-column') {
      const box = event.currentTarget.getBoundingClientRect()
      setDrag({ ...drag, target: event.clientX > box.left + box.width / 2 ? col + 1 : col })
    }
  }

  const handleRowHeaderEnter = (row: number, event: ReactMouseEvent) => {
    if (!drag) return
    if (drag.kind === 'select-rows') selectRows(drag.anchor, row)
    if (drag.kind === 'reorder-row') {
      const box = event.currentTarget.getBoundingClientRect()
      setDrag({ ...drag, target: event.clientY > box.top + box.height / 2 ? row + 1 : row })
    }
  }

  const fillRange = (source: SelectionRange, target: SelectionRange) => {
    const next = normalizedData.map(row => [...row])
    const nextStyles = { ...styles }
    const { rows, cols } = rangeSize(source)
    const vertical = target.endRow > source.endRow || target.startRow < source.startRow
    const backwards = target.startRow < source.startRow || target.startCol < source.startCol
    const distance = vertical ? rangeSize(target).rows - rows : rangeSize(target).cols - cols
    const lanes = vertical ? cols : rows
    const length = vertical ? rows : cols
    const cellOf = (lane: number, position: number): CellPos => vertical
      ? { row: source.startRow + position, col: source.startCol + lane }
      : { row: source.startRow + lane, col: source.startCol + position }
    for (let lane = 0; lane < lanes; lane += 1) {
      const positions = Array.from({ length }, (_, index) => backwards ? length - 1 - index : index)
      const values = positions.map(position => { const cell = cellOf(lane, position); return normalizedData[cell.row][cell.col] })
      const hasFormula = values.some(value => value.startsWith('='))
      for (let step = 1; step <= distance; step += 1) {
        const position = backwards ? -step : length - 1 + step
        const cell = cellOf(lane, position)
        const sourcePosition = positions[(step - 1) % length]
        const sourceCell = cellOf(lane, sourcePosition)
        next[cell.row][cell.col] = hasFormula
          ? shiftFormula(normalizedData[sourceCell.row][sourceCell.col], cell.row - sourceCell.row, cell.col - sourceCell.col)
          : seriesValue(values, step)
        const sourceStyle = styles[`${sourceCell.row}:${sourceCell.col}`]
        if (sourceStyle) nextStyles[`${cell.row}:${cell.col}`] = sourceStyle
        else delete nextStyles[`${cell.row}:${cell.col}`]
      }
    }
    onDataChange(next)
    onStylesChange?.(nextStyles)
    setSelectionRange(target)
  }

  const moveBlock = (range: SelectionRange, toRow: number, toCol: number) => {
    const { rows, cols } = rangeSize(range)
    const grown = normalizeGrid(normalizedData, Math.min(MAX_ROWS, toRow + rows), Math.min(MAX_COLS, toCol + cols))
    if (toRow + rows > grown.length || toCol + cols > grown[0].length) return
    onDataChange(moveCellBlock(grown, range, toRow, toCol))
    if (onStylesChange) {
      const nextStyles = { ...styles }
      const moved: SheetCellStyles = {}
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        for (let col = range.startCol; col <= range.endCol; col += 1) {
          const style = styles[`${row}:${col}`]
          delete nextStyles[`${row}:${col}`]
          if (style) moved[`${row - range.startRow + toRow}:${col - range.startCol + toCol}`] = style
        }
      }
      for (let row = toRow; row < toRow + rows; row += 1) for (let col = toCol; col < toCol + cols; col += 1) delete nextStyles[`${row}:${col}`]
      onStylesChange({ ...nextStyles, ...moved })
    }
    setSelectedCell({ row: toRow, col: toCol })
    setSelectionRange({ startRow: toRow, endRow: toRow + rows - 1, startCol: toCol, endCol: toCol + cols - 1 })
  }

  // Finishing a drag needs the latest handlers, not the ones from when the listener was attached.
  const finishDragRef = useRef<() => void>(() => undefined)
  finishDragRef.current = () => {
    if (!drag) return
    setDrag(null)
    if (drag.kind === 'fill' && drag.preview && normalizedSelection) fillRange(normalizedSelection, drag.preview)
    if (drag.kind === 'move' && normalizedSelection && (drag.offset.row || drag.offset.col)) {
      moveBlock(normalizedSelection, Math.max(0, normalizedSelection.startRow + drag.offset.row), Math.max(0, normalizedSelection.startCol + drag.offset.col))
    }
    if (drag.kind === 'reorder-column') {
      if (drag.target !== null) reorderColumns(drag.start, drag.count, drag.target)
    }
    if (drag.kind === 'reorder-row') {
      if (drag.target !== null) reorderRows(drag.start, drag.count, drag.target)
    }
  }
  useEffect(() => {
    const onMouseUp = () => finishDragRef.current()
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const isCellInSelection = (row: number, col: number) => {
    if (!normalizedSelection) return false
    return row >= normalizedSelection.startRow && row <= normalizedSelection.endRow && col >= normalizedSelection.startCol && col <= normalizedSelection.endCol
  }

  const selectedRawValue = editing ? editing.draft : selectedCell ? normalizedData[selectedCell.row]?.[selectedCell.col] ?? '' : ''
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
    setEditing({ row: selectedCell.row, col: selectedCell.col, draft: formula })
    setTimeout(() => cellEditorRef.current?.focus(), 0)
  }

  const rememberSelection = (cut: boolean): string => {
    if (!normalizedSelection) return ''
    const rowsInRange = Array.from({ length: rangeSize(normalizedSelection).rows }, (_, offset) => normalizedSelection.startRow + offset).filter(row => !hiddenRows.has(row))
    const colsInRange = Array.from({ length: rangeSize(normalizedSelection).cols }, (_, offset) => normalizedSelection.startCol + offset)
    const text = rowsInRange.map(row => colsInRange.map(col => displayData[row]?.[col] ?? '').join('\t')).join('\n')
    clipboardRef.current = {
      text,
      range: normalizedSelection,
      rows: rowsInRange.map(row => colsInRange.map(col => normalizedData[row]?.[col] ?? '')),
      styles: rowsInRange.map(row => colsInRange.map(col => styles[`${row}:${col}`])),
      cut,
    }
    return text
  }

  const copySelection = async (cut = false) => {
    const text = rememberSelection(cut)
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: cut ? tl("Celle tagliate") : tl("Celle copiate") })
    } catch {
      toast({ title: tl("Copia con Ctrl/Cmd+C"), description: tl("Il browser non ha concesso l’accesso diretto agli appunti.") })
    }
  }

  const pasteRows = (incoming: string[][], incomingStyles: Array<Array<SheetCellStyle | undefined>> | null, sourceOrigin: CellPos | null) => {
    if (!selectedCell || !incoming.length) return
    const start = normalizedSelection ? { row: normalizedSelection.startRow, col: normalizedSelection.startCol } : selectedCell
    const height = incoming.length
    const width = Math.max(1, ...incoming.map(row => row.length))
    // A smaller block pasted on a bigger selection repeats to fill it, when it fits evenly.
    const selection = normalizedSelection ? rangeSize(normalizedSelection) : { rows: 1, cols: 1 }
    const repeatRows = selection.rows % height === 0 ? selection.rows : height
    const repeatCols = selection.cols % width === 0 ? selection.cols : width
    const next = normalizeGrid(normalizedData, Math.min(MAX_ROWS, Math.max(normalizedData.length, start.row + repeatRows)), Math.min(MAX_COLS, Math.max(normalizedData[0]?.length || 0, start.col + repeatCols)))
    const nextStyles = { ...styles }
    for (let rowOffset = 0; rowOffset < repeatRows; rowOffset += 1) {
      for (let colOffset = 0; colOffset < repeatCols; colOffset += 1) {
        const row = start.row + rowOffset
        const col = start.col + colOffset
        if (row >= next.length || col >= next[0].length) continue
        const value = incoming[rowOffset % height][colOffset % width] ?? ''
        const key = `${row}:${col}`
        if (sourceOrigin) {
          next[row][col] = shiftFormula(value, row - (sourceOrigin.row + rowOffset % height), col - (sourceOrigin.col + colOffset % width))
          const style = incomingStyles?.[rowOffset % height]?.[colOffset % width]
          if (style) nextStyles[key] = style
          else delete nextStyles[key]
        } else {
          const parsed = parseCellInput(value, styles[key]?.numberFormat)
          next[row][col] = parsed.value
          if (parsed.numberFormat) nextStyles[key] = { ...(styles[key] || {}), numberFormat: parsed.numberFormat }
        }
      }
    }
    onDataChange(next)
    onStylesChange?.(nextStyles)
    setSelectionRange({ startRow: start.row, endRow: Math.min(next.length - 1, start.row + repeatRows - 1), startCol: start.col, endCol: Math.min(next[0].length - 1, start.col + repeatCols - 1) })
  }

  const pasteText = (text: string) => {
    if (!text) return
    const internal = clipboardRef.current
    if (internal && internal.text.replace(/\r/g, '') === text.replace(/\r/g, '').replace(/\n$/, '')) {
      if (internal.cut && selectedCell) {
        moveBlock(internal.range, normalizedSelection?.startRow ?? selectedCell.row, normalizedSelection?.startCol ?? selectedCell.col)
        clipboardRef.current = null
      } else {
        pasteRows(internal.rows, internal.styles, { row: internal.range.startRow, col: internal.range.startCol })
      }
      return
    }
    pasteRows(text.replace(/\r/g, '').split('\n').filter((row, index, all) => row.length > 0 || index < all.length - 1).map(row => row.split('\t')), null, null)
  }

  const pasteSelection = async () => {
    try { pasteText(await navigator.clipboard.readText()) }
    catch { toast({ title: tl("Incolla con Ctrl/Cmd+V"), description: tl("Il browser non ha concesso l’accesso diretto agli appunti.") }) }
  }

  const gridHasFocus = () => document.activeElement === gridRef.current

  const handleGridCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!gridHasFocus()) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', rememberSelection(false))
  }

  const handleGridCut = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!gridHasFocus()) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', rememberSelection(true))
  }

  const handleGridPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!gridHasFocus()) return
    event.preventDefault()
    pasteText(event.clipboardData.getData('text/plain'))
  }

  const clearSelectionValues = () => {
    if (!normalizedSelection) return
    applyToSelection(normalizedSelection, (row, col) => hiddenRows.has(row) ? normalizedData[row][col] : '')
  }

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || !selectedCell) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[key]) {
      event.preventDefault()
      const [rows, cols] = arrows[key]
      if (event.shiftKey) {
        const focus = normalizedSelection && selectionRange ? { row: selectionRange.endRow, col: selectionRange.endCol } : selectedCell
        const target = mod ? jumpCell(focus, rows, cols) : offsetCell(focus, rows, cols)
        extendSelectionTo(target.row, target.col)
        scrollCellIntoView(target.row, target.col)
      } else {
        const target = mod ? jumpCell(selectedCell, rows, cols) : offsetCell(selectedCell, rows, cols)
        moveToCell(target.row, target.col)
      }
      return
    }
    if (key === 'Tab' || key === 'Enter') {
      event.preventDefault()
      const direction = event.shiftKey ? -1 : 1
      const target = key === 'Tab' ? offsetCell(selectedCell, 0, direction) : offsetCell(selectedCell, direction, 0)
      moveToCell(target.row, target.col)
      return
    }
    if (key === 'F2') { event.preventDefault(); startEditing(); return }
    if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); clearSelectionValues(); return }
    if (key === 'Escape') { clipboardRef.current = null; return }
    if (mod) {
      const letter = key.toLowerCase()
      if (letter === 'a') { event.preventDefault(); selectAll() }
      else if (letter === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      else if (letter === 'y') { event.preventDefault(); redo() }
      else if (letter === 'b') { event.preventDefault(); applyStyle({ fontWeight: selectedStyle.fontWeight === 'bold' ? 'normal' : 'bold' }) }
      else if (letter === 'i') { event.preventDefault(); applyStyle({ fontStyle: selectedStyle.fontStyle === 'italic' ? 'normal' : 'italic' }) }
      else if (letter === 'u') { event.preventDefault(); applyStyle({ textDecoration: selectedStyle.textDecoration === 'underline' ? 'none' : 'underline' }) }
      return
    }
    if (key.length === 1 && !event.altKey) {
      event.preventDefault()
      startEditing(key)
    }
  }

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Tab' || event.key === 'Enter') && formulaCompletions.length > 0) {
      event.preventDefault()
      completeFormula(formulaCompletions[0].name)
      return
    }
    // Started by typing over a cell, arrows confirm and move; started with F2 or double click, they move the caret.
    const arrow = editing?.typed ? { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key] : undefined
    if (arrow) { event.preventDefault(); commitEditing({ rows: arrow[0], cols: arrow[1] }); return }
    if (event.key === 'Enter') { event.preventDefault(); commitEditing({ rows: event.shiftKey ? -1 : 1, cols: 0 }) }
    if (event.key === 'Tab') { event.preventDefault(); commitEditing({ rows: 0, cols: event.shiftKey ? -1 : 1 }) }
    if (event.key === 'Escape') { event.preventDefault(); cancelEditing() }
  }

  const startResize = (kind: 'column' | 'row', index: number, event: ReactMouseEvent) => {
    if (!onDimensionsChange) return
    event.preventDefault()
    event.stopPropagation()
    pushHistory()
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
      toast({ title: tl("Inserisci un numero valido"), variant: 'destructive' })
      return
    }
    if (operation === '/' && operand === 0) {
      toast({ title: tl("Non è possibile dividere per zero"), variant: 'destructive' })
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
      toast({ title: tl("Nessun numero nella selezione"), description: tl("Seleziona una o più celle numeriche."), variant: 'destructive' })
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
        toast({ title: tl("Nessuno spazio per il risultato"), variant: 'destructive' })
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
        toast({ title: tl("Nessuno spazio per il risultato"), variant: 'destructive' })
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
      title: tl("Formula inserita"),
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

  /** Applying a date format to text the importer left as "31/12/2024" converts it, instead of showing nothing new. */
  const applyNumberFormat = (code: string) => {
    if (!normalizedSelection) return
    applyStyle({ numberFormat: code === GENERAL_FORMAT ? undefined : code })
    if (code === TEXT_FORMAT) return
    let changed = false
    const next = normalizedData.map(row => [...row])
    for (let row = normalizedSelection.startRow; row <= normalizedSelection.endRow; row += 1) {
      for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
        const raw = next[row][col]
        if (!raw || raw.startsWith('=') || isNumericText(raw)) continue
        const parsed = parseCellInput(raw)
        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T]/)
        const value = parsed.value !== raw ? parsed.value : iso ? String(dateToSerial(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? raw) : raw
        if (value !== raw) { next[row][col] = value; changed = true }
      }
    }
    if (changed) onDataChange(next)
  }

  const stepSelectionDecimals = (delta: number) => {
    if (!selectedCell) return
    applyNumberFormat(stepDecimals(selectedStyle.numberFormat, evaluatedData[selectedCell.row]?.[selectedCell.col] ?? '0', delta))
  }

  const toggleFilters = () => {
    setFiltersOn(on => !on)
    setColumnFilters({})
    setFilterMenu(null)
  }

  const filterOptions = useMemo(() => {
    if (!filterMenu) return [] as Array<{ value: string; count: number }>
    const last = lastDataRow(displayData)
    const counts = new Map<string, number>()
    for (let row = filterHeaderRow + 1; row <= last; row += 1) {
      const value = displayData[row]?.[filterMenu.col] ?? ''
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, sortKey: evaluatedData[normalizedData.findIndex((_, row) => row > filterHeaderRow && displayData[row]?.[filterMenu.col] === value)]?.[filterMenu.col] ?? value }))
      .sort((a, b) => compareCells(a.sortKey, b.sortKey))
  }, [displayData, evaluatedData, filterHeaderRow, filterMenu, normalizedData])

  const toggleFilterValue = (col: number, value: string) => {
    const current = columnFilters[col] ?? new Set(filterOptions.map(option => option.value))
    const nextValues = new Set(current)
    if (nextValues.has(value)) nextValues.delete(value)
    else nextValues.add(value)
    setFilterColumnValues(col, nextValues)
  }

  const setFilterColumnValues = (col: number, values: Set<string> | null) => {
    setColumnFilters(current => {
      const next = { ...current }
      if (!values || values.size === filterOptions.length) delete next[col]
      else next[col] = values
      return next
    })
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
    return Array.from({ length: normalizedSelection.endCol - normalizedSelection.startCol + 1 }, (_, idx) => tl("Colonna {0}", columnName(normalizedSelection.startCol + idx)))
  }, [normalizedSelection, selectedRowsForCharts, useFirstRowAsHeader])

  const selectedColumnOptions = useMemo(() => {
    if (!normalizedSelection) return [] as Array<{ index: number; label: string }>
    const out: Array<{ index: number; label: string }> = []
    for (let col = normalizedSelection.startCol; col <= normalizedSelection.endCol; col += 1) {
      const rel = col - normalizedSelection.startCol
      const header = selectedHeaderRow[rel] || tl("Colonna {0}", columnName(col))
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
      title: chartConfig.title || tl("Grafico {0}", selectedRangeLabel),
    })
    setActiveContextMenu('chart')
  }

  /** Pixel box of a cell range over the visible rows; ranges partly behind a filter shrink to what shows. */
  const boxOfRange = (range: SelectionRange | null): CSSProperties | null => {
    if (!range) return null
    const firstRow = visibleRows.findIndex(row => row >= range.startRow)
    let lastRow = firstRow
    while (lastRow + 1 < visibleRows.length && visibleRows[lastRow + 1] <= range.endRow) lastRow += 1
    if (firstRow < 0 || visibleRows[firstRow] > range.endRow) return null
    return {
      left: columnOffsets[range.startCol] - 1,
      top: headerHeight + rowOffsets[firstRow] - 1,
      width: columnOffsets[range.endCol + 1] - columnOffsets[range.startCol] + 1,
      height: rowOffsets[lastRow + 1] - rowOffsets[firstRow] + 1,
    }
  }
  const selectionBox = editing ? null : boxOfRange(normalizedSelection)
  const editorBox = editing ? boxOfRange({ startRow: editing.row, endRow: editing.row, startCol: editing.col, endCol: editing.col }) : null
  const movedRange = drag?.kind === 'move' && normalizedSelection ? (() => {
    const { rows, cols } = rangeSize(normalizedSelection)
    const startRow = Math.max(0, Math.min(normalizedData.length - rows, normalizedSelection.startRow + drag.offset.row))
    const startCol = Math.max(0, Math.min(columnWidths.length - cols, normalizedSelection.startCol + drag.offset.col))
    return { startRow, endRow: startRow + rows - 1, startCol, endCol: startCol + cols - 1 }
  })() : null
  const dragPreviewBox = boxOfRange(drag?.kind === 'fill' ? drag.preview : movedRange)
  const totalHeight = rowOffsets[rowOffsets.length - 1]
  const dropMarker: CSSProperties | null = drag?.kind === 'reorder-column' && drag.target !== null
    ? { left: columnOffsets[drag.target] - 2, top: 0, width: 3, height: headerHeight + totalHeight }
    : drag?.kind === 'reorder-row' && drag.target !== null
      ? { left: 0, top: headerHeight + rowOffsets[visibleIndex.get(drag.target) ?? visibleRows.length] - 2, height: 3, width: columnOffsets[columnOffsets.length - 1] }
      : null

  const startMoveDrag = (event: ReactMouseEvent) => {
    if (!normalizedSelection) return
    event.preventDefault()
    event.stopPropagation()
    setDrag({ kind: 'move', grab: { row: normalizedSelection.startRow, col: normalizedSelection.startCol }, offset: { row: 0, col: 0 } })
  }

  const openFilterMenu = (col: number, event: ReactMouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    setFilterSearch('')
    setContextMenu(null)
    setFilterMenu(current => current?.col === col ? null : { col, x: Math.min(window.innerWidth - 270, box.left), y: Math.min(window.innerHeight - 420, box.bottom + 4) })
  }

  /** Right click keeps a selection that contains the target, otherwise it selects the target first. */
  const openContextMenu = (event: ReactMouseEvent, kind: 'cell' | 'row' | 'column', first: number, second = 0) => {
    event.preventDefault()
    setFilterMenu(null)
    if (editing) commitEditing()
    if (kind === 'cell' && !isCellInSelection(first, second)) {
      setSelectedCell({ row: first, col: second })
      setSelectionRange({ startRow: first, endRow: first, startCol: second, endCol: second })
      setSelectionMode('cell')
    }
    if (kind === 'row' && !(selectionMode === 'row' && normalizedSelection && first >= normalizedSelection.startRow && first <= normalizedSelection.endRow)) {
      setSelectedCell({ row: first, col: 0 })
      selectRows(first, first)
    }
    if (kind === 'column' && !(selectionMode === 'column' && normalizedSelection && first >= normalizedSelection.startCol && first <= normalizedSelection.endCol)) {
      setSelectedCell({ row: 0, col: first })
      selectColumns(first, first)
    }
    focusGrid()
    setContextMenu({ x: Math.min(window.innerWidth - 232, event.clientX), y: Math.min(window.innerHeight - 340, event.clientY) })
  }

  const contextMenuItems: Array<{ label: string; run: () => void } | null> = normalizedSelection ? [
    { label: tl("Taglia"), run: () => void copySelection(true) },
    { label: tl("Copia"), run: () => void copySelection() },
    { label: tl("Incolla"), run: () => void pasteSelection() },
    { label: tl("Svuota celle"), run: clearSelectionValues },
    null,
    { label: tl("Inserisci {0} righe sopra", rangeSize(normalizedSelection).rows), run: () => insertRowsAt(normalizedSelection.startRow, rangeSize(normalizedSelection).rows) },
    { label: tl("Inserisci {0} righe sotto", rangeSize(normalizedSelection).rows), run: () => insertRowsAt(normalizedSelection.endRow + 1, rangeSize(normalizedSelection).rows) },
    { label: tl("Inserisci {0} colonne a sinistra", rangeSize(normalizedSelection).cols), run: () => insertColumnsAt(normalizedSelection.startCol, rangeSize(normalizedSelection).cols) },
    { label: tl("Inserisci {0} colonne a destra", rangeSize(normalizedSelection).cols), run: () => insertColumnsAt(normalizedSelection.endCol + 1, rangeSize(normalizedSelection).cols) },
    null,
    { label: tl("Elimina righe"), run: removeSelectedRow },
    { label: tl("Elimina colonne"), run: removeSelectedColumn },
    null,
    { label: tl("Ordina crescente"), run: () => sortByColumn(normalizedSelection.startCol, 1) },
    { label: tl("Ordina decrescente"), run: () => sortByColumn(normalizedSelection.startCol, -1) },
  ] : []

  /** Double click on a column edge: fit the widest displayed value. */
  const autoColumnWidth = (col: number) => {
    const longest = Math.max(1, ...displayData.map(row => (row[col] ?? '').length))
    return Math.max(56, Math.min(420, Math.round(longest * 7.5) + 24))
  }

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-3" onCopy={handleGridCopy} onCut={handleGridCut} onPaste={handleGridPaste}>
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <IconTool label={tl("Importa CSV/XLSX")} onClick={() => fileInputRef.current?.click()}><FileUp className="h-4 w-4" /></IconTool>
          <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={async (event) => { const file = event.target.files?.[0]; if (file) await importSheet(file); event.target.value = '' }} />
          <IconTool label={tl("Esporta CSV")} onClick={exportCsv}><span className="relative"><Download className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">C</span></span></IconTool>
          <IconTool label={tl("Esporta XLSX")} onClick={exportXlsx}><span className="relative"><Download className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">X</span></span></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label={selectionMode === 'row' ? tl("Inserisci riga dopo la selezione") : tl("Aggiungi riga")} onClick={addRow}><span className="relative"><Plus className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">R</span></span></IconTool>
          <IconTool label={selectionMode === 'column' ? tl("Inserisci colonna dopo la selezione") : tl("Aggiungi colonna")} onClick={addColumn}><span className="relative"><Plus className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">C</span></span></IconTool>
          <IconTool label={tl("Elimina riga selezionata")} onClick={removeSelectedRow} disabled={!selectedCell}><span className="relative"><Trash2 className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">R</span></span></IconTool>
          <IconTool label={tl("Elimina colonna selezionata")} onClick={removeSelectedColumn} disabled={!selectedCell}><span className="relative"><Trash2 className="h-4 w-4" /><span className="absolute -bottom-1 -right-1 text-[7px] font-black">C</span></span></IconTool>
          <IconTool label={tl("Pulisci tutta la tabella")} onClick={clearSheet}><Eraser className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label={tl("Annulla (Ctrl+Z)")} onClick={undo} disabled={!historyRef.current.past.length}><Undo2 className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Ripeti (Ctrl+Y)")} onClick={redo} disabled={!historyRef.current.future.length}><Redo2 className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label={tl("Filtri sulle colonne")} onClick={toggleFilters} active={filtersOn}><Filter className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label={tl("Taglia")} onClick={() => void copySelection(true)} disabled={!normalizedSelection}><Scissors className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Copia selezione")} onClick={() => void copySelection()} disabled={!normalizedSelection}><Copy className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Incolla")} onClick={() => void pasteSelection()} disabled={!selectedCell}><ClipboardPaste className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Separa testo in colonne")} onClick={splitSelection} disabled={!normalizedSelection}><span className="text-[11px] font-black">a|b</span></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <IconTool label={tl("Crea grafico dalla selezione")} onClick={() => openChartFromSelection(false)} active={activeContextMenu === 'chart'}><BarChart3 className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Regressione lineare")} onClick={() => openChartFromSelection(true)} active={activeContextMenu === 'chart' && chartConfig.type === 'scatter'}><TrendingUp className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Riempimento guidato o AI")} onClick={() => setActiveContextMenu(activeContextMenu === 'fill' ? 'none' : 'fill')} active={activeContextMenu === 'fill'}><Wand2 className="h-4 w-4" /></IconTool>
          <span className="ml-auto rounded-md bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700">
            {selectionMode === 'column' && normalizedSelection
              ? tl("Colonna {0}", columnName(normalizedSelection.startCol))
              : selectionMode === 'row' && normalizedSelection
                ? tl("Riga {0}", normalizedSelection.startRow + 1)
                : selectionMode === 'all' ? tl("Tutta la tabella") : selectedRangeLabel}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="flex h-8 min-w-14 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-bold text-slate-600">{selectedCell ? `${columnName(selectedCell.col)}${selectedCell.row + 1}` : '-'}</span>
          <span className="text-xs font-black text-slate-400">fx</span>
          <div className="relative min-w-56 flex-1">
            <Input
              ref={formulaBarRef}
              value={selectedRawValue}
              onBlur={event => { if (event.relatedTarget !== cellEditorRef.current) commitEditing() }}
              onFocus={() => { if (selectedCell && !editing) setEditing({ row: selectedCell.row, col: selectedCell.col, draft: selectedRawValue }) }}
              onChange={(event) => { if (selectedCell) setEditing({ row: selectedCell.row, col: selectedCell.col, draft: event.target.value }) }}
              onKeyDown={handleEditorKeyDown}
              placeholder={tl("Valore oppure =FUNZIONE(A1:B5)")}
              aria-label={tl("Barra della formula")}
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
          <select className="h-8 max-w-32 rounded-md border border-slate-200 bg-white px-2 text-xs" onChange={event => applyStyle({ fontFamily: event.target.value })} value={selectedStyle.fontFamily || 'Arial'}><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Times New Roman</option><option>Verdana</option><option>monospace</option></select>
          <select className="h-8 w-16 rounded-md border border-slate-200 bg-white px-1 text-xs" onChange={event => applyStyle({ fontSize: Number(event.target.value) })} value={selectedStyle.fontSize || 14}>{[...new Set([10, 12, 14, 15, 16, 18, 20, 24, selectedStyle.fontSize || 14])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}</select>
          <IconTool label={tl("Grassetto")} active={selectedStyle.fontWeight === 'bold'} onClick={() => applyStyle({ fontWeight: selectedStyle.fontWeight === 'bold' ? 'normal' : 'bold' })}><Bold className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Corsivo")} active={selectedStyle.fontStyle === 'italic'} onClick={() => applyStyle({ fontStyle: selectedStyle.fontStyle === 'italic' ? 'normal' : 'italic' })}><Italic className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Sottolineato")} active={selectedStyle.textDecoration === 'underline'} onClick={() => applyStyle({ textDecoration: selectedStyle.textDecoration === 'underline' ? 'none' : 'underline' })}><Underline className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Allinea a sinistra")} active={selectedStyle.textAlign === 'left'} onClick={() => applyStyle({ textAlign: 'left' })}><AlignLeft className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Centra")} active={selectedStyle.textAlign === 'center'} onClick={() => applyStyle({ textAlign: 'center' })}><AlignCenter className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Allinea a destra")} active={selectedStyle.textAlign === 'right'} onClick={() => applyStyle({ textAlign: 'right' })}><AlignRight className="h-4 w-4" /></IconTool>
          <IconTool label={tl("Testo a capo")} active={selectedStyle.whiteSpace === 'normal'} onClick={() => applyStyle({ whiteSpace: selectedStyle.whiteSpace === 'normal' ? 'nowrap' : 'normal' })}><span className="text-[11px] font-black">↵</span></IconTool>
          <label className="flex h-9 w-9 cursor-pointer flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-[12px] font-black text-slate-700 hover:bg-slate-100" title={tl("Colore testo")}>
            A<span className="h-1 w-5 rounded-sm" style={{ backgroundColor: selectedStyle.color || '#0f172a' }} />
            <input type="color" className="sr-only" value={selectedStyle.color || '#0f172a'} onChange={event => applyStyle({ color: event.target.value })} aria-label={tl("Colore testo")} />
          </label>
          <label className="flex h-9 w-9 cursor-pointer flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-[11px] font-black text-slate-700 hover:bg-slate-100" title={tl("Colore cella")}>
            ▧<span className="h-1 w-5 rounded-sm border border-slate-200" style={{ backgroundColor: selectedStyle.backgroundColor || '#ffffff' }} />
            <input type="color" className="sr-only" value={selectedStyle.backgroundColor || '#ffffff'} onChange={event => applyStyle({ backgroundColor: event.target.value })} aria-label={tl("Colore cella")} />
          </label>
          <select className="h-8 max-w-32 rounded-md border border-slate-200 bg-white px-2 text-xs" aria-label={tl("Formato numero")} title={tl("Formato numero")} value={NUMBER_FORMATS.some(format => format.code === (selectedStyle.numberFormat || GENERAL_FORMAT)) ? selectedStyle.numberFormat || GENERAL_FORMAT : 'custom'} onChange={event => applyNumberFormat(event.target.value)}>
            {NUMBER_FORMATS.map(format => <option key={format.code} value={format.code}>{format.label}</option>)}
            {!NUMBER_FORMATS.some(format => format.code === (selectedStyle.numberFormat || GENERAL_FORMAT)) && <option value="custom">{selectedStyle.numberFormat}</option>}
          </select>
          <IconTool label={tl("Meno decimali")} onClick={() => stepSelectionDecimals(-1)}><span className="text-[10px] font-black">,0</span></IconTool>
          <IconTool label={tl("Più decimali")} onClick={() => stepSelectionDecimals(1)}><span className="text-[10px] font-black">,00</span></IconTool>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-semibold text-slate-500">{tl("Calcola sulle celle")}</span>
          <select value={operation} onChange={event => setOperation(event.target.value as typeof operation)} className="h-8 w-12 rounded-md border border-slate-200 bg-white px-2 text-xs"><option>+</option><option>-</option><option>*</option><option>/</option></select>
          <Input value={operationValue} onChange={event => setOperationValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applyNumericOperation() }} className="h-8 w-20 text-xs" inputMode="decimal" />
          <IconTool label={tl("Applica operazione ai valori selezionati")} onClick={applyNumericOperation}><Check className="h-4 w-4" /></IconTool>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <span className="text-[11px] font-semibold text-slate-500">{tl("Formula rapida")}</span>
          <select value={statFunction} onChange={event => setStatFunction(event.target.value as typeof statFunction)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option>SUM</option><option>AVERAGE</option><option>MIN</option><option>MAX</option><option>COUNT</option><option>MEDIAN</option><option>STDEV.S</option></select>
          <IconTool label={tl("Inserisci la formula nella posizione suggerita")} onClick={() => insertSmartStatistic(statFunction)} disabled={!smartSelection}><Sigma className="h-4 w-4" /></IconTool>
          {smartSelection && <span className="ml-auto rounded-md bg-cyan-50 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-800">{smartSelection.count} {tl("valori · Somma")} {smartSelection.sum.toLocaleString('it-IT', { maximumFractionDigits: 4 })} {tl("· Media")} {smartSelection.average.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</span>}
        </div>

        {/* Always rendered: a bar appearing mid-drag would shift the grid under the mouse. */}
        <div className="mt-2 flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 p-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-violet-800"><Sigma className="h-3.5 w-3.5" /> {tl("Operazioni suggerite")}</span>
            {!isMultipleSelection ? (
              <span className="text-[11px] text-slate-600">{tl("Seleziona più celle per calcolare somma, media e altro.")}</span>
            ) : smartSelection ? (
              <>
                {FORMULA_FUNCTIONS.filter(item => ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(item.name)).map(item => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => insertSmartStatistic(item.name as StatFunction)}
                    className="rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-100"
                    title={tl("{0}; inserisce il risultato {1} senza includere celle vuote esterne ai dati", item.hint, smartSelection.direction === 'row' ? 'a destra' : 'sotto')}
                  >
                    {item.label}
                  </button>
                ))}
                <span className="ml-auto text-[11px] text-violet-700">
                  {tl("Dati rilevati in")} {rangeToA1(smartSelection.bounds)} {tl("· risultato")} {smartSelection.direction === 'row' ? tl("a destra per ogni riga") : tl("sotto per ogni colonna")}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-slate-600">{tl("La selezione non contiene valori numerici. Puoi comunque scrivere una formula nella barra fx.")}</span>
            )}
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          ref={scrollRef}
          className="max-h-[68vh] overflow-auto select-none"
          onScroll={event => { setScrollTop(event.currentTarget.scrollTop); setFilterMenu(null); setContextMenu(null) }}
        >
          <div
            ref={gridRef}
            tabIndex={0}
            role="grid"
            aria-label={tl("Foglio di calcolo")}
            aria-rowcount={normalizedData.length}
            className={`relative outline-none ${drag?.kind === 'reorder-column' || drag?.kind === 'reorder-row' || drag?.kind === 'move' ? 'cursor-grabbing' : ''}`}
            style={{ width: columnOffsets[columnOffsets.length - 1] }}
            onKeyDown={handleGridKeyDown}
          >
            <table className="table-fixed border-collapse text-sm" style={{ width: columnOffsets[columnOffsets.length - 1] }}>
              <colgroup>
                <col style={{ width: ROW_HEADER_WIDTH }} />
                {columnWidths.map((width, index) => <col key={index} style={{ width }} />)}
              </colgroup>
              <thead ref={headRef} className="sticky top-0 z-20 bg-slate-100">
                <tr>
                  <th className={`sticky left-0 z-10 w-12 border border-slate-200 p-0 text-xs ${selectionMode === 'all' ? 'bg-violet-200 text-violet-800' : 'bg-slate-100 text-slate-500'}`}>
                    <button type="button" tabIndex={-1} onClick={selectAll} className="h-full min-h-8 w-full px-2 py-1.5" aria-label={tl("Seleziona tutta la tabella")} title={tl("Seleziona tutta la tabella")}>#</button>
                  </th>
                  {normalizedData[0]?.map((_, colIdx) => {
                    const columnSelected = (selectionMode === 'column' || selectionMode === 'all') && normalizedSelection !== null && colIdx >= normalizedSelection.startCol && colIdx <= normalizedSelection.endCol
                    return (
                      <th
                        key={colIdx}
                        className={`relative border border-slate-200 p-0 text-xs font-semibold ${columnSelected ? 'cursor-grab bg-violet-200 text-violet-900' : 'cursor-pointer text-slate-700'}`}
                        style={{ width: columnWidths[colIdx] }}
                        title={selectionMode === 'column' && columnSelected ? tl("Trascina per spostare la colonna") : tl("Seleziona tutta la colonna {0}", columnName(colIdx))}
                        onMouseDown={event => handleColumnHeaderDown(colIdx, event)}
                        onMouseMove={event => handleColumnHeaderEnter(colIdx, event)}
                        onContextMenu={event => openContextMenu(event, 'column', colIdx)}
                      >
                        <div className="min-h-8 px-2 py-1.5 text-center">{columnName(colIdx)}</div>
                        {onDimensionsChange && <span
                          role="separator"
                          aria-orientation="vertical"
                          title={tl("Trascina per ridimensionare la colonna")}
                          onMouseDown={(event) => startResize('column', colIdx, event)}
                          onDoubleClick={() => onDimensionsChange?.({ columnWidths: columnWidths.map((width, index) => index === colIdx ? autoColumnWidth(colIdx) : width), rowHeights })}
                          className="absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize hover:bg-indigo-400/50"
                        />}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {renderWindow.first > 0 && <tr style={{ height: rowOffsets[renderWindow.first] }}><td colSpan={columnWidths.length + 1} /></tr>}
                {visibleRows.slice(renderWindow.first, renderWindow.last + 1).map(rowIdx => {
                  const row = normalizedData[rowIdx]
                  const rowSelected = (selectionMode === 'row' || selectionMode === 'all') && normalizedSelection !== null && rowIdx >= normalizedSelection.startRow && rowIdx <= normalizedSelection.endRow
                  return (
                    <tr key={rowIdx} style={{ height: rowHeights[rowIdx] }}>
                      <td
                        className={`sticky left-0 z-10 border border-slate-200 p-0 text-center text-xs ${rowSelected ? 'cursor-grab bg-violet-200 text-violet-900' : hiddenRows.size ? 'cursor-pointer bg-slate-50 font-semibold text-indigo-600' : 'cursor-pointer bg-slate-50 text-slate-500'}`}
                        title={selectionMode === 'row' && rowSelected ? tl("Trascina per spostare la riga") : tl("Seleziona tutta la riga {0}", rowIdx + 1)}
                        onMouseDown={event => handleRowHeaderDown(rowIdx, event)}
                        onMouseMove={event => handleRowHeaderEnter(rowIdx, event)}
                        onContextMenu={event => openContextMenu(event, 'row', rowIdx)}
                      >
                        <div className="relative flex h-full min-h-6 items-center justify-center px-2">
                          {rowIdx + 1}
                          {onDimensionsChange && <span
                            role="separator"
                            aria-orientation="horizontal"
                            title={tl("Trascina per ridimensionare la riga")}
                            onMouseDown={(event) => startResize('row', rowIdx, event)}
                            onDoubleClick={() => onDimensionsChange?.({ columnWidths, rowHeights: rowHeights.map((height, index) => index === rowIdx ? 36 : height) })}
                            className="absolute -bottom-1 left-0 z-10 h-2 w-full cursor-row-resize hover:bg-indigo-400/50"
                          />}
                        </div>
                      </td>
                      {row.map((_cell, colIdx) => {
                        const selected = isCellInSelection(rowIdx, colIdx)
                        const cellStyle = styles[`${rowIdx}:${colIdx}`]
                        const display = displayData[rowIdx]?.[colIdx] ?? ''
                        const rawValue = normalizedData[rowIdx][colIdx]
                        const numeric = isNumericText(evaluatedData[rowIdx]?.[colIdx] ?? '') && cellStyle?.numberFormat !== TEXT_FORMAT
                        const isFilterHeader = filtersOn && rowIdx === filterHeaderRow && lastDataRow(normalizedData) > rowIdx && (rawValue !== '' || colIdx < row.length && normalizedData.some((r, i) => i > rowIdx && r[colIdx] !== ''))
                        const { numberFormat: _numberFormat, ...textStyle } = cellStyle || {}
                        return (
                          <td
                            key={colIdx}
                            className={`relative overflow-hidden border border-slate-200 p-0 ${selected && !(selectedCell?.row === rowIdx && selectedCell.col === colIdx) ? 'bg-violet-100/70' : ''}`}
                            style={{ backgroundColor: selected && !(selectedCell?.row === rowIdx && selectedCell.col === colIdx) ? undefined : cellStyle?.backgroundColor }}
                            onMouseDown={(e) => handleCellMouseDown(rowIdx, colIdx, e)}
                            onMouseEnter={() => handleCellMouseEnter(rowIdx, colIdx)}
                            onDoubleClick={() => startEditing()}
                            onContextMenu={event => openContextMenu(event, 'cell', rowIdx, colIdx)}
                            title={rawValue.startsWith('=') ? `${rawValue} → ${display}` : undefined}
                          >
                            <div
                              className={`flex h-full min-h-6 w-full items-center overflow-hidden px-2 text-sm text-slate-800 ${cellStyle?.whiteSpace === 'normal' ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'}`}
                              style={{ ...textStyle, backgroundColor: undefined, justifyContent: (cellStyle?.textAlign ?? (numeric ? 'right' : 'left')) === 'right' ? 'flex-end' : cellStyle?.textAlign === 'center' ? 'center' : 'flex-start' }}
                            >
                              <span className={`min-w-0 ${cellStyle?.whiteSpace === 'normal' ? '' : 'truncate'}`}>{display}</span>
                            </div>
                            {isFilterHeader && (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={tl("Filtra la colonna {0}", columnName(colIdx))}
                                title={tl("Filtra e ordina")}
                                onMouseDown={event => event.stopPropagation()}
                                onClick={event => openFilterMenu(colIdx, event)}
                                className={`absolute right-0.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded border shadow-sm ${columnFilters[colIdx] ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}`}
                              >
                                {columnFilters[colIdx] ? <Filter className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {renderWindow.last < visibleRows.length - 1 && <tr style={{ height: rowOffsets[rowOffsets.length - 1] - rowOffsets[renderWindow.last + 1] }}><td colSpan={columnWidths.length + 1} /></tr>}
              </tbody>
            </table>

            {selectionBox && (
              <div className="pointer-events-none absolute z-10 border-2 border-violet-600" style={selectionBox}>
                {!editing && (['top', 'right', 'bottom', 'left'] as const).map(side => (
                  <span
                    key={side}
                    title={tl("Trascina per spostare le celle")}
                    onMouseDown={event => startMoveDrag(event)}
                    className={`pointer-events-auto absolute cursor-move ${side === 'top' ? '-top-1 left-0 h-1.5 w-full' : side === 'bottom' ? '-bottom-1 left-0 h-1.5 w-full' : side === 'left' ? '-left-1 top-0 h-full w-1.5' : '-right-1 top-0 h-full w-1.5'}`}
                  />
                ))}
                {!editing && (
                  <span
                    title={tl("Trascina per riempire")}
                    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); setDrag({ kind: 'fill', preview: null }) }}
                    className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-2.5 w-2.5 cursor-crosshair border border-white bg-violet-600"
                  />
                )}
              </div>
            )}
            {dragPreviewBox && <div className="pointer-events-none absolute z-10 border-2 border-dashed border-violet-500 bg-violet-200/20" style={dragPreviewBox} />}
            {dropMarker && <div className="pointer-events-none absolute z-30 bg-indigo-600" style={dropMarker} />}
            {editing && editorBox && (
              <input
                ref={cellEditorRef}
                aria-label={tl("Modifica cella {0}{1}", columnName(editing.col), editing.row + 1)}
                value={editing.draft}
                onChange={event => setEditing({ ...editing, draft: event.target.value })}
                onKeyDown={handleEditorKeyDown}
                onFocus={event => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
                onBlur={event => { if (event.relatedTarget !== formulaBarRef.current) commitEditing() }}
                className="absolute z-30 border-2 border-violet-600 bg-white px-2 text-sm text-slate-900 shadow-lg outline-none"
                style={{ ...editorBox, fontFamily: selectedStyle.fontFamily, fontSize: selectedStyle.fontSize }}
              />
            )}
          </div>
        </div>
      </div>

      {filterMenu && (
        <div className="fixed z-[70] w-64 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-xl" style={{ left: filterMenu.x, top: filterMenu.y }} onMouseDown={event => event.stopPropagation()}>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100" onClick={() => sortByColumn(filterMenu.col, 1)}><ArrowUp className="h-3.5 w-3.5" /> {tl("Ordina A → Z / crescente")}</button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100" onClick={() => sortByColumn(filterMenu.col, -1)}><ArrowDown className="h-3.5 w-3.5" /> {tl("Ordina Z → A / decrescente")}</button>
          <div className="my-1 h-px bg-slate-100" />
          <Input autoFocus value={filterSearch} onChange={event => setFilterSearch(event.target.value)} placeholder={tl("Cerca valore")} className="h-8 text-xs" />
          <div className="mt-1 flex justify-between px-1 text-[11px] font-semibold">
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => setFilterColumnValues(filterMenu.col, null)}>{tl("Seleziona tutto")}</button>
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => setFilterColumnValues(filterMenu.col, new Set())}>{tl("Deseleziona tutto")}</button>
          </div>
          <div className="mt-1 max-h-56 overflow-auto">
            {filterOptions.filter(option => option.value.toLowerCase().includes(filterSearch.trim().toLowerCase())).map(option => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <input type="checkbox" checked={columnFilters[filterMenu.col]?.has(option.value) ?? true} onChange={() => toggleFilterValue(filterMenu.col, option.value)} />
                <span className="min-w-0 flex-1 truncate">{option.value || tl("(vuote)")}</span>
                <span className="text-[10px] text-slate-400">{option.count}</span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex justify-end"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFilterMenu(null)}>{tl("Chiudi")}</Button></div>
        </div>
      )}

      {contextMenu && (
        <div className="fixed z-[70] w-56 rounded-lg border border-slate-200 bg-white py-1 text-xs font-semibold text-slate-700 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={event => event.stopPropagation()}>
          {contextMenuItems.map((item, index) => item === null
            ? <div key={index} className="my-1 h-px bg-slate-100" />
            : <button key={item.label} type="button" className="block w-full px-3 py-1.5 text-left hover:bg-violet-50" onClick={() => { setContextMenu(null); item.run(); focusGrid() }}>{item.label}</button>)}
        </div>
      )}

      {normalizedSelection && activeContextMenu !== 'none' && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">{activeContextMenu === 'chart' ? tl("Grafico") : tl("Riempimento")} · {selectedRangeLabel}</p>
            <button onClick={() => setActiveContextMenu('none')} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">{tl("Chiudi")}</button>
          </div>

          {activeContextMenu === 'fill' && (
            <div className="mt-3 border-t border-slate-700 pt-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-300">
                <Wand2 className="h-3.5 w-3.5" />
                {tl("Suggerimenti: \"Riempi con presente\", \"Da 1 a 100\", \"Valori casuali tra 10 e 50\", \"Formula: =A")}{'{row}'}*2"
              </div>
              <div className="flex gap-2">
                <Input
                  value={fillInstruction}
                  onChange={(e) => setFillInstruction(e.target.value)}
                  placeholder={tl("Descrivi come riempire l'intervallo")}
                  className="bg-slate-800 text-slate-100 border-slate-600 placeholder:text-slate-400"
                />
                <Button onClick={applyNaturalFill} variant="outline" className="border-slate-500 bg-transparent text-white hover:bg-slate-700">{tl("Guidato")}</Button>
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
                  <label className="mb-1 block text-xs text-slate-300">{tl("Tipo grafico")}</label>
                  <select
                    className="h-9 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100"
                    value={chartConfig.type}
                    onChange={(e) => onChartConfigChange({ ...chartConfig, type: e.target.value as SheetChartType })}
                  >
                    <option value="line">{tl("Linea")}</option>
                    <option value="bar">{tl("Barre")}</option>
                    <option value="scatter">Scatter</option>
                    <option value="pie">{tl("Torta")}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-300">{tl("Asse X")}</label>
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
                  <label className="mb-1 block text-xs text-slate-300">{tl("Asse Y")}</label>
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
                  <label className="mb-1 block text-xs text-slate-300">{tl("Titolo")}</label>
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
                  {tl("Usa prima riga come intestazione")}
                </label>
                {chartConfig.type === 'scatter' && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chartConfig.showRegression}
                      onChange={(e) => onChartConfigChange({ ...chartConfig, showRegression: e.target.checked })}
                    />
                    {tl("Mostra regressione lineare")}
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
                  {tl("Operazioni su Y")}
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
