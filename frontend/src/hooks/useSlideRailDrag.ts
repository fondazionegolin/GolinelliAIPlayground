import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { reorderSlides } from '@/lib/slideNavigation'

/** Native drag preview, midpoint insertion slots and continuous edge scrolling. */
export function useSlideRailDrag<T extends { id: string }>(
  listRef: RefObject<HTMLDivElement>, slides: T[], onReorder: (slides: T[]) => void,
) {
  const [draggedIds, setDraggedIds] = useState<string[]>([])
  const [markerTop, setMarkerTop] = useState<number | null>(null)
  const dragRef = useRef<{ ids: string[]; boundary: number; y: number } | null>(null)
  const frameRef = useRef(0)

  const updateSlot = (y: number) => {
    const list = listRef.current
    const drag = dragRef.current
    if (!list || !drag) return
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-slide-index]'))
    if (!items.length) return
    const rects = items.map(item => item.getBoundingClientRect())
    let boundary = rects.findIndex(rect => y < rect.top + rect.height / 2)
    if (boundary < 0) boundary = items.length
    drag.boundary = boundary
    const top = boundary === 0 ? rects[0].top - 5
      : boundary === rects.length ? rects[rects.length - 1].bottom + 5
      : (rects[boundary - 1].bottom + rects[boundary].top) / 2
    setMarkerTop(top - list.getBoundingClientRect().top + list.scrollTop)
  }

  const stop = () => {
    cancelAnimationFrame(frameRef.current)
    dragRef.current = null
    setDraggedIds([])
    setMarkerTop(null)
  }

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const start = (event: DragEvent, ids: string[]) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-golinelli-slides', JSON.stringify(ids))
    dragRef.current = { ids, boundary: 0, y: event.clientY }
    setDraggedIds(ids)
    updateSlot(event.clientY)
    let previousTime = 0
    const scroll = (time: number) => {
      const list = listRef.current
      const drag = dragRef.current
      if (!list || !drag) return
      const rect = list.getBoundingClientRect()
      const edge = Math.min(64, rect.height / 4)
      const inside = drag.y >= rect.top && drag.y <= rect.bottom
      const speed = !inside ? 0 : drag.y < rect.top + edge ? -Math.min(1, (rect.top + edge - drag.y) / edge)
        : drag.y > rect.bottom - edge ? Math.min(1, (drag.y - rect.bottom + edge) / edge) : 0
      const elapsed = previousTime ? Math.min(32, time - previousTime) : 16
      previousTime = time
      if (speed) {
        list.scrollTop += speed * elapsed * 0.6
        updateSlot(drag.y)
      }
      frameRef.current = requestAnimationFrame(scroll)
    }
    frameRef.current = requestAnimationFrame(scroll)
  }

  const over = (event: DragEvent) => {
    if (!dragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    dragRef.current.y = event.clientY
    updateSlot(event.clientY)
  }

  const leave = (event: DragEvent) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    if (dragRef.current) dragRef.current.y = -Infinity
    setMarkerTop(null)
  }

  const drop = (event: DragEvent) => {
    if (!dragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    updateSlot(event.clientY)
    const next = reorderSlides(slides, dragRef.current.ids, dragRef.current.boundary)
    stop()
    if (next !== slides) onReorder(next)
  }

  return { draggedIds, markerTop, start, stop, listProps: { onDragOver: over, onDragLeave: leave, onDrop: drop } }
}
