import { useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { ListTree, PanelLeftClose } from '@/components/icons'
import { tl } from '@/i18n/tl'

type Heading = { pos: number; level: number; text: string }

const STORAGE_KEY = 'document_outline_open'

const readOpen = () => {
  try { return localStorage.getItem(STORAGE_KEY) !== '0' } catch { return true }
}

/**
 * Chapter map of the word-processor document: a side column to the left of the canvas (it never covers the
 * sheet), listing the headings (H1–H3). The section being read is highlighted; a click scrolls to it.
 * Collapses to a thin rail; hidden below the lg breakpoint where there is no room beside the sheet.
 */
export default function DocumentOutline({ editor, scrollRef }: { editor: Editor | null; scrollRef: RefObject<HTMLElement> }) {
  const [open, setOpen] = useState(readOpen)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0') } catch { /* per-viewer convenience only */ }
  }, [open])

  // Headings follow the document as it changes.
  useEffect(() => {
    if (!editor) return
    let timer = 0
    const collect = () => {
      const next: Heading[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          const level = Number(node.attrs.level) || 1
          const text = node.textContent.trim()
          if (level <= 3 && text) next.push({ pos, level, text })
          return false
        }
        return node.type.name !== 'paragraph'
      })
      setHeadings(next)
    }
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(collect, 250) }
    collect()
    editor.on('update', schedule)
    return () => { editor.off('update', schedule); window.clearTimeout(timer) }
  }, [editor])

  // Active section: the last heading above the upper third of the viewport.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!editor || !scroller || !open || headings.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3
      let current: number | null = null
      for (const heading of headings) {
        const dom = editor.view.nodeDOM(heading.pos) as HTMLElement | null
        if (!dom?.getBoundingClientRect) continue
        if (dom.getBoundingClientRect().top <= line) current = heading.pos
        else break
      }
      setActive(current ?? headings[0].pos)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => { scroller.removeEventListener('scroll', schedule); if (frame) cancelAnimationFrame(frame) }
  }, [editor, scrollRef, open, headings])

  if (!editor) return null

  const go = (heading: Heading) => {
    const dom = editor.view.nodeDOM(heading.pos) as HTMLElement | null
    dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    editor.chain().setTextSelection(heading.pos + 1).focus(undefined, { scrollIntoView: false }).run()
    setActive(heading.pos)
  }

  if (!open) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col items-center border-r border-[var(--border-subtle)] bg-slate-100 pt-3 lg:flex" aria-label={tl("Mappa dei capitoli")}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--control-radius)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--ds-control-hover)] hover:text-[var(--text-primary)]"
          title={tl("Mostra la mappa dei capitoli")}
          aria-label={tl("Mostra la mappa dei capitoli")}
        >
          <ListTree className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      aria-label={tl("Mappa dei capitoli")}
      className="hidden w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-slate-100 lg:flex xl:w-64"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pl-4 pr-2">
        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{tl("Indice")}</span>
        <button type="button" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-[var(--control-radius)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--ds-control-hover)]" title={tl("Nascondi la mappa")} aria-label={tl("Nascondi la mappa")}>
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {headings.length === 0 ? (
          <p className="px-2 text-[11px] leading-4 text-[var(--text-secondary)]">{tl("Nessun titolo ancora: usa Titolo 1, 2 o 3 per vedere qui la struttura del documento.")}</p>
        ) : headings.map((heading) => (
          <button
            key={heading.pos}
            type="button"
            onClick={() => go(heading)}
            aria-current={active === heading.pos ? 'location' : undefined}
            className={`flex min-h-9 w-full items-center rounded-[var(--control-radius)] py-1.5 pr-3 text-left text-xs leading-4 transition-colors ${active === heading.pos ? 'ds-selected font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--ds-control-hover)] hover:text-[var(--text-primary)]'} ${heading.level === 1 && active !== heading.pos ? 'font-semibold' : ''}`}
            style={{ paddingLeft: 12 + (heading.level - 1) * 14 }}
            title={heading.text}
          >
            <span className="line-clamp-2">{heading.text}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
