import { useState, useEffect, useRef, useCallback } from 'react'
import { ColorPicker } from '@/components/ui/ColorPicker'
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo, Redo, Image as ImageIcon, Link as LinkIcon,
  Heading1, Heading2, Pilcrow, Type, Plus, Minus, ZoomIn, ZoomOut, Sparkles, Rows3, MoreHorizontal,
  Square, Circle, RotateCw, Magnet, Grid3x3, Layers, Paintbrush, ListTree, Eraser, Highlighter
} from '@/components/icons'
import { Button } from './ui/button'
import { Editor } from '@tiptap/react'
import { SlideBlock, SlideBlockType, SlideSnapOptions, type ShapeSlideBlock, type TextSlideBlock } from './SlideEditor'
import { AIImageGeneratorModal } from './AIImageGeneratorModal'
import { DocumentTableMenu } from '@/components/documents/DocumentTableMenu'
import { useFormatPainter } from '@/hooks/useFormatPainter'
import { LineSpacingMenu } from '@/components/documents/LineSpacingMenu'
import { CompositionMenu } from '@/components/documents/CompositionMenu'
import { applyFormatOperations, clearFormatting, STRUCTURE_CLEANUP } from '@/lib/documentFormatOps'
import { useToast } from '@/components/ui/use-toast'
import {
  DEFAULT_DOC_FONT_PT, DOC_FONTS as FONTS, DOC_FONT_SIZES as FONT_SIZES, fontSizeToPoints, primaryFontFamily, setFontSize, stepFontSize,
} from '@/lib/documentTextFormat'
import { tl } from '@/i18n/tl'

interface UnifiedToolbarProps {
  mode: 'document' | 'slides'
  /** Slide-deck history (document mode uses the editor's own). */
  slideHistory?: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }
  // Document Mode Props
  editor?: Editor | null
  // Slide Mode Props
  scale?: number
  setScale?: (s: number) => void
  onAddSlideBlock?: (type: SlideBlockType) => void
  onAddSlideImage?: (imageUrl: string) => void
  selectedBlock?: SlideBlock
  /** How many slide objects are selected (multi-selection applies styles to all of them). */
  selectionCount?: number
  /** Every selected slide object: mixed selections show shape and text controls together. */
  selectedBlocks?: SlideBlock[]
  /** Colours already used in the deck, offered first by the colour picker. */
  documentColors?: string[]
  onUpdateBlockStyle?: (key: string, value: any) => void
  /** The focused slide text block's TipTap instance, if any (see SlideEditor's onActiveTextEditorChange).
   * When it has a non-collapsed selection, formatting buttons apply to that range instead of the whole block. */
  activeBlockEditor?: Editor | null
  onOpenAIAssist?: (position: { x: number; y: number }) => void
  onAIAssistAnchorChange?: (position: { x: number; y: number }) => void
  showRuledLines?: boolean
  onToggleRuledLines?: () => void
  snapOptions?: SlideSnapOptions
  onChangeSnapOptions?: (options: SlideSnapOptions) => void
  layersPanelOpen?: boolean
  onToggleLayersPanel?: () => void
}

export function UnifiedToolbar({
  slideHistory,
  mode,
  editor,
  scale = 1,
  setScale,
  onAddSlideBlock,
  onAddSlideImage,
  selectedBlock,
  selectionCount = 1,
  selectedBlocks,
  documentColors = [],
  onUpdateBlockStyle,
  activeBlockEditor,
  onOpenAIAssist,
  onAIAssistAnchorChange,
  showRuledLines = false,
  onToggleRuledLines,
  snapOptions,
  onChangeSnapOptions,
  layersPanelOpen = false,
  onToggleLayersPanel
}: UnifiedToolbarProps) {
  const [showImageModal, setShowImageModal] = useState(false)
  const formatPainter = useFormatPainter(mode === 'document' ? editor : null)
  const { toast } = useToast()
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [hasTextSelection, setHasTextSelection] = useState(false)
  const aiAssistButtonRef = useRef<HTMLButtonElement | null>(null)
  const overflowMenuRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [isCompactLayout, setIsCompactLayout] = useState(false)
  const groupClass = 'flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-200'

  const handleImageGenerated = (imageUrl: string) => {
    if (mode === 'document' && editor) {
      editor.chain().focus().setImage({ src: imageUrl }).run()
    } else if (mode === 'slides' && onAddSlideImage) {
      onAddSlideImage(imageUrl)
    }
    setShowImageModal(false)
  }

  const cleanUpStructure = () => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const { lines, changed } = applyFormatOperations(editor, STRUCTURE_CLEANUP, empty ? null : { from, to })
    toast({
      title: changed ? tl("Struttura riordinata") : tl("Nessuna modifica necessaria"),
      description: changed ? tl("{0}. Puoi annullare con Ctrl+Z.", lines.join(' · ')) : tl("Non ho trovato righe vuote usate come spazio né titoli da riconoscere."),
    })
  }

  const setLink = () => {
    if (mode === 'document' && editor) {
      const previousUrl = editor.getAttributes('link').href
      const url = window.prompt('URL Link:', previousUrl)
      if (url === null) return
      if (url === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
        return
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  useEffect(() => {
    if (mode !== 'document' || !onAIAssistAnchorChange) return

    const emitAnchor = () => {
      if (!aiAssistButtonRef.current) return
      const rect = aiAssistButtonRef.current.getBoundingClientRect()
      onAIAssistAnchorChange({
        x: rect.left + rect.width - 320,
        y: rect.bottom + 8
      })
    }

    emitAnchor()
    window.addEventListener('resize', emitAnchor)
    return () => window.removeEventListener('resize', emitAnchor)
  }, [mode, onAIAssistAnchorChange])

  useEffect(() => {
    if (mode !== 'document' || !editor) {
      setHasTextSelection(false)
      return
    }
    const updateSelectionState = () => {
      const { from, to } = editor.state.selection
      setHasTextSelection(from !== to && editor.state.doc.textBetween(from, to, ' ').trim().length > 0)
    }
    updateSelectionState()
    editor.on('selectionUpdate', updateSelectionState)
    return () => {
      editor.off('selectionUpdate', updateSelectionState)
    }
  }, [editor, mode])

  const selectionList = selectedBlocks && selectedBlocks.length > 0 ? selectedBlocks : selectedBlock ? [selectedBlock] : []
  const isShape = (block: SlideBlock): block is ShapeSlideBlock => block.type === 'rectangle' || block.type === 'ellipse' || block.type === 'line'
  const isText = (block: SlideBlock): block is TextSlideBlock => block.type === 'text'
  // The primary (last clicked) block wins when it has the right type, so its values are displayed.
  const shapeBlock = selectedBlock && isShape(selectedBlock) ? selectedBlock : selectionList.find(isShape)
  const rectBlock = [selectedBlock, ...selectionList].find((block): block is ShapeSlideBlock => Boolean(block && block.type === 'rectangle'))
  const textBlock = selectedBlock && isText(selectedBlock) ? selectedBlock : selectionList.find(isText)

  // Same pattern as the document-mode selection tracking above, but for whichever slide text
  // block is currently focused — drives whether formatting buttons target the highlighted
  // range (hasBlockRangeSelection) or fall back to the whole-block style (onUpdateBlockStyle).
  const [hasBlockRangeSelection, setHasBlockRangeSelection] = useState(false)
  useEffect(() => {
    if (mode !== 'slides' || !activeBlockEditor) {
      setHasBlockRangeSelection(false)
      return
    }
    const updateSelectionState = () => {
      const { from, to } = activeBlockEditor.state.selection
      setHasBlockRangeSelection(from !== to && activeBlockEditor.state.doc.textBetween(from, to, ' ').trim().length > 0)
    }
    updateSelectionState()
    activeBlockEditor.on('selectionUpdate', updateSelectionState)
    return () => {
      activeBlockEditor.off('selectionUpdate', updateSelectionState)
    }
  }, [activeBlockEditor, mode])

  useEffect(() => {
    if (!toolbarRef.current) return
    const node = toolbarRef.current
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || window.innerWidth
      setIsCompactLayout(width < 820)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!overflowMenuRef.current) return
      if (!overflowMenuRef.current.contains(event.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const activeFontSizeAttr = editor?.getAttributes('textStyle')?.fontSize
  const activeFontSize = activeFontSizeAttr ? fontSizeToPoints(activeFontSizeAttr) : DEFAULT_DOC_FONT_PT
  const fontSizeOptions = FONT_SIZES.includes(activeFontSize) ? FONT_SIZES : [...FONT_SIZES, activeFontSize].sort((a, b) => a - b)
  const activeFontFamily = primaryFontFamily(editor?.getAttributes('textStyle')?.fontFamily) || 'Arial'
  const fontOptions = FONTS.includes(activeFontFamily) ? FONTS : [activeFontFamily, ...FONTS]

  // Save editor selection before select/color-input steals browser focus
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const saveSelection = useCallback(() => {
    if (editor) {
      const { from, to } = editor.state.selection
      savedSelectionRef.current = { from, to }
    }
  }, [editor])

  // Select/colour popups steal focus, so their range is remembered once and consumed once. A stale
  // range must never leak into the +/- buttons (they keep the editor focused and need no restore).
  const restoreSelection = useCallback((chain: ReturnType<NonNullable<typeof editor>['chain']>) => {
    const s = savedSelectionRef.current
    savedSelectionRef.current = null
    if (s && s.from !== s.to) {
      chain.setTextSelection({ from: s.from, to: s.to })
    }
    return chain
  }, [])

  const applyFontSize = (size: number) => {
    if (mode !== 'document' || !editor) return
    const s = savedSelectionRef.current
    savedSelectionRef.current = null
    if (s && s.from !== s.to) editor.chain().setTextSelection({ from: s.from, to: s.to }).run()
    setFontSize(editor, size)
  }
  const decreaseFontSize = () => { if (editor) stepFontSize(editor, -1) }
  const increaseFontSize = () => { if (editor) stepFontSize(editor, 1) }

  return (
    <div
      ref={toolbarRef}
      className="flex h-12 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-1.5"
      onMouseDown={(e) => {
        // Prevent editor from losing focus when clicking any toolbar button.
        // select/input/textarea elements are excluded so their native behaviour is preserved.
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault()
      }}
    >
      
      {/* History Group */}
      {(mode === 'document' || slideHistory) && <div className={groupClass}>
        <Button size="icon" variant="ghost" className="h-8 w-8"
          title={tl("Annulla (Ctrl+Z)")}
          onClick={() => mode === 'document' ? editor?.chain().focus().undo().run() : slideHistory?.undo()}
          disabled={mode === 'document' ? !editor?.can().undo() : !slideHistory?.canUndo}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8"
          title={tl("Ripeti (Ctrl+Shift+Z)")}
          onClick={() => mode === 'document' ? editor?.chain().focus().redo().run() : slideHistory?.redo()}
          disabled={mode === 'document' ? !editor?.can().redo() : !slideHistory?.canRedo}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>}

      {mode === 'document' && editor && (
        <div className={groupClass}>
          <Button
            size="icon"
            variant="ghost"
            className={`h-8 w-8 ${formatPainter.armed ? 'bg-violet-100 text-violet-700' : ''}`}
            title={formatPainter.armed ? tl("Seleziona il testo a cui applicare la formattazione (Esc per annullare)") : tl("Copia formattazione: copia lo stile del testo o paragrafo corrente")}
            aria-pressed={formatPainter.armed}
            onClick={formatPainter.copy}
          >
            <Paintbrush className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title={tl("Riordina struttura: righe vuote → spaziatura tra paragrafi, riconosce capitoli e titoli (solo sulla selezione, se presente)")}
            onClick={cleanUpStructure}
          >
            <ListTree className="h-4 w-4" />
          </Button>
          <CompositionMenu />
        </div>
      )}

      {/* DOCUMENT MODE TOOLBAR */}
      {mode === 'document' && editor && (
        <>
          {/* Font Selector */}
          {!isCompactLayout && (
          <div className={groupClass}>
            <select
              className="h-8 text-xs border rounded px-2 w-32"
              value={activeFontFamily}
              onMouseDown={saveSelection}
              onChange={(e) => restoreSelection(editor.chain().focus()).setFontFamily(e.target.value).run()}
              title={tl("Carattere")}
            >
              {fontOptions.map(f => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
            </select>
            <div className="flex items-center gap-0.5 ml-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={decreaseFontSize} title={tl("Riduci font")}>
                <Minus className="h-4 w-4" />
              </Button>
              <select
                className="h-8 text-xs border rounded px-2 w-16"
                value={String(activeFontSize)}
                onMouseDown={saveSelection}
                onChange={(e) => applyFontSize(Number(e.target.value))}
                title={tl("Dimensione font")}
              >
                {fontSizeOptions.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={increaseFontSize} title={tl("Aumenta font")}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          )}

          {/* Text Style Group */}
          <div className={groupClass}>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('bold') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('italic') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('underline') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <Underline className="h-4 w-4" />
            </Button>
            {!isCompactLayout && (
              <>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('strike') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <Strikethrough className="h-4 w-4" />
            </Button>
            <ColorPicker
              className="ml-1"
              glyph="A"
              value={editor.getAttributes('textStyle').color || '#000000'}
              onChange={(color) => editor.chain().focus().setColor(color).run()}
              title={tl("Colore testo")}
            />
              </>
            )}
          </div>

          {/* Alignment Group */}
          {!isCompactLayout && (
          <div className={groupClass}>
            <LineSpacingMenu editor={editor} />
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'left' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
              <AlignLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'center' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
              <AlignCenter className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'right' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
              <AlignRight className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'justify' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
              <AlignJustify className="h-4 w-4" />
            </Button>
          </div>
          )}

          {/* Paragraph style, clear formatting, highlight */}
          {!isCompactLayout && (
          <div className={groupClass}>
            <select
              className="h-8 w-36 rounded border px-2 text-xs"
              value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'}
              onChange={(event) => {
                const value = event.target.value
                const chain = editor.chain().focus()
                if (value === 'p') chain.setParagraph().run()
                else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
              }}
              title={tl("Stile del paragrafo (Ctrl+Alt+0…3)")}
            >
              <option value="p">{tl("Testo normale")}</option>
              <option value="h1">{tl("Titolo 1")}</option>
              <option value="h2">{tl("Titolo 2")}</option>
              <option value="h3">{tl("Titolo 3")}</option>
            </select>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('importedHighlight') ? 'bg-yellow-100' : ''}`} title={tl("Evidenzia (Ctrl+Alt+H)")}
              onClick={() => (editor.isActive('importedHighlight') ? editor.chain().focus().unsetMark('importedHighlight').run() : editor.chain().focus().setMark('importedHighlight', { color: '#fef08a' }).run())}>
              <Highlighter className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title={tl("Cancella formattazione (Ctrl+\\\\)")} onClick={() => clearFormatting(editor)}>
              <Eraser className="h-4 w-4" />
            </Button>
          </div>
          )}

          {/* Lists & Media */}
          <div className="flex items-center gap-0.5">
            {!isCompactLayout && (
              <>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('bulletList') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <List className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('orderedList') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={setLink}>
              <LinkIcon className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowImageModal(true)} title={tl("Inserisci immagine")}>
              <ImageIcon className="h-4 w-4" />
            </Button>
            <DocumentTableMenu editor={editor} />
              </>
            )}
            <Button
              ref={aiAssistButtonRef}
              density="icon"
              tone="warning"
              surface={hasTextSelection ? 'soft' : 'ghost'}
              disabled={!hasTextSelection}
              className={`h-8 w-8 transition-all ${hasTextSelection ? 'scale-105 shadow-[var(--selection-shadow)]' : ''}`}
              onClick={(e) => {
                if (!onOpenAIAssist) return
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                onOpenAIAssist({
                  x: rect.left + rect.width - 320,
                  y: rect.bottom + 8
                })
              }}
              title={hasTextSelection ? tl("Espandi o trasforma il testo selezionato con AI") : tl("Seleziona del testo per attivare l’assistente AI")}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            {isCompactLayout && (
              <div className="relative" ref={overflowMenuRef}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setShowOverflowMenu((v) => !v)}
                  title={tl("Altri strumenti")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
                {showOverflowMenu && (
                  <div className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl space-y-1">
                    <div className="flex items-center gap-2 pb-1 mb-1 border-b border-slate-100">
                      <select
                        className="h-8 text-xs border rounded px-2 w-full"
                        value={activeFontFamily}
                        onMouseDown={saveSelection}
                        onChange={(e) => restoreSelection(editor.chain().focus()).setFontFamily(e.target.value).run()}
                        title={tl("Carattere")}
                      >
                        {fontOptions.map(f => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1 pb-1 mb-1 border-b border-slate-100">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={decreaseFontSize} title={tl("Riduci font")}>
                        <Minus className="h-4 w-4" />
                      </Button>
                      <select
                        className="h-8 text-xs border rounded px-2 flex-1"
                        value={String(activeFontSize)}
                        onMouseDown={saveSelection}
                        onChange={(e) => applyFontSize(Number(e.target.value))}
                        title={tl("Dimensione font")}
                      >
                        {fontSizeOptions.map((size) => (
                          <option key={size} value={size}>{size} pt</option>
                        ))}
                      </select>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={increaseFontSize} title={tl("Aumenta font")}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('strike') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()}>
                        <Strikethrough className="h-4 w-4" />
                      </Button>
                      <ColorPicker
                        glyph="A"
                        value={editor.getAttributes('textStyle').color || '#000000'}
                        onChange={(color) => editor.chain().focus().setColor(color).run()}
                        title={tl("Colore testo")}
                      />
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'left' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'center' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'right' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive({ textAlign: 'justify' }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('heading', { level: 1 }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('heading', { level: 2 }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('paragraph') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setParagraph().run()}><Pilcrow className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('bulletList') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('orderedList') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={setLink}><LinkIcon className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowImageModal(true)} title={tl("Inserisci immagine")}><ImageIcon className="h-4 w-4" /></Button>
                      <DocumentTableMenu editor={editor} />
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`h-8 w-8 ${showRuledLines ? 'bg-slate-200 text-slate-900' : 'text-slate-500'}`}
                        onClick={onToggleRuledLines}
                        title={tl("Mostra/Nascondi righe del foglio")}
                      >
                        <Rows3 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Document Zoom */}
          <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
            {!isCompactLayout && (
              <Button
                size="icon"
                variant="ghost"
                className={`h-8 w-8 ${showRuledLines ? 'bg-slate-200 text-slate-900' : 'text-slate-500'}`}
                onClick={onToggleRuledLines}
                title={tl("Mostra/Nascondi righe del foglio")}
              >
                <Rows3 className="h-4 w-4" />
              </Button>
            )}
            {/* Zoom now lives in the floating page/zoom widget at the bottom right of the sheet. */}
          </div>

        </>
      )}

      {/* SLIDE MODE TOOLBAR */}
      {mode === 'slides' && (
        <>
          {/* Zoom Group */}
          <div className="flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setScale?.(Math.max(0.2, scale - 0.1))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs w-10 text-center">{Math.round(scale * 100)}%</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setScale?.(Math.min(3, scale + 0.1))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>

          {/* Snap Group */}
          {snapOptions && onChangeSnapOptions && (
            <div className="flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300">
              <Button
                size="icon" variant="ghost" className={`h-8 w-8 ${snapOptions.gridEnabled ? 'bg-slate-200' : ''}`}
                title={tl("Snap alla griglia")}
                onClick={() => onChangeSnapOptions({ ...snapOptions, gridEnabled: !snapOptions.gridEnabled })}
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
              <Button
                size="icon" variant="ghost" className={`h-8 w-8 ${snapOptions.guidesEnabled ? 'bg-slate-200' : ''}`}
                title={tl("Guide intelligenti (allineamento)")}
                onClick={() => onChangeSnapOptions({ ...snapOptions, guidesEnabled: !snapOptions.guidesEnabled })}
              >
                <Magnet className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Layers panel toggle */}
          {onToggleLayersPanel && (
            <div className="flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300">
              <Button
                size="icon" variant="ghost" className={`h-8 w-8 ${layersPanelOpen ? 'bg-slate-200' : ''}`}
                title={tl("Livelli")}
                onClick={onToggleLayersPanel}
              >
                <Layers className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Insert Group */}
          <div className="flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300">
            <Button variant="ghost" size="icon" onClick={() => onAddSlideBlock?.('text')} className="h-8 w-8 rounded-lg" title={tl("Testo")}>
              <Type className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowImageModal(true)} className="h-8 w-8 rounded-lg" title={tl("Immagine")}>
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onAddSlideBlock?.('rectangle')} className="h-8 w-8 rounded-lg" title={tl("Rettangolo")}>
              <Square className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onAddSlideBlock?.('ellipse')} className="h-8 w-8 rounded-lg" title={tl("Ellisse")}>
              <Circle className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onAddSlideBlock?.('line')} className="h-8 w-8 rounded-lg" title={tl("Linea")}>
              <Minus className="h-4 w-4" />
            </Button>
          </div>

          {selectedBlock && selectionCount > 1 && (
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700" title={tl("Le modifiche si applicano a tutti gli oggetti selezionati")}>
              {selectionCount} {tl("oggetti")}
            </span>
          )}

          {/* Contextual Properties (Shapes) — shown whenever the selection contains a shape */}
          {shapeBlock && onUpdateBlockStyle && (
            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
              {shapeBlock.type !== 'line' && (
                <ColorPicker
                  value={shapeBlock.style?.fill || '#e5e5e5'}
                  onChange={(color) => onUpdateBlockStyle('fill', color)}
                  documentColors={documentColors}
                  allowTransparent
                  title={tl("Riempimento")}
                />
              )}
              <ColorPicker
                className="ml-1"
                value={shapeBlock.style?.stroke || '#262626'}
                onChange={(color) => onUpdateBlockStyle('stroke', color)}
                documentColors={documentColors}
                allowTransparent
                title={tl("Bordo")}
              />
              <div className="flex items-center border rounded h-8 px-1 ml-1" title={tl("Spessore bordo")}>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUpdateBlockStyle('strokeWidth', Math.max(0, (shapeBlock.style?.strokeWidth ?? 2) - 1))}>
                  <Minus className="h-3 w-3" />
                </Button>
                <input
                  type="number"
                  className="h-6 w-8 text-xs border-0 text-center focus:ring-0 p-0"
                  value={shapeBlock.style?.strokeWidth ?? 2}
                  onChange={(e) => onUpdateBlockStyle('strokeWidth', parseInt(e.target.value) || 0)}
                />
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUpdateBlockStyle('strokeWidth', (shapeBlock.style?.strokeWidth ?? 2) + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {rectBlock && (
                <div className="flex items-center border rounded h-8 px-1 ml-1" title={tl("Raggio angoli")}>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUpdateBlockStyle('cornerRadius', Math.max(0, (rectBlock.style?.cornerRadius ?? 0) - 4))}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    className="h-6 w-8 text-xs border-0 text-center focus:ring-0 p-0"
                    value={rectBlock.style?.cornerRadius ?? 0}
                    onChange={(e) => onUpdateBlockStyle('cornerRadius', parseInt(e.target.value) || 0)}
                  />
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUpdateBlockStyle('cornerRadius', (rectBlock.style?.cornerRadius ?? 0) + 4)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Rotation (any block type) */}
          {selectedBlock && onUpdateBlockStyle && (
            <div className="flex items-center gap-1 border-l pl-2 ml-1 border-slate-300" title={tl("Rotazione (gradi)")}>
              <RotateCw className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="number"
                className="h-8 w-14 text-xs border rounded px-1"
                value={Math.round(selectedBlock.rotation || 0)}
                onChange={(e) => onUpdateBlockStyle('rotation', parseInt(e.target.value) || 0)}
              />
            </div>
          )}

          {/* Contextual Properties (Text) */}
          {textBlock && onUpdateBlockStyle && (() => {
            const selectedBlock = textBlock
            // When there's a highlighted range in the focused block, format commands target
            // that range via TipTap; otherwise they fall back to the whole block's style
            // (today's behavior — the sane default before the user has typed/selected anything).
            const useRange = selectionCount <= 1 && hasBlockRangeSelection && !!activeBlockEditor
            const isBold = useRange ? activeBlockEditor!.isActive('bold') : selectedBlock.style?.fontWeight === 'bold'
            const isItalic = useRange ? activeBlockEditor!.isActive('italic') : selectedBlock.style?.fontStyle === 'italic'
            const isUnderline = useRange ? activeBlockEditor!.isActive('underline') : selectedBlock.style?.textDecoration === 'underline'
            const activeColor = useRange ? (activeBlockEditor!.getAttributes('textStyle').color || '#000000') : (selectedBlock.style?.color || '#000000')
            const activeFontFamily = useRange ? (activeBlockEditor!.getAttributes('textStyle').fontFamily || 'Arial') : (selectedBlock.style?.fontFamily || 'Arial')
            const rangeFontSizeAttr = useRange ? activeBlockEditor!.getAttributes('textStyle').fontSize : null
            const activeFontSize = rangeFontSizeAttr ? parseInt(String(rangeFontSizeAttr), 10) || 16 : (selectedBlock.style?.fontSize || 16)

            const applyFontFamily = (value: string) => {
              if (useRange) activeBlockEditor!.chain().focus().setFontFamily(value).run()
              else onUpdateBlockStyle('fontFamily', value)
            }
            const applyFontSize = (size: number) => {
              const next = Math.max(8, size)
              if (useRange) activeBlockEditor!.chain().focus().setMark('textStyle', { fontSize: `${next}px` }).run()
              else onUpdateBlockStyle('fontSize', next)
            }
            const toggleBold = () => useRange ? activeBlockEditor!.chain().focus().toggleBold().run() : onUpdateBlockStyle('fontWeight', isBold ? 'normal' : 'bold')
            const toggleItalic = () => useRange ? activeBlockEditor!.chain().focus().toggleItalic().run() : onUpdateBlockStyle('fontStyle', isItalic ? 'normal' : 'italic')
            const toggleUnderline = () => useRange ? activeBlockEditor!.chain().focus().toggleUnderline().run() : onUpdateBlockStyle('textDecoration', isUnderline ? 'none' : 'underline')
            const applyColor = (value: string) => useRange ? activeBlockEditor!.chain().focus().setColor(value).run() : onUpdateBlockStyle('color', value)
            const applyAlign = (align: string) => useRange ? activeBlockEditor!.chain().focus().setTextAlign(align).run() : onUpdateBlockStyle('textAlign', align)
            const activeAlign = useRange
              ? (['left', 'center', 'right'].find(a => activeBlockEditor!.isActive({ textAlign: a })) || 'left')
              : selectedBlock.style?.textAlign

            return (
            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
              {selectionCount <= 1 && (
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-bold ${useRange ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
                  title={useRange ? tl("Le modifiche valgono solo per il testo evidenziato") : tl("Le modifiche valgono per tutto il testo del blocco")}
                >
                  {useRange ? tl("Testo selezionato") : tl("Tutto il blocco")}
                </span>
              )}
              <select
                className="h-8 text-xs border rounded px-2 w-32"
                value={primaryFontFamily(activeFontFamily) || 'Arial'}
                onChange={(e) => applyFontFamily(e.target.value)}
              >
                {(FONTS.includes(primaryFontFamily(activeFontFamily)) || !primaryFontFamily(activeFontFamily) ? FONTS : [primaryFontFamily(activeFontFamily), ...FONTS]).map(f => (
                  <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>
                ))}
              </select>

              <div className="flex items-center border rounded h-8 px-1">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => applyFontSize(activeFontSize - 2)}>
                  <Minus className="h-3 w-3" />
                </Button>
                <input
                  type="number"
                  className="h-6 w-10 text-xs border-0 text-center focus:ring-0 p-0"
                  value={activeFontSize}
                  onChange={(e) => applyFontSize(parseInt(e.target.value) || activeFontSize)}
                />
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => applyFontSize(activeFontSize + 2)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${isBold ? 'bg-slate-200' : ''}`} onClick={toggleBold}>
                  <Bold className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${isItalic ? 'bg-slate-200' : ''}`} onClick={toggleItalic}>
                  <Italic className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${isUnderline ? 'bg-slate-200' : ''}`} onClick={toggleUnderline}>
                  <Underline className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
                <ColorPicker
                  glyph="A"
                  value={activeColor}
                  onChange={applyColor}
                  documentColors={documentColors}
                  title={tl("Colore testo")}
                />
                <ColorPicker
                  className="ml-1"
                  value={selectedBlock.style?.backgroundColor}
                  onChange={(color) => onUpdateBlockStyle('backgroundColor', color)}
                  documentColors={documentColors}
                  allowTransparent
                  title={tl("Colore di sfondo del testo")}
                />
              </div>

              <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${activeAlign === 'left' ? 'bg-slate-200' : ''}`} onClick={() => applyAlign('left')}>
                  <AlignLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${activeAlign === 'center' ? 'bg-slate-200' : ''}`} onClick={() => applyAlign('center')}>
                  <AlignCenter className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${activeAlign === 'right' ? 'bg-slate-200' : ''}`} onClick={() => applyAlign('right')}>
                  <AlignRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            )
          })()}
        </>
      )}

      {/* AI Image Generator Modal */}
      <AIImageGeneratorModal
        isOpen={showImageModal}
        onClose={() => setShowImageModal(false)}
        onImageGenerated={handleImageGenerated}
      />
    </div>
  )
}
