import { useEditor, EditorContent, Editor, Extension } from '@tiptap/react'
import { Mark, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { useEffect, useState, useCallback, useRef } from 'react'
import { DocumentPagination, requestPaginationRelayout, type PaginationOptions } from '@/lib/documentPagination'

const ImportedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: element => element.getAttribute('width') || parseInt(element.style.width, 10) || null,
      },
      height: {
        default: null,
        parseHTML: element => element.getAttribute('height') || parseInt(element.style.height, 10) || null,
      },
    }
  },
})

const SuperscriptMark = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes), 0],
})

const SubscriptMark = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: ({ HTMLAttributes }) => ['sub', mergeAttributes(HTMLAttributes), 0],
})

const HighlightMark = Mark.create({
  name: 'importedHighlight',
  addAttributes() {
    return {
      color: {
        default: '#ffff00',
        parseHTML: element => element.style.backgroundColor || '#ffff00',
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'mark' },
      {
        tag: 'span',
        getAttrs: element => {
          const color = (element as HTMLElement).style.backgroundColor
          return color ? { color } : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const { color, ...attributes } = HTMLAttributes
    return ['mark', mergeAttributes(attributes, { style: `background-color:${color}` }), 0]
  },
})

const DocumentCommentMark = Mark.create({
  name: 'documentComment',
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: element => element.getAttribute('data-comment-id') },
      author: { default: null, parseHTML: element => element.getAttribute('data-comment-author') },
      date: { default: null, parseHTML: element => element.getAttribute('data-comment-date') },
      text: { default: null, parseHTML: element => element.getAttribute('data-comment-text') },
    }
  },
  parseHTML: () => [{ tag: "span[data-docx-comment=\"true\"]" }],
  renderHTML({ HTMLAttributes }) {
    const { id, author, date, text, ...attributes } = HTMLAttributes
    const title = [author, text].filter(Boolean).join(': ')
    return ['span', mergeAttributes(attributes, {
      'data-docx-comment': 'true',
      'data-comment-id': id,
      'data-comment-author': author,
      'data-comment-date': date,
      'data-comment-text': text,
      title,
      class: 'docx-comment',
    }), 0]
  },
})

const DocumentRevisionMark = Mark.create({
  name: 'documentRevision',
  inclusive: false,
  addAttributes() {
    return {
      kind: { default: 'insert', parseHTML: element => element.getAttribute('data-revision-kind') || 'insert' },
      author: { default: null, parseHTML: element => element.getAttribute('data-revision-author') },
      date: { default: null, parseHTML: element => element.getAttribute('data-revision-date') },
    }
  },
  parseHTML: () => [{ tag: "span[data-revision-kind]" }],
  renderHTML({ HTMLAttributes }) {
    const { kind, author, date, ...attributes } = HTMLAttributes
    return ['span', mergeAttributes(attributes, {
      'data-revision-kind': kind,
      'data-revision-author': author,
      'data-revision-date': date,
      title: [kind === 'delete' ? tl("Eliminato") : tl("Aggiunto"), author].filter(Boolean).join(' da '),
      class: kind === 'delete' ? 'docx-revision-delete' : 'docx-revision-insert',
    }), 0]
  },
})

const DocxRegion = Node.create({
  name: 'docxRegion',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: { default: 'header', parseHTML: element => element.getAttribute('data-docx-region') },
      label: { default: '', parseHTML: element => element.getAttribute('data-docx-region-label') },
    }
  },
  parseHTML: () => [{ tag: "section[data-docx-region]" }],
  renderHTML({ HTMLAttributes }) {
    const { kind, label, ...attributes } = HTMLAttributes
    return ['section', mergeAttributes(attributes, {
      'data-docx-region': kind,
      'data-docx-region-label': label,
      class: 'docx-region',
    }), 0]
  },
})

// Editable tables (official TipTap table: add/remove rows & columns, merge/split cells, header row).
// Cells keep a background colour so DOCX shading survives import → edit → export.
const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
    renderHTML: (attributes: { backgroundColor?: string | null }) =>
      attributes.backgroundColor ? { style: `background-color:${attributes.backgroundColor}` } : {},
  },
}
const EditableTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground }
  },
})
const EditableTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground }
  },
})

import { AITextAssistPanel } from './AITextAssistPanel'
import { looksLikeMarkdown, renderMarkdownToHtml } from '@/lib/markdown'
import { FontSizeExtension } from '@/lib/tiptapFontSize'
import { ParagraphFormatExtension } from '@/lib/tiptapParagraphFormat'
import { DocumentComposition } from '@/lib/tiptapComposition'
import { SmartPaste } from '@/lib/tiptapPaste'
import { SmartLists } from '@/lib/tiptapSmartLists'
import 'katex/dist/katex.min.css'
import { tl } from '@/i18n/tl'

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  onEditorReady?: (editor: Editor) => void
  readOnly?: boolean
  contentClassName?: string
  aiPanelAnchor?: { x: number; y: number } | null
  aiOpenRequestId?: number
  onMissingSelectionForAI?: () => void
  enableSelectionAssist?: boolean
  /** Word-processor pages on a baseline grid (see lib/documentPagination). Changes re-measure, never remount. */
  pagination?: PaginationOptions & { layoutKey?: string }
}

interface SelectionState {
  from: number
  to: number
  text: string
  position: { x: number; y: number }
}

const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const previousUrl = this.editor.getAttributes('link').href
        const url = window.prompt('URL Link:', previousUrl)
        if (url === null) return false
        if (url === '') {
          this.editor.chain().focus().extendMarkRange('link').unsetLink().run()
          return true
        }
        this.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        return true
      },
    }
  },
})

const PersistentSelectionHighlight = Extension.create({
  name: 'persistentSelectionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('persistentSelectionHighlight'),
        props: {
          decorations(state) {
            const { from, to, empty } = state.selection
            if (empty) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { class: 'document-selection-highlight' }),
            ])
          },
        },
      }),
    ]
  },
})

export function RichTextEditor({
  content,
  onChange,
  onEditorReady,
  readOnly = false,
  contentClassName,
  aiPanelAnchor,
  aiOpenRequestId = 0,
  onMissingSelectionForAI,
  enableSelectionAssist = true,
  pagination,
}: RichTextEditorProps) {
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const paginationRef = useRef(pagination)
  paginationRef.current = pagination
  const hasPagination = Boolean(pagination)
  const [lastValidSelection, setLastValidSelection] = useState<SelectionState | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSizeExtension,
      ParagraphFormatExtension,
      DocumentComposition,
      SmartPaste,
      SmartLists,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      // Imported Word/PowerPoint pictures arrive as data: URIs and sit inside paragraphs.
      ImportedImage.configure({ inline: true, allowBase64: true }),
      Link.configure({
        openOnClick: false,
      }),
      SuperscriptMark,
      SubscriptMark,
      HighlightMark,
      DocumentCommentMark,
      DocumentRevisionMark,
      DocxRegion,
      Table.configure({ resizable: false, HTMLAttributes: { class: 'docx-table' } }),
      TableRow,
      EditableTableCell,
      EditableTableHeader,
      LinkShortcut,
      Mathematics,
      PersistentSelectionHighlight,
      ...(hasPagination ? [DocumentPagination.configure({ getOptions: () => paginationRef.current ?? null })] : []),
    ],
    content: content,
    editable: !readOnly,
    // Italian spell-check/hyphenation in the browser, like Docs follows the document language.
    editorProps: { attributes: { lang: 'it', spellcheck: 'true' } },
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  }, [hasPagination])

  // Page size, margins, line spacing or ruling changed: measure the pages again on the same editor.
  const paginationLayoutKey = pagination
    ? `${pagination.pageHeight}|${pagination.pageGap}|${pagination.marginTop}|${pagination.marginBottom}|${pagination.row}|${pagination.layoutKey ?? ''}`
    : ''
  useEffect(() => {
    if (!editor || !paginationLayoutKey) return
    const frame = requestAnimationFrame(() => requestPaginationRelayout(editor.view))
    return () => cancelAnimationFrame(frame)
  }, [editor, paginationLayoutKey])

  // Handle text selection for AI assist
  const updateSelectionFromEditor = useCallback(() => {
    if (!editor || readOnly) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')
    if (selectedText && selectedText.trim().length > 0) {
      const fallbackPosition = { x: 20, y: 80 }
      const nextSelection = {
        from,
        to,
        text: selectedText.trim(),
        position: aiPanelAnchor || fallbackPosition
      }
      setSelection(nextSelection)
      setLastValidSelection(nextSelection)
    } else {
      setSelection(null)
    }
  }, [editor, readOnly, aiPanelAnchor])

  const handleMouseUp = useCallback(() => {
    // Small delay to ensure browser selection is finalized before reading editor selection.
    setTimeout(() => updateSelectionFromEditor(), 10)
  }, [updateSelectionFromEditor])

  // Open AI panel explicitly from toolbar button, anchored under toolbar icon.
  useEffect(() => {
    if (!editor || readOnly || aiOpenRequestId === 0) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim()

    if (selectedText && selectedText.length > 0) {
      const nextSelection = {
        from,
        to,
        text: selectedText,
        position: aiPanelAnchor || { x: 20, y: 80 }
      }
      setSelection(nextSelection)
      setLastValidSelection(nextSelection)
      return
    }

    if (lastValidSelection && lastValidSelection.text.trim().length > 0) {
      setSelection({
        ...lastValidSelection,
        position: aiPanelAnchor || lastValidSelection.position
      })
      return
    }

    onMissingSelectionForAI?.()
  }, [aiOpenRequestId, editor, readOnly, aiPanelAnchor, onMissingSelectionForAI, lastValidSelection])

  // Close panel when clicking elsewhere or when selection changes
  const handleMouseDown = useCallback(() => {
    // Only close if clicking outside the panel (panel handles its own clicks)
    if (selection) {
      const domSelection = window.getSelection()
      if (!domSelection || domSelection.toString().trim().length === 0) {
        setSelection(null)
      }
    }
  }, [selection])

  useEffect(() => {
    if (!editor || readOnly) return
    const onSelectionUpdate = () => updateSelectionFromEditor()
    editor.on('selectionUpdate', onSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate)
    }
  }, [editor, readOnly, updateSelectionFromEditor])

  // Sync content updates from parent
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      if (!editor.isFocused) {
        editor.commands.setContent(content)
      }
    }
  }, [content, editor])

  // Apply AI-generated text (with math formula support)
  const handleApplyAIText = useCallback((newText: string) => {
    if (!editor || !selection) return

    const { from, to } = selection
    const trimmed = newText.trim()

    // Detect block math: $$...$$
    const blockMatch = trimmed.match(/^\$\$([\s\S]+)\$\$$/)
    if (blockMatch) {
      const latex = blockMatch[1].trim()
      editor.chain().focus().deleteRange({ from, to })
        .insertBlockMath({ latex })
        .run()
      setSelection(null)
      setLastValidSelection(null)
      return
    }

    // Detect inline math: $...$
    const inlineMatch = trimmed.match(/^\$([^$]+)\$$/)
    if (inlineMatch) {
      const latex = inlineMatch[1].trim()
      editor.chain().focus().deleteRange({ from, to })
        .insertInlineMath({ latex })
        .run()
      setSelection(null)
      setLastValidSelection(null)
      return
    }

    // Multiple inline formulas on one line — detect $...$ patterns within normal text
    if (/\$[^$]+\$/.test(trimmed)) {
      // Insert as HTML letting the Mathematics extension's parseHTML handle it
      const htmlWithMath = trimmed.replace(/\$\$([^$]+)\$\$/g, (_m, latex) => {
        return `<span data-type="blockMath" data-latex="${latex.trim()}"></span>`
      }).replace(/\$([^$]+)\$/g, (_m, latex) => {
        return `<span data-type="inlineMath" data-latex="${latex.trim()}"></span>`
      })
      editor.chain().focus().deleteRange({ from, to }).insertContent(htmlWithMath).run()
      setSelection(null)
      setLastValidSelection(null)
      return
    }

    const nextContent = looksLikeMarkdown(trimmed) ? renderMarkdownToHtml(trimmed) : trimmed
    editor.chain().focus().deleteRange({ from, to }).insertContent(nextContent).run()
    setSelection(null)
    setLastValidSelection(null)
  }, [editor, selection])

  if (!editor) {
    return null
  }

  return (
    <div className="flex flex-col min-h-full bg-transparent relative">
      <EditorContent
        editor={editor}
        className={`${contentClassName || "flex-1 p-8 prose max-w-none focus:outline-none min-h-[500px]"} ${enableSelectionAssist && selection && !readOnly ? 'pb-64' : ''}`}
        onMouseUp={handleMouseUp}
        onMouseDown={handleMouseDown}
      />

      {/* AI Assist Panel */}
      {enableSelectionAssist && selection && !readOnly && (
        <AITextAssistPanel
          selectedText={selection.text}
          position={aiPanelAnchor || selection.position}
          variant="floating"
          onClose={() => setSelection(null)}
          onApply={handleApplyAIText}
          context={tl("Documento didattico")}
        />
      )}
    </div>
  )
}
