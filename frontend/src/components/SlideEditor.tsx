import { useState, useRef, useEffect, useCallback, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { BringToFront, Video, Copy, Download, Image as ImageIcon, Layers, Lock, MoveDown, MoveUp, RefreshCw, RotateCw, Sparkles, Trash2, Type, Unlock, EyeOff } from '@/components/icons'
import { SlideTextBlock } from './SlideTextBlock'
import { SlideVideo } from './SlideVideo'
import { isVideoUrl } from '@/lib/slideVideo'
import { computeSnap, type GuideLine } from '@/lib/slideSnap'
import { applyStyleToBlocks, boundsOf, cloneBlocks, moveBlockLayer, normalizeLayerOrder, textBoxPadding, toggleBlockHidden, toggleBlockLocked, type LayerMoveAction } from '@/lib/slideBlocks'
import { ensureSlideFonts } from '@/lib/slideFonts'
import { tl } from '@/i18n/tl'
import { presentationStudioApi, type DeckTheme } from '@/lib/presentationStudio'
import { GeneratedBadge, SlideImagePlaceholder } from './presentation/SlideImagePlaceholder'

/** Reads a picture as a data URL, shrinking very large ones (screenshots, photos) so saved decks stay light. */
async function imageFileToDataUrl(file: File, maxSide = 1920): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return original
  try {
    const bitmap = await createImageBitmap(file)
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (ratio >= 1 && file.size <= 1_500_000) { bitmap.close(); return original }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * ratio)
    canvas.height = Math.round(bitmap.height * ratio)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const keepsAlpha = file.type === 'image/png' || file.type === 'image/webp'
    const encoded = canvas.toDataURL(keepsAlpha ? 'image/png' : 'image/jpeg', 0.88)
    return encoded.length < original.length ? encoded : original
  } catch {
    return original
  }
}

/** An image slot that has its prompt but not yet a real picture. */
export const isPendingImage = (block: SlideBlock): boolean =>
  block.type === 'image' && Boolean(block.imagePrompt) && (!block.content || block.content.includes('placehold.co'))

/** Saves a slide picture to the user's disk (falls back to opening it when the host forbids reading it). */
export async function downloadSlideImage(url: string, name = 'immagine-slide') {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(String(response.status))
    const blob = await response.blob()
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')
    const href = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href, download: `${name}.${ext}` })
    document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
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
export type SlideBlockType = 'text' | 'image' | 'video' | BlockShapeType

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
    paddingTop?: number
    paddingRight?: number
    paddingBottom?: number
    paddingLeft?: number
    verticalAlign?: 'middle' | 'bottom'
    whiteSpace?: 'nowrap'
    /** false: keep the authored size even if the text overflows its box (imported decks). */
    autoFit?: boolean
  }
}

export interface ImageSlideBlock extends BaseSlideBlock {
  type: 'image'
  content: string
  /** Newly inserted: once the picture loads, reshape the box to the image's real proportions. */
  fitToImage?: boolean
  /** What the picture should show: a slot with a prompt and no real picture yet is a placeholder to generate. */
  imagePrompt?: string
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

/** A video linked by URL (YouTube, Vimeo or a direct file); `content` is the link, empty until the author pastes one. */
export interface VideoSlideBlock extends BaseSlideBlock {
  type: 'video'
  content: string
  style: { borderRadius?: number }
}

export type SlideBlock = TextSlideBlock | ImageSlideBlock | VideoSlideBlock | ShapeSlideBlock

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
  /** Scroll area around the slide: dragging on its empty background draws a selection box. */
  marqueeSurfaceRef?: RefObject<HTMLElement | null>
  /** With no object selected, Up/Down arrows ask to move to the previous/next slide. */
  onNavigateSlide?: (delta: -1 | 1) => void
  onContextAddBlock?: (type: SlideBlockType, position: { x: number; y: number }) => void
  /** Fires with the focused text block's TipTap instance (or null on blur) so a parent toolbar
   * can route Bold/Italic/color/etc. to the actual selection range instead of the whole block. */
  onActiveTextEditorChange?: (editor: Editor | null) => void
  /** Slide background; the editing dot grid only shows on an unset (white) slide. */
  backgroundColor?: string
  /** Enables «Genera immagine» on image placeholders (context for a picture consistent with the deck). */
  imageGeneration?: { deckTitle: string; slideTitle?: string; theme?: DeckTheme | null }
  /** Patches one block wherever it lives in the deck (a picture may arrive after the user moved to another slide). */
  onPatchBlock?: (blockId: string, patch: Partial<ImageSlideBlock>) => void
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
  marqueeSurfaceRef,
  onNavigateSlide,
  onContextAddBlock,
  onActiveTextEditorChange,
  backgroundColor,
  imageGeneration,
  onPatchBlock,
}: SlideEditorProps) {
  // Generation outlives re-renders: patch the latest blocks, not the ones captured when the click happened.
  const latestBlocksRef = useRef(blocks)
  latestBlocksRef.current = blocks
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [imageStatus, setImageStatus] = useState<Record<string, { state: 'busy' | 'error' | 'done'; error?: string }>>({})
  const onPatchBlockRef = useRef(onPatchBlock)
  onPatchBlockRef.current = onPatchBlock
  const patchBlock = useCallback((blockId: string, patch: Partial<ImageSlideBlock>) => {
    if (onPatchBlockRef.current) { onPatchBlockRef.current(blockId, patch); return }
    onChangeRef.current(latestBlocksRef.current.map(b => b.id === blockId && b.type === 'image' ? { ...b, ...patch } : b))
  }, [])
  const generateImage = useCallback(async (blockId: string, prompt: string) => {
    if (!imageGeneration || !prompt.trim()) return
    setImageStatus(s => ({ ...s, [blockId]: { state: 'busy' } }))
    try {
      const { data } = await presentationStudioApi.image({ prompt: prompt.trim().slice(0, 1200), deck_title: imageGeneration.deckTitle, slide_title: imageGeneration.slideTitle || '', theme: imageGeneration.theme })
      if (!data?.url) throw new Error('empty')
      patchBlock(blockId, { content: data.url, imagePrompt: prompt.trim() })
      setImageStatus(s => ({ ...s, [blockId]: { state: 'done' } }))
      window.setTimeout(() => setImageStatus(s => { const next = { ...s }; if (next[blockId]?.state === 'done') delete next[blockId]; return next }), 4000)
    } catch (error: any) {
      const detail = error?.response?.status === 402 ? tl("Crediti AI esauriti.") : (typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : '')
      setImageStatus(s => ({ ...s, [blockId]: { state: 'error', error: detail } }))
    }
  }, [imageGeneration, patchBlock])
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
    /** Resizing one of several selected blocks: the other selected blocks of the same kind take its new size. */
    siblings?: { id: string; x: number; y: number; width: number; height: number }[]
    /** The dragged blocks are fresh Alt-drag copies; `origin` is where the dragged one started. */
    cloned?: { x: number; y: number }
  } | null>(null)
  // Offset of the last Alt-drag / Ctrl+D copy, repeated by the next Ctrl+D (Figma's "duplicate again").
  const lastCloneOffsetRef = useRef<{ dx: number; dy: number } | null>(null)
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
  const groupMembers = blocks.filter(b => selection.includes(b.id) && !b.locked && !b.hidden)
  const groupBounds = !readOnly && groupMembers.length > 1 ? boundsOf(groupMembers) : null
  const textMembers = groupMembers.filter((b): b is Extract<SlideBlock, { type: 'text' }> => b.type === 'text')
  const sharedTextSize = textMembers.length && textMembers.every(b => b.style.fontSize === textMembers[0].style.fontSize) ? (textMembers[0].style.fontSize ?? null) : null
  const setTextSize = (size: number) => onChange(applyStyleToBlocks(blocks, textMembers.map(b => b.id), 'fontSize', Math.max(8, size)))
  const select = useCallback((ids: string[]) => {
    onSelectBlocks?.(ids)
    onSelectBlock(ids.length ? ids[ids.length - 1] : null)
  }, [onSelectBlock, onSelectBlocks])

  useEffect(() => { ensureSlideFonts(blocks) }, [blocks])

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

  // The selection box lives in screen coordinates so it can start anywhere (also outside the slide).
  const beginMarquee = (clientX: number, clientY: number, pointerId: number, additive: boolean) => {
    setMarquee({ startX: clientX, startY: clientY, x: clientX, y: clientY, pointerId, additive, base: additive ? selection : [] })
  }
  const startMarquee = (e: React.PointerEvent) => {
    if (readOnly || !onSelectBlocks) return false
    beginMarquee(e.clientX, e.clientY, e.pointerId, e.shiftKey || e.metaKey || e.ctrlKey)
    return true
  }
  const selectionRef = useRef<string[]>([])
  selectionRef.current = selection
  const selectRef = useRef(select)
  selectRef.current = select
  // Dragging on the empty area around the slide (the workspace) also draws a selection box.
  useEffect(() => {
    const surface = marqueeSurfaceRef?.current
    if (!surface || readOnly || !onSelectBlocks) return
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== surface) return
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      e.preventDefault()
      if (!additive) selectRef.current([])
      setMarquee({ startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, pointerId: e.pointerId, additive, base: additive ? selectionRef.current : [] })
    }
    surface.addEventListener('pointerdown', onDown)
    return () => surface.removeEventListener('pointerdown', onDown)
  }, [marqueeSurfaceRef, readOnly, onSelectBlocks])

  useEffect(() => {
    if (!marquee) return
    const move = (e: PointerEvent) => {
      if (e.pointerId !== marquee.pointerId) return
      setMarquee(current => current ? { ...current, x: e.clientX, y: e.clientY } : current)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== marquee.pointerId) return
      const left = Math.min(marquee.startX, marquee.x), right = Math.max(marquee.startX, marquee.x)
      const top = Math.min(marquee.startY, marquee.y), bottom = Math.max(marquee.startY, marquee.y)
      if (right - left > 4 || bottom - top > 4) {
        const origin = canvasRef.current?.getBoundingClientRect()
        const hit = (origin ? blocks : [])
          .filter(b => {
            const bl = origin!.left + b.x * scale, bt = origin!.top + b.y * scale
            return !b.hidden && !b.locked && bl < right && bl + b.width * scale > left && bt < bottom && bt + Math.max(b.height * scale, 1) > top
          })
          .map(b => b.id)
        select(Array.from(new Set([...marquee.base, ...hit])))
        // The click that follows a drag ending on the workspace must not reach its "deselect" handler.
        const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault() }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
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
  }, [marquee, blocks, select, scale])

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
      if (selection.length === 0) {
        // Nothing selected: Up/Down (and Page Up/Down) browse the slides instead.
        if (onNavigateSlide && !target.closest('[role="listbox"]') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          const step = event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 0
          if (step) { event.preventDefault(); onNavigateSlide(step) }
        }
        return
      }
      const editable = blocks.filter(b => selection.includes(b.id) && !b.locked)
      if (event.key === 'Escape') { select([]); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && editable.length) {
        // Duplicate, repeating the offset of the last Alt-drag / Ctrl+D (Figma's "duplicate again").
        event.preventDefault()
        const offset = lastCloneOffsetRef.current ?? { dx: 24, dy: 24 }
        const copied = cloneBlocks(blocks, editable.map(b => b.id), offset.dx, offset.dy)
        lastCloneOffsetRef.current = offset
        onChange(copied.blocks)
        select(copied.ids)
        return
      }
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
  }, [readOnly, selection, blocks, onChange, select, slideWidth, slideHeight, editingBlockId, onNavigateSlide])
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
        const members = dragState.group && dragState.group.length > 1
          ? blocks.filter(b => dragState.group!.some(item => item.id === b.id)) : []
        // A multi-selection snaps as one box (its bounds), not as the single block that was grabbed.
        const startBox = members.length > 1
          ? boundsOf(dragState.group!.map(item => { const b = members.find(m => m.id === item.id)!; return { x: item.x, y: item.y, width: b.width, height: b.height } }))!
          : { x: init.x, y: init.y, width: init.width, height: init.height }
        const proposed = { x: startBox.x + deltaX, y: startBox.y + deltaY, width: startBox.width, height: startBox.height }
        const others = blocks.filter(b => !b.hidden && b.id !== init.id && !(dragState.group || []).some(item => item.id === b.id))
        const snap = computeSnap(proposed, others, { width: slideWidth, height: slideHeight }, snapOptions)
        dragSnap = { x: init.x + (snap.x - startBox.x), y: init.y + (snap.y - startBox.y) }
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

          // Images scale proportionally (the visible picture really grows/shrinks instead of the
          // crop changing); hold Shift to resize the frame freely and crop.
          if (init.type === 'image' && !e.shiftKey && init.width > 0 && init.height > 0) {
            const handle = dragState.handle
            const scaleW = width / init.width
            const scaleH = height / init.height
            let factor = handle === 'n' || handle === 's' ? scaleH
              : handle === 'e' || handle === 'w' ? scaleW
              : Math.abs(localDeltaX) * init.height >= Math.abs(localDeltaY) * init.width ? scaleW : scaleH
            factor = Math.max(factor, 20 / Math.min(init.width, init.height))
            const anchorX = (w: number) => handle.includes('w') ? init.x + init.width - w
              : handle.includes('e') ? init.x : init.x + (init.width - w) / 2
            const anchorY = (h: number) => handle.includes('n') ? init.y + init.height - h
              : handle.includes('s') ? init.y : init.y + (init.height - h) / 2
            // Largest factor that keeps the anchored box inside the slide.
            const limits = [factor]
            const centerX = init.x + init.width / 2
            const centerY = init.y + init.height / 2
            if (slideWidth) {
              const room = handle.includes('w') ? init.x + init.width
                : handle.includes('e') ? slideWidth - init.x : 2 * Math.min(centerX, slideWidth - centerX)
              limits.push(room / init.width)
            }
            if (slideHeight) {
              const room = handle.includes('n') ? init.y + init.height
                : handle.includes('s') ? slideHeight - init.y : 2 * Math.min(centerY, slideHeight - centerY)
              limits.push(room / init.height)
            }
            factor = Math.max(0.01, Math.min(...limits))
            const w = init.width * factor
            const h = init.height * factor
            const nx = slideWidth ? Math.min(Math.max(0, anchorX(w)), Math.max(0, slideWidth - w)) : anchorX(w)
            const ny = slideHeight ? Math.min(Math.max(0, anchorY(h)), Math.max(0, slideHeight - h)) : anchorY(h)
            return { ...b, x: nx, y: ny, width: w, height: h }
          }

          return { ...b, x, y, width, height }
        }
        return b
      })

      if (dragState.isResizing && dragState.siblings?.length && dragState.handle) {
        const init = dragState.initialBlock!
        const resized = newBlocks.find(b => b.id === init.id)
        if (resized) {
          const handle = dragState.handle
          const sameWidth = (handle.includes('e') || handle.includes('w')) && resized.width !== init.width
          const sameHeight = (handle.includes('n') || handle.includes('s')) && resized.height !== init.height
          const byId = new Map(dragState.siblings.map(item => [item.id, item]))
          onChange(newBlocks.map(b => {
            const start = byId.get(b.id)
            if (!start) return b
            let { x, y, width, height } = start
            if (sameWidth) { width = resized.width; if (handle.includes('w')) x = start.x + start.width - width }
            if (sameHeight) { height = resized.height; if (handle.includes('n')) y = start.y + start.height - height }
            if (slideWidth) { x = Math.min(Math.max(0, x), Math.max(0, slideWidth - width)) }
            if (slideHeight) { y = Math.min(Math.max(0, y), Math.max(0, slideHeight - height)) }
            return { ...b, x, y, width, height }
          }))
          return
        }
      }

      onChange(newBlocks)
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== dragState?.pointerId) return
      if (dragState.cloned) {
        const moved = blocks.find(b => b.id === dragState.initialBlock?.id)
        if (moved && (Math.abs(moved.x - dragState.cloned.x) > 0.5 || Math.abs(moved.y - dragState.cloned.y) > 0.5)) {
          lastCloneOffsetRef.current = { dx: moved.x - dragState.cloned.x, dy: moved.y - dragState.cloned.y }
        }
      }
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

  /** First load of a newly inserted image: give its frame the picture's real aspect ratio
   * (same area, centred, kept inside the slide) so nothing is cropped. */
  const fitImageBlock = (blockId: string, img: HTMLImageElement) => {
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0
    onChange(blocks.map(b => {
      if (b.id !== blockId || b.type !== 'image') return b
      const { fitToImage: _done, ...rest } = b
      if (!ratio) return rest as SlideBlock
      const area = b.width * b.height
      let width = Math.sqrt(area * ratio)
      let height = width / ratio
      const shrink = Math.min(1, slideWidth ? slideWidth * 0.9 / width : 1, slideHeight ? slideHeight * 0.9 / height : 1)
      width *= shrink
      height *= shrink
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      const x = slideWidth ? Math.min(Math.max(0, cx - width / 2), Math.max(0, slideWidth - width)) : cx - width / 2
      const y = slideHeight ? Math.min(Math.max(0, cy - height / 2), Math.max(0, slideHeight - height)) : cy - height / 2
      return { ...rest, x, y, width, height } as SlideBlock
    }))
  }

  /** Drops/pastes become new blocks: pictures (downscaled so decks stay light) and video links. */
  const addDroppedMedia = async (files: File[], text: string, at: { x: number; y: number } | null) => {
    const added: SlideBlock[] = []
    const place = (width: number, height: number, index: number) => {
      const rawX = at ? at.x + index * 24 : (slideWidth || 960) / 2 - width / 2 + index * 24
      const rawY = at ? at.y + index * 24 : (slideHeight || 540) / 2 - height / 2 + index * 24
      return {
        x: slideWidth ? Math.min(Math.max(0, rawX), Math.max(0, slideWidth - width)) : rawX,
        y: slideHeight ? Math.min(Math.max(0, rawY), Math.max(0, slideHeight - height)) : rawY,
      }
    }
    for (const file of files.filter(item => item.type.startsWith('image/'))) {
      try {
        const content = await imageFileToDataUrl(file)
        const width = Math.min(300, slideWidth || 300)
        const height = Math.min(200, slideHeight || 200)
        added.push({ id: crypto.randomUUID(), type: 'image', content, ...place(width, height, added.length), width, height, style: {}, fitToImage: true })
      } catch { /* unreadable image: skip it */ }
    }
    if (!added.length && isVideoUrl(text)) {
      const width = Math.min(480, slideWidth || 480)
      const height = Math.round(width * 9 / 16)
      added.push({ id: crypto.randomUUID(), type: 'video', content: text.trim(), ...place(width, height, 0), width, height, style: { borderRadius: 8 } })
    }
    if (!added.length) return false
    const top = Math.max(-1, ...latestBlocksRef.current.map(b => b.zIndex ?? 0))
    onChange(normalizeLayerOrder([...latestBlocksRef.current, ...added.map((block, i) => ({ ...block, zIndex: top + 1 + i }))]))
    select(added.map(b => b.id))
    return true
  }

  // Ctrl/Cmd+V: a copied picture (or a video link) lands in the slide, as in any design tool.
  const addDroppedMediaRef = useRef(addDroppedMedia)
  addDroppedMediaRef.current = addDroppedMedia
  useEffect(() => {
    if (readOnly) return
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
      const text = event.clipboardData?.getData('text/plain') || ''
      if (!files.length && !isVideoUrl(text)) return
      event.preventDefault()
      void addDroppedMediaRef.current(files, text, null)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [readOnly])

  // Handle file drop for images (and video links dragged from the browser)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (readOnly) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const at = rect ? { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale } : null
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''
    void addDroppedMedia(Array.from(e.dataTransfer.files), text, at)
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
        ...(backgroundColor
          ? { backgroundColor }
          : { backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1px)', backgroundSize: '20px 20px' }),
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
            ...(block.type === 'video' ? { overflow: 'hidden', borderRadius: block.style.borderRadius ?? 8, backgroundColor: '#0f172a' } : {}),
            ...(block.type === 'text' || block.type === 'image'
              ? {
                  backgroundColor: block.style.backgroundColor || 'transparent',
                  borderRadius: block.style.borderRadius,
                  ...textBoxPadding(block.style),
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
            if (e.altKey) {
              // Alt + drag duplicates: the copies are what follows the pointer, the originals stay put.
              const copied = cloneBlocks(blocks, groupIds, 0, 0)
              if (copied.ids.length) {
                const sourceIds = blocks.filter(b => groupIds.includes(b.id) && !b.locked).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map(b => b.id)
                const grabbed = copied.blocks.find(b => b.id === copied.ids[Math.max(0, sourceIds.indexOf(block.id))]) || copied.blocks.find(b => b.id === copied.ids[0])!
                onChange(copied.blocks)
                select(copied.ids)
                setDragState({
                  isDragging: true,
                  isResizing: false,
                  startX: e.clientX,
                  startY: e.clientY,
                  pointerId: e.pointerId,
                  initialBlock: grabbed,
                  group: copied.blocks.filter(b => copied.ids.includes(b.id)).map(b => ({ id: b.id, x: b.x, y: b.y })),
                  cloned: { x: grabbed.x, y: grabbed.y },
                })
                return
              }
            }
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
          ) : block.type === 'image' && isPendingImage(block) ? (
            <SlideImagePlaceholder
              prompt={block.imagePrompt || ''}
              status={imageStatus[block.id]?.state === 'busy' ? 'busy' : imageStatus[block.id]?.state === 'error' ? 'error' : undefined}
              error={imageStatus[block.id]?.error}
              readOnly={readOnly || block.locked}
              onPromptChange={(prompt) => patchBlock(block.id, { imagePrompt: prompt })}
              onGenerate={imageGeneration ? (prompt) => void generateImage(block.id, prompt) : undefined}
            />
          ) : block.type === 'image' ? (
            <>
            {imageStatus[block.id]?.state === 'done' && <GeneratedBadge />}
            {imageStatus[block.id]?.state === 'busy' && <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/60 text-xs font-bold text-violet-700">{tl("Rigenero l’immagine…")}</span>}
            <img
              src={block.content}
              alt="Block"
              className="w-full h-full object-cover pointer-events-none select-none"
              onLoad={block.fitToImage && !readOnly ? (event) => fitImageBlock(block.id, event.currentTarget) : undefined}
            />
            </>
          ) : block.type === 'video' ? (
            <SlideVideo
              url={block.content}
              interactive={readOnly}
              selected={selection.length === 1 && selection[0] === block.id && !block.locked}
              onChangeUrl={readOnly || block.locked ? undefined : (url) => onChange(blocks.map(b => b.id === block.id ? { ...b, content: url } : b))}
            />
          ) : block.type === 'line' ? (
            <svg className="pointer-events-none overflow-visible" style={{ width: Math.max(1, block.width), height: Math.max(1, block.height) }}>
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
          {!block.locked && (selection.length === 1 || (block.width >= 28 && block.height >= 20)) && (
            <>
              {(block.type === 'line' ? ['nw', 'se'] : ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']).map((handle) => (
                <div
                  key={handle}
                  className={`pointer-events-auto absolute touch-none rounded-full border border-blue-500 bg-white z-20 ${selection.length > 1 ? "h-2.5 w-2.5" : "h-4 w-4"} [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6`}
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
                      initialBlock: block,
                      // With several objects selected, the others of the same kind follow this one's size.
                      siblings: selection.length > 1
                        ? blocks.filter(b => selection.includes(b.id) && b.id !== block.id && b.type === block.type && !b.locked)
                            .map(b => ({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height }))
                        : undefined,
                    })
                  }}
                />
              ))}

              {/* Rotation handle — pivots around the block's own center, captured on mousedown. */}
              {selection.length === 1 && <div
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
              </div>}
            </>
          )}
        </div>
      ))}

      {/* Multi-selection: a small panel that adapts to what is selected (today: one font size for all the texts). */}
      {!readOnly && groupBounds && textMembers.length > 0 && !dragState && (
        <div
          className="pointer-events-auto absolute z-[1002] flex items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white p-1 pl-3 text-slate-700 shadow-lg"
          style={groupBounds.y * scale > 56
            ? { left: groupBounds.x, top: groupBounds.y - 8 / scale, transform: `translateY(-100%) scale(${1 / scale})`, transformOrigin: 'left bottom' }
            : { left: groupBounds.x, top: groupBounds.y + groupBounds.height + 8 / scale, transform: `scale(${1 / scale})`, transformOrigin: 'left top' }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <span className="text-xs font-semibold text-slate-500">{textMembers.length === 1 ? tl("1 testo") : `${textMembers.length} ${tl("testi")}`} · {tl("Dimensione")}</span>
          <button type="button" aria-label={tl("Riduci carattere")} className="flex h-8 w-8 items-center justify-center rounded-lg text-base font-bold hover:bg-slate-100" onClick={() => setTextSize((sharedTextSize ?? textMembers[0].style.fontSize ?? 16) - 2)}>−</button>
          <input
            key={`${selection.join('|')}-${sharedTextSize ?? 'mixed'}`}
            type="number"
            min={8}
            defaultValue={sharedTextSize ?? ''}
            placeholder="–"
            title={sharedTextSize === null ? tl("Misure diverse: scrivi un valore per renderle tutte uguali") : undefined}
            className="h-8 w-14 rounded-lg bg-slate-100 px-2 text-center text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-400"
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            onBlur={(e) => { const value = parseInt(e.currentTarget.value, 10); if (Number.isFinite(value) && value !== sharedTextSize) setTextSize(value) }}
          />
          <button type="button" aria-label={tl("Ingrandisci carattere")} className="flex h-8 w-8 items-center justify-center rounded-lg text-base font-bold hover:bg-slate-100" onClick={() => setTextSize((sharedTextSize ?? textMembers[0].style.fontSize ?? 16) + 2)}>+</button>
        </div>
      )}

      {/* Smart guides — alignment lines and equal-spacing markers, only while dragging/resizing */}
      {activeGuides.map((guide, i) => guide.kind === 'spacing' ? (
        <div
          key={i}
          className="pointer-events-none absolute z-30 bg-rose-500"
          style={guide.orientation === 'vertical'
            ? { left: guide.position - 0.5 / scale, top: guide.from, width: 1 / scale, height: guide.to - guide.from }
            : { top: guide.position - 0.5 / scale, left: guide.from, width: guide.to - guide.from, height: 1 / scale }}
        >
          <span
            className="absolute rounded bg-rose-500 px-1 font-bold leading-none text-white"
            style={{ fontSize: 10 / scale, padding: `${2 / scale}px ${4 / scale}px`, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          >{guide.label}</span>
        </div>
      ) : (
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

      {marquee && createPortal(
        <div
          className="pointer-events-none fixed z-[10000] border border-blue-500 bg-blue-500/10"
          style={{
            left: Math.min(marquee.startX, marquee.x),
            top: Math.min(marquee.startY, marquee.y),
            width: Math.abs(marquee.x - marquee.startX),
            height: Math.abs(marquee.y - marquee.startY),
          }}
        />,
        document.body,
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
          <ContextMenuButton icon={<Video className="h-4 w-4" />} label={tl("Aggiungi video da link")} onClick={() => runContextAction(() => onContextAddBlock?.('video', { x: contextMenu.canvasX, y: contextMenu.canvasY }))} />
          {contextMenu.blockId && (
            <>
              <div className="my-1 border-t border-slate-100" />
              {(() => {
                const target = blocks.find(b => b.id === contextMenu.blockId)
                if (!target || target.type !== 'image') return null
                const pending = isPendingImage(target)
                return <>
                  {pending && imageGeneration && <ContextMenuButton icon={<Sparkles className="h-4 w-4" />} label={tl("Genera immagine")} onClick={() => runContextAction(() => void generateImage(target.id, target.imagePrompt || ''))} />}
                  {!pending && target.imagePrompt && imageGeneration && <ContextMenuButton icon={<RefreshCw className="h-4 w-4" />} label={tl("Rigenera dal prompt")} onClick={() => runContextAction(() => void generateImage(target.id, target.imagePrompt || ''))} />}
                  {!pending && target.content && <ContextMenuButton icon={<Download className="h-4 w-4" />} label={tl("Scarica immagine")} onClick={() => runContextAction(() => void downloadSlideImage(target.content))} />}
                  <div className="my-1 border-t border-slate-100" />
                </>
              })()}
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
