import { SearchPill } from '@/design/primitives/SearchPill'
import type { ReactNode } from 'react'
import { SectionHeading } from '@/design/primitives/SectionHeading'

import { PASTEL_ICON_BACKGROUNDS, PASTEL_ICON_TEXT, PASTEL_SURFACES, type PastelTone } from '@/design/themes/pastelSurfaces'

export function WorkspaceExplorerSidebar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <aside className={`ds-frame-sidebar flex max-h-[260px] w-full shrink-0 flex-col lg:max-h-none lg:w-[19rem] ${className}`}>
      {children}
    </aside>
  )
}

export function WorkspaceExplorerHeader({
  eyebrow,
  title,
  section,
  description,
  action,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  clearSearchLabel,
}: {
  eyebrow: string
  title: string
  section?: string
  description: string
  action?: ReactNode
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  clearSearchLabel?: string
}) {
  const showSearch = searchValue !== undefined && onSearchChange

  return (
    <div className="bg-[var(--ds-surface)] px-5 py-4 shadow-[var(--ds-shadow-1)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 max-w-[14rem]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{eyebrow}</p>
          {section ? <SectionHeading section={section} compact className="mt-1 truncate text-[17px] font-semibold tracking-tight text-slate-950" subtitle={description} subtitleClassName="mt-1 text-xs leading-5 text-slate-500">{title}</SectionHeading>
            : <h1 className="mt-1 truncate text-[17px] font-semibold tracking-tight text-slate-950">{title}</h1>}
          {!section && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {action}
      </div>

      {showSearch && (
        <SearchPill value={searchValue ?? ""} placeholder={searchPlaceholder} onValueChange={onSearchChange} className="mt-4" clearLabel={clearSearchLabel} />
      )}
    </div>
  )
}

export function WorkspaceExplorerList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${className}`}>{children}</div>
}

export function WorkspaceExplorerItem({
  icon,
  title,
  subtitle,
  badges,
  selected = false,
  tone,
  onClick,
  trailing,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  badges?: ReactNode
  selected?: boolean
  tone?: PastelTone
  onClick: () => void
  trailing?: ReactNode
}) {
  const itemTone: PastelTone = tone || (selected ? 'violet' : 'slate')

  return (
    <div className={`group relative flex w-full overflow-hidden rounded-[18px] text-left transition-all ${PASTEL_SURFACES[itemTone]} ${selected ? 'shadow-[var(--ds-shadow-focus)]' : ''}`}>
      <button type="button" onClick={onClick} className="min-w-0 flex-1 p-3 text-left">
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${PASTEL_ICON_BACKGROUNDS[itemTone]} ${PASTEL_ICON_TEXT[itemTone]}`}>
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-800">{title}</span>
            {subtitle && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{subtitle}</span>}
            {badges && <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">{badges}</span>}
          </span>
        </div>
      </button>
      {trailing}
    </div>
  )
}

export function WorkspaceExplorerBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-white/70 px-2 py-0.5 font-bold text-slate-500 shadow-[var(--ds-shadow-1)]">{children}</span>
}
