import { useEditor, EditorContent, Editor, Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import { Mathematics } from '@tiptap/extension-mathematics'
import { useEffect, useState, useCallback } from 'react'

// Adds fontSize support to the existing TextStyle mark
const FontSizeExtension = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.fontSize || null,
          renderHTML: (attributes: Record<string, unknown>) => {
            if (!attributes.fontSize) return {}
            return { style: `font-size: ${attributes.fontSize}` }
          },
        },
      },
    }]
  },
})
import { AITextAssistPanel } from './AITextAssistPanel'
import { looksLikeMarkdown, renderMarkdownToHtml } from '@/lib/markdown'
import 'katex/dist/katex.min.css'

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
  pagination?: {
    pageHeight: number
    pageGap: number
    marginTop: number
    marginBottom: number
    onPageCountChange?: (pageCount: number) => void
  }
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

const paginationPluginKey = new PluginKey<DecorationSet>('documentPagination')

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

const Pagination = Extension.create<{
  pageHeight: number
  pageGap: number
  marginTop: number
  marginBottom: number
  onPageCountChange?: (pageCount: number) => void
}>({
  name: 'documentPagination',

  addOptions() {
    return {
      pageHeight: 1123,
      pageGap: 28,
      marginTop: 56,
      marginBottom: 56,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<DecorationSet>({
        key: paginationPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations) {
            const nextDecorations = transaction.getMeta(paginationPluginKey) as DecorationSet | undefined
            if (nextDecorations) return nextDecorations
            if (transaction.docChanged) return DecorationSet.empty
            return decorations.map(transaction.mapping, transaction.doc)
          },
        },
        props: {
          decorations(state) {
            return paginationPluginKey.getState(state)
          },
        },
        view(view) {
          let frame: number | null = null
          let lastPageCount = 0

          const schedulePagination = () => {
            if (frame !== null) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
              frame = null
              if (view.isDestroyed) return

              const currentDecorations = paginationPluginKey.getState(view.state)
              if (currentDecorations && currentDecorations !== DecorationSet.empty && currentDecorations.find().length > 0) return

              const contentHeight = Math.max(120, options.pageHeight - options.marginTop - options.marginBottom)
              const rootRect = view.dom.getBoundingClientRect()
              const layoutScale = view.dom.clientWidth > 0 ? rootRect.width / view.dom.clientWidth : 1
              const docSize = view.state.doc.content.size
              const blocks: Array<{
                pos: number
                end: number
                top: number
                bottom: number
                height: number
                textblock: boolean
                keepTogether: boolean
              }> = []

              view.state.doc.forEach((node, offset) => {
                const dom = view.nodeDOM(offset) as HTMLElement | null
                if (!dom?.getBoundingClientRect) return
                const rect = dom.getBoundingClientRect()
                const tagName = dom.tagName?.toLowerCase() || ''
                blocks.push({
                  pos: offset,
                  end: offset + node.nodeSize,
                  top: (rect.top - rootRect.top) / layoutScale,
                  bottom: (rect.bottom - rootRect.top) / layoutScale,
                  height: rect.height / layoutScale,
                  textblock: node.isTextblock,
                  keepTogether: ['table', 'pre', 'blockquote', 'figure'].includes(tagName) || Boolean(dom.querySelector('img, table, pre, .katex-display')),
                })
              })

              const naturalHeight = Math.max(contentHeight, ...blocks.map(block => block.bottom))
              const decorations: Decoration[] = []
              const separatorHeight = options.marginBottom + options.pageGap + options.marginTop

              const lineStartsForBlock = (block: typeof blocks[number]) => {
                const dom = view.nodeDOM(block.pos) as HTMLElement | null
                if (!dom) return [] as Array<{ pos: number; top: number; bottom: number }>
                const lines: Array<{ pos: number; top: number; bottom: number }> = []
                const walker = globalThis.document.createTreeWalker(dom, NodeFilter.SHOW_TEXT)
                let textNode = walker.nextNode() as Text | null
                let previousTop = Number.NEGATIVE_INFINITY
                while (textNode) {
                  const textLength = textNode.data.length
                  for (let offset = 0; offset < textLength; offset += 1) {
                    const range = globalThis.document.createRange()
                    range.setStart(textNode, offset)
                    range.setEnd(textNode, offset + 1)
                    const rect = range.getBoundingClientRect()
                    const top = (rect.top - rootRect.top) / layoutScale
                    if (rect.height > 0 && Math.abs(top - previousTop) > 1) {
                      try {
                        lines.push({ pos: view.posAtDOM(textNode, offset), top, bottom: (rect.bottom - rootRect.top) / layoutScale })
                        previousTop = top
                      } catch {
                        // Ignore DOM fragments that ProseMirror cannot map (for example rendered math internals).
                      }
                    }
                  }
                  textNode = walker.nextNode() as Text | null
                }
                return lines
              }

              let naturalPageStart = 0
              let pageIndex = 1
              while (naturalHeight > naturalPageStart + contentHeight && pageIndex < 100) {
                const boundary = naturalPageStart + contentHeight
                const blockIndex = blocks.findIndex(block => block.bottom > boundary)
                if (blockIndex < 0) break
                const block = blocks[blockIndex]
                const nextBlock = blocks[blockIndex + 1]
                let breakPos = block.pos
                let breakTop = block.top

                const isHeading = (() => {
                  const dom = view.nodeDOM(block.pos) as HTMLElement | null
                  return Boolean(dom && /^h[1-6]$/i.test(dom.tagName))
                })()
                const shouldKeepWithNext = isHeading && nextBlock && nextBlock.bottom > boundary

                if (block.top < boundary && block.bottom > boundary && block.textblock && !block.keepTogether && !shouldKeepWithNext) {
                  const lines = lineStartsForBlock(block)
                  const crossingLineIndex = lines.findIndex(line => line.bottom > boundary)
                  const canMoveWholeBlock = block.top > naturalPageStart + 1
                  if (crossingLineIndex >= 2 && lines.length - crossingLineIndex >= 2) {
                    breakPos = lines[crossingLineIndex].pos
                    breakTop = lines[crossingLineIndex].top
                  } else if (!canMoveWholeBlock && crossingLineIndex >= 0) {
                    breakPos = lines[crossingLineIndex].pos
                    breakTop = lines[crossingLineIndex].top
                  }
                } else if (block.top >= boundary) {
                  breakPos = block.pos
                  breakTop = block.top
                } else if (block.height > contentHeight && block.textblock) {
                  const lines = lineStartsForBlock(block)
                  const crossingLine = lines.find(line => line.bottom > boundary)
                  if (crossingLine) {
                    breakPos = crossingLine.pos
                    breakTop = crossingLine.top
                  }
                }

                breakPos = Math.max(1, Math.min(docSize, breakPos))
                if (decorations.some(item => item.from === breakPos) || breakTop <= naturalPageStart + 1) break
                const pageSeparatorHeight = separatorHeight + Math.max(0, boundary - breakTop)
                decorations.push(Decoration.widget(breakPos, () => {
                  const separator = globalThis.document.createElement('span')
                  separator.className = 'document-page-separator'
                  separator.setAttribute('contenteditable', 'false')
                  separator.setAttribute('aria-hidden', 'true')
                  separator.style.display = 'block'
                  separator.style.height = `${pageSeparatorHeight}px`
                  separator.style.pointerEvents = 'none'
                  return separator
                }, { side: -1, key: `page-${pageIndex}-${breakPos}` }))
                naturalPageStart = breakTop
                pageIndex += 1
              }

              const pageCount = decorations.length + 1
              if (pageCount !== lastPageCount) {
                lastPageCount = pageCount
                options.onPageCountChange?.(pageCount)
              }
              view.dispatch(view.state.tr.setMeta(paginationPluginKey, DecorationSet.create(view.state.doc, decorations)))
            })
          }

          schedulePagination()
          return {
            update(updatedView: EditorView, previousState) {
              if (updatedView.state.doc !== previousState.doc) schedulePagination()
            },
            destroy() {
              if (frame !== null) cancelAnimationFrame(frame)
            },
          }
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
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image,
      Link.configure({
        openOnClick: false,
      }),
      LinkShortcut,
      Mathematics,
      PersistentSelectionHighlight,
      ...(pagination ? [Pagination.configure(pagination)] : []),
    ],
    content: content,
    editable: !readOnly,
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  }, [pagination?.pageHeight, pagination?.pageGap, pagination?.marginTop, pagination?.marginBottom])

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
          context="Documento didattico"
        />
      )}
    </div>
  )
}
