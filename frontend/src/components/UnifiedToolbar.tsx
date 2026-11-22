import { useState, useEffect, useRef, useCallback } from 'react'
import { ColorPicker } from '@/components/ui/ColorPicker'
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo, Redo, Image as ImageIcon, Link as LinkIcon,
  Pilcrow, Type, Plus, Minus, Video, ZoomIn, ZoomOut, Sparkles, Rows3,
  Square, Circle, RotateCw, Magnet, Grid3x3, Layers, Paintbrush, ListTree, Eraser, Highlighter, Palette, Settings2
} from '@/components/icons'
import { Button } from './ui/button'
import { Editor } from '@tiptap/react'
import { SlideBlock, SlideBlockType, SlideSnapOptions, type ShapeSlideBlock, type TextSlideBlock } from './SlideEditor'
import { AIImageGeneratorModal } from './AIImageGeneratorModal'
import { DocumentTableMenu } from '@/components/documents/DocumentTableMenu'
import { useFormatPainter } from '@/hooks/useFormatPainter'
import { CompositionOptions } from '@/components/documents/CompositionMenu'
import { MenuDivider, MenuIconRow, MenuLabel, MenuRow, ToolbarSection } from '@/components/documents/ToolbarSectionMenu'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_LINE_SPACING, LINE_SPACING_OPTIONS, documentRow } from '@/lib/documentPage'
import { applyFormatOperations, clearFormatting, STRUCTURE_CLEANUP } from '@/lib/documentFormatOps'
import { useToast } from '@/components/ui/use-toast'
import {
  DEFAULT_DOC_FONT_PT, DOC_FONTS as FONTS, DOC_FONT_SIZES as FONT_SIZES, fontSizeToPoints, primaryFontFamily, setFontSize, stepFontSize,
} from '@/lib/documentTextFormat'
import { tl } from '@/i18n/tl'

interface UnifiedToolbarProps {
  mode: 'document' | 'slides'
  allowAI?: boolean
  onInsertImage?: () => void
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
  /** Document line spacing (baseline grid row = 16 px × value) and its setter. */
  lineSpacing?: number
  onLineSpacingChange?: (value: number) => void
  snapOptions?: SlideSnapOptions
  onChangeSnapOptions?: (options: SlideSnapOptions) => void
  layersPanelOpen?: boolean
  onToggleLayersPanel?: () => void
  /** Slide look editor (background, fonts, sizes, colours, saved styles). */
  onOpenSlideStyle?: () => void
}

export function UnifiedToolbar({
  slideHistory,
  mode,
  allowAI = true,
  onInsertImage,
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
  lineSpacing = DEFAULT_LINE_SPACING,
  onLineSpacingChange,
  snapOptions,
  onChangeSnapOptions,
  layersPanelOpen = false,
  onToggleLayersPanel,
  onOpenSlideStyle
}: UnifiedToolbarProps) {
  const [showImageModal, setShowImageModal] = useState(false)
  const formatPainter = useFormatPainter(mode === 'document' ? editor : null)
  const { toast } = useToast()
  const [hasTextSelection, setHasTextSelection] = useState(false)
  const aiAssistButtonRef = useRef<HTMLButtonElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
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
  const [openSection, setOpenSection] = useState<string | null>(null)
  const toggleSection = (id: string) => setOpenSection((current) => (current === id ? null : id))
  const closeSection = useCallback(() => setOpenSection(null), [])
  const docRow = documentRow({ lineSpacing })
  const caretBlock = mode === 'document' && editor ? editor.state.selection.$from.parent : null
  const paragraphStyle = !editor ? 'p' : editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'
  /** Space of the caret paragraph in whole rows (the sheet rounds any space up to the grid). */
  const spaceRows = (value: unknown, fallback: number) => {
    const px = Number.parseFloat(String(value ?? ''))
    return Number.isFinite(px) ? Math.ceil(px / docRow - 0.01) : fallback
  }
  const setParagraphSpacing = (key: 'spaceBefore' | 'spaceAfter', value: string | null) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const tr = editor.state.tr
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [key]: value })
        return false
      }
      return true
    })
    if (tr.docChanged) editor.view.dispatch(tr)
    editor.view.focus()
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

      {/* DOCUMENT MODE TOOLBAR: settings grouped in named sections, each opening a vertical menu. */}
      {mode === 'document' && editor && (
        <>
          <div className={groupClass}>
            <ToolbarSection label={tl("Testo")} icon={Type} open={openSection === 'text'} onToggle={() => toggleSection('text')} onClose={closeSection}>
              <MenuLabel>{tl("Carattere")}</MenuLabel>
              <div className="space-y-1.5 px-1.5 pb-1">
                <select
                  className="ds-control h-9 w-full rounded-[var(--control-radius)] px-3 text-sm"
                  value={activeFontFamily}
                  onMouseDown={saveSelection}
                  onChange={(e) => restoreSelection(editor.chain().focus()).setFontFamily(e.target.value).run()}
                  title={tl("Carattere")}
                >
                  {fontOptions.map(f => <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={decreaseFontSize} title={tl("Riduci font")}><Minus className="h-4 w-4" /></Button>
                  <select
                    className="ds-control h-9 flex-1 rounded-[var(--control-radius)] px-3 text-sm"
                    value={String(activeFontSize)}
                    onMouseDown={saveSelection}
                    onChange={(e) => applyFontSize(Number(e.target.value))}
                    title={tl("Dimensione font")}
                  >
                    {fontSizeOptions.map((size) => <option key={size} value={size}>{size} pt</option>)}
                  </select>
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={increaseFontSize} title={tl("Aumenta font")}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
              <MenuLabel>{tl("Stile")}</MenuLabel>
              <MenuIconRow items={[
                { icon: Bold, label: tl("Grassetto"), active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
                { icon: Italic, label: tl("Corsivo"), active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
                { icon: Underline, label: tl("Sottolineato"), active: editor.isActive('underline'), onClick: () => editor.chain().focus().toggleUnderline().run() },
                { icon: Strikethrough, label: tl("Barrato"), active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
              ]} />
              <div className="flex min-h-9 items-center gap-2.5 px-3 py-1 text-sm text-[var(--text-primary)]">
                <Palette className="h-4 w-4 shrink-0 opacity-80" />
                <span className="flex-1">{tl("Colore testo")}</span>
                <ColorPicker glyph="A" value={editor.getAttributes('textStyle').color || '#000000'} onChange={(color) => editor.chain().focus().setColor(color).run()} title={tl("Colore testo")} />
              </div>
              <MenuRow icon={Highlighter} label={tl("Evidenzia")} hint="Ctrl+Alt+H" active={editor.isActive('importedHighlight')}
                onClick={() => (editor.isActive('importedHighlight') ? editor.chain().focus().unsetMark('importedHighlight').run() : editor.chain().focus().setMark('importedHighlight', { color: '#fef08a' }).run())} />
              <MenuDivider />
              <MenuRow icon={Eraser} label={tl("Cancella formattazione")} hint="Ctrl+\" onClick={() => { clearFormatting(editor); closeSection() }} />
            </ToolbarSection>

            <ToolbarSection label={tl("Paragrafo")} icon={Pilcrow} open={openSection === 'paragraph'} onToggle={() => toggleSection('paragraph')} onClose={closeSection}>
              <MenuLabel>{tl("Stile del paragrafo")}</MenuLabel>
              {([['p', tl("Testo normale"), 'Ctrl+Alt+0'], ['h1', tl("Titolo 1"), 'Ctrl+Alt+1'], ['h2', tl("Titolo 2"), 'Ctrl+Alt+2'], ['h3', tl("Titolo 3"), 'Ctrl+Alt+3']] as const).map(([value, label, hint]) => (
                <MenuRow key={value} label={label} hint={hint} active={paragraphStyle === value}
                  onClick={() => (value === 'p' ? editor.chain().focus().setParagraph().run() : editor.chain().focus().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run())} />
              ))}
              <MenuLabel>{tl("Allineamento")}</MenuLabel>
              <MenuIconRow items={[
                { icon: AlignLeft, label: tl("A sinistra"), active: editor.isActive({ textAlign: 'left' }), onClick: () => editor.chain().focus().setTextAlign('left').run() },
                { icon: AlignCenter, label: tl("Al centro"), active: editor.isActive({ textAlign: 'center' }), onClick: () => editor.chain().focus().setTextAlign('center').run() },
                { icon: AlignRight, label: tl("A destra"), active: editor.isActive({ textAlign: 'right' }), onClick: () => editor.chain().focus().setTextAlign('right').run() },
                { icon: AlignJustify, label: tl("Giustificato"), active: editor.isActive({ textAlign: 'justify' }), onClick: () => editor.chain().focus().setTextAlign('justify').run() },
              ]} />
              <MenuLabel>{tl("Elenchi")}</MenuLabel>
              <MenuRow icon={List} label={tl("Elenco puntato")} hint={tl("«- » o Tab a inizio riga")} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
              <MenuRow icon={ListOrdered} label={tl("Elenco numerato")} hint={tl("«1. » a inizio riga")} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
              <MenuLabel>{tl("Spazio prima del paragrafo")}</MenuLabel>
              <div className="flex gap-1 px-1.5 pb-1">
                {[0, 1, 2].map((rows) => (
                  <button key={rows} type="button" onClick={() => setParagraphSpacing('spaceBefore', rows === 0 ? null : `${rows * docRow}px`)}
                    className={`h-9 flex-1 rounded-[var(--control-radius)] text-xs font-semibold transition-colors ${spaceRows(caretBlock?.attrs.spaceBefore, 0) === rows ? 'ds-selected' : 'text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}>
                    {rows === 0 ? tl("Nessuno") : rows === 1 ? tl("1 riga") : tl("{0} righe", rows)}
                  </button>
                ))}
              </div>
              <MenuLabel>{tl("Spazio dopo il paragrafo")}</MenuLabel>
              <div className="flex gap-1 px-1.5 pb-1">
                {[0, 1, 2].map((rows) => (
                  <button key={rows} type="button" onClick={() => setParagraphSpacing('spaceAfter', rows === 1 ? null : `${rows * docRow}px`)}
                    className={`h-9 flex-1 rounded-[var(--control-radius)] text-xs font-semibold transition-colors ${spaceRows(caretBlock?.attrs.spaceAfter, 1) === rows ? 'ds-selected' : 'text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}>
                    {rows === 0 ? tl("Nessuno") : rows === 1 ? tl("1 riga") : tl("{0} righe", rows)}
                  </button>
                ))}
              </div>
            </ToolbarSection>

            <ToolbarSection label={tl("Inserisci")} icon={Plus} open={openSection === 'insert'} onToggle={() => toggleSection('insert')} onClose={closeSection} width={300}>
              <MenuRow icon={LinkIcon} label={tl("Collegamento")} hint="Ctrl+K" active={editor.isActive('link')} onClick={() => { closeSection(); setLink() }} />
              <MenuRow icon={ImageIcon} label={tl("Immagine")} onClick={() => { closeSection(); if (onInsertImage) onInsertImage(); else setShowImageModal(true) }} />
              <DocumentTableMenu editor={editor} inline onDone={closeSection} />
            </ToolbarSection>

            <ToolbarSection label={tl("Foglio")} icon={Rows3} open={openSection === 'sheet'} onToggle={() => toggleSection('sheet')} onClose={closeSection}>
              <MenuLabel>{tl("Interlinea del documento")}</MenuLabel>
              {LINE_SPACING_OPTIONS.map((value) => (
                <MenuRow key={value} label={value.toLocaleString('it-IT')} hint={tl("Riga di {0} px", documentRow({ lineSpacing: value }))}
                  active={Math.abs(lineSpacing - value) < 0.001} disabled={!onLineSpacingChange}
                  onClick={() => onLineSpacingChange?.(value)} />
              ))}
              <MenuDivider />
              <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-[var(--control-radius)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]">
                <span className="flex items-center gap-2.5"><Rows3 className="h-4 w-4 opacity-80" />{tl("Mostra le righe del foglio")}</span>
                <Switch checked={showRuledLines} onCheckedChange={() => onToggleRuledLines?.()} />
              </label>
            </ToolbarSection>

            <ToolbarSection label={tl("Strumenti")} icon={Settings2} open={openSection === 'tools'} onToggle={() => toggleSection('tools')} onClose={closeSection} width={320}>
              <MenuRow icon={Paintbrush} label={tl("Copia formattazione")} hint={formatPainter.armed ? tl("Seleziona il testo di destinazione (Esc per annullare)") : tl("Copia lo stile del testo o paragrafo corrente")}
                active={formatPainter.armed} onClick={() => { formatPainter.copy(); closeSection() }} />
              <MenuRow icon={ListTree} label={tl("Riordina struttura")} hint={tl("Righe vuote → spaziatura, riconosce capitoli e titoli")} onClick={() => { cleanUpStructure(); closeSection() }} />
              <MenuLabel>{tl("Composizione automatica")}</MenuLabel>
              <CompositionOptions />
            </ToolbarSection>
          </div>

          {/* Quick formatting, always at hand */}
          <div className={groupClass}>
            <Button size="icon" variant="ghost" title={tl("Grassetto (Ctrl+B)")} className={`h-8 w-8 ${editor.isActive('bold') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" title={tl("Corsivo (Ctrl+I)")} className={`h-8 w-8 ${editor.isActive('italic') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" title={tl("Sottolineato (Ctrl+U)")} className={`h-8 w-8 ${editor.isActive('underline') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <Underline className="h-4 w-4" />
            </Button>
          </div>

          {allowAI && <Button
            ref={aiAssistButtonRef}
            density="icon"
            tone="warning"
            surface={hasTextSelection ? 'soft' : 'ghost'}
            disabled={!hasTextSelection}
            className={`h-8 w-8 transition ${hasTextSelection ? 'scale-105 shadow-[var(--selection-shadow)]' : ''}`}
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
          </Button>}
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
              {onOpenSlideStyle && (
                <Button size="icon" variant="ghost" className="h-8 w-8" title={tl("Stile delle slide: sfondo, caratteri, colori")} aria-label={tl("Stile delle slide")} onClick={onOpenSlideStyle}>
                  <Palette className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* Insert Group */}
          <div className="flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300">
            <Button variant="ghost" size="icon" onClick={() => onAddSlideBlock?.('text')} className="h-8 w-8 rounded-lg" title={tl("Testo")}>
              <Type className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onInsertImage ? onInsertImage() : setShowImageModal(true)} className="h-8 w-8 rounded-lg" title={tl("Immagine")}>
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onAddSlideBlock?.('video')} className="h-8 w-8 rounded-lg" title={tl("Video da link")}>
              <Video className="h-4 w-4" />
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
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700" title={tl("Le modifiche si applicano a tutti gli oggetti selezionati")}>
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
                  className={`rounded-full px-2 py-1 text-[11px] font-semibold ${useRange ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
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
