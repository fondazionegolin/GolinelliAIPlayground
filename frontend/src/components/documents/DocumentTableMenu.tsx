import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, Combine, PaintBucket,
  Rows3, SplitSquareHorizontal, Table2, Trash2,
} from '@/components/icons'

const GRID = 8

/**
 * Table tool for the document toolbar: a size picker to insert a table and, while the caret is in a
 * table, the structural commands (rows, columns, merge/split, header row, cell colour, delete).
 */
export function DocumentTableMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<{ rows: number; cols: number }>({ rows: 0, cols: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const inTable = editor.isActive('table')

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    command(editor.chain().focus()).run()
  }

  const actions: Array<{ label: string; icon: typeof Rows3; onClick: () => void; enabled: boolean; danger?: boolean }> = [
    { label: 'Riga sopra', icon: ArrowUpToLine, onClick: () => run(c => c.addRowBefore()), enabled: editor.can().addRowBefore() },
    { label: 'Riga sotto', icon: ArrowDownToLine, onClick: () => run(c => c.addRowAfter()), enabled: editor.can().addRowAfter() },
    { label: 'Colonna a sinistra', icon: ArrowLeftToLine, onClick: () => run(c => c.addColumnBefore()), enabled: editor.can().addColumnBefore() },
    { label: 'Colonna a destra', icon: ArrowRightToLine, onClick: () => run(c => c.addColumnAfter()), enabled: editor.can().addColumnAfter() },
    { label: 'Unisci celle', icon: Combine, onClick: () => run(c => c.mergeCells()), enabled: editor.can().mergeCells() },
    { label: 'Dividi cella', icon: SplitSquareHorizontal, onClick: () => run(c => c.splitCell()), enabled: editor.can().splitCell() },
    { label: 'Riga di intestazione', icon: Rows3, onClick: () => run(c => c.toggleHeaderRow()), enabled: editor.can().toggleHeaderRow() },
    { label: 'Elimina riga', icon: Trash2, onClick: () => run(c => c.deleteRow()), enabled: editor.can().deleteRow(), danger: true },
    { label: 'Elimina colonna', icon: Columns3, onClick: () => run(c => c.deleteColumn()), enabled: editor.can().deleteColumn(), danger: true },
    { label: 'Elimina tabella', icon: Table2, onClick: () => { run(c => c.deleteTable()); setOpen(false) }, enabled: editor.can().deleteTable(), danger: true },
  ]

  const cellColor = (editor.getAttributes('tableCell').backgroundColor || editor.getAttributes('tableHeader').backgroundColor || '#ffffff') as string

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${open || inTable ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}
        title="Tabella"
        aria-label="Tabella"
        aria-expanded={open}
      >
        <Table2 className="h-4 w-4" />
      </button>
      {open && (
        <div className="ds-popover absolute left-0 top-full z-50 mt-2 w-[248px] rounded-2xl p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {hover.rows ? `Inserisci ${hover.rows} × ${hover.cols}` : 'Inserisci tabella'}
          </p>
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }} onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
            {Array.from({ length: GRID * GRID }, (_, index) => {
              const row = Math.floor(index / GRID) + 1
              const col = (index % GRID) + 1
              const active = row <= hover.rows && col <= hover.cols
              return (
                <button
                  key={index}
                  type="button"
                  aria-label={`${row} righe per ${col} colonne`}
                  onMouseEnter={() => setHover({ rows: row, cols: col })}
                  onClick={() => {
                    editor.chain().focus().insertTable({ rows: row, cols: col, withHeaderRow: true }).run()
                    setOpen(false)
                  }}
                  className={`aspect-square rounded-[3px] border transition-colors ${active ? 'border-[var(--logo-violet)] bg-[var(--logo-violet-22)]' : 'border-slate-200 bg-slate-50'}`}
                />
              )
            })}
          </div>

          {inTable && (
            <>
              <div className="ds-divider my-3 h-px" />
              <div className="grid grid-cols-2 gap-1">
                {actions.map(({ label, icon: Icon, onClick, enabled, danger }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!enabled}
                    onClick={onClick}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-[var(--ds-control-hover)]'}`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-[var(--ds-control-hover)]">
                  <PaintBucket className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">Colore cella</span>
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(cellColor) ? cellColor : '#ffffff'}
                    onChange={event => run(c => c.setCellAttribute('backgroundColor', event.target.value))}
                    className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
