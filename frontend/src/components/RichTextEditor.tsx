import { useEditor, EditorContent, Editor, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import { useEffect, useState, useCallback } from 'react'
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

export function RichTextEditor({
  content,
  onChange,
  onEditorReady,
  readOnly = false,
  contentClassName,
  aiPanelAnchor,
  aiOpenRequestId = 0,
  onMissingSelectionForAI
}: RichTextEditorProps) {
  const [selection, setSelection] = useState<SelectionState | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image,
      Link.configure({
        openOnClick: false,
      }),
      LinkShortcut,
    ],
    content: content,
    editable: !readOnly,
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  // Handle text selection for AI assist
  const handleMouseUp = useCallback(() => {
    if (!editor || readOnly) return

    // Small delay to ensure selection is complete
    setTimeout(() => {
      const { from, to } = editor.state.selection
      const selectedText = editor.state.doc.textBetween(from, to, ' ')

      if (selectedText && selectedText.trim().length > 3) {
        const fallbackPosition = { x: 20, y: 80 }
        setSelection({
          from,
          to,
          text: selectedText.trim(),
          position: aiPanelAnchor || fallbackPosition
        })
      } else {
        setSelection(null)
      }
    }, 10)
  }, [editor, readOnly, aiPanelAnchor])

  // Open AI panel explicitly from toolbar button, anchored under toolbar icon.
  useEffect(() => {
    if (!editor || readOnly || aiOpenRequestId === 0) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim()
    if (!selectedText || selectedText.length < 1) {
      onMissingSelectionForAI?.()
      return
    }
    setSelection({
      from,
      to,
      text: selectedText,
      position: aiPanelAnchor || { x: 20, y: 80 }
    })
  }, [aiOpenRequestId, editor, readOnly, aiPanelAnchor, onMissingSelectionForAI])

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

  // Sync content updates from parent
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      if (!editor.isFocused) {
        editor.commands.setContent(content)
      }
    }
  }, [content, editor])

  // Apply AI-generated text
  const handleApplyAIText = useCallback((newText: string) => {
    if (!editor || !selection) return

    const { from, to } = selection
    const nextContent = looksLikeMarkdown(newText) ? renderMarkdownToHtml(newText) : newText
    editor.chain().focus().deleteRange({ from, to }).insertContent(nextContent).run()
    setSelection(null)
  }, [editor, selection])

  if (!editor) {
    return null
  }

  return (
    <div className="flex flex-col min-h-full bg-transparent relative">
      <EditorContent
        editor={editor}
        className={contentClassName || "flex-1 p-8 prose max-w-none focus:outline-none min-h-[500px]"}
        onMouseUp={handleMouseUp}
        onMouseDown={handleMouseDown}
      />

      {/* AI Assist Panel */}
      {selection && !readOnly && (
        <AITextAssistPanel
          selectedText={selection.text}
          position={aiPanelAnchor || selection.position}
          onClose={() => setSelection(null)}
          onApply={handleApplyAIText}
          context="Documento didattico"
        />
      )}
    </div>
  )
}
