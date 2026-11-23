import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from '@/components/icons'
import { tl } from '@/i18n/tl'
import { shadeTopFor, shapeStrokeFor } from './canvasColors'

export const HAND_FONT = "'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive"
export const BOARD_COLORS = ['#fef9c3', '#dbeafe', '#dcfce7', '#fce7f3', '#ffedd5', '#ede9fe', '#e0f2fe', '#fecaca']

export type BoardColumn = { id: string; title: string; color: string }
export type BoardCard = { id: string; col: string; text: string }
export type BoardData = { title?: string; columns: BoardColumn[]; cards: BoardCard[] }

const rid = () => crypto.randomUUID().slice(0, 8)

export function newBoardData(): BoardData {
  const cols: BoardColumn[] = [tl("Da fare"), tl("In corso"), tl("Fatto")].map((title, i) => ({ id: rid(), title, color: BOARD_COLORS[[0, 1, 2][i]] }))
  return { title: tl("Tabella"), columns: cols, cards: [] }
}

/** Where a card lands: before `beforeId` in column `col` (or at the end). Pure, so it can be tested. */
export function moveCard(cards: BoardCard[], cardId: string, col: string, beforeId?: string | null): BoardCard[] {
  const card = cards.find((c) => c.id === cardId)
  if (!card) return cards
  const rest = cards.filter((c) => c.id !== cardId)
  const moved = { ...card, col }
  const at = beforeId ? rest.findIndex((c) => c.id === beforeId) : -1
  if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)]
  // end of the column: after its last card, keeping the global order of the others
  const last = rest.map((c, i) => (c.col === col ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
  return last >= 0 ? [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)] : [...rest, moved]
}

/** Removing a column keeps its cards: they join the neighbour on the left (or the right when it was the first). */
export function removeColumn(data: BoardData, colId: string): BoardData {
  if (data.columns.length <= 1) return data
  const index = data.columns.findIndex((c) => c.id === colId)
  const heir = data.columns[index > 0 ? index - 1 : 1]
  return { ...data, columns: data.columns.filter((c) => c.id !== colId), cards: data.cards.map((c) => (c.col === colId ? { ...c, col: heir.id } : c)) }
}

function AutoTextarea({ value, onChange, disabled, autoFocus, ...rest }: { value: string; onChange: (v: string) => void; disabled?: boolean; autoFocus?: boolean } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const el = ref.current; if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px` } }, [value])
  return <textarea ref={ref} rows={1} value={value} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} {...rest} />
}

let draggedCard: string | null = null

/**
 * A table that works as a board: editable column headers, any number of columns, and sticky-note cards that stay
 * tidy (same width, same spacing, tinted by column). Everything lives inside one canvas item.
 */
export function CanvasBoardTable({ data, canEdit, onChange, onFocusEdit, onBlurEdit, onWiden }: {
  data: BoardData
  canEdit: boolean
  onChange: (next: BoardData) => void
  onFocusEdit: () => void
  onBlurEdit: () => void
  /** The item grows/shrinks with its columns: called with the new column count. */
  onWiden: (columns: number) => void
}) {
  const { columns, cards } = data
  const set = (patch: Partial<BoardData>) => onChange({ ...data, ...patch })
  const focusNext = useRef<string | null>(null)
  useEffect(() => { focusNext.current = null })
  const addCard = (col: string) => { const id = rid(); focusNext.current = id; set({ cards: [...cards, { id, col, text: '' }] }) }
  const addColumn = () => { set({ columns: [...columns, { id: rid(), title: `${tl("Colonna")} ${columns.length + 1}`, color: BOARD_COLORS[columns.length % BOARD_COLORS.length] }] }); onWiden(columns.length + 1) }
  const dropOn = (col: string, beforeId: string | null) => { if (draggedCard) set({ cards: moveCard(cards, draggedCard, col, beforeId) }); draggedCard = null }
  const shift = (card: BoardCard, dir: -1 | 1) => { const i = columns.findIndex((c) => c.id === card.col) + dir; if (columns[i]) set({ cards: moveCard(cards, card.id, columns[i].id) }) }
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-sm" data-board-ctl onDragOver={stop} onDrop={stop} style={{ boxShadow: '0 1px 0 rgba(15,23,42,.04), 0 6px 18px -10px rgba(15,23,42,.35)' }}>
      <div className="flex shrink-0 cursor-grab items-center gap-2 px-3 pb-1 pt-2.5 active:cursor-grabbing">
        <input value={data.title || ''} disabled={!canEdit} onChange={(e) => set({ title: e.target.value })} onFocus={onFocusEdit} onBlur={onBlurEdit} placeholder={tl("Titolo della tabella")}
          aria-label={tl("Titolo della tabella")} className="min-w-0 flex-1 cursor-text bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400" />
        {canEdit && (
          <button type="button" onClick={addColumn} className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-100">
            <Plus className="h-3 w-3" />{tl("Colonna")}
          </button>
        )}
      </div>
      <div className="grid min-h-0 flex-1 gap-2.5 overflow-auto px-2.5 pb-2.5 pt-1" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(150px, 1fr))` }}>
        {columns.map((col) => {
          const mine = cards.filter((c) => c.col === col.id)
          const ink = shapeStrokeFor(col.color)
          return (
            <section key={col.id} className="flex min-h-0 flex-col gap-2 rounded-xl p-2" style={{ background: `${col.color}88` }}
              onDragOver={(e) => { if (draggedCard) { e.preventDefault(); e.stopPropagation() } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOn(col.id, null) }}>
              <header className="flex items-center gap-1.5">
                <input value={col.title} disabled={!canEdit} onChange={(e) => set({ columns: columns.map((c) => (c.id === col.id ? { ...c, title: e.target.value } : c)) })} onFocus={onFocusEdit} onBlur={onBlurEdit}
                  aria-label={tl("Intestazione della colonna")} className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none" style={{ color: '#1e293b' }} />
                <span className="rounded-full bg-white/70 px-1.5 text-[11px] font-semibold text-slate-600">{mine.length}</span>
                {canEdit && columns.length > 1 && (
                  <button type="button" aria-label={tl("Elimina colonna")} title={tl("Elimina colonna (le schede passano alla colonna accanto)")} onClick={() => { onChange(removeColumn(data, col.id)); onWiden(columns.length - 1) }} className="rounded-full p-0.5 text-slate-500 hover:bg-white/80 hover:text-slate-800"><X className="h-3 w-3" /></button>
                )}
              </header>
              {mine.map((card) => (
                <div key={card.id} className="group relative rounded-lg px-2.5 py-2 text-slate-800"
                  style={{ background: `linear-gradient(180deg, ${shadeTopFor(col.color, 0.55)} 0%, ${col.color} 100%)`, boxShadow: `inset 0 0 0 1px ${ink}33, 0 2px 5px -2px ${ink}55` }}
                  onDragOver={(e) => { if (draggedCard && draggedCard !== card.id) { e.preventDefault(); e.stopPropagation() } }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOn(col.id, card.id) }}>
                  <AutoTextarea value={card.text} disabled={!canEdit} autoFocus={focusNext.current === card.id}
                    onChange={(text) => set({ cards: cards.map((c) => (c.id === card.id ? { ...c, text } : c)) })} onFocus={onFocusEdit} onBlur={onBlurEdit} placeholder={tl("Scrivi qui…")}
                    aria-label={tl("Testo della scheda")} className="block w-full resize-none overflow-hidden bg-transparent text-[16px] leading-[1.25] outline-none placeholder:text-slate-400" style={{ fontFamily: HAND_FONT, fontStyle: 'italic' }} />
                  {canEdit && (
                    <div className="absolute -top-2 right-1 hidden items-center gap-0.5 rounded-full bg-white px-1 py-0.5 shadow group-hover:flex group-focus-within:flex">
                      <span draggable title={tl("Trascina per spostare")} onDragStart={(e) => { draggedCard = card.id; e.dataTransfer.setData('application/x-board-card', card.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { draggedCard = null }}
                        className="cursor-grab select-none px-1 text-[13px] leading-none text-slate-500 active:cursor-grabbing">⠿</span>
                      <button type="button" aria-label={tl("Sposta a sinistra")} onClick={() => shift(card, -1)} className="rounded-full p-0.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-3 w-3" /></button>
                      <button type="button" aria-label={tl("Sposta a destra")} onClick={() => shift(card, 1)} className="rounded-full p-0.5 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-3 w-3" /></button>
                      <button type="button" aria-label={tl("Elimina scheda")} onClick={() => set({ cards: cards.filter((c) => c.id !== card.id) })} className="rounded-full p-0.5 text-slate-500 hover:bg-slate-100"><X className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              ))}
              {canEdit && (
                <button type="button" onClick={() => addCard(col.id)} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-white/60">
                  <Plus className="h-3.5 w-3.5" />{tl("Scheda")}
                </button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
