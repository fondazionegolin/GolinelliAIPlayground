import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { BringToFront, Copy, Image as ImageIcon, Layers, MoveDown, MoveUp, RotateCw, Trash2, Type } from 'lucide-react'
import { AITextAssistPanel } from './AITextAssistPanel'
import { computeSnap, type GuideLine } from '@/lib/slideSnap'

interface TextSelectionState {
  blockId: string
  text: string
  position: { x: number; y: number }
  selectionStart: number
  selectionEnd: number
}

/** Rotates a screen-space delta by `angleDeg` into the block's local (unrotated) coordinate space,
 * so the existing per-handle resize math (defined in that local space) keeps working unchanged. */
function rotateDelta(dx: number, dy: number, angleDeg: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { dx: dx * cos + dy * sin, dy: -dx * sin + dy * cos }
}

export type BlockShapeType = 'rectangle' | 'ellipse' | 'line'
export type SlideBlockType = 'text' | 'image' | BlockShapeType

interface BaseSlideBlock {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** Degrees; undefined/0 = unrotated. Optional so documents saved before rotation existed still load. */
  rotation?: number
  /** Reserved for future layer reordering; paint order is still array order until that ships. */
  zIndex?: number
}

export interface TextSlideBlock extends BaseSlideBlock {
  type: 'text'
  content: string
  style: {
    fontFamily?: string
    fontSize?: number
    color?: string
    backgroundColor?: string
    fontWeight?: string
    fontStyle?: string
    textDecoration?: string
    textAlign?: 'left' | 'center' | 'right' | 'justify'
    lineHeight?: number
    borderRadius?: number
    padding?: number
  }
}

export interface ImageSlideBlock extends BaseSlideBlock {
  type: 'image'
  content: string
  style: {
    borderRadius?: number
    padding?: number
    backgroundColor?: string
  }
}

export interface ShapeSlideBlock extends BaseSlideBlock {
  type: BlockShapeType
  /** Unused for shapes (kept as `string` rather than `''` so generic block spreads type-check). */
  content: string
  style: {
    fill?: string
    stroke?: string
    strokeWidth?: number
    /** Rectangle only; ignored for ellipse/line. */
    cornerRadius?: number
  }
}

export type SlideBlock = TextSlideBlock | ImageSlideBlock | ShapeSlideBlock

export interface SlideSnapOptions {
  gridEnabled: boolean
  gridStep: number
  guidesEnabled: boolean
}

export const DEFAULT_SLIDE_SNAP_OPTIONS: SlideSnapOptions = { gridEnabled: true, gridStep: 20, guidesEnabled: true }

interface SlideEditorProps {
  blocks: SlideBlock[]
  onChange: (blocks: SlideBlock[]) => void
  selectedBlockId: string | null
  onSelectBlock: (id: string | null) => void
  scale?: number
  readOnly?: boolean
  /** Slide canvas dimensions (unrotated, unscaled) — used for grid/guide snap against slide bounds. */
  slideWidth?: number
  slideHeight?: number
  snapOptions?: SlideSnapOptions
  onContextAddBlock?: (type: SlideBlockType, position: { x: number; y: number }) => void
}

export function SlideEditor({
  blocks,
  onChange,
  selectedBlockId,
  onSelectBlock,
  scale = 1,
  readOnly = false,
  slideWidth,
  slideHeight,
  snapOptions = DEFAULT_SLIDE_SNAP_OPTIONS,
  onContextAddBlock
}: SlideEditorProps) {
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    isResizing: boolean
    isRotating?: boolean
    handle?: string
    startX: number
    startY: number
    /** Screen-space pivot (block center) captured once when a rotation drag starts. */
    pivotX?: number
    pivotY?: number
    initialBlock: SlideBlock | null
  } | null>(null)

  const [textSelection, setTextSelection] = useState<TextSelectionState | null>(null)
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const [activeGuides, setActiveGuides] = useState<GuideLine[]>([])
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    canvasX: number
    canvasY: number
    blockId: string | null
  } | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const selectedBlock = selectedBlockId ? blocks.find(block => block.id === selectedBlockId) || null : null
  const orderedBlocks = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))

  // Handle Canvas Click (Deselect)
  const handleCanvasClick = (e: React.MouseEvent) => {
    setContextMenu(null)
    if (e.target === canvasRef.current) {
      onSelectBlock(null)
    }
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  const normalizeLayerOrder = (nextBlocks: SlideBlock[]) =>
    nextBlocks.map((block, index) => ({ ...block, zIndex: index }))

  const duplicateBlock = (blockId: string) => {
    const block = blocks.find(item => item.id === blockId)
    if (!block) return
    const copy = {
      ...block,
      id: crypto.randomUUID(),
      x: block.x + 24,
      y: block.y + 24,
      zIndex: blocks.length,
    } as SlideBlock
    onChange(normalizeLayerOrder([...blocks, copy]))
    onSelectBlock(copy.id)
  }

  const deleteBlock = (blockId: string) => {
    onChange(normalizeLayerOrder(blocks.filter(block => block.id !== blockId)))
    if (selectedBlockId === blockId) onSelectBlock(null)
  }

  const moveLayer = (blockId: string, action: 'front' | 'back' | 'forward' | 'backward') => {
    const order = orderedBlocks.map(({ block }) => block)
    const index = order.findIndex(block => block.id === blockId)
    if (index < 0) return
    const [block] = order.splice(index, 1)
    const targetIndex =
      action === 'front' ? order.length :
      action === 'back' ? 0 :
      action === 'forward' ? Math.min(order.length, index + 1) :
      Math.max(0, index - 1)
    order.splice(targetIndex, 0, block)
    onChange(normalizeLayerOrder(order))
    onSelectBlock(blockId)
  }

  const openContextMenu = (e: React.MouseEvent, blockId: string | null) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    const canvasX = rect ? (e.clientX - rect.left) / scale : 0
    const canvasY = rect ? (e.clientY - rect.top) / scale : 0
    if (blockId) onSelectBlock(blockId)
    else onSelectBlock(null)
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX, canvasY, blockId })
  }

  const runContextAction = (action: () => void) => {
    action()
    setContextMenu(null)
  }

  // Handle Drag & Resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState || !dragState.initialBlock) return

      // Adjust delta by scale to ensure smooth movement regardless of zoom
      const deltaX = (e.clientX - dragState.startX) / scale
      const deltaY = (e.clientY - dragState.startY) / scale

      // Computed once per move (not per block) since only the dragged block needs snapping.
      let dragSnap: { x: number; y: number } | null = null
      if (dragState.isDragging && slideWidth && slideHeight) {
        const init = dragState.initialBlock!
        const proposed = { x: init.x + deltaX, y: init.y + deltaY, width: init.width, height: init.height }
        const others = blocks.filter(b => b.id !== init.id)
        const snap = computeSnap(proposed, others, { width: slideWidth, height: slideHeight }, snapOptions)
        dragSnap = { x: snap.x, y: snap.y }
        setActiveGuides(snap.guides)
      }

      const newBlocks = blocks.map(b => {
        if (b.id !== dragState.initialBlock!.id) return b

        if (dragState.isDragging) {
          return {
            ...b,
            x: dragSnap ? dragSnap.x : dragState.initialBlock!.x + deltaX,
            y: dragSnap ? dragSnap.y : dragState.initialBlock!.y + deltaY
          }
        }

        if (dragState.isRotating && dragState.pivotX !== undefined && dragState.pivotY !== undefined) {
          const angle = Math.atan2(e.clientY - dragState.pivotY, e.clientX - dragState.pivotX) * (180 / Math.PI) + 90
          const rotation = e.shiftKey ? Math.round(angle / 15) * 15 : angle
          return { ...b, rotation }
        }

        if (dragState.isResizing && dragState.handle) {
          const init = dragState.initialBlock!
          let { x, y, width, height } = init

          // Mouse movement is in screen space; the resize math below is defined in the block's own
          // local (unrotated) space, so rotate the delta back by -rotation before applying it.
          const rotation = init.rotation || 0
          const { dx: localDeltaX, dy: localDeltaY } = rotation ? rotateDelta(deltaX, deltaY, -rotation) : { dx: deltaX, dy: deltaY }

          switch (dragState.handle) {
            case 'se': width += localDeltaX; height += localDeltaY; break;
            case 'sw': width -= localDeltaX; height += localDeltaY; x += localDeltaX; break;
            case 'ne': width += localDeltaX; height -= localDeltaY; y += localDeltaY; break;
            case 'nw': width -= localDeltaX; height -= localDeltaY; x += localDeltaX; y += localDeltaY; break;
            case 'n': height -= localDeltaY; y += localDeltaY; break;
            case 's': height += localDeltaY; break;
            case 'e': width += localDeltaX; break;
            case 'w': width -= localDeltaX; x += localDeltaX; break;
          }

          // Constraints — lines are allowed to be near-zero thickness/degenerate on one axis
          // (a horizontal or vertical line is a normal, common case), so skip the floor for them.
          if (init.type !== 'line') {
            if (width < 20) width = 20
            if (height < 20) height = 20
          }

          return { ...b, x, y, width, height }
        }
        return b
      })

      onChange(newBlocks)
    }

    const handleMouseUp = () => {
      setDragState(null)
      setActiveGuides([])
    }

    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, blocks, onChange, scale, slideWidth, slideHeight, snapOptions])

  // Handle text selection in textarea for AI assist
  const handleTextSelection = useCallback((blockId: string, textarea: HTMLTextAreaElement) => {
    if (readOnly) return

    const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)

    if (selectedText && selectedText.trim().length > 3) {
      const rect = textarea.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const panelHeight = 320 // Approximate panel height

      // Position panel above the textarea if there's not enough space below
      let yPos = rect.top - panelHeight - 10
      if (yPos < 80) {
        // If not enough space above, try below but with safe margin
        yPos = Math.min(rect.bottom + 10, viewportHeight - panelHeight - 20)
      }

      setTextSelection({
        blockId,
        text: selectedText.trim(),
        position: {
          x: rect.left + rect.width / 2 - 140,
          y: yPos
        },
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd
      })
    } else {
      setTextSelection(null)
    }
  }, [readOnly])

  // Apply AI-generated text to textarea
  const handleApplyAIText = useCallback((newText: string) => {
    if (!textSelection) return

    const textarea = textareaRefs.current.get(textSelection.blockId)
    if (!textarea) return

    const block = blocks.find(b => b.id === textSelection.blockId)
    if (!block) return

    const beforeSelection = block.content.substring(0, textSelection.selectionStart)
    const afterSelection = block.content.substring(textSelection.selectionEnd)
    const newContent = beforeSelection + newText + afterSelection

    const newBlocks = blocks.map(b =>
      b.id === textSelection.blockId ? { ...b, content: newContent } : b
    )
    onChange(newBlocks)
    setTextSelection(null)
  }, [textSelection, blocks, onChange])

  // Handle file drop for images
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (readOnly) return
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        if (event.target?.result) {
          const newBlock: SlideBlock = {
            id: crypto.randomUUID(),
            type: 'image',
            content: event.target.result as string,
            x: e.nativeEvent.offsetX / scale,
            y: e.nativeEvent.offsetY / scale,
            width: 300,
            height: 200,
            style: {}
          }
          onChange([...blocks, newBlock])
          onSelectBlock(newBlock.id)
        }
      }
      reader.readAsDataURL(files[0])
    }
  }

  return (
    <div 
      ref={canvasRef}
      className="flex-1 relative overflow-hidden bg-white shadow-inner w-full h-full"
      onMouseDown={handleCanvasClick}
      onContextMenu={(e) => openContextMenu(e, null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{ 
        cursor: dragState?.isDragging ? 'grabbing' : 'default',
        backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}
    >
      {!blocks.length && !readOnly && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-300 pointer-events-none select-none">
          <p>Trascina immagini qui o usa la barra strumenti</p>
        </div>
      )}

      {orderedBlocks.map(({ block, index }) => (
        <div
          key={block.id}
          className={`absolute group ${selectedBlockId === block.id ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-slate-300'}`}
          style={{
            left: block.x,
            top: block.y,
            width: block.width,
            height: block.height,
            zIndex: selectedBlockId === block.id ? 1000 : block.zIndex ?? index,
            cursor: dragState?.isDragging ? 'grabbing' : 'grab',
            transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
            transformOrigin: 'center center',
            ...(block.type === 'text' || block.type === 'image'
              ? {
                  backgroundColor: block.style.backgroundColor || 'transparent',
                  borderRadius: block.style.borderRadius,
                  padding: block.style.padding,
                }
              : block.type === 'rectangle' || block.type === 'ellipse'
                ? {
                    backgroundColor: block.style.fill || 'transparent',
                    border: `${block.style.strokeWidth ?? 1}px solid ${block.style.stroke || '#1e293b'}`,
                    borderRadius: block.type === 'ellipse' ? '50%' : (block.style.cornerRadius ?? 0),
                  }
                : {}),
          }}
          onContextMenu={(e) => openContextMenu(e, block.id)}
          onMouseDown={(e) => {
            if (readOnly) return
            e.stopPropagation()
            onSelectBlock(block.id)
            setDragState({
              isDragging: true,
              isResizing: false,
              startX: e.clientX,
              startY: e.clientY,
              initialBlock: block
            })
          }}
        >
          {/* Content */}
          {block.type === 'text' ? (
            <textarea
              ref={(el) => {
                if (el) textareaRefs.current.set(block.id, el)
                else textareaRefs.current.delete(block.id)
              }}
              value={block.content}
              readOnly={readOnly}
              onChange={(e) => {
                const newBlocks = blocks.map(b => b.id === block.id ? { ...b, content: e.target.value } : b)
                onChange(newBlocks)
              }}
              className="w-full h-full bg-transparent resize-none border-none focus:ring-0 p-0 cursor-text select-text"
              style={{
                fontFamily: block.style.fontFamily,
                fontSize: block.style.fontSize,
                color: block.style.color,
                fontWeight: block.style.fontWeight,
                fontStyle: block.style.fontStyle,
                textDecoration: block.style.textDecoration,
                textAlign: block.style.textAlign,
                lineHeight: block.style.lineHeight,
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                if (!readOnly) onSelectBlock(block.id)
              }}
              onFocus={() => {
                if (!readOnly) onSelectBlock(block.id)
              }}
              onMouseUp={(e) => {
                e.stopPropagation()
                handleTextSelection(block.id, e.currentTarget)
              }}
              onKeyUp={(e) => handleTextSelection(block.id, e.currentTarget)}
            />
          ) : block.type === 'image' ? (
            <img
              src={block.content}
              alt="Block"
              className="w-full h-full object-cover pointer-events-none select-none"
            />
          ) : block.type === 'line' ? (
            <svg className="w-full h-full pointer-events-none overflow-visible">
              <line
                x1={0}
                y1={0}
                x2={block.width}
                y2={block.height}
                stroke={block.style.stroke || '#1e293b'}
                strokeWidth={block.style.strokeWidth ?? 2}
              />
            </svg>
          ) : null /* rectangle/ellipse appearance is fully handled by the wrapper's own style above */}

          {/* Resize Handles (only when selected) */}
          {selectedBlockId === block.id && !readOnly && (
            <>
              {(block.type === 'line' ? ['nw', 'se'] : ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']).map((handle) => (
                <div
                  key={handle}
                  className="absolute w-3 h-3 bg-white border border-blue-500 rounded-full z-20"
                  style={{
                    top: handle.includes('n') ? -6 : handle.includes('s') ? '100%' : '50%',
                    left: handle.includes('w') ? -6 : handle.includes('e') ? '100%' : '50%',
                    marginTop: handle.includes('s') ? -6 : handle.includes('n') ? 0 : -6,
                    marginLeft: handle.includes('e') ? -6 : handle.includes('w') ? 0 : -6,
                    cursor: `${handle}-resize`
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setDragState({
                      isDragging: false,
                      isResizing: true,
                      handle,
                      startX: e.clientX,
                      startY: e.clientY,
                      initialBlock: block
                    })
                  }}
                />
              ))}

              {/* Rotation handle — pivots around the block's own center, captured on mousedown. */}
              <div
                className="absolute flex items-center justify-center w-5 h-5 -translate-x-1/2 bg-white border border-blue-500 rounded-full z-20 cursor-alias"
                style={{ top: -28, left: '50%' }}
                title="Trascina per ruotare (Shift per scattare a 15°)"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                  setDragState({
                    isDragging: false,
                    isResizing: false,
                    isRotating: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    pivotX: rect.left + rect.width / 2,
                    pivotY: rect.top + rect.height / 2,
                    initialBlock: block
                  })
                }}
              >
                <RotateCw className="h-3 w-3 text-blue-500" />
              </div>
            </>
          )}
        </div>
      ))}

      {/* Smart alignment guides — only visible while actively dragging a block */}
      {activeGuides.map((guide, i) => (
        <div
          key={i}
          className="absolute bg-pink-500 pointer-events-none z-30"
          style={
            guide.orientation === 'vertical'
              ? { left: guide.position, top: guide.from, width: 1, height: guide.to - guide.from }
              : { top: guide.position, left: guide.from, width: guide.to - guide.from, height: 1 }
          }
        />
      ))}

      {/* AI Text Assist Panel */}
      {textSelection && !readOnly && (
        <AITextAssistPanel
          selectedText={textSelection.text}
          position={textSelection.position}
          onClose={() => setTextSelection(null)}
          onApply={handleApplyAIText}
          context="Slide di presentazione"
        />
      )}

      {contextMenu && !readOnly && (
        <div
          className="absolute z-[9999] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-black shadow-xl"
          style={{ left: contextMenu.canvasX, top: contextMenu.canvasY }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuButton icon={<Type className="h-4 w-4" />} label="Aggiungi testo" onClick={() => runContextAction(() => onContextAddBlock?.('text', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          <ContextMenuButton icon={<Layers className="h-4 w-4" />} label="Aggiungi rettangolo" onClick={() => runContextAction(() => onContextAddBlock?.('rectangle', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          <ContextMenuButton icon={<BringToFront className="h-4 w-4" />} label="Aggiungi ellisse" onClick={() => runContextAction(() => onContextAddBlock?.('ellipse', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          <ContextMenuButton icon={<ImageIcon className="h-4 w-4" />} label="Aggiungi immagine" onClick={() => runContextAction(() => onContextAddBlock?.('image', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          {contextMenu.blockId && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <ContextMenuButton icon={<Copy className="h-4 w-4" />} label="Duplica oggetto" onClick={() => runContextAction(() => duplicateBlock(contextMenu.blockId!))} />
              <ContextMenuButton icon={<BringToFront className="h-4 w-4" />} label="Porta davanti" onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'front'))} />
              <ContextMenuButton icon={<Layers className="h-4 w-4" />} label="Porta dietro" onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'back'))} />
              <ContextMenuButton icon={<MoveUp className="h-4 w-4" />} label="Avanza livello" onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'forward'))} />
              <ContextMenuButton icon={<MoveDown className="h-4 w-4" />} label="Arretra livello" onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'backward'))} />
              <ContextMenuButton icon={<Trash2 className="h-4 w-4" />} label="Elimina oggetto" danger onClick={() => runContextAction(() => deleteBlock(contextMenu.blockId!))} />
            </>
          )}
          {selectedBlock && (
            <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Livello {(selectedBlock.zIndex ?? blocks.findIndex(b => b.id === selectedBlock.id)) + 1} / {blocks.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ContextMenuButton({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 ${danger ? 'text-red-600' : 'text-black'}`}
      onClick={() => {
        onClick()
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
