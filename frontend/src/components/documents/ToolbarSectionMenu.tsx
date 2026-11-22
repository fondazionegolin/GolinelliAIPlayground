import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from '@/components/icons'

type IconType = ComponentType<{ className?: string }>

/**
 * A named section of the document toolbar ("Testo", "Paragrafo", …): a labelled trigger that opens a vertical
 * menu with that section's settings. The menu lives in a portal (the toolbar scrolls horizontally and would clip
 * it), keeps the editor selection (no focus change) and closes on outside click, Escape or resize.
 */
export function ToolbarSection({ label, icon: Icon, open, onToggle, onClose, width = 288, children }: {
  label: string
  icon: IconType
  open: boolean
  onToggle: () => void
  onClose: () => void
  width?: number
  children: ReactNode
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) { setPosition(null); return }
    const rect = triggerRef.current.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: rect.bottom + 6 })
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [open, onClose])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] px-2.5 text-xs font-semibold transition-colors ${open ? 'ds-selected' : 'text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && position && createPortal(
        <div
          ref={popupRef}
          role="menu"
          aria-label={label}
          className="ds-popover fixed z-[120] max-h-[calc(100vh-140px)] overflow-y-auto p-1.5"
          style={{ left: position.left, top: position.top, width }}
          onMouseDown={(event) => {
            const tag = (event.target as HTMLElement).tagName
            if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') event.preventDefault()
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--text-secondary)]">{children}</p>
}

export function MenuDivider() {
  return <div className="mx-2 my-1.5 h-px bg-[var(--border-subtle)]" />
}

/** A wide choosing row (design system dropdown rows: ≥36px, 12px padding, ds-selected when current). */
export function MenuRow({ icon: Icon, label, hint, active = false, disabled = false, onClick, trailing }: {
  icon?: IconType
  label: ReactNode
  hint?: ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2.5 rounded-[var(--control-radius)] px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'ds-selected font-semibold' : 'text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block text-[11px] font-normal leading-snug text-[var(--text-secondary)]">{hint}</span>}
      </span>
      {trailing ?? (active ? <Check className="h-4 w-4 shrink-0" /> : null)}
    </button>
  )
}

/** A row of equal icon toggles inside a section menu (bold/italic…, alignment). */
export function MenuIconRow({ items }: { items: Array<{ icon: IconType; label: string; active?: boolean; onClick: () => void }> }) {
  return (
    <div className="flex gap-1 px-1.5 py-1">
      {items.map(({ icon: Icon, label, active, onClick }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={`flex h-9 flex-1 items-center justify-center rounded-[var(--control-radius)] transition-colors ${active ? 'ds-selected' : 'text-[var(--text-primary)] hover:bg-[var(--ds-control-hover)]'}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}
