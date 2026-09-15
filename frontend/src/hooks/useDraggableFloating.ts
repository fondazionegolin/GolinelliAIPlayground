import { useCallback, useEffect, useRef, useState, type PointerEventHandler } from 'react'

type Corner = 'top-left' | 'top-right'
type VerticalSlot = 'top' | 'bottom'
type Position = { x: number; y: number }

const TOP_OFFSET = 88
const BOTTOM_OFFSET = 24
const SIDE_OFFSET = 16

const getPosition = (corner: Corner, slot: VerticalSlot, size: number): Position => ({
  x: corner === 'top-right'
    ? Math.max(SIDE_OFFSET, window.innerWidth - size - SIDE_OFFSET)
    : SIDE_OFFSET,
  y: slot === 'top'
    ? TOP_OFFSET
    : Math.max(TOP_OFFSET, window.innerHeight - size - BOTTOM_OFFSET),
})

const readSlot = (storageKey: string): VerticalSlot => {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'top' || stored === 'bottom') return stored
    // Migrate coordinates saved by the previous free-drag behavior.
    if (stored) {
      const legacy = JSON.parse(stored) as Partial<Position>
      if (typeof legacy.y === 'number') return legacy.y < window.innerHeight / 2 ? 'top' : 'bottom'
    }
  } catch {
    // Storage is optional.
  }
  return 'top'
}

/** A floating control with exactly two stable positions on its assigned side. */
export function useDraggableFloating(storageKey: string, corner: Corner, size = 48) {
  const [slot, setSlot] = useState<VerticalSlot>(() => readSlot(storageKey))
  const [position, setPosition] = useState<Position>(() => getPosition(corner, readSlot(storageKey), size))
  const drag = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const selectSlot = useCallback((nextSlot: VerticalSlot, persist = false) => {
    setSlot(nextSlot)
    setPosition(getPosition(corner, nextSlot, size))
    if (persist) {
      try { localStorage.setItem(storageKey, nextSlot) } catch { /* Storage is optional. */ }
    }
  }, [corner, size, storageKey])

  useEffect(() => {
    const handleResize = () => setPosition(getPosition(corner, slot, size))
    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [corner, size, slot])

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
  }

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 5) current.moved = true
    if (current.moved) selectSlot(event.clientY < window.innerHeight / 2 ? 'top' : 'bottom')
  }

  const finishDrag: PointerEventHandler<HTMLElement> = (event) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.moved) selectSlot(event.clientY < window.innerHeight / 2 ? 'top' : 'bottom', true)
    suppressClick.current = current.moved
    drag.current = null
  }

  const consumeDragClick = () => {
    if (!suppressClick.current) return false
    suppressClick.current = false
    return true
  }

  return {
    position,
    dragProps: { onPointerDown, onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag },
    consumeDragClick,
  }
}
