import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import { FontSizeExtension } from '@/lib/tiptapFontSize'
import { sanitizeSlideHtml } from '@/lib/sanitizeSlideHtml'
import type { TextSlideBlock } from './SlideEditor'

interface SlideTextBlockProps {
  block: TextSlideBlock
  readOnly?: boolean
  onChange: (html: string) => void
  onSelectBlock: () => void
  onEditorFocus: (editor: Editor) => void
  onEditorBlur: () => void
  /** Fired once when the underlying TipTap instance is created, so the parent can keep a
   * blockId -> Editor map for AI text-assist and toolbar formatting even before focus. */
  onEditorCreate: (editor: Editor) => void
  onEditorDestroy: () => void
  onSelectionChange: () => void
  /** Called when the rendered text overflows its box so the block's font size can be shrunk to
   * fit — a client-side safety net for manual edits/typing (generation-time content is already
   * sized to fit via presentation_layouts.fit_font_size on the backend, but a user can always
   * type more than a fixed box was sized for). Shrink-only, never grows text back automatically. */
  onOverflowFontFit?: (fontSize: number) => void
}

/**
 * Minimal per-block rich-text editor for a single slide text box — deliberately a small
 * extension set (no headings/lists/tables/pagination), unlike the full-document RichTextEditor,
 * since a slide text block is one short text box, not a page. Inline marks (bold/italic/underline/
 * color/font/size) apply to the TipTap selection range, which is what lets the toolbar format a
 * highlighted portion of text instead of the whole block.
 */
export function SlideTextBlock({
  block,
  readOnly = false,
  onChange,
  onSelectBlock,
  onEditorFocus,
  onEditorBlur,
  onEditorCreate,
  onEditorDestroy,
  onSelectionChange,
  onOverflowFontFit,
}: SlideTextBlockProps) {
  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSizeExtension,
      TextAlign.configure({ types: ['paragraph'] }),
    ],
    content: block.content,
    editable: !readOnly && !block.locked,
    onCreate: ({ editor }) => onEditorCreate(editor),
    onUpdate: ({ editor }) => onChange(sanitizeSlideHtml(editor.getHTML())),
    onSelectionUpdate: onSelectionChange,
    onDestroy: onEditorDestroy,
  }, [])

  useEffect(() => {
    if (editor && !editor.isFocused && block.content !== editor.getHTML()) {
      editor.commands.setContent(block.content)
    }
  }, [editor, block.content])

  useEffect(() => {
    editor?.setEditable(!readOnly && !block.locked)
  }, [editor, readOnly, block.locked])

  useEffect(() => {
    if (!editor || readOnly || !onOverflowFontFit) return
    const currentSize = block.style.fontSize
    if (!currentSize || currentSize <= 10) return
    const frame = requestAnimationFrame(() => {
      const dom = editor.view.dom as HTMLElement
      if (dom.scrollHeight > dom.clientHeight + 1) {
        const ratio = dom.clientHeight / dom.scrollHeight
        const next = Math.max(10, Math.floor(currentSize * ratio))
        if (next < currentSize) onOverflowFontFit(next)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, readOnly, block.content, block.style.fontSize, block.width, block.height, onOverflowFontFit])

  if (!editor) return null

  const style = block.style

  return (
    <EditorContent
      editor={editor}
      className="slide-text-block h-full w-full cursor-text select-text [&_.ProseMirror]:h-full [&_.ProseMirror]:w-full [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0"
      style={{
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textDecoration: style.textDecoration,
        textAlign: style.textAlign,
        lineHeight: style.lineHeight,
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (!readOnly) onSelectBlock()
      }}
      onFocus={() => {
        if (!readOnly) {
          onSelectBlock()
          onEditorFocus(editor)
        }
      }}
      onBlur={onEditorBlur}
    />
  )
}
