import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'

const PAINTED_MARKS = ['bold', 'italic', 'underline', 'strike', 'textStyle', 'importedHighlight', 'superscript', 'subscript']
const BLOCK_ATTRS = ['textAlign', 'lineHeight', 'spaceBefore', 'spaceAfter', 'textIndent']

type CopiedFormat = {
  marks: Mark[]
  blockType: 'paragraph' | 'heading'
  level: number | null
  attrs: Record<string, unknown>
}

/**
 * "Copia formattazione": arm it with a selection (or the caret) as source, then select other text
 * to paint the same character + paragraph format onto it. Esc or a second click cancels.
 */
export function useFormatPainter(editor: Editor | null | undefined) {
  const [armed, setArmed] = useState(false)
  const copied = useRef<CopiedFormat | null>(null)

  const cancel = useCallback(() => {
    copied.current = null
    setArmed(false)
  }, [])

  const copy = useCallback(() => {
    if (!editor) return
    if (copied.current) { cancel(); return }
    const { selection } = editor.state
    const { $from, from, to, empty } = selection
    let marks: Mark[] = [...$from.marks()]
    if (!empty) {
      const first = editor.state.doc.nodeAt(from)
      if (first?.isText) marks = [...first.marks]
    }
    const parent = $from.parent
    const isHeading = parent.type.name === 'heading'
    const attrs: Record<string, unknown> = {}
    for (const key of BLOCK_ATTRS) attrs[key] = parent.attrs[key] ?? null
    copied.current = {
      marks: marks.filter((mark) => PAINTED_MARKS.includes(mark.type.name)),
      blockType: isHeading ? 'heading' : 'paragraph',
      level: isHeading ? (parent.attrs.level as number) : null,
      attrs,
    }
    void to
    setArmed(true)
  }, [cancel, editor])

  useEffect(() => {
    if (!editor || !armed) return
    const dom = editor.view.dom as HTMLElement
    dom.style.cursor = 'copy'

    const paint = () => {
      const format = copied.current
      const { from, to, empty } = editor.state.selection
      if (!format || empty) return
      const { schema } = editor.state.doc.type
      const tr = editor.state.tr
      for (const name of PAINTED_MARKS) if (schema.marks[name]) tr.removeMark(from, to, schema.marks[name])
      for (const mark of format.marks) tr.addMark(from, to, mark)
      editor.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
        const nodeType = format.blockType === 'heading' ? schema.nodes.heading : schema.nodes.paragraph
        const nextAttrs = { ...node.attrs, ...format.attrs, ...(format.blockType === 'heading' ? { level: format.level } : {}) }
        if (nodeType && node.type !== nodeType) {
          // Only retag plain top-level blocks: list items and cells keep their structure.
          const $pos = editor.state.doc.resolve(pos)
          if ($pos.depth === 0) tr.setNodeMarkup(pos, nodeType, nextAttrs)
          else tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...format.attrs })
        } else {
          tr.setNodeMarkup(pos, undefined, nextAttrs)
        }
        return false
      })
      editor.view.dispatch(tr)
      cancel()
    }
    const onMouseUp = () => window.setTimeout(paint, 0)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    dom.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKey)
    return () => {
      dom.style.cursor = ''
      dom.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [armed, cancel, editor])

  return { armed, copy, cancel }
}
