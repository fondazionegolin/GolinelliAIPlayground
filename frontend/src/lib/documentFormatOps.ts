import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

/**
 * Deterministic document formatting used by Document Builder (after the user confirmed the agent's
 * interpretation) and by the "Riordina struttura" toolbar action. Doing it with ProseMirror
 * transactions instead of asking the LLM to rewrite HTML means spacing/indent/heading changes are exact,
 * cannot alter the wording, and are a single undo step.
 */
export type FormatTarget = 'paragraphs' | 'headings' | 'h1' | 'h2' | 'h3' | 'all'

export type FormatOperation =
  | {
      op: 'paragraph_format'
      target?: FormatTarget
      /** null clears the value (back to the document default). */
      space_before_px?: number | null
      space_after_px?: number | null
      line_height?: number | null
      text_indent_px?: number | null
      text_align?: 'left' | 'center' | 'right' | 'justify'
    }
  | { op: 'text_style'; target?: FormatTarget; font_family?: string; font_size_pt?: number; color?: string; bold?: boolean; italic?: boolean }
  | { op: 'normalize_spacing'; gap_px?: number }
  | { op: 'detect_structure' }
  | { op: 'smart_indent'; indent_px?: number; skip_after_heading?: boolean }

export type FormatRange = { from: number; to: number } | null

const HEADING_SPACING: Record<number, { before: string; after: string }> = {
  1: { before: '24px', after: '10px' },
  2: { before: '18px', after: '8px' },
  3: { before: '14px', after: '6px' },
}

type Block = { node: PMNode; pos: number; topLevel: boolean; inTable: boolean; inList: boolean }

function collectBlocks(tr: Transaction, range: FormatRange): Block[] {
  const doc = tr.doc
  const from = range ? range.from : 0
  const to = range ? range.to : doc.content.size
  const blocks: Block[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
    const $pos = doc.resolve(pos)
    let inTable = false
    let inList = false
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const name = $pos.node(depth).type.name
      if (/table/i.test(name)) inTable = true
      if (/listItem/i.test(name)) inList = true
    }
    blocks.push({ node, pos, topLevel: $pos.depth === 0, inTable, inList })
    return false
  })
  return blocks
}

function matchesTarget(block: Block, target: FormatTarget = 'all'): boolean {
  const isHeading = block.node.type.name === 'heading'
  switch (target) {
    case 'paragraphs': return !isHeading
    case 'headings': return isHeading
    case 'h1': return isHeading && block.node.attrs.level === 1
    case 'h2': return isHeading && block.node.attrs.level === 2
    case 'h3': return isHeading && block.node.attrs.level === 3
    default: return true
  }
}

const isBlankText = (node: PMNode) => node.content.size === 0 || (node.childCount > 0 && node.textContent.replace(/[\s ]/g, '') === '' && node.childCount === node.content.childCount && node.content.content.every((child) => child.isText))
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function applyParagraphFormat(tr: Transaction, range: FormatRange, op: Extract<FormatOperation, { op: 'paragraph_format' }>): number {
  const attrs: Record<string, unknown> = {}
  const spacing = op.space_before_px !== undefined || op.space_after_px !== undefined || op.text_indent_px !== undefined
  if (op.space_before_px !== undefined) attrs.spaceBefore = op.space_before_px === null || op.space_before_px === 0 ? null : `${clamp(op.space_before_px, 0, 120)}px`
  if (op.space_after_px !== undefined) attrs.spaceAfter = op.space_after_px === null || op.space_after_px === 0 ? null : `${clamp(op.space_after_px, 0, 120)}px`
  if (op.text_indent_px !== undefined) attrs.textIndent = op.text_indent_px === null || op.text_indent_px === 0 ? null : `${clamp(op.text_indent_px, 0, 160)}px`
  if (op.line_height !== undefined) attrs.lineHeight = op.line_height === null ? null : String(clamp(op.line_height, 0.8, 3))
  if (op.text_align) attrs.textAlign = op.text_align
  let changed = 0
  for (const block of collectBlocks(tr, range)) {
    if (!matchesTarget(block, op.target)) continue
    // Table cells and list items keep their compact rhythm: block spacing would pull them apart.
    if (spacing && (block.inTable || block.inList)) continue
    tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, ...attrs })
    changed += 1
  }
  return changed
}

function applyTextStyle(tr: Transaction, range: FormatRange, op: Extract<FormatOperation, { op: 'text_style' }>): number {
  const { schema } = tr.doc.type
  const textStyle = schema.marks.textStyle
  const changes: Record<string, string> = {}
  if (op.font_family) changes.fontFamily = op.font_family
  if (op.font_size_pt) changes.fontSize = `${clamp(op.font_size_pt, 6, 96)}pt`
  if (op.color) changes.color = op.color
  const jobs: Array<{ start: number; end: number; marks: readonly import('@tiptap/pm/model').Mark[] }> = []
  let changed = 0
  for (const block of collectBlocks(tr, range)) {
    if (!matchesTarget(block, op.target)) continue
    const blockStart = block.pos + 1
    const blockEnd = block.pos + block.node.nodeSize - 1
    tr.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
      if (!node.isText) return true
      const start = Math.max(pos, range ? range.from : 0)
      const end = Math.min(pos + node.nodeSize, range ? range.to : Number.MAX_SAFE_INTEGER)
      if (start < end) jobs.push({ start, end, marks: node.marks })
      return false
    })
    changed += 1
  }
  for (const { start, end, marks } of jobs) {
    if (textStyle && Object.keys(changes).length) {
      const existing = marks.find((mark) => mark.type === textStyle)
      tr.addMark(start, end, textStyle.create({ ...(existing?.attrs ?? {}), ...changes }))
    }
    if (op.bold !== undefined && schema.marks.bold) {
      if (op.bold) tr.addMark(start, end, schema.marks.bold.create())
      else tr.removeMark(start, end, schema.marks.bold)
    }
    if (op.italic !== undefined && schema.marks.italic) {
      if (op.italic) tr.addMark(start, end, schema.marks.italic.create())
      else tr.removeMark(start, end, schema.marks.italic)
    }
  }
  return changed
}

/** Empty paragraphs typed as vertical distance become real paragraph spacing. */
function normalizeSpacing(tr: Transaction, range: FormatRange, op: Extract<FormatOperation, { op: 'normalize_spacing' }>): { removed: number; spaced: number } {
  const gap = clamp(op.gap_px ?? 14, 4, 48)
  const doc = tr.doc
  const from = range ? range.from : 0
  const to = range ? range.to : doc.content.size
  const runs: Array<{ start: number; end: number; count: number; prev: { node: PMNode; pos: number } | null; next: { node: PMNode; pos: number } | null }> = []
  let run: (typeof runs)[number] | null = null
  let previous: { node: PMNode; pos: number } | null = null
  const children: Array<{ node: PMNode; pos: number }> = []
  doc.forEach((node, offset) => children.push({ node, pos: offset }))
  for (let index = 0; index < children.length; index += 1) {
    const { node, pos } = children[index]
    const inRange = pos + node.nodeSize > from && pos < to
    const blank = node.type.name === 'paragraph' && isBlankText(node) && !node.attrs.pageBreak
    if (blank && inRange) {
      if (!run) {
        run = { start: pos, end: pos + node.nodeSize, count: 1, prev: previous, next: null }
        runs.push(run)
      } else {
        run.end = pos + node.nodeSize
        run.count += 1
      }
    } else {
      if (run) run.next = { node, pos }
      run = null
      previous = { node, pos }
    }
  }
  let spaced = 0
  let removed = 0
  const isTextBlock = (entry: { node: PMNode } | null) => !!entry && (entry.node.type.name === 'paragraph' || entry.node.type.name === 'heading')
  for (const item of runs) {
    const distance = `${Math.min(item.count, 3) * gap}px`
    if (isTextBlock(item.prev)) {
      tr.setNodeMarkup(item.prev!.pos, undefined, { ...item.prev!.node.attrs, spaceAfter: distance })
      spaced += 1
    } else if (isTextBlock(item.next)) {
      tr.setNodeMarkup(item.next!.pos, undefined, { ...item.next!.node.attrs, spaceBefore: distance })
      spaced += 1
    }
    removed += item.count
  }
  // setNodeMarkup keeps positions stable; delete from the end so earlier ranges stay valid.
  for (const item of [...runs].reverse()) tr.delete(item.start, item.end)
  return { removed, spaced }
}

function headingLevel(text: string, node: PMNode, nextText: string | null): number | null {
  const value = text.trim()
  if (!value || value.length > 100 || /[.;,]$/.test(value) || value.split(/\s+/).length > 14) return null
  if (/^(capitolo|chapter|parte|part|libro|book)\s+([0-9]+|[ivxlc]+)\b/i.test(value)) return 1
  if (/^(sezione|section|paragrafo|articolo|article)\s+([0-9]+|[ivxlc]+)\b/i.test(value)) return 2
  if (/^\d+(\.\d+){2,}[.)]?\s+\S/.test(value)) return 3
  if (/^\d+\.\d+[.)]?\s+\S/.test(value)) return 3
  if (/^\d+[.)]\s+\S/.test(value)) return 2
  if (/^[IVX]+[.)]\s+\S/.test(value)) return 2
  const letters = value.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (letters.length >= 4 && value === value.toUpperCase() && value.split(/\s+/).length <= 10) return 2
  const allBold = node.childCount > 0 && node.content.content.every((child) => child.isText && child.marks.some((mark) => mark.type.name === 'bold'))
  if (allBold && value.length <= 80 && nextText !== null && nextText.length > value.length * 1.5) return 3
  return null
}

/** Recognises chapter/section titles typed as plain paragraphs and promotes them to real headings. */
function detectStructure(tr: Transaction, range: FormatRange): number {
  const { schema } = tr.doc.type
  const heading = schema.nodes.heading
  if (!heading) return 0
  const blocks = collectBlocks(tr, range).filter((block) => block.topLevel && !block.inTable && !block.inList)
  const doc = tr.doc
  let changed = 0
  for (const block of blocks) {
    if (block.node.type.name !== 'paragraph') continue
    const $end = doc.resolve(block.pos + block.node.nodeSize)
    const next = $end.nodeAfter
    const level = headingLevel(block.node.textContent, block.node, next ? next.textContent.trim() : null)
    if (!level) continue
    const spacing = HEADING_SPACING[level]
    tr.setNodeMarkup(block.pos, heading, {
      ...block.node.attrs,
      level,
      textIndent: null,
      spaceBefore: block.node.attrs.spaceBefore || spacing.before,
      spaceAfter: block.node.attrs.spaceAfter || spacing.after,
    })
    changed += 1
  }
  return changed
}

/** Manual indentation (leading spaces/tabs) becomes a real first-line indent, applied consistently to body text. */
function smartIndent(tr: Transaction, range: FormatRange, op: Extract<FormatOperation, { op: 'smart_indent' }>): number {
  const indent = `${clamp(op.indent_px ?? 28, 8, 120)}px`
  const skipAfterHeading = op.skip_after_heading !== false
  const strips: Array<{ from: number; to: number }> = []
  let changed = 0
  let previousWasHeading = false
  for (const block of collectBlocks(tr, range)) {
    const { node } = block
    const isBody = node.type.name === 'paragraph' && block.topLevel && !block.inTable && !block.inList
    const long = node.textContent.trim().length > 40
    const aligned = node.attrs.textAlign !== 'center' && node.attrs.textAlign !== 'right'
    if (isBody && long && aligned) {
      const lead = node.firstChild?.isText ? (/^[\s\u00a0]+/.exec(node.textContent)?.[0].length ?? 0) : 0
      if (lead > 0) strips.push({ from: block.pos + 1, to: block.pos + 1 + lead })
      if (!(skipAfterHeading && previousWasHeading)) {
        tr.setNodeMarkup(block.pos, undefined, { ...node.attrs, textIndent: indent })
        changed += 1
      } else if (lead > 0) {
        changed += 1
      }
    }
    previousWasHeading = node.type.name === 'heading'
  }
  // Attribute changes keep positions stable; delete the typed spaces from the end backwards.
  for (const strip of strips.reverse()) tr.delete(strip.from, strip.to)
  return changed
}

export type FormatResult = { lines: string[]; changed: number }

export function applyFormatOperations(editor: Editor, operations: FormatOperation[], range: FormatRange = null): FormatResult {
  const tr = editor.state.tr
  const lines: string[] = []
  let changed = 0
  let activeRange = range
  for (const op of operations) {
    const before = tr.steps.length
    if (op.op === 'paragraph_format') {
      const count = applyParagraphFormat(tr, activeRange, op)
      if (count) lines.push(`Formato di ${count} paragrafi`)
      changed += count
    } else if (op.op === 'text_style') {
      const count = applyTextStyle(tr, activeRange, op)
      if (count) lines.push(`Stile del testo su ${count} blocchi`)
      changed += count
    } else if (op.op === 'normalize_spacing') {
      const { removed, spaced } = normalizeSpacing(tr, activeRange, op)
      if (removed) lines.push(`${removed} righe vuote sostituite da spaziatura tra paragrafi (${spaced} punti)`)
      changed += removed
    } else if (op.op === 'detect_structure') {
      const count = detectStructure(tr, activeRange)
      if (count) lines.push(`${count} titoli riconosciuti`)
      changed += count
    } else if (op.op === 'smart_indent') {
      const count = smartIndent(tr, activeRange, op)
      if (count) lines.push(`Rientro uniforme su ${count} paragrafi`)
      changed += count
    }
    if (activeRange && tr.steps.length > before) {
      const slice = tr.mapping.slice(before)
      activeRange = { from: slice.map(activeRange.from), to: slice.map(activeRange.to, -1) }
    }
  }
  if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView())
  return { lines, changed }
}

export const STRUCTURE_CLEANUP: FormatOperation[] = [{ op: 'normalize_spacing' }, { op: 'detect_structure' }]

/** Compact description of the document (or selection) the agent reasons about — no full text sent. */
export function describeDocumentForAgent(editor: Editor, range: FormatRange = null): Record<string, unknown> {
  const { doc } = editor.state
  const from = range ? range.from : 0
  const to = range ? range.to : doc.content.size
  let paragraphs = 0
  let empty = 0
  let lists = 0
  let tables = 0
  let words = 0
  const headings: Record<string, number> = {}
  const sample: Array<Record<string, unknown>> = []
  doc.nodesBetween(from, to, (node) => {
    const name = node.type.name
    if (/table$/i.test(name)) tables += 1
    if (name === 'bulletList' || name === 'orderedList') lists += 1
    if (name === 'heading') headings[`h${node.attrs.level}`] = (headings[`h${node.attrs.level}`] || 0) + 1
    if (name === 'paragraph' || name === 'heading') {
      if (name === 'paragraph') {
        paragraphs += 1
        if (isBlankText(node)) empty += 1
      }
      words += node.textContent.split(/\s+/).filter(Boolean).length
      if (sample.length < 12 && node.textContent.trim()) {
        sample.push({
          type: name === 'heading' ? `h${node.attrs.level}` : 'p',
          text: node.textContent.trim().slice(0, 80),
          line_height: node.attrs.lineHeight || null,
          space_before: node.attrs.spaceBefore || null,
          space_after: node.attrs.spaceAfter || null,
          text_indent: node.attrs.textIndent || null,
          align: node.attrs.textAlign || null,
        })
      }
      return false
    }
    return true
  })
  return { scope: range ? 'selection' : 'document', paragraphs, empty_paragraphs: empty, headings, lists, tables, words, sample }
}


/** "Cancella formattazione": drops character marks (bold, font, colour, highlight…) and paragraph spacing/indent from the selection. */
export function clearFormatting(editor: Editor): void {
  const { from, to, empty } = editor.state.selection
  const chain = editor.chain().focus()
  if (!empty) chain.unsetAllMarks()
  chain.run()
  const tr = editor.state.tr
  const range = empty ? { from, to: from } : { from, to }
  editor.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: null, spaceBefore: null, spaceAfter: null, textIndent: null, textAlign: null })
    return false
  })
  if (tr.docChanged || tr.steps.length) editor.view.dispatch(tr)
}
