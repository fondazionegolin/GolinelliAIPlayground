import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describeDocumentForAgent, type FormatRange } from '@/lib/documentFormatOps'

/** Where a piece of generated text goes (decided by the Document Builder planner). */
export type WritePlacement = 'replace_selection' | 'after_selection' | 'at_cursor' | 'end_of_document'

export interface WriteSpec {
  task: 'expand' | 'continue' | 'draft' | 'insert' | 'summarize'
  placement: WritePlacement
  target_words: number
  tone?: string
  structure?: string
  merge_first_paragraph?: boolean
}

export const PLACEMENT_LABEL: Record<WritePlacement, string> = {
  replace_selection: 'Sostituisce il testo selezionato',
  after_selection: 'Inserito dopo la selezione',
  at_cursor: 'Inserito nel punto del cursore',
  end_of_document: 'Aggiunto in fondo al documento',
}

type Range = { from: number; to: number }

/** Plain text of [from, to] with one blank line between blocks and "#" markers for headings. */
function docToPlain(doc: PMNode, from: number, to: number): string {
  const lines: string[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const start = Math.max(pos + 1, from)
    const end = Math.min(pos + node.nodeSize - 1, to)
    const text = start < end ? doc.textBetween(start, end, '', ' ') : ''
    if (text.trim()) lines.push(node.type.name === 'heading' ? `${'#'.repeat(Number(node.attrs.level) || 1)} ${text}` : text)
    return false
  })
  return lines.join('\n\n')
}

function resolveRange(editor: Editor, target: { kind: string; from?: number; to?: number }): Range {
  const size = editor.state.doc.content.size
  const clamp = (value: number) => Math.max(0, Math.min(size, value))
  if (target.kind === 'selected_text' && typeof target.from === 'number' && typeof target.to === 'number') {
    return { from: clamp(target.from), to: clamp(target.to) }
  }
  // Whole-document scope: the writing point is the caret (the panel keeps the editor selection).
  const { from, to } = editor.state.selection
  return { from: clamp(from), to: clamp(to) }
}

/** Everything the writer needs to write *into* this document: title, outline, text around the insertion point. */
export function buildWritingContext(editor: Editor, title: string, target: { kind: string; from?: number; to?: number }): Record<string, unknown> {
  const { doc } = editor.state
  const { from, to } = resolveRange(editor, target)
  const outline: Array<{ level: number; text: string }> = []
  doc.descendants((node) => {
    if (node.type.name === 'heading') outline.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim().slice(0, 120) })
    return true
  })
  return {
    title,
    outline,
    before: docToPlain(doc, 0, from).slice(-7000),
    after: docToPlain(doc, to, doc.content.size).slice(0, 1500),
    selection: from < to ? docToPlain(doc, from, to).slice(0, 6000) : '',
    range: { from, to },
  }
}

/** Compact picture of the document for the planner (no full text): structure + where the caret/selection is. */
export function buildPlanStats(editor: Editor, title: string, target: { kind: string; from?: number; to?: number }, range: FormatRange): Record<string, unknown> {
  const context = buildWritingContext(editor, title, target) as { before: string; after: string; selection: string; outline: unknown[] }
  const lastBlock = context.before.split('\n\n').filter(Boolean).slice(-1)[0] ?? ''
  const selectionWords = context.selection ? context.selection.split(/\s+/).filter(Boolean).length : 0
  return {
    ...describeDocumentForAgent(editor, range),
    title,
    outline: context.outline,
    has_selection: Boolean(context.selection),
    selection_words: selectionWords,
    cursor_at_end: context.after.trim() === '',
    cursor_at_start: context.before.trim() === '',
    last_block: lastBlock.slice(-300),
    last_block_ends_sentence: /[.!?:]["”»)]?\s*$/.test(lastBlock),
    text_after_head: context.after.slice(0, 200),
  }
}

export interface WriteProposal {
  html: string
  placement: WritePlacement
  merge_first_paragraph?: boolean
  client_context?: { range?: Range } & Record<string, unknown>
}

/** Inserts generated HTML where the planner said, as one undoable step. Returns false when it could not apply. */
export function applyWriteProposal(editor: Editor, proposal: WriteProposal): boolean {
  const { doc } = editor.state
  const size = doc.content.size
  const recorded = proposal.client_context?.range
  const from = Math.max(0, Math.min(size, recorded?.from ?? editor.state.selection.from))
  const to = Math.max(from, Math.min(size, recorded?.to ?? editor.state.selection.to))
  const parsed = new DOMParser().parseFromString(proposal.html, 'text/html').body
  const blocks = Array.from(parsed.children) as HTMLElement[]
  if (blocks.length === 0) return false
  const singleParagraph = blocks.length === 1 && blocks[0].tagName === 'P'

  const chain = editor.chain().focus()
  const topLevelAfter = (pos: number) => {
    const $pos = editor.state.doc.resolve(pos)
    return $pos.depth >= 1 ? $pos.after(1) : pos
  }

  if (proposal.placement === 'replace_selection' && from < to) {
    return chain.insertContentAt({ from, to }, singleParagraph ? blocks[0].innerHTML : proposal.html).run()
  }
  if (proposal.placement === 'after_selection') {
    return chain.insertContentAt(topLevelAfter(to), proposal.html).run()
  }
  if (proposal.placement === 'end_of_document') {
    const last = doc.lastChild
    const lastEmpty = last && last.type.name === 'paragraph' && last.content.size === 0
    return chain.insertContentAt(lastEmpty ? { from: size - last.nodeSize, to: size } : size, proposal.html).run()
  }
  // at_cursor (also the fallback when a selection-based placement lost its selection)
  const $from = doc.resolve(from)
  const parent = $from.parent
  if (proposal.merge_first_paragraph && blocks[0].tagName === 'P' && parent.isTextblock && parent.content.size > 0) {
    // The text continues an unfinished sentence: glue the first paragraph to the current one, the rest follows.
    const first = blocks[0].innerHTML
    const rest = blocks.slice(1).map((block) => block.outerHTML).join('')
    const ok = editor.chain().focus().insertContentAt(to, ` ${first.replace(/^\s+/, '')}`).run()
    if (ok && rest) editor.chain().focus().insertContentAt(topLevelAfter(editor.state.selection.to), rest).run()
    return ok
  }
  if (parent.isTextblock && parent.content.size === 0 && $from.depth >= 1) {
    return chain.insertContentAt({ from: $from.before(), to: $from.after() }, proposal.html).run()
  }
  return chain.insertContentAt(topLevelAfter(to), proposal.html).run()
}
