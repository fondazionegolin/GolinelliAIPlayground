import { HyperFormula } from 'hyperformula'
import * as XLSX from 'xlsx'

const NUMBER_LOCALE = 'it-IT'
export const GENERAL_FORMAT = 'General'
export const TEXT_FORMAT = '@'
export const DEFAULT_DATE_FORMAT = 'dd/mm/yyyy'
export const CURRENCY_FORMAT = '#,##0.00 "€"'
export const PERCENT_FORMAT = '0.00%'

export type CellPos = { row: number; col: number }
export type SelectionRange = { startRow: number; endRow: number; startCol: number; endCol: number }

/** Reads a number the way it is written in Italian or by a machine: "12,5", "1.234,56", "1,234.56", "1e3".
 * A lone "1.234" stays 1.234: files and AI output use the dot as decimal separator. */
export function parseLocaleNumber(raw: string): number | null {
  const value = raw.trim().replace(/[\s  ]/g, '')
  if (!value) return null
  if (/^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(value)) return Number(value)
  if (/^[-+]?\d+,\d+$/.test(value)) return Number(value.replace(',', '.'))
  if (/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(value)) return Number(value.replace(/\./g, '').replace(',', '.'))
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return Number(value.replace(/,/g, ''))
  return null
}

const DAY_MS = 86400000
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

export function dateToSerial(year: number, month: number, day: number, seconds = 0): number | null {
  const time = Date.UTC(year, month - 1, day)
  const check = new Date(time)
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return (time - EXCEL_EPOCH) / DAY_MS + seconds / 86400
}

function parseDate(value: string): number | null {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return dateToSerial(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const local = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/)
  if (!local) return null
  const year = Number(local[3]) + (local[3].length === 2 ? 2000 : 0)
  return dateToSerial(year, Number(local[2]), Number(local[1]))
}

/** What a typed or pasted value becomes: `value` is what the sheet stores (machine number, formula or
 * text) and `numberFormat` the format the input implied, as in Excel typing "25%" or "12/03/2025". */
export function parseCellInput(raw: string, currentFormat?: string): { value: string; numberFormat?: string } {
  const value = raw.trim()
  if (!value || value.startsWith('=') || currentFormat === TEXT_FORMAT) return { value: raw }
  if (/^[-+]?0\d+$/.test(value)) return { value: raw } // codes and phone numbers keep their leading zeros
  const percent = value.match(/^(.+?)\s*%$/)
  if (percent) {
    const number = parseLocaleNumber(percent[1])
    if (number !== null) return { value: String(Number((number / 100).toPrecision(15))), numberFormat: percent[1].match(/[.,]\d/) ? PERCENT_FORMAT : '0%' }
  }
  const currency = value.match(/^(?:€\s*(.+)|(.+?)\s*€)$/)
  if (currency) {
    const number = parseLocaleNumber(currency[1] ?? currency[2])
    if (number !== null) return { value: String(number), numberFormat: CURRENCY_FORMAT }
  }
  const number = parseLocaleNumber(value)
  if (number !== null) return { value: String(number) }
  const serial = parseDate(value)
  if (serial !== null) return { value: String(serial), numberFormat: isDateFormat(currentFormat) ? currentFormat : DEFAULT_DATE_FORMAT }
  return { value: raw }
}

export function isDateFormat(code?: string): boolean {
  if (!code || code === GENERAL_FORMAT || code === TEXT_FORMAT) return false
  try { return XLSX.SSF.is_date(code) } catch { return false }
}

function formatGeneral(value: number): string {
  return Number(value.toPrecision(12)).toLocaleString(NUMBER_LOCALE, { useGrouping: false, maximumFractionDigits: 10 })
}

export function isNumericText(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value))
}

/** Text shown in a cell. `value` is the evaluated value in machine form. */
export function formatCellValue(value: string, code?: string): string {
  if (!isNumericText(value) || code === TEXT_FORMAT) return value
  const number = Number(value)
  if (!code || code === GENERAL_FORMAT) return formatGeneral(number)
  if (isDateFormat(code)) {
    try { return XLSX.SSF.format(code, number) } catch { return formatGeneral(number) }
  }
  const section = code.split(';')[Number(number < 0 && code.includes(';'))] || code
  const plain = section.replace(/"[^"]*"|\\.|_.|\*./g, ' ').replace(/\[[^\]]*\]/g, '')
  const scientific = /e[+-]/i.test(plain)
  const fraction = /\?\/\?|#\/#/.test(plain)
  if (scientific || fraction || !/[0#]/.test(plain)) {
    try { return XLSX.SSF.format(code, number) } catch { return formatGeneral(number) }
  }
  const decimals = plain.match(/\.([0#?]+)/)?.[1] ?? ''
  const percent = plain.includes('%')
  const body = (percent ? number * 100 : number).toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: (decimals.match(/0/g) || []).length,
    maximumFractionDigits: decimals.length,
    // it-IT groups four-digit numbers only with minimumGroupingDigits off, which Excel always does.
    useGrouping: (plain.includes(',') ? 'always' : false) as unknown as boolean,
  })
  const symbol = section.match(/\[\$([^\]-]*)[^\]]*\]/)?.[1] || section.match(/[€$£]/)?.[0] || ''
  const leadingSymbol = symbol && section.search(/[€$£]|\[\$/) < section.search(/[0#]/)
  const parenthesised = number < 0 && code.includes(';') && /^\s*[^0#]*\(/.test(section)
  const magnitude = number < 0 && code.includes(';') ? body.replace('-', '') : body
  const text = `${leadingSymbol ? `${symbol} ` : ''}${magnitude}${percent ? '%' : ''}${symbol && !leadingSymbol ? ` ${symbol}` : ''}`
  return parenthesised ? `(${text})` : text
}

/** Number of decimals after pressing "more/fewer decimals" on a cell. */
export function stepDecimals(code: string | undefined, value: string, delta: number): string {
  if (isDateFormat(code) || code === TEXT_FORMAT) return code || GENERAL_FORMAT
  const current = !code || code === GENERAL_FORMAT
    ? (String(Number(value)).split('.')[1] || '').length
    : (code.match(/\.(0+)/)?.[1].length ?? 0)
  const next = Math.max(0, current + delta)
  const zeros = next ? `.${'0'.repeat(next)}` : ''
  if (!code || code === GENERAL_FORMAT) return `0${zeros}`
  return /\.0+/.test(code) ? code.replace(/\.0+/g, zeros) : code.replace(/0(?![0.])/, `0${zeros}`)
}

const CELL_REF = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\d(A-Za-z_])/g

export function columnName(index: number): string {
  let n = index
  let name = ''
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function columnIndex(name: string): number {
  return name.toUpperCase().split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

/** Relative references of a formula as if it moved by (rows, cols); strings and $-locked parts stay. */
export function shiftFormula(formula: string, rows: number, cols: number): string {
  if (!formula.startsWith('=')) return formula
  return formula.split(/("(?:[^"]|"")*")/).map((part, index) => index % 2 ? part : part.replace(CELL_REF, (match, lockCol: string, col: string, lockRow: string, row: string, offset: number, whole: string) => {
    if (offset > 0 && /[A-Za-z_.]/.test(whole[offset - 1])) return match
    const nextCol = lockCol ? columnIndex(col) : columnIndex(col) + cols
    const nextRow = lockRow ? Number(row) : Number(row) + rows
    if (nextCol < 0 || nextRow < 1) return '#REF!'
    return `${lockCol}${columnName(nextCol)}${lockRow}${nextRow}`
  })).join('')
}

/** A row changed place in a sort: references to its own cells follow it, references to other rows stay. */
export function rebaseRowFormula(formula: string, fromRow: number, toRow: number): string {
  if (!formula.startsWith('=') || fromRow === toRow) return formula
  return formula.split(/("(?:[^"]|"")*")/).map((part, index) => index % 2 ? part : part.replace(CELL_REF, (match, lockCol: string, col: string, lockRow: string, row: string, offset: number, whole: string) => {
    if (offset > 0 && /[A-Za-z_.]/.test(whole[offset - 1])) return match
    return !lockRow && Number(row) === fromRow + 1 ? `${lockCol}${col}${toRow + 1}` : match
  })).join('')
}

const SERIES_LISTS = [
  ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'],
  ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'],
  ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
]

function matchCase(word: string, model: string): string {
  if (model === model.toUpperCase()) return word.toUpperCase()
  return model[0] === model[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word
}

/** Values the fill handle writes after `source`. `index` counts from 1; `step` is the row/col distance
 * of the written cell from the source cell a formula is copied from. */
export function seriesValue(source: string[], index: number): string {
  const last = source[source.length - 1]
  const cycled = source[(index - 1) % source.length]
  if (source.every(isNumericText)) {
    if (source.length === 1) return source[0]
    const numbers = source.map(Number)
    const step = (numbers[numbers.length - 1] - numbers[0]) / (numbers.length - 1)
    return String(Number((numbers[numbers.length - 1] + step * index).toPrecision(15)))
  }
  const lower = source.map(value => value.toLowerCase())
  const list = SERIES_LISTS.find(items => lower.every(value => items.includes(value)))
  if (list) {
    const position = list.indexOf(lower[lower.length - 1])
    const step = source.length > 1 ? (list.indexOf(lower[1]) - list.indexOf(lower[0]) + list.length) % list.length : 1
    return matchCase(list[(position + step * index) % list.length], last)
  }
  const numbered = last.match(/^(.*?)(\d+)$/)
  if (numbered && source.every(value => value.startsWith(numbered[1]) && /^\d+$/.test(value.slice(numbered[1].length)))) {
    const first = Number(source[0].slice(numbered[1].length))
    const step = source.length > 1 ? (Number(numbered[2]) - first) / (source.length - 1) : 1
    return `${numbered[1]}${Number(numbered[2]) + step * index}`
  }
  return cycled
}

function formulaEngine(data: string[][]) {
  const clean = data.map(row => row.map(cell => cell.startsWith('=') ? cell : null))
  return HyperFormula.buildFromArray(clean, { licenseKey: 'gpl-v3' })
}

/** Runs a structural edit on a throw-away engine, which rewrites every formula reference, and lays the
 * rewritten formulas over the same edit done on the plain values. */
export function restructure(
  data: string[][],
  engineEdit: (engine: HyperFormula) => void,
  gridEdit: (grid: string[][]) => string[][],
): string[][] {
  const next = gridEdit(data.map(row => [...row]))
  if (!data.some(row => row.some(cell => cell.startsWith('=')))) return next
  const engine = formulaEngine(data)
  engineEdit(engine)
  const serialized = engine.getSheetSerialized(0)
  return next.map((row, rowIndex) => row.map((cell, colIndex) => {
    const formula = serialized[rowIndex]?.[colIndex]
    return typeof formula === 'string' && formula.startsWith('=') ? formula : cell
  }))
}

export function moveItems<T>(items: T[], from: number, count: number, target: number): T[] {
  const moved = items.slice(from, from + count)
  const rest = [...items.slice(0, from), ...items.slice(from + count)]
  const insertAt = target > from ? target - count : target
  return [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)]
}

/** Move `count` columns starting at `from` so they land before the column now at `target`. */
export function moveColumns(data: string[][], from: number, count: number, target: number): string[][] {
  return restructure(data, engine => engine.moveColumns(0, from, count, target), grid => grid.map(row => moveItems(row, from, count, target)))
}

export function moveRows(data: string[][], from: number, count: number, target: number): string[][] {
  return restructure(data, engine => engine.moveRows(0, from, count, target), grid => moveItems(grid, from, count, target))
}

/** Move a block of cells; formulas elsewhere that point at it follow, like cut and paste in Excel. */
export function moveCellBlock(data: string[][], range: SelectionRange, toRow: number, toCol: number): string[][] {
  return restructure(
    data,
    engine => engine.moveCells(
      { start: { sheet: 0, row: range.startRow, col: range.startCol }, end: { sheet: 0, row: range.endRow, col: range.endCol } },
      { sheet: 0, row: toRow, col: toCol },
    ),
    grid => {
      const block = grid.slice(range.startRow, range.endRow + 1).map(row => row.slice(range.startCol, range.endCol + 1))
      for (let row = range.startRow; row <= range.endRow; row += 1) for (let col = range.startCol; col <= range.endCol; col += 1) grid[row][col] = ''
      block.forEach((values, r) => values.forEach((value, c) => { grid[toRow + r][toCol + c] = value }))
      return grid
    },
  )
}

export function insertRows(data: string[][], at: number, count: number): string[][] {
  const cols = data[0]?.length || 1
  return restructure(data, engine => engine.addRows(0, [at, count]), grid => [...grid.slice(0, at), ...Array.from({ length: count }, () => Array<string>(cols).fill('')), ...grid.slice(at)])
}

export function deleteRows(data: string[][], at: number, count: number): string[][] {
  return restructure(data, engine => engine.removeRows(0, [at, count]), grid => [...grid.slice(0, at), ...grid.slice(at + count)])
}

export function insertColumns(data: string[][], at: number, count: number): string[][] {
  return restructure(data, engine => engine.addColumns(0, [at, count]), grid => grid.map(row => [...row.slice(0, at), ...Array<string>(count).fill(''), ...row.slice(at)]))
}

export function deleteColumns(data: string[][], at: number, count: number): string[][] {
  return restructure(data, engine => engine.removeColumns(0, [at, count]), grid => grid.map(row => [...row.slice(0, at), ...row.slice(at + count)]))
}

/** Re-keys "row:col" styles after rows/columns moved; a null mapping drops the cell. */
export function remapStyles<T>(styles: Record<string, T>, mapRow: (row: number) => number | null, mapCol: (col: number) => number | null): Record<string, T> {
  const next: Record<string, T> = {}
  Object.entries(styles).forEach(([key, style]) => {
    const [row, col] = key.split(':').map(Number)
    const nextRow = mapRow(row)
    const nextCol = mapCol(col)
    if (nextRow !== null && nextCol !== null) next[`${nextRow}:${nextCol}`] = style
  })
  return next
}

export function positionAfterMove(index: number, from: number, count: number, target: number): number {
  const positions = moveItems(Array.from({ length: Math.max(index, from + count, target) + 1 }, (_, i) => i), from, count, target)
  return positions.indexOf(index)
}

export function compareCells(a: string, b: string): number {
  const aEmpty = a === ''
  const bEmpty = b === ''
  if (aEmpty || bEmpty) return Number(aEmpty) - Number(bEmpty)
  const aNumeric = isNumericText(a)
  const bNumeric = isNumericText(b)
  if (aNumeric && bNumeric) return Number(a) - Number(b)
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a.localeCompare(b, NUMBER_LOCALE, { sensitivity: 'base', numeric: true })
}

/** Last row holding anything, the end of the range filters and sorts act on. */
export function lastDataRow(data: string[][]): number {
  for (let row = data.length - 1; row >= 0; row -= 1) if (data[row].some(cell => cell !== '')) return row
  return -1
}

/** Rows hidden by column filters. `allowed` maps a column to the set of shown (displayed) values. */
export function hiddenRowSet(display: string[][], headerRow: number, allowed: Record<number, Set<string>>): Set<number> {
  const hidden = new Set<number>()
  const columns = Object.entries(allowed)
  if (!columns.length) return hidden
  const last = lastDataRow(display)
  for (let row = headerRow + 1; row <= last; row += 1) {
    if (columns.some(([col, values]) => !values.has(display[row]?.[Number(col)] ?? ''))) hidden.add(row)
  }
  return hidden
}

export function rangeSize(range: SelectionRange) {
  return { rows: range.endRow - range.startRow + 1, cols: range.endCol - range.startCol + 1 }
}
