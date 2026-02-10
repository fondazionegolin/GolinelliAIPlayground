import { useState, useEffect, useRef } from 'react'
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo, Redo, Image as ImageIcon, Link as LinkIcon,
  Heading1, Heading2, Pilcrow, Type, Plus, Minus, ZoomIn, ZoomOut, Sparkles, Rows3
} from 'lucide-react'
import { Button } from './ui/button'
import { Editor } from '@tiptap/react'
import { SlideBlock } from './SlideEditor'
import { AIImageGeneratorModal } from './AIImageGeneratorModal'

interface UnifiedToolbarProps {
  mode: 'document' | 'slides'
  // Document Mode Props
  editor?: Editor | null
  docScale?: number
  setDocScale?: (s: number) => void
  // Slide Mode Props
  scale?: number
  setScale?: (s: number) => void
  onAddSlideBlock?: (type: 'text' | 'image') => void
  onAddSlideImage?: (imageUrl: string) => void
  selectedBlock?: SlideBlock
  onUpdateBlockStyle?: (key: string, value: any) => void
  onOpenAIAssist?: (position: { x: number; y: number }) => void
  onAIAssistAnchorChange?: (position: { x: number; y: number }) => void
  showRuledLines?: boolean
  onToggleRuledLines?: () => void
}

const FONTS = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Arial Black'
]

export function UnifiedToolbar({
  mode,
  editor,
  docScale = 1,
  setDocScale,
  scale = 1,
  setScale,
  onAddSlideBlock,
  onAddSlideImage,
  selectedBlock,
  onUpdateBlockStyle,
  onOpenAIAssist,
  onAIAssistAnchorChange,
  showRuledLines = false,
  onToggleRuledLines
}: UnifiedToolbarProps) {
  const [showImageModal, setShowImageModal] = useState(false)
  const aiAssistButtonRef = useRef<HTMLButtonElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [isCompactLayout, setIsCompactLayout] = useState(false)
  const stackVertical = mode === 'document' && isCompactLayout
  const groupClass = stackVertical
    ? 'flex items-center gap-0.5 w-full border-b border-slate-200 pb-1 mb-1'
    : 'flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300'

  const handleImageGenerated = (imageUrl: string) => {
    if (mode === 'document' && editor) {
      editor.chain().focus().setImage({ src: imageUrl }).run()
    } else if (mode === 'slides' && onAddSlideImage) {
      onAddSlideImage(imageUrl)
    }
    setShowImageModal(false)
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
    if (!toolbarRef.current) return
    const node = toolbarRef.current
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || window.innerWidth
      setIsCompactLayout(width < 980)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={toolbarRef}
      className={`flex gap-1 p-2 border-b border-slate-200 bg-white sticky top-0 z-20 shadow-sm ${stackVertical ? 'flex-col items-stretch h-auto' : 'items-center flex-wrap h-14'}`}
    >
      
      {/* History Group */}
      <div className={groupClass}>
        <Button size="icon" variant="ghost" className="h-8 w-8" 
          onClick={() => mode === 'document' ? editor?.chain().focus().undo().run() : null} 
          disabled={mode === 'document' ? !editor?.can().undo() : true} // TODO: Implement slide undo
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" 
          onClick={() => mode === 'document' ? editor?.chain().focus().redo().run() : null} 
          disabled={mode === 'document' ? !editor?.can().redo() : true}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>

      {/* DOCUMENT MODE TOOLBAR */}
      {mode === 'document' && editor && (
        <>
          {/* Font Selector */}
          <div className={groupClass}>
            <select
              className="h-8 text-xs border rounded px-2 w-28"
              onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
            >
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

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
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('strike') ? 'bg-slate-200 text-black' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <Strikethrough className="h-4 w-4" />
            </Button>
            <input
              type="color"
              onInput={event => editor.chain().focus().setColor((event.target as HTMLInputElement).value).run()}
              value={editor.getAttributes('textStyle').color || '#000000'}
              className="h-8 w-8 p-0 border-0 rounded cursor-pointer ml-1"
              title="Colore testo"
            />
          </div>

          {/* Alignment Group */}
          <div className={groupClass}>
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

          {/* Formatting Group */}
          <div className={groupClass}>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('heading', { level: 1 }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
              <Heading1 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('heading', { level: 2 }) ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('paragraph') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().setParagraph().run()}>
              <Pilcrow className="h-4 w-4" />
            </Button>
          </div>

          {/* Lists & Media */}
          <div className={stackVertical ? 'flex items-center gap-0.5 w-full border-b border-slate-200 pb-1 mb-1' : 'flex items-center gap-0.5'}>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('bulletList') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              <List className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className={`h-8 w-8 ${editor.isActive('orderedList') ? 'bg-slate-200' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={setLink}>
              <LinkIcon className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowImageModal(true)} title="Inserisci immagine">
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button
              ref={aiAssistButtonRef}
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={(e) => {
                if (!onOpenAIAssist) return
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                onOpenAIAssist({
                  x: rect.left + rect.width - 320,
                  y: rect.bottom + 8
                })
              }}
              title="Assistente AI (testo selezionato)"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </div>

          {/* Document Zoom */}
          <div className={stackVertical ? 'flex items-center gap-0.5 w-full' : 'flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300'}>
            <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 ${showRuledLines ? 'bg-slate-200 text-slate-900' : 'text-slate-500'}`}
              onClick={onToggleRuledLines}
              title="Mostra/Nascondi righe del foglio"
            >
              <Rows3 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDocScale?.(Math.max(0.5, docScale - 0.1))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs w-10 text-center">{Math.round(docScale * 100)}%</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDocScale?.(Math.min(2, docScale + 0.1))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
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

          {/* Insert Group */}
          <div className="flex items-center gap-0.5 border-r pr-2 mr-1 border-slate-300">
            <Button variant="ghost" size="sm" onClick={() => onAddSlideBlock?.('text')} className="h-8 px-2">
              <Type className="h-4 w-4 mr-1" />
              <span className="text-xs">Testo</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowImageModal(true)} className="h-8 px-2">
              <ImageIcon className="h-4 w-4 mr-1" />
              <span className="text-xs">Immagine</span>
            </Button>
          </div>

          {/* Contextual Properties (Text) */}
          {selectedBlock?.type === 'text' && onUpdateBlockStyle && (
            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
              <select 
                className="h-8 text-xs border rounded px-2 w-32"
                value={selectedBlock.style?.fontFamily || 'Arial'}
                onChange={(e) => onUpdateBlockStyle('fontFamily', e.target.value)}
              >
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>

              <div className="flex items-center border rounded h-8 px-1">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUpdateBlockStyle('fontSize', (selectedBlock.style?.fontSize || 16) - 2)}>
                  <Minus className="h-3 w-3" />
                </Button>
                <input 
                  type="number" 
                  className="h-6 w-10 text-xs border-0 text-center focus:ring-0 p-0"
                  value={selectedBlock.style?.fontSize || 16}
                  onChange={(e) => onUpdateBlockStyle('fontSize', parseInt(e.target.value))}
                />
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onUpdateBlockStyle('fontSize', (selectedBlock.style?.fontSize || 16) + 2)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
                <Button 
                  size="icon" variant="ghost" className={`h-8 w-8 ${selectedBlock.style?.fontWeight === 'bold' ? 'bg-slate-200' : ''}`}
                  onClick={() => onUpdateBlockStyle('fontWeight', selectedBlock.style?.fontWeight === 'bold' ? 'normal' : 'bold')}
                >
                  <Bold className="h-4 w-4" />
                </Button>
                <Button 
                  size="icon" variant="ghost" className={`h-8 w-8 ${selectedBlock.style?.fontStyle === 'italic' ? 'bg-slate-200' : ''}`}
                  onClick={() => onUpdateBlockStyle('fontStyle', selectedBlock.style?.fontStyle === 'italic' ? 'normal' : 'italic')}
                >
                  <Italic className="h-4 w-4" />
                </Button>
                <Button 
                  size="icon" variant="ghost" className={`h-8 w-8 ${selectedBlock.style?.textDecoration === 'underline' ? 'bg-slate-200' : ''}`}
                  onClick={() => onUpdateBlockStyle('textDecoration', selectedBlock.style?.textDecoration === 'underline' ? 'none' : 'underline')}
                >
                  <Underline className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
                <input
                  type="color"
                  value={selectedBlock.style?.color || '#000000'}
                  onChange={(e) => onUpdateBlockStyle('color', e.target.value)}
                  className="h-8 w-8 p-0 border-0 rounded cursor-pointer"
                  title="Colore Testo"
                />
                <input
                  type="color"
                  value={selectedBlock.style?.backgroundColor === 'transparent' ? '#ffffff' : selectedBlock.style?.backgroundColor}
                  onChange={(e) => onUpdateBlockStyle('backgroundColor', e.target.value)}
                  className="h-8 w-8 p-0 border-0 rounded cursor-pointer ml-1"
                  title="Colore Sfondo"
                />
              </div>

              <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-slate-300">
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${selectedBlock.style?.textAlign === 'left' ? 'bg-slate-200' : ''}`} onClick={() => onUpdateBlockStyle('textAlign', 'left')}>
                  <AlignLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${selectedBlock.style?.textAlign === 'center' ? 'bg-slate-200' : ''}`} onClick={() => onUpdateBlockStyle('textAlign', 'center')}>
                  <AlignCenter className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className={`h-8 w-8 ${selectedBlock.style?.textAlign === 'right' ? 'bg-slate-200' : ''}`} onClick={() => onUpdateBlockStyle('textAlign', 'right')}>
                  <AlignRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
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
