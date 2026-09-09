import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { PASTEL_ICON_BACKGROUNDS, PASTEL_ICON_TEXT, PASTEL_SURFACES, type PastelTone } from '@/design/themes/pastelSurfaces'

export function WorkspaceExplorerSidebar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <aside className={`flex max-h-[260px] w-full shrink-0 flex-col border-b border-slate-200 bg-white/80 lg:max-h-none lg:w-[19rem] lg:border-b-0 lg:border-r ${className}`}>
      {children}
    </aside>
  )
}

export function WorkspaceExplorerHeader({
  eyebrow,
  title,
  description,
  action,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  clearSearchLabel,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  clearSearchLabel?: string
}) {
  const showSearch = searchValue !== undefined && onSearchChange

  return (
    <div className="border-b border-slate-200/80 bg-white/90 px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 max-w-[14rem]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{eyebrow}</p>
          <h1 className="mt-1 truncate text-[17px] font-semibold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {action}
      </div>

      {showSearch && (
        <div className={`relative mt-4 rounded-2xl px-3 py-2 shadow-sm ${PASTEL_SURFACES.slate}`}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border-0 bg-transparent py-2 pl-9 pr-8 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
              aria-label={clearSearchLabel || 'Clear search'}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
    <div className={`group relative flex w-full overflow-hidden rounded-[18px] text-left shadow-sm transition-all ${PASTEL_SURFACES[itemTone]} ${selected ? 'ring-1 ring-[rgba(123,105,201,0.32)]' : ''}`}>
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
  return <span className="rounded-full bg-white/55 px-2 py-0.5 font-bold text-slate-500 ring-1 ring-white/70">{children}</span>
}
