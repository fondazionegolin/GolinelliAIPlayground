import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToolbarMenuItem = {
  key: string
  icon: ReactNode
  label: string
  hint?: string
  disabled?: boolean
  onSelect: () => void
}

/**
 * Dropdown for the Vibe Lab toolbar. The toolbar scrolls horizontally, which would clip a normal
 * absolutely-positioned menu, so the popup is portalled to <body> and placed from the trigger rect.
 * Popup surface follows the design system: opaque `--ds-popover-solid`, wide ≥36px rows.
 */
export function CodingToolbarMenu({ trigger, items, label, align = 'right' }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  items: ToolbarMenuItem[]
  label: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 248
    const left = align === 'right' ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) : Math.max(8, rect.left)
    setPos({ top: rect.bottom + 6, left })
  }, [align])

  useEffect(() => {
    if (!open) return
    place()
    const close = () => setOpen(false)
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, place])

  return (
    <>
      <span ref={triggerRef} className="inline-flex shrink-0">{trigger({ open, toggle: () => setOpen((value) => !value) })}</span>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ top: pos.top, left: pos.left, width: 248 }}
          className="ds-popover fixed z-[80] space-y-0.5 rounded-[var(--ds-radius-panel)] bg-[var(--ds-popover-solid)] p-1.5 text-[var(--text-primary)]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect() }}
              className="flex min-h-9 w-full items-center gap-3 rounded-[var(--control-radius)] px-3 py-1.5 text-left text-sm hover:bg-[var(--ds-control-hover)] focus-visible:bg-[var(--ds-control-hover)] focus-visible:outline-none disabled:opacity-50"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{item.label}</span>
                {item.hint && <span className="block truncate text-[11px] text-[var(--text-secondary)]">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
