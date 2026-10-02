import type { Editor } from '@tiptap/core'

export const DOC_FONTS = [
  'Arial', 'Aptos', 'Calibri', 'Cambria', 'Times New Roman', 'Georgia', 'Garamond', 'Helvetica', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Segoe UI', 'Century Gothic', 'Courier New', 'Comic Sans MS', 'Impact', 'Arial Black',
]
// Document text is sized in points, like Word (slides keep canvas pixels).
export const DOC_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72]
export const DEFAULT_DOC_FONT_PT = 12

/** 'Calibri', "'Calibri', sans-serif" → Calibri */
export function primaryFontFamily(value: unknown): string {
  return String(value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}

/** CSS font-size ('11pt', '14.6667px', '16px') → points, rounded to the half point. */
export function fontSizeToPoints(value: unknown): number {
  const match = /^\s*([\d.]+)\s*(pt|px)?\s*$/i.exec(String(value || ''))
  if (!match) return DEFAULT_DOC_FONT_PT
  const number = Number(match[1])
  const points = (match[2] || 'px').toLowerCase() === 'pt' ? number : number * 0.75
  return Math.round(points * 2) / 2
}

const clampSize = (points: number) => Math.max(6, Math.min(96, Math.round(points * 2) / 2))

function nextSize(current: number, direction: 1 | -1): number {
  const ladder = direction > 0
    ? DOC_FONT_SIZES.find((size) => size > current)
    : [...DOC_FONT_SIZES].reverse().find((size) => size < current)
  return clampSize(ladder ?? current + (direction > 0 ? 2 : -1))
}

/** Size a run is actually rendered at: its explicit size, else what CSS gives it (headings are bigger than body text). */
function renderedPoints(editor: Editor, pos: number, explicit: unknown): number {
  if (explicit) return fontSizeToPoints(explicit)
  try {
    const { node } = editor.view.domAtPos(pos)
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
    if (element) return fontSizeToPoints(window.getComputedStyle(element).fontSize)
  } catch {
    /* position not rendered */
  }
  return DEFAULT_DOC_FONT_PT
}

/**
 * Word-style A+ / A−: every run in the selection moves one step up/down from ITS OWN size, so a
 * multi-line selection with mixed sizes keeps its proportions instead of being flattened to the first line.
 */
export function stepFontSize(editor: Editor, direction: 1 | -1): void {
  const { from, to, empty } = editor.state.selection
  const textStyle = editor.state.schema.marks.textStyle
  if (empty || !textStyle) {
    const current = renderedPoints(editor, from, editor.getAttributes('textStyle').fontSize)
    editor.chain().focus().setMark('textStyle', { fontSize: `${nextSize(current, direction)}pt` }).run()
    return
  }
  const tr = editor.state.tr
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (start >= end) return false
    const existing = node.marks.find((mark) => mark.type === textStyle)
    const current = renderedPoints(editor, start, existing?.attrs.fontSize)
    tr.addMark(start, end, textStyle.create({ ...(existing?.attrs ?? {}), fontSize: `${nextSize(current, direction)}pt` }))
    return false
  })
  editor.view.dispatch(tr)
  editor.view.focus()
}

/** Whole selection (any number of lines/blocks) to one size. */
export function setFontSize(editor: Editor, points: number): void {
  editor.chain().focus().setMark('textStyle', { fontSize: `${clampSize(points)}pt` }).run()
}
