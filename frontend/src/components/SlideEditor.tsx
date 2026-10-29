import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { BringToFront, Copy, Image as ImageIcon, Layers, Lock, MoveDown, MoveUp, RotateCw, Trash2, Type, Unlock, EyeOff } from '@/components/icons'
import { SlideTextBlock } from './SlideTextBlock'
import { computeSnap, type GuideLine } from '@/lib/slideSnap'
import { moveBlockLayer, normalizeLayerOrder, toggleBlockHidden, toggleBlockLocked, type LayerMoveAction } from '@/lib/slideBlocks'
import { tl } from '@/i18n/tl'

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
  /** Paint/selection order; renormalized to array index on every reorder (see normalizeLayerOrder). */
  zIndex?: number
  /** When true, block ignores drag/resize/rotate/text-edit interactions on the canvas. */
  locked?: boolean
  /** When true, block is excluded from canvas paint but stays listed (dimmed) in the layers panel. */
  hidden?: boolean
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
  /** Multi-selection (Shift/Ctrl/Cmd+click, or drag a selection box on empty space / the locked
   * background). When omitted the editor behaves as single-selection. */
  selectedBlockIds?: string[]
  onSelectBlocks?: (ids: string[]) => void
  scale?: number
  readOnly?: boolean
  /** Slide canvas dimensions (unrotated, unscaled) — used for grid/guide snap against slide bounds. */
  slideWidth?: number
  slideHeight?: number
  snapOptions?: SlideSnapOptions
  onContextAddBlock?: (type: SlideBlockType, position: { x: number; y: number }) => void
  /** Fires with the focused text block's TipTap instance (or null on blur) so a parent toolbar
   * can route Bold/Italic/color/etc. to the actual selection range instead of the whole block. */
  onActiveTextEditorChange?: (editor: Editor | null) => void
}

export function SlideEditor({
  blocks,
  onChange,
  selectedBlockId,
  onSelectBlock,
  selectedBlockIds,
  onSelectBlocks,
  scale = 1,
  readOnly = false,
  slideWidth,
  slideHeight,
  snapOptions = DEFAULT_SLIDE_SNAP_OPTIONS,
  onContextAddBlock,
  onActiveTextEditorChange
}: SlideEditorProps) {
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    isResizing: boolean
    isRotating?: boolean
    handle?: string
    startX: number
    startY: number
    pointerId: number
    /** Screen-space pivot (block center) captured once when a rotation drag starts. */
    pivotX?: number
    pivotY?: number
    initialBlock: SlideBlock | null
    /** Starting positions of every selected block moved together with the dragged one. */
    group?: { id: string; x: number; y: number }[]
  } | null>(null)
  // Text block in text-editing mode (entered by double-click); otherwise a click selects and drags it.
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; x: number; y: number; pointerId: number; additive: boolean; base: string[] } | null>(null)

  const blockEditors = useRef<Map<string, Editor>>(new Map())
  // A move drag starts only past a small threshold, so a click or double-click never nudges/snaps the block.
  const dragMovedRef = useRef(false)
  const blockWrapperRefs = useRef<Map<string, HTMLDivElement>>(new Map())
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
  const selection = selectedBlockIds && selectedBlockIds.length > 0 ? selectedBlockIds : (selectedBlockId ? [selectedBlockId] : [])
  const select = useCallback((ids: string[]) => {
    onSelectBlocks?.(ids)
    onSelectBlock(ids.length ? ids[ids.length - 1] : null)
  }, [onSelectBlock, onSelectBlocks])

  // A text editor stays the toolbar's target while its block stays selected, so a range selected in
  // the text survives clicking a toolbar control (which blurs the editor).
  const activeEditorBlockRef = useRef<string | null>(null)
  useEffect(() => {
    if (editingBlockId && (selection.length !== 1 || selection[0] !== editingBlockId)) setEditingBlockId(null)
    if (activeEditorBlockRef.current && (selection.length !== 1 || selection[0] !== activeEditorBlockRef.current)) {
      activeEditorBlockRef.current = null
      onActiveTextEditorChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join('|')])
  // Leaving text editing hands the toolbar back to whole-block formatting.
  useEffect(() => {
    if (!editingBlockId && activeEditorBlockRef.current) {
      activeEditorBlockRef.current = null
      onActiveTextEditorChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBlockId])

  const startEditing = (blockId: string, clientX: number, clientY: number) => {
    setEditingBlockId(blockId)
    // Wait for the block to become editable and hit-testable, then put the caret where the user clicked.
    requestAnimationFrame(() => {
      const editor = blockEditors.current.get(blockId)
      if (!editor) return
      const pos = editor.view.posAtCoords({ left: clientX, top: clientY })?.pos
      editor.commands.focus(pos ?? 'end')
    })
  }

  const canvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: rect ? (clientX - rect.left) / scale : 0, y: rect ? (clientY - rect.top) / scale : 0 }
  }
  const startMarquee = (e: React.PointerEvent) => {
    if (readOnly || !onSelectBlocks) return false
    const point = canvasPoint(e.clientX, e.clientY)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    setMarquee({ startX: point.x, startY: point.y, x: point.x, y: point.y, pointerId: e.pointerId, additive, base: additive ? selection : [] })
    return true
  }

  useEffect(() => {
    if (!marquee) return
    const move = (e: PointerEvent) => {
      if (e.pointerId !== marquee.pointerId) return
      const point = canvasPoint(e.clientX, e.clientY)
      setMarquee(current => current ? { ...current, x: point.x, y: point.y } : current)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== marquee.pointerId) return
      const left = Math.min(marquee.startX, marquee.x), right = Math.max(marquee.startX, marquee.x)
      const top = Math.min(marquee.startY, marquee.y), bottom = Math.max(marquee.startY, marquee.y)
      if (right - left > 4 || bottom - top > 4) {
        const hit = blocks
          .filter(b => !b.hidden && !b.locked && b.x < right && b.x + b.width > left && b.y < bottom && b.y + Math.max(b.height, 1) > top)
          .map(b => b.id)
        select(Array.from(new Set([...marquee.base, ...hit])))
      }
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marquee, blocks, select])

  // Keyboard: Delete/Backspace removes, arrows nudge (Shift = 10px), Escape deselects — never while
  // typing in a text block or a form field.
  useEffect(() => {
    if (readOnly) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && editingBlockId && target?.isContentEditable) {
        // First Escape leaves text editing (block stays selected), the next one deselects.
        target.blur()
        setEditingBlockId(null)
        return
      }
      if (!target || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (selection.length === 0) return
      const editable = blocks.filter(b => selection.includes(b.id) && !b.locked)
      if (event.key === 'Escape') { select([]); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && editable.length) {
        event.preventDefault()
        const ids = new Set(editable.map(b => b.id))
        onChange(normalizeLayerOrder(blocks.filter(b => !ids.has(b.id))))
        select([])
        return
      }
      const step = event.shiftKey ? 10 : 1
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
      if (delta && editable.length) {
        event.preventDefault()
        const ids = new Set(editable.map(b => b.id))
        onChange(blocks.map(b => ids.has(b.id) ? {
          ...b,
          x: slideWidth ? Math.min(Math.max(0, b.x + delta[0]), Math.max(0, slideWidth - b.width)) : b.x + delta[0],
          y: slideHeight ? Math.min(Math.max(0, b.y + delta[1]), Math.max(0, slideHeight - b.height)) : b.y + delta[1],
        } : b))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [readOnly, selection, blocks, onChange, select, slideWidth, slideHeight, editingBlockId])
  const orderedBlocks = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))
  const paintBlocks = orderedBlocks.filter(({ block }) => !block.hidden)

  // Handle Canvas Click (Deselect)
  const handleCanvasClick = (e: React.PointerEvent) => {
    setContextMenu(null)
    if (e.target === canvasRef.current) {
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) select([])
      startMarquee(e)
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

  const moveLayer = (blockId: string, action: LayerMoveAction) => {
    onChange(moveBlockLayer(blocks, blockId, action))
    onSelectBlock(blockId)
  }

  const toggleLock = (blockId: string) => {
    onChange(toggleBlockLocked(blocks, blockId))
  }

  const toggleHidden = (blockId: string) => {
    onChange(toggleBlockHidden(blocks, blockId))
    if (selectedBlockId === blockId) onSelectBlock(null)
  }

  const openContextMenu = (e: React.MouseEvent, blockId: string | null) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    const canvasX = rect ? (e.clientX - rect.left) / scale : 0
    const canvasY = rect ? (e.clientY - rect.top) / scale : 0
    if (blockId) { if (!selection.includes(blockId)) select([blockId]) }
    else select([])
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX, canvasY, blockId })
  }

  const runContextAction = (action: () => void) => {
    action()
    setContextMenu(null)
  }

  // Handle Drag & Resize
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState || !dragState.initialBlock) return
      if (e.pointerId !== dragState.pointerId) return
      e.preventDefault()
      if (dragState.isDragging && !dragMovedRef.current) {
        if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) < 3) return
        dragMovedRef.current = true
      }

      // Adjust delta by scale to ensure smooth movement regardless of zoom
      const deltaX = (e.clientX - dragState.startX) / scale
      const deltaY = (e.clientY - dragState.startY) / scale

      // Computed once per move (not per block) since only the dragged block needs snapping.
      let dragSnap: { x: number; y: number } | null = null
      if (dragState.isDragging && slideWidth && slideHeight) {
        const init = dragState.initialBlock!
        const proposed = { x: init.x + deltaX, y: init.y + deltaY, width: init.width, height: init.height }
        const others = blocks.filter(b => b.id !== init.id && !(dragState.group || []).some(item => item.id === b.id))
        const snap = computeSnap(proposed, others, { width: slideWidth, height: slideHeight }, snapOptions)
        dragSnap = { x: snap.x, y: snap.y }
        setActiveGuides(snap.guides)
      }

      if (dragState.isDragging && dragState.group && dragState.group.length > 1) {
        const init = dragState.initialBlock!
        const dx = (dragSnap ? dragSnap.x : init.x + deltaX) - init.x
        const dy = (dragSnap ? dragSnap.y : init.y + deltaY) - init.y
        const starts = new Map(dragState.group.map(item => [item.id, item]))
        onChange(blocks.map(b => {
          const start = starts.get(b.id)
          if (!start) return b
          const x = start.x + dx
          const y = start.y + dy
          return {
            ...b,
            x: slideWidth ? Math.min(Math.max(0, x), Math.max(0, slideWidth - b.width)) : x,
            y: slideHeight ? Math.min(Math.max(0, y), Math.max(0, slideHeight - b.height)) : y,
          }
        }))
        return
      }

      const newBlocks = blocks.map(b => {
        if (b.id !== dragState.initialBlock!.id) return b

        if (dragState.isDragging) {
          const nextX = dragSnap ? dragSnap.x : dragState.initialBlock!.x + deltaX
          const nextY = dragSnap ? dragSnap.y : dragState.initialBlock!.y + deltaY
          return {
            ...b,
            x: slideWidth ? Math.min(Math.max(0, nextX), Math.max(0, slideWidth - b.width)) : nextX,
            y: slideHeight ? Math.min(Math.max(0, nextY), Math.max(0, slideHeight - b.height)) : nextY,
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

          // Keep resized objects reachable. This is especially important on touch screens,
          // where an object outside the slide cannot be grabbed again with a precise pointer.
          if (slideWidth) {
            if (x < 0) { width += x; x = 0 }
            if (x + width > slideWidth) width = slideWidth - x
          }
          if (slideHeight) {
            if (y < 0) { height += y; y = 0 }
            if (y + height > slideHeight) height = slideHeight - y
          }
          if (init.type !== 'line') {
            width = Math.max(20, width)
            height = Math.max(20, height)
          }
          if (slideWidth) {
            width = Math.min(slideWidth, width)
            x = Math.min(x, Math.max(0, slideWidth - width))
          }
          if (slideHeight) {
            height = Math.min(slideHeight, height)
            y = Math.min(y, Math.max(0, slideHeight - height))
          }

          return { ...b, x, y, width, height }
        }
        return b
      })

      onChange(newBlocks)
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== dragState?.pointerId) return
      setDragState(null)
      setActiveGuides([])
    }

    if (dragState) {
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [dragState, blocks, onChange, scale, slideWidth, slideHeight, snapOptions])

  // Handle file drop for images
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (readOnly) return
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        if (event.target?.result) {
          const rect = canvasRef.current?.getBoundingClientRect()
          const width = Math.min(300, slideWidth || 300)
          const height = Math.min(200, slideHeight || 200)
          const rawX = rect ? (e.clientX - rect.left) / scale : 0
          const rawY = rect ? (e.clientY - rect.top) / scale : 0
          const newBlock: SlideBlock = {
            id: crypto.randomUUID(),
            type: 'image',
            content: event.target.result as string,
            x: slideWidth ? Math.min(Math.max(0, rawX), Math.max(0, slideWidth - width)) : rawX,
            y: slideHeight ? Math.min(Math.max(0, rawY), Math.max(0, slideHeight - height)) : rawY,
            width,
            height,
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
      onPointerDown={handleCanvasClick}
      onContextMenu={(e) => openContextMenu(e, null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{ 
        cursor: dragState?.isDragging ? 'grabbing' : 'default',
        backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}
    >
      {!blocks.length && !readOnly && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-300 pointer-events-none select-none">
          <p>{tl("Trascina immagini qui o usa la barra strumenti")}</p>
        </div>
      )}

      {paintBlocks.map(({ block, index }) => (
        <div
          key={block.id}
          ref={(el) => {
            if (el) blockWrapperRefs.current.set(block.id, el)
            else blockWrapperRefs.current.delete(block.id)
          }}
          className={`absolute group ${selection.includes(block.id) || readOnly ? '' : 'hover:ring-1 hover:ring-slate-300'}`}
          style={{
            left: block.x,
            top: block.y,
            width: block.width,
            height: block.height,
            // Selecting never changes paint order (a selected full-slide background used to jump on top
            // and hide everything): the selection frame and handles live in a separate overlay below.
            zIndex: block.zIndex ?? index,
            cursor: block.locked ? 'default' : dragState?.isDragging ? 'grabbing' : selection.includes(block.id) ? 'move' : 'grab',
            touchAction: readOnly || block.locked || editingBlockId === block.id ? undefined : 'none',
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
                    border: `${block.style.strokeWidth ?? 1}px solid ${block.style.stroke || '#262626'}`,
                    borderRadius: block.type === 'ellipse' ? '50%' : (block.style.cornerRadius ?? 0),
                  }
                : {}),
          }}
          onContextMenu={(e) => openContextMenu(e, block.id)}
          onDoubleClick={(e) => {
            if (readOnly || block.locked || block.type !== 'text' || e.shiftKey || e.metaKey || e.ctrlKey) return
            e.stopPropagation()
            select([block.id])
            startEditing(block.id, e.clientX, e.clientY)
          }}
          onPointerDown={(e) => {
            if (readOnly) return
            e.stopPropagation()
            const additive = e.shiftKey || e.metaKey || e.ctrlKey
            if (additive && onSelectBlocks) {
              // Toggle in/out of the multi-selection; no drag.
              e.preventDefault()
              select(selection.includes(block.id) ? selection.filter(id => id !== block.id) : [...selection.filter(id => id !== block.id), block.id])
              return
            }
            if (block.locked) {
              // A locked block (e.g. the slide background) is selected on click; dragging from it draws a selection box.
              select([block.id])
              startMarquee(e)
              return
            }
            const inGroup = selection.length > 1 && selection.includes(block.id)
            if (!inGroup) select([block.id])
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            const groupIds = inGroup ? selection : [block.id]
            dragMovedRef.current = false
            setDragState({
              isDragging: true,
              isResizing: false,
              startX: e.clientX,
              startY: e.clientY,
              pointerId: e.pointerId,
              initialBlock: block,
              group: blocks.filter(b => groupIds.includes(b.id) && !b.locked).map(b => ({ id: b.id, x: b.x, y: b.y })),
            })
          }}
        >
          {block.locked && !readOnly && (
            <div className="pointer-events-none absolute -top-2 -right-2 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 opacity-0 shadow-sm group-hover:opacity-100">
              <Lock className="h-3 w-3" />
            </div>
          )}
          {/* Content */}
          {block.type === 'text' ? (
            <SlideTextBlock
              block={block}
              readOnly={readOnly}
              editing={editingBlockId === block.id}
              onChange={(html) => {
                const newBlocks = blocks.map(b => b.id === block.id ? { ...b, content: html } : b)
                onChange(newBlocks)
              }}
              onSelectBlock={() => { if (!(selection.length > 1 && selection.includes(block.id))) select([block.id]) }}
              onEditorCreate={(editor) => blockEditors.current.set(block.id, editor)}
              onEditorDestroy={() => blockEditors.current.delete(block.id)}
              onSelectionChange={() => undefined}
              onEditorFocus={(editor) => { activeEditorBlockRef.current = block.id; onActiveTextEditorChange?.(editor) }}
              onEditorBlur={() => undefined}
              onOverflowFontFit={(fontSize) => {
                const newBlocks = blocks.map(b => b.id === block.id && b.type === 'text' ? { ...b, style: { ...b.style, fontSize } } : b)
                onChange(newBlocks)
              }}
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
                stroke={block.style.stroke || '#262626'}
                strokeWidth={block.style.strokeWidth ?? 2}
              />
            </svg>
          ) : null /* rectangle/ellipse appearance is fully handled by the wrapper's own style above */}

        </div>
      ))}

      {/* Selection overlay: frame + handles above every block, without touching the block's own layer. */}
      {!readOnly && paintBlocks.filter(({ block }) => selection.includes(block.id)).map(({ block }) => (
        <div
          key={`selection-${block.id}`}
          className="pointer-events-none absolute ring-2 ring-blue-500"
          style={{
            left: block.x,
            top: block.y,
            width: block.width,
            height: block.height,
            zIndex: 1000,
            transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
            transformOrigin: 'center center',
          }}
        >
          {!block.locked && selection.length === 1 && (
            <>
              {(block.type === 'line' ? ['nw', 'se'] : ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']).map((handle) => (
                <div
                  key={handle}
                  className="pointer-events-auto absolute h-4 w-4 touch-none rounded-full border border-blue-500 bg-white z-20 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
                  style={{
                    top: handle.includes('n') ? 0 : handle.includes('s') ? '100%' : '50%',
                    left: handle.includes('w') ? 0 : handle.includes('e') ? '100%' : '50%',
                    transform: 'translate(-50%, -50%)',
                    cursor: `${handle}-resize`
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setDragState({
                      isDragging: false,
                      isResizing: true,
                      handle,
                      startX: e.clientX,
                      startY: e.clientY,
                      pointerId: e.pointerId,
                      initialBlock: block
                    })
                  }}
                />
              ))}

              {/* Rotation handle — pivots around the block's own center, captured on mousedown. */}
              <div
                className="pointer-events-auto absolute flex h-5 w-5 touch-none -translate-x-1/2 items-center justify-center rounded-full border border-blue-500 bg-white z-20 cursor-alias [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7"
                style={{ top: -28, left: '50%' }}
                title={tl("Trascina per ruotare (Shift per scattare a 15°)")}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                  setDragState({
                    isDragging: false,
                    isResizing: false,
                    isRotating: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    pointerId: e.pointerId,
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

      {marquee && (
        <div
          className="pointer-events-none absolute z-[1001] border border-blue-500 bg-blue-500/10"
          style={{
            left: Math.min(marquee.startX, marquee.x),
            top: Math.min(marquee.startY, marquee.y),
            width: Math.abs(marquee.x - marquee.startX),
            height: Math.abs(marquee.y - marquee.startY),
          }}
        />
      )}

      {contextMenu && !readOnly && (
        <div
          className="absolute z-[9999] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-black shadow-xl"
          style={{ left: contextMenu.canvasX, top: contextMenu.canvasY }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuButton icon={<Type className="h-4 w-4" />} label={tl("Aggiungi testo")} onClick={() => runContextAction(() => onContextAddBlock?.('text', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          <ContextMenuButton icon={<Layers className="h-4 w-4" />} label={tl("Aggiungi rettangolo")} onClick={() => runContextAction(() => onContextAddBlock?.('rectangle', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          <ContextMenuButton icon={<BringToFront className="h-4 w-4" />} label={tl("Aggiungi ellisse")} onClick={() => runContextAction(() => onContextAddBlock?.('ellipse', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          <ContextMenuButton icon={<ImageIcon className="h-4 w-4" />} label={tl("Aggiungi immagine")} onClick={() => runContextAction(() => onContextAddBlock?.('image', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          {contextMenu.blockId && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <ContextMenuButton icon={<Copy className="h-4 w-4" />} label={tl("Duplica oggetto")} onClick={() => runContextAction(() => duplicateBlock(contextMenu.blockId!))} />
              <ContextMenuButton icon={<BringToFront className="h-4 w-4" />} label={tl("Porta davanti")} onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'front'))} />
              <ContextMenuButton icon={<Layers className="h-4 w-4" />} label={tl("Porta dietro")} onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'back'))} />
              <ContextMenuButton icon={<MoveUp className="h-4 w-4" />} label={tl("Avanza livello")} onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'forward'))} />
              <ContextMenuButton icon={<MoveDown className="h-4 w-4" />} label={tl("Arretra livello")} onClick={() => runContextAction(() => moveLayer(contextMenu.blockId!, 'backward'))} />
              <div className="my-1 border-t border-slate-100" />
              <ContextMenuButton
                icon={blocks.find(b => b.id === contextMenu.blockId)?.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                label={blocks.find(b => b.id === contextMenu.blockId)?.locked ? tl("Sblocca oggetto") : tl("Blocca oggetto")}
                onClick={() => runContextAction(() => toggleLock(contextMenu.blockId!))}
              />
              <ContextMenuButton icon={<EyeOff className="h-4 w-4" />} label={tl("Nascondi oggetto")} onClick={() => runContextAction(() => toggleHidden(contextMenu.blockId!))} />
              <ContextMenuButton icon={<Trash2 className="h-4 w-4" />} label={tl("Elimina oggetto")} danger onClick={() => runContextAction(() => deleteBlock(contextMenu.blockId!))} />
            </>
          )}
          {selectedBlock && (
            <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {tl("Livello")} {(selectedBlock.zIndex ?? blocks.findIndex(b => b.id === selectedBlock.id)) + 1} / {blocks.length}
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
