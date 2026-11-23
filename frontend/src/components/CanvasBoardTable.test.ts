import { describe, expect, it } from 'vitest'
import { moveCard, removeColumn, type BoardData } from './CanvasBoardTable'

const cards = [{ id: 'a', col: '1', text: 'a' }, { id: 'b', col: '1', text: 'b' }, { id: 'c', col: '2', text: 'c' }]
describe('board table', () => {
  it('moves a card before another one, across columns', () => {
    expect(moveCard(cards, 'c', '1', 'a').map((c) => `${c.id}${c.col}`)).toEqual(['c1', 'a1', 'b1'])
  })
  it('appends to the end of a column', () => {
    expect(moveCard(cards, 'a', '2').map((c) => `${c.id}${c.col}`)).toEqual(['b1', 'c2', 'a2'])
    expect(moveCard(cards, 'a', '3').map((c) => c.col).at(-1)).toBe('3')
  })
  it('keeps the cards of a removed column', () => {
    const data: BoardData = { columns: [{ id: '1', title: 'x', color: '#fff' }, { id: '2', title: 'y', color: '#fff' }], cards }
    expect(removeColumn(data, '2').cards.every((c) => c.col === '1')).toBe(true)
    expect(removeColumn(removeColumn(data, '2'), '1').columns).toHaveLength(1)
  })
})
