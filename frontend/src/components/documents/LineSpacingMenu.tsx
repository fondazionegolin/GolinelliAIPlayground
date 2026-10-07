import { useEffect, useRef, useState } from 'react'
import { AlignVerticalSpaceAround, Check } from '@/components/icons'
import type { Editor } from '@tiptap/core'
import { applyFormatOperations } from '@/lib/documentFormatOps'

const LINE_HEIGHTS: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'Predefinita' },
  { value: 1, label: '1,0' },
  { value: 1.15, label: '1,15' },
  { value: 1.5, label: '1,5' },
  { value: 2, label: '2,0' },
  { value: 2.5, label: '2,5' },
  { value: 3, label: '3,0' },
]
// Space before/after a paragraph, in points (stored as CSS px: 1 pt = 4/3 px).
const SPACES = [0, 6, 12, 18, 24]
const PT = 4 / 3

const parseNumber = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number.parseFloat(String(value)))

/**
 * Line spacing and paragraph spacing, Word-style: applies to the selected paragraphs (or the one with
 * the caret), or to the whole document. Values are shown for the paragraph at the caret.
 */
export function LineSpacingMenu({ editor, isEnglish }: { editor: Editor; isEnglish?: boolean }) {
  const t = (it: string, en: string) => (isEnglish ? en : it)
  const [open, setOpen] = useState(false)
  const [wholeDocument, setWholeDocument] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [, force] = useState(0)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    const refresh = () => force((value) => value + 1)
    document.addEventListener('mousedown', close)
    editor.on('selectionUpdate', refresh)
    editor.on('transaction', refresh)
    return () => {
      document.removeEventListener('mousedown', close)
      editor.off('selectionUpdate', refresh)
      editor.off('transaction', refresh)
    }
  }, [open, editor])

  const $from = editor.state.selection.$from
  const block = $from.parent
  const currentLine = parseNumber(block.attrs.lineHeight)
  const currentBefore = parseNumber(block.attrs.spaceBefore)
  const currentAfter = parseNumber(block.attrs.spaceAfter)

  const apply = (changes: { line_height?: number | null; space_before_px?: number | null; space_after_px?: number | null }) => {
    const { from, to } = editor.state.selection
    applyFormatOperations(editor, [{ op: 'paragraph_format', target: 'all', ...changes }], wholeDocument ? null : { from, to })
    editor.view.focus()
  }
  const sameSpace = (current: number | null, pt: number) => Math.abs((current ?? 0) - pt * PT) < 0.6
  const row = (active: boolean) => `flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-slate-100 ${active ? 'font-bold text-violet-700' : 'text-slate-700'}`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 ${open ? 'bg-slate-200' : ''}`}
        title={t('Interlinea e spaziatura paragrafi', 'Line and paragraph spacing')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <AlignVerticalSpaceAround className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-60 space-y-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" onMouseDown={(event) => event.preventDefault()}>
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold">
            <button type="button" className={`rounded-md py-1 ${!wholeDocument ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`} onClick={() => setWholeDocument(false)}>{t('Selezione', 'Selection')}</button>
            <button type="button" className={`rounded-md py-1 ${wholeDocument ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`} onClick={() => setWholeDocument(true)}>{t('Tutto il documento', 'Whole document')}</button>
          </div>
          <div>
            <p className="px-2.5 pb-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">{t('Interlinea', 'Line spacing')}</p>
            {LINE_HEIGHTS.map(({ value, label }) => {
              const active = value === null ? currentLine === null : currentLine !== null && Math.abs(currentLine - value) < 0.001
              return (
                <button key={label} type="button" className={row(active)} onClick={() => apply({ line_height: value })}>
                  <span>{value === null ? t('Predefinita', 'Default') : label}</span>{active && <Check className="h-3.5 w-3.5" />}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([['space_before_px', t('Spazio prima', 'Before'), currentBefore], ['space_after_px', t('Spazio dopo', 'After'), currentAfter]] as const).map(([key, label, current]) => (
              <div key={key}>
                <p className="px-2.5 pb-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
                {SPACES.map((pt) => (
                  <button key={pt} type="button" className={row(sameSpace(current, pt))} onClick={() => apply({ [key]: pt === 0 ? null : Math.round(pt * PT) })}>
                    <span>{pt} pt</span>{sameSpace(current, pt) && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
