import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@/components/icons'
import { tl } from '@/i18n/tl'

interface FloatingWindowProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Initial top-left corner; clamped to the viewport. */
  initial?: { x: number; y: number }
  width?: number
}

/** Small non-modal window that can be dragged by its header and stays above the page. */
export function FloatingWindow({ title, subtitle, onClose, children, initial = { x: 96, y: 96 }, width = 360 }: FloatingWindowProps) {
  const [pos, setPos] = useState(initial)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 80)),
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onResize = () => setPos((p) => clamp(p.x, p.y))
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y }
  }
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setPos(clamp(event.clientX - drag.current.dx, event.clientY - drag.current.dy))
  }
  const onUp = () => { drag.current = null }

  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      className="ds-popover fixed z-[80] flex max-h-[min(80vh,38rem)] flex-col overflow-hidden rounded-[var(--ds-radius-panel)]"
      style={{ left: pos.x, top: pos.y, width: Math.min(width, window.innerWidth - 16) }}
    >
      <div
        className="flex cursor-grab touch-none select-none items-center gap-2 px-4 py-3 active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-800">{title}</p>
          {subtitle && <p className="truncate text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tl("Chiudi")}
          title={tl("Chiudi")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>,
    document.body,
  )
}
