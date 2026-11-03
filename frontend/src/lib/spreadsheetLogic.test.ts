import { describe, expect, it } from 'vitest'
import {
  CURRENCY_FORMAT, compareCells, dateToSerial, deleteRows, formatCellValue, hiddenRowSet, insertRows, moveCellBlock, moveColumns, moveItems, moveRows,
  parseCellInput, parseLocaleNumber, positionAfterMove, rebaseRowFormula, seriesValue, shiftFormula, stepDecimals,
} from './spreadsheetLogic'

describe('numbers as people write them', () => {
  it.each([['12,5', 12.5], ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['1.234', 1.234], ['1.234.567', 1234567], ['-3', -3], ['1e3', 1000]])('%s', (text, value) => {
    expect(parseLocaleNumber(text)).toBe(value)
  })
  it('leaves words alone', () => {
    expect(parseLocaleNumber('12 mesi')).toBeNull()
    expect(parseLocaleNumber('A1')).toBeNull()
  })
})

describe('input parsing', () => {
  it('keeps the format the input implies', () => {
    expect(parseCellInput('25%')).toEqual({ value: '0.25', numberFormat: '0%' })
    expect(parseCellInput('12,50 €')).toEqual({ value: '12.5', numberFormat: CURRENCY_FORMAT })
    expect(parseCellInput('31/12/2024').numberFormat).toBe('dd/mm/yyyy')
    expect(parseCellInput('31/12/2024').value).toBe(String(dateToSerial(2024, 12, 31)))
  })
  it('does not touch formulas, codes with leading zeros, text cells or impossible dates', () => {
    expect(parseCellInput('=A1*2').value).toBe('=A1*2')
    expect(parseCellInput('00123').value).toBe('00123')
    expect(parseCellInput('12,5', '@').value).toBe('12,5')
    expect(parseCellInput('31/02/2024').value).toBe('31/02/2024')
  })
})

describe('display formats', () => {
  it.each([
    ['1234.5', undefined, '1234,5'],
    ['0.30000000000000004', undefined, '0,3'],
    ['1234.5', '#,##0.00', '1.234,50'],
    ['0.256', '0.0%', '25,6%'],
    ['0.5', '0%', '50%'],
    ['1234.5', CURRENCY_FORMAT, '1.234,50 €'],
    ['1234.5', '[$€-410] #,##0.00', '€ 1.234,50'],
    ['45657', 'dd/mm/yyyy', '31/12/2024'],
    ['testo', '0.00', 'testo'],
  ])('%s as %s', (value, code, expected) => {
    expect(formatCellValue(value, code).replace(/ /g, ' ')).toBe(expected)
  })
  it('steps decimals', () => {
    expect(stepDecimals(undefined, '1.5', 1)).toBe('0.00')
    expect(stepDecimals('0.00', '1', -1)).toBe('0.0')
    expect(stepDecimals('0.0', '1', -1)).toBe('0')
    expect(stepDecimals('#,##0', '1', 1)).toBe('#,##0.0')
  })
})

describe('formula shifting', () => {
  it('moves relative references and respects $', () => {
    expect(shiftFormula('=A1+$B2+C$3+$D$4', 1, 1)).toBe('=B2+$B3+D$3+$D$4')
    expect(shiftFormula('=SUM(A1:A3)', 2, 0)).toBe('=SUM(A3:A5)')
  })
  it('ignores strings and function names', () => {
    expect(shiftFormula('=LOG10(A1)&"A1"', 1, 0)).toBe('=LOG10(A2)&"A1"')
  })
  it('flags references pushed off the sheet', () => {
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!')
  })
})

describe('sorting formulas', () => {
  it('moves own-row references and leaves ranges alone', () => {
    expect(rebaseRowFormula('=C4*2+SUM(C2:C9)', 3, 1)).toBe('=C2*2+SUM(C2:C9)')
  })
})

describe('fill series', () => {
  it('continues numbers, labels and lists', () => {
    expect(seriesValue(['1', '3'], 1)).toBe('5')
    expect(seriesValue(['Lezione 1'], 2)).toBe('Lezione 3')
    expect(seriesValue(['Lunedì'], 1)).toBe('Martedì')
    expect(seriesValue(['dicembre'], 1)).toBe('gennaio')
  })
  it('repeats single numbers and plain text', () => {
    expect(seriesValue(['7'], 3)).toBe('7')
    expect(seriesValue(['a', 'b'], 3)).toBe('a')
  })
})

describe('structural edits rewrite formulas', () => {
  const grid = [['1', '2', '=A1+B1'], ['3', '4', '=SUM(A1:A2)']]
  it('moves a column', () => {
    const moved = moveColumns(grid, 0, 1, 2)
    expect(moved[0]).toEqual(['2', '1', '=B1+A1'])
  })
  it('moves a row', () => {
    const moved = moveRows([['1', '=A1*2'], ['5', '']], 1, 1, 0)
    expect(moved[0]).toEqual(['5', ''])
    expect(moved[1]).toEqual(['1', '=A2*2'])
  })
  it('adjusts on insert and delete', () => {
    expect(insertRows(grid, 0, 1)[1][2]).toBe('=A2+B2')
    expect(deleteRows([['x', ''], ['1', '=A2']], 0, 1)).toEqual([['1', '=A1']])
  })
  it('keeps values that a formula engine would reinterpret', () => {
    expect(moveColumns([['007', '31/12/2024', '=1+1']], 0, 1, 2)[0]).toEqual(['31/12/2024', '007', '=1+1'])
  })
  it('moves a block and retargets formulas that point at it', () => {
    const moved = moveCellBlock([['5', '', '=A1*2']], { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }, 0, 1)
    expect(moved[0]).toEqual(['', '5', '=B1*2'])
  })
  it('computes positions', () => {
    expect(moveItems(['a', 'b', 'c', 'd'], 0, 2, 3)).toEqual(['c', 'a', 'b', 'd'])
    expect(positionAfterMove(0, 0, 2, 3)).toBe(1)
    expect(positionAfterMove(2, 0, 2, 3)).toBe(0)
  })
})

describe('filter and sort', () => {
  it('hides only rows under the header and inside the data', () => {
    const display = [['Nome', 'Classe'], ['Ada', '1A'], ['Bea', '2B'], ['', '']]
    expect([...hiddenRowSet(display, 0, { 1: new Set(['1A']) })]).toEqual([2])
  })
  it('sorts numbers before text and blanks last', () => {
    expect(['b', '', '10', '9', 'a'].sort(compareCells)).toEqual(['9', '10', 'a', 'b', ''])
  })
})
