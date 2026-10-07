import { useState, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus } from '@/components/icons'
import { Button } from '@/design'

/** Collapsed/expanded state for a page sidebar, remembered per device under `storageKey`. */
export function useSidebarCollapsed(storageKey: string): [boolean, (collapsed: boolean) => void] {
  const key = `sidebar_collapsed:${storageKey}`
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  const update = (next: boolean) => {
    setCollapsed(next)
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* per-device convenience only */ }
  }
  return [collapsed, update]
}

const railButtonClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-[var(--ds-control-hover)] hover:text-slate-800'

/** Header button that collapses an expanded sidebar into its rail. */
export function SidebarCollapseButton({ onClick, label = 'Comprimi pannello', side = 'left' }: {
  onClick: () => void
  label?: string
  side?: 'left' | 'right'
}) {
  const Icon = side === 'left' ? PanelLeftClose : PanelRightClose
  return (
    <button type="button" onClick={onClick} className={railButtonClass} title={label} aria-label={label}>
      <Icon className="h-4 w-4" />
    </button>
  )
}

export interface SidebarRailItem {
  id: string
  title: string
  icon: ReactNode
  selected?: boolean
  onClick: () => void
  /** Short marker drawn on the icon corner (defaults to the title's first letter; '' hides it). */
  marker?: string
}

/**
 * Collapsed sidebar: a narrow floating rail with an expand button, an optional "new" action and
 * one icon per item (title on hover). Same material as the expanded explorer column.
 */
export function SidebarRail({
  items = [],
  onExpand,
  onCreate,
  createLabel = 'Nuovo',
  expandLabel = 'Espandi pannello',
  label,
  side = 'left',
  className = '',
  bare = false,
}: {
  items?: SidebarRailItem[]
  onExpand: () => void
  onCreate?: () => void
  createLabel?: string
  expandLabel?: string
  label?: string
  side?: 'left' | 'right'
  className?: string
  /** Render only the rail content (no own <aside>/material) inside a host sidebar. */
  bare?: boolean
}) {
  const ExpandIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  return (
    <RailShell bare={bare} className={className} label={label}>
      <button type="button" onClick={onExpand} className={railButtonClass} title={expandLabel} aria-label={expandLabel}>
        <ExpandIcon className="h-4 w-4" />
      </button>
      {onCreate && (
        <Button
          type="button"
          onClick={onCreate}
          density="compact"
          tone="accent"
          surface="solid"
          className="h-9 w-9 shrink-0 rounded-full p-0"
          title={createLabel}
          aria-label={createLabel}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      )}
      {items.length > 0 && <div className="ds-divider my-1 h-px w-8" />}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2 pb-2">
        {items.map((item) => {
          const marker = item.marker ?? (item.title.trim().charAt(0) || '·')
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={item.title}
              aria-label={item.title}
              aria-current={item.selected ? 'true' : undefined}
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all ${item.selected
                ? 'bg-[image:var(--ds-choice-bg)] text-[var(--ds-choice-ink)] shadow-[var(--ds-shadow-1)]'
                : 'text-slate-500 hover:bg-[var(--ds-control-hover)] hover:text-slate-800'}`}
            >
              {item.icon}
              {marker && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ds-surface-raised)] px-0.5 text-[9px] font-black uppercase text-slate-600 shadow-[var(--ds-shadow-1)]">
                  {marker}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </RailShell>
  )
}

function RailShell({ bare, className, label, children }: { bare: boolean; className: string; label?: string; children: ReactNode }) {
  if (bare) return <div className={`flex min-h-0 w-full flex-1 flex-col items-center gap-2 py-3 ${className}`}>{children}</div>
  return (
    <aside className={`ds-frame-sidebar flex w-16 shrink-0 flex-col items-center gap-2 py-3 ${className}`} aria-label={label}>
      {children}
    </aside>
  )
}
