import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { documentUsableHeight } from '@/lib/documentPage'

/**
 * Word-processor pagination on a baseline grid.
 *
 * Coordinates are CSS px from the top of the editor root, which sits at the top of the writing area of
 * page 0; page k's writing area starts at k × (pageHeight + pageGap). Each page holds a whole number of
 * rows, every block starts on a row, and the content that opens a page lands exactly on its first row.
 *
 * The layout is measured without any pagination widget (the "natural" flow), the breaks are computed in
 * one sequential pass, and after rendering a verification pass corrects every widget to the pixel, so
 * nothing drifts even after hundreds of pages. Any layout change (text, fonts, images, line spacing,
 * ruling, margins, width) triggers a fresh pass.
 */
export interface PaginationOptions {
  pageHeight: number
  pageGap: number
  marginTop: number
  marginBottom: number
  /** Baseline grid row in px. */
  row: number
  onPageCountChange?: (pageCount: number) => void
}

type Spacer = {
  pos: number
  kind: 'page' | 'grid'
  /** Inside a paragraph (an inline-block line) rather than between top-level blocks. */
  inline: boolean
  height: number
  /** Where the content after the widget must start (editor root coordinates). */
  target: number
  hyphen: boolean
  blockIndex: number
  shiftBefore: number
  pageBefore: number
}

type Block = {
  pos: number
  top: number
  bottom: number
  marginBottom: number
  heading: boolean
  splittable: boolean
}

type Line = { pos: number; top: number; bottom: number }

type PaginationState = { decorations: DecorationSet; relayout: number }

export const paginationPluginKey = new PluginKey<PaginationState>('documentPagination')
const RELAYOUT_META = 'documentPaginationRelayout'
const EPS = 0.5

/** Ask the pagination to measure again (line spacing, ruling, margins… changed without a text change). */
export function requestPaginationRelayout(view: EditorView) {
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(RELAYOUT_META, true).setMeta('addToHistory', false))
}

const LETTER = /\p{L}/u

function widgetDom(spacer: Spacer): HTMLElement {
  const element = globalThis.document.createElement('span')
  element.className = spacer.kind === 'page' ? 'document-page-separator' : 'document-grid-spacer'
  if (spacer.inline) element.classList.add('is-inline')
  element.setAttribute('contenteditable', 'false')
  element.setAttribute('aria-hidden', 'true')
  element.style.height = `${spacer.height}px`
  ;(element as HTMLElement & { __spacer?: Spacer }).__spacer = spacer
  return element
}

function hyphenDom(): HTMLElement {
  const element = globalThis.document.createElement('span')
  element.className = 'document-page-hyphen'
  element.setAttribute('contenteditable', 'false')
  element.setAttribute('aria-hidden', 'true')
  element.textContent = '-'
  return element
}

function buildDecorations(state: EditorState, spacers: Spacer[]): DecorationSet {
  const decorations: Decoration[] = []
  spacers.forEach((spacer, index) => {
    const key = `${spacer.kind}-${index}-${spacer.pos}-${spacer.inline ? 'i' : 'b'}-${spacer.target}`
    if (spacer.hyphen) {
      decorations.push(Decoration.widget(spacer.pos, hyphenDom, { side: -2, key: `${key}-hyphen`, ignoreSelection: true }))
    }
    decorations.push(Decoration.widget(spacer.pos, () => widgetDom(spacer), { side: -1, key, ignoreSelection: true }))
  })
  return DecorationSet.create(state.doc, decorations)
}

/** Line boxes of a block, snapped to their element's line height (glyph boxes sit a few px lower). */
function measureLines(view: EditorView, dom: HTMLElement, rootTop: number, scale: number): Line[] {
  const boxes = new Map<Element, { contentTop: number; lineHeight: number } | null>()
  const boxOf = (node: Text) => {
    const element = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th') ?? dom
    if (!boxes.has(element)) {
      const style = getComputedStyle(element)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const rect = element.getBoundingClientRect()
      boxes.set(element, Number.isFinite(lineHeight) && lineHeight > 0
        ? { contentTop: (rect.top - rootTop) / scale + (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.borderTopWidth) || 0), lineHeight }
        : null)
    }
    return boxes.get(element) ?? null
  }

  const rows: Array<{ top: number; bottom: number; left: number; clientY: number }> = []
  const walker = globalThis.document.createTreeWalker(dom, NodeFilter.SHOW_TEXT)
  const range = globalThis.document.createRange()
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data.length || node.parentElement?.closest('[contenteditable="false"]')) continue
    const box = boxOf(node)
    range.selectNodeContents(node)
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height <= 0 || rect.width <= 0) continue
      const glyphTop = (rect.top - rootTop) / scale
      const glyphBottom = (rect.bottom - rootTop) / scale
      let top = glyphTop
      let bottom = glyphBottom
      if (box && glyphBottom - glyphTop <= box.lineHeight + 1) {
        top = box.contentTop + Math.floor((glyphTop - box.contentTop + 1) / box.lineHeight) * box.lineHeight
        bottom = top + box.lineHeight
      }
      const existing = rows.find((row) => Math.abs(row.top - top) <= 1)
      if (existing) {
        if (rect.left < existing.left) { existing.left = rect.left; existing.clientY = rect.top + rect.height / 2 }
        existing.bottom = Math.max(existing.bottom, bottom)
      } else {
        rows.push({ top, bottom, left: rect.left, clientY: rect.top + rect.height / 2 })
      }
    }
  }
  rows.sort((a, b) => a.top - b.top)
  const lines: Line[] = []
  for (const row of rows) {
    const hit = view.posAtCoords({ left: row.left + 1, top: row.clientY })
    if (!hit) continue
    if (lines.length && hit.pos <= lines[lines.length - 1].pos) continue
    lines.push({ pos: hit.pos, top: row.top, bottom: row.bottom })
  }
  return lines
}

function computeSpacers(view: EditorView, options: PaginationOptions): { spacers: Spacer[]; pageCount: number } {
  const root = view.dom as HTMLElement
  const rootRect = root.getBoundingClientRect()
  const scale = root.clientWidth > 0 ? rootRect.width / root.clientWidth : 1
  const row = Math.max(1, options.row)
  const stride = options.pageHeight + options.pageGap
  const usable = documentUsableHeight(options.pageHeight, options.marginTop, options.marginBottom, row)

  const blocks: Block[] = []
  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null
    if (!dom?.getBoundingClientRect) return
    const rect = dom.getBoundingClientRect()
    const tag = dom.tagName?.toLowerCase() || ''
    const keepTogether = ['table', 'pre', 'blockquote', 'figure', 'hr'].includes(tag) || Boolean(dom.querySelector('table, pre, .katex-display'))
    const heading = /^h[1-6]$/.test(tag)
    blocks.push({
      pos: offset,
      top: (rect.top - rootRect.top) / scale,
      bottom: (rect.bottom - rootRect.top) / scale,
      marginBottom: Number.parseFloat(getComputedStyle(dom).marginBottom) || 0,
      heading,
      splittable: !keepTogether && !heading,
    })
  })

  const spacers: Spacer[] = []
  const displayTop: number[] = []
  let shift = 0
  let page = 0
  const pageTop = () => page * stride
  const pageEnd = () => page * stride + usable
  const snap = (y: number) => {
    const base = pageTop()
    return base + Math.ceil((y - base) / row - 1e-3) * row
  }
  const anchorOf = (index: number) => (index > 0 ? blocks[index - 1].bottom + blocks[index - 1].marginBottom : 0) + shift

  const pushGrid = (index: number, target: number) => {
    const anchor = anchorOf(index)
    spacers.push({ pos: blocks[index].pos, kind: 'grid', inline: false, height: Math.max(0, target - anchor), target, hyphen: false, blockIndex: index, shiftBefore: shift, pageBefore: page })
    shift = target - blocks[index].top
  }

  const breakBefore = (startIndex: number) => {
    let index = startIndex
    // A heading never ends a page: it moves with the block that follows (unless it opens the page itself).
    while (index > 0 && blocks[index - 1].heading && displayTop[index - 1] > pageTop() + EPS && displayTop[index - 1] < pageEnd()) {
      index -= 1
      while (spacers.length && spacers[spacers.length - 1].blockIndex >= index && spacers[spacers.length - 1].kind === 'grid') {
        const removed = spacers.pop()!
        shift = removed.shiftBefore
      }
    }
    const anchor = anchorOf(index)
    let targetPage = page + 1
    if (anchor > targetPage * stride) targetPage = Math.ceil(anchor / stride)
    const target = targetPage * stride
    spacers.push({ pos: blocks[index].pos, kind: 'page', inline: false, height: Math.max(0, target - anchor), target, hyphen: false, blockIndex: index, shiftBefore: shift, pageBefore: page })
    shift = target - blocks[index].top
    page = targetPage
    return index
  }

  const doc = view.state.doc
  const splitAt = (index: number, line: Line) => {
    const lineTop = line.top + shift
    const target = (page + 1) * stride
    const before = line.pos > 1 ? doc.textBetween(line.pos - 1, line.pos) : ''
    const after = line.pos < doc.content.size ? doc.textBetween(line.pos, Math.min(doc.content.size, line.pos + 1)) : ''
    spacers.push({
      pos: line.pos, kind: 'page', inline: true, height: Math.max(0, target - lineTop), target,
      hyphen: LETTER.test(before) && LETTER.test(after), blockIndex: index, shiftBefore: shift, pageBefore: page,
    })
    shift = target - line.top
    page += 1
  }

  let index = 0
  let guard = 0
  while (index < blocks.length && guard++ < 20000) {
    const block = blocks[index]
    const naturalTop = block.top + shift
    const top = index > 0 ? snap(naturalTop) : naturalTop
    const height = block.bottom - block.top
    const startsPage = top <= pageTop() + EPS

    // Starts below the writing area (e.g. after a large space): next page, then evaluate it again there.
    if (top >= pageEnd() - EPS && !startsPage) {
      index = breakBefore(index)
      displayTop[index] = pageTop()
      continue
    }
    if (top + height <= pageEnd() + EPS) {
      if (top - naturalTop > EPS) pushGrid(index, top)
      displayTop[index] = top
      index += 1
      continue
    }

    // The block crosses the end of the page.
    if (!block.splittable) {
      if (!startsPage) { index = breakBefore(index); displayTop[index] = pageTop(); continue }
      // Taller than a page and unbreakable (big table or picture): it overflows; the next block starts on a fresh page.
      if (top - naturalTop > EPS) pushGrid(index, top)
      displayTop[index] = top
      const overflowBottom = block.bottom + shift
      while (pageEnd() < overflowBottom - EPS) page += 1
      index += 1
      continue
    }

    const dom = view.nodeDOM(block.pos) as HTMLElement | null
    const lines = dom ? measureLines(view, dom, rootRect.top, scale) : []
    const offset = top - naturalTop
    const crossing = lines.findIndex((line) => line.bottom + shift + offset > pageEnd() + EPS)
    // Orphans and widows: at least two lines stay at the bottom of the page and two move to the next one
    // (a paragraph of three lines moves whole), unless the block already opens its page.
    const canSplit = crossing >= 2 && (lines.length - crossing >= 2 || crossing >= 3)
    if (!startsPage && !canSplit) {
      index = breakBefore(index)
      displayTop[index] = pageTop()
      continue
    }
    if (top - naturalTop > EPS) pushGrid(index, top)
    displayTop[index] = top

    let first = 0
    while (block.bottom + shift > pageEnd() + EPS) {
      let cut = lines.findIndex((line, lineIndex) => lineIndex > first && line.bottom + shift > pageEnd() + EPS)
      if (cut < 0) break
      if (lines.length - cut === 1 && cut - first >= 3) cut -= 1
      splitAt(index, lines[cut])
      first = cut
    }
    index += 1
  }

  // The last page holds whatever ends after the last break.
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock) {
    const contentBottom = lastBlock.bottom + shift
    while (pageEnd() < contentBottom - EPS) page += 1
  }
  return { spacers, pageCount: page + 1 }
}

/** After rendering: move every widget so the content after it starts exactly on its target. */
function verifySpacers(view: EditorView): number {
  const root = view.dom as HTMLElement
  const elements = Array.from(root.querySelectorAll<HTMLElement>('.document-page-separator, .document-grid-spacer'))
  if (!elements.length) return 0
  const rootRect = root.getBoundingClientRect()
  const scale = root.clientWidth > 0 ? rootRect.width / root.clientWidth : 1
  const tops = elements.map((element) => (element.getBoundingClientRect().top - rootRect.top) / scale)
  let delta = 0
  let corrections = 0
  elements.forEach((element, index) => {
    const spacer = (element as HTMLElement & { __spacer?: Spacer }).__spacer
    if (!spacer) return
    const top = tops[index] + delta
    const wanted = Math.max(0, spacer.target - top)
    const current = Number.parseFloat(element.style.height) || 0
    if (Math.abs(wanted - current) > 0.25) {
      element.style.height = `${wanted}px`
      spacer.height = wanted
      delta += wanted - current
      corrections += 1
    }
  })
  return corrections
}

export const DocumentPagination = Extension.create<{ getOptions: () => PaginationOptions | null }>({
  name: 'documentPagination',

  addOptions() {
    return { getOptions: () => null }
  },

  addProseMirrorPlugins() {
    const getOptions = this.options.getOptions
    return [
      new Plugin<PaginationState>({
        key: paginationPluginKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, relayout: 0 }),
          apply(tr, value) {
            const next = tr.getMeta(paginationPluginKey) as DecorationSet | undefined
            const relayout = tr.getMeta(RELAYOUT_META) ? value.relayout + 1 : value.relayout
            if (next) return { decorations: next, relayout }
            // Keep the breaks where they were until the next pass (no flash of an unpaginated sheet).
            return { decorations: tr.docChanged ? value.decorations.map(tr.mapping, tr.doc) : value.decorations, relayout }
          },
        },
        props: {
          decorations: (state) => paginationPluginKey.getState(state)?.decorations,
        },
        view(view) {
          let frame: number | null = null
          let timer: number | null = null
          let applying = false
          let appliedHeight = -1
          let lastPageCount = 0

          const run = () => {
            frame = null
            const options = getOptions()
            if (view.isDestroyed || !options) return
            applying = true
            try {
              view.dispatch(view.state.tr.setMeta(paginationPluginKey, DecorationSet.empty).setMeta('addToHistory', false))
              const { spacers, pageCount } = computeSpacers(view, options)
              view.dispatch(view.state.tr.setMeta(paginationPluginKey, buildDecorations(view.state, spacers)).setMeta('addToHistory', false))
              verifySpacers(view)
              appliedHeight = (view.dom as HTMLElement).offsetHeight
              if (pageCount !== lastPageCount) {
                lastPageCount = pageCount
                options.onPageCountChange?.(pageCount)
              }
            } finally {
              applying = false
            }
          }

          const schedule = () => {
            if (frame !== null) cancelAnimationFrame(frame)
            if (timer !== null) window.clearTimeout(timer)
            timer = null
            // Large documents: wait for a pause in typing (the previous breaks stay mapped meanwhile).
            const large = view.state.doc.childCount > 160
            if (large) timer = window.setTimeout(() => { timer = null; frame = requestAnimationFrame(run) }, 140)
            else frame = requestAnimationFrame(run)
          }

          const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
            if (applying) return
            const height = (view.dom as HTMLElement).offsetHeight
            if (Math.abs(height - appliedHeight) > EPS) schedule()
          }) : null
          resizeObserver?.observe(view.dom)
          const onLoad = (event: Event) => { if ((event.target as HTMLElement)?.tagName === 'IMG') schedule() }
          view.dom.addEventListener('load', onLoad, true)
          const fonts = (globalThis.document as Document & { fonts?: FontFaceSet }).fonts
          fonts?.addEventListener?.('loadingdone', schedule)
          void fonts?.ready.then(() => { if (!view.isDestroyed) schedule() })

          schedule()
          return {
            update(updated, previous) {
              const before = paginationPluginKey.getState(previous)?.relayout
              const after = paginationPluginKey.getState(updated.state)?.relayout
              if (updated.state.doc !== previous.doc || before !== after) schedule()
            },
            destroy() {
              if (frame !== null) cancelAnimationFrame(frame)
              if (timer !== null) window.clearTimeout(timer)
              resizeObserver?.disconnect()
              view.dom.removeEventListener('load', onLoad, true)
              fonts?.removeEventListener?.('loadingdone', schedule)
            },
          }
        },
      }),
    ]
  },
})
