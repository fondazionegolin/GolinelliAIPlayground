import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Loader2, Sparkles } from '@/components/icons'

export type FloatingPoint = { x: number; y: number }
export const LAUNCHER_SIZE = 48
const EDGE = 8
const CLICK_SLOP = 4

/**
 * Drag logic shared by the floating icon and the panel header: the position follows the pointer freely, then
 * «snaps» to the canvas dot grid on release (same magnetic step as the nodes). A press that never moves is a click.
 */
export function useFloatingDrag(
  pos: FloatingPoint, setPos: (point: FloatingPoint) => void, container: RefObject<HTMLElement | null>,
  snap: (point: FloatingPoint) => FloatingPoint, persist: (point: FloatingPoint) => void,
) {
  const [dragging, setDragging] = useState(false)
  const posRef = useRef(pos)
  posRef.current = pos

  const clamp = useCallback((point: FloatingPoint): FloatingPoint => {
    const rect = container.current?.getBoundingClientRect()
    if (!rect) return point
    return {
      x: Math.min(Math.max(EDGE, point.x), Math.max(EDGE, rect.width - LAUNCHER_SIZE - EDGE)),
      y: Math.min(Math.max(EDGE, point.y), Math.max(EDGE, rect.height - LAUNCHER_SIZE - EDGE)),
    }
  }, [container])

  const begin = useCallback((event: ReactPointerEvent, onClick?: () => void) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, origin: posRef.current, moved: false }
    const move = (next: PointerEvent) => {
      const dx = next.clientX - start.x, dy = next.clientY - start.y
      if (!start.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
      if (!start.moved) { start.moved = true; setDragging(true) }
      setPos(clamp({ x: start.origin.x + dx, y: start.origin.y + dy }))
    }
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      setDragging(false)
      if (!start.moved) { onClick?.(); return }
      const final = clamp(snap(clamp({ x: start.origin.x + next.clientX - start.x, y: start.origin.y + next.clientY - start.y })))
      setPos(final); persist(final)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }, [clamp, persist, setPos, snap])

  return { begin, dragging, clamp }
}

type Props = {
  pos: FloatingPoint
  open: boolean
  working: boolean
  dragging: boolean
  onPointerDown: (event: ReactPointerEvent) => void
  onToggle: () => void
}

/** Always-on-canvas assistant button: drag it anywhere (it snaps to the grid), click to open or close the panel. */
export function AssistantLauncher({ pos, open, working, dragging, onPointerDown, onToggle }: Props) {
  return <button
    type="button" aria-label={open ? 'Nascondi assistente workflow' : 'Apri assistente workflow (Ctrl/Cmd+J)'} aria-expanded={open}
    title="Assistente workflow · trascinalo dove vuoi · Ctrl/Cmd+J"
    onPointerDown={onPointerDown}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() } }}
    className={`absolute z-[35] flex touch-none select-none items-center justify-center rounded-full text-white shadow-xl ring-2 ring-white transition-[box-shadow,background-color] ${open ? 'bg-violet-700' : 'bg-violet-600 hover:bg-violet-700'} ${dragging ? 'cursor-grabbing shadow-2xl' : 'cursor-grab'}`}
    style={{ left: pos.x, top: pos.y, width: LAUNCHER_SIZE, height: LAUNCHER_SIZE }}
  >
    {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
    {working && <span className="absolute inset-0 animate-ping rounded-full bg-violet-400/40" aria-hidden="true" />}
  </button>
}
