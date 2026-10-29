import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from '@/components/icons'
import { hasSectionArt, NavSectionArt } from '@/components/NavSectionArt'
import type { NavRecent, NavRecentsSpec } from '@/lib/navRecents'
import { tl } from '@/i18n/tl'

export interface NavClusterItem {
  path: string
  label: string
  description?: string
  icon: React.ElementType
  badgeCount?: number
  /** Longer explanation shown under the title when the menu is wide (with recents). */
  details?: string
  /** Quick access to the latest work in this section, shown on the right of the row. */
  recents?: NavRecentsSpec
}

export interface NavCluster {
  id: string
  label: string
  icon: React.ElementType
  items: NavClusterItem[]
}

/** Exact match for the section root, prefix match for nested routes (editor pages, live controls…). */
export function isNavPathActive(pathname: string, path: string, exactRoot = '/teacher') {
  if (path === exactRoot) return pathname === path || pathname === `${path}/` || pathname === `${path}/assistant`
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function clusterIsActive(pathname: string, cluster: NavCluster) {
  return cluster.items.some((item) => isNavPathActive(pathname, item.path))
}

const clusterBadge = (cluster: NavCluster) => cluster.items.reduce((sum, item) => sum + (item.badgeCount ?? 0), 0)

const OPEN_DELAY_MS = 70
const CLOSE_DELAY_MS = 180

function ClusterBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span className={`flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fe004d] px-1 text-[10px] font-black leading-none text-white shadow-[var(--ds-shadow-1)] ${className}`}>
      {count > 9 ? '9+' : count}
    </span>
  )
}

/** Hover-intent open/close shared by the bar and the rail, so the pointer can travel into the panel. */
function useHoverMenu() {
  const { pathname } = useLocation()
  const [openId, setOpenId] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const clear = () => { if (timer.current) window.clearTimeout(timer.current) }
  const openSoon = (id: string) => { clear(); timer.current = window.setTimeout(() => setOpenId(id), openId ? 0 : OPEN_DELAY_MS) }
  const closeSoon = () => { clear(); timer.current = window.setTimeout(() => setOpenId(null), CLOSE_DELAY_MS) }
  const openNow = (id: string | null) => { clear(); setOpenId(id) }
  useEffect(() => { openNow(null) }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => clear, [])
  return { openId, openSoon, closeSoon, openNow }
}

export const clusterHasRecents = (cluster: NavCluster) => cluster.items.some((item) => item.recents)

const RECENT_LINES = 3

/** Up to three single-name entries, each in its own rounded chip with a soft grey highlight (design-system control). */
function RecentsColumn({ entries, loading, onPick }: { entries: NavRecent[]; loading: boolean; onPick: () => void }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 px-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{tl("Recenti")}</p>
      {loading ? (
        <div className="flex flex-col gap-1.5" aria-hidden="true">
          {Array.from({ length: RECENT_LINES }, (_, index) => <span key={index} className="h-8 w-full animate-pulse rounded-[var(--ds-radius-control)] bg-slate-100" />)}
        </div>
      ) : entries.length === 0 ? (
        <p className="flex h-8 items-center px-1 text-[12px] text-slate-400">{tl("Niente di recente")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.slice(0, RECENT_LINES).map((entry) => (
            <li key={entry.id}>
              <Link
                to={entry.to}
                onClick={onPick}
                title={[entry.title, entry.meta].filter(Boolean).join(' · ')}
                className="nav-recent-chip flex h-8 items-center gap-2 rounded-[var(--ds-radius-control)] px-3 outline-none focus-visible:shadow-[var(--ds-shadow-focus)]"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-700">{entry.title}</span>
                {entry.badge && <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-semibold text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{entry.badge}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ClusterPanel({ cluster, pathname, onPick, side = false, panelRef }: {
  cluster: NavCluster
  pathname: string
  onPick: () => void
  side?: boolean
  panelRef?: React.Ref<HTMLDivElement>
}) {
  const wide = clusterHasRecents(cluster)
  // Fetch only while the panel is mounted (= menu open); cached briefly so hovering back and forth is free.
  const results = useQueries({
    queries: cluster.items.map((item) => ({
      queryKey: ['nav-recents', ...(item.recents?.queryKey ?? [item.path])],
      queryFn: item.recents?.fetch ?? (async () => [] as NavRecent[]),
      enabled: Boolean(item.recents?.fetch),
      staleTime: 30_000,
    })),
  })
  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={cluster.label}
      className={`ds-popover rounded-[var(--ds-radius-panel)] p-2 ${wide ? 'w-[min(860px,calc(100vw-2rem))]' : 'w-80'} ${side ? 'nav-cluster-unroll-side' : 'nav-cluster-unroll'}`}
    >
      {wide ? (
        <div className="flex flex-col divide-y divide-slate-200/60">
          {cluster.items.map((item, index) => {
            const active = isNavPathActive(pathname, item.path)
            const spec = item.recents
            const entries = spec?.entries ?? results[index]?.data ?? []
            return (
              <div key={item.path} style={{ animationDelay: `${60 + index * 35}ms` }} className="nav-cluster-item grid min-h-[10rem] grid-cols-[minmax(0,1fr)_16rem] items-start gap-x-8 px-2 py-4">
                <Link
                  to={item.path}
                  role="menuitem"
                  onClick={onPick}
                  className={`group/item -mx-2 -my-1 block rounded-[var(--ds-radius-control)] px-2 py-1 outline-none transition-colors focus-visible:shadow-[var(--ds-shadow-focus)] ${active ? 'ds-selected' : 'hover:bg-[var(--ds-control-hover)] focus-visible:bg-[var(--ds-control-hover)]'}`}
                >
                  <span className="flex items-start gap-4">
                    <NavSectionArt path={item.path} className="h-[104px] w-[104px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-emphasis text-[19px] font-extrabold leading-tight tracking-tight">{item.label}</span>
                        <ClusterBadge count={item.badgeCount ?? 0} />
                      </span>
                      {(item.details || item.description) && <span className="mt-1 line-clamp-3 block text-[12.5px] leading-[1.45] text-slate-500">{item.details || item.description}</span>}
                    </span>
                  </span>
                </Link>
                <div className="min-w-0">
                  {spec ? <RecentsColumn entries={entries} loading={!spec.entries && Boolean(results[index]?.isLoading)} onPick={onPick} /> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <p className="px-3 pb-1.5 pt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{cluster.label}</p>
          <div className="flex flex-col gap-1">
            {cluster.items.map((item, index) => {
              const Icon = item.icon
              const active = isNavPathActive(pathname, item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  role="menuitem"
                  onClick={onPick}
                  style={{ animationDelay: `${60 + index * 35}ms` }}
                  className={`nav-cluster-item group/item flex items-center gap-3 rounded-[var(--ds-radius-control)] px-2.5 py-2 text-left outline-none transition-colors focus-visible:shadow-[var(--ds-shadow-focus)] ${active
                    ? 'ds-selected'
                    : 'text-slate-700 hover:bg-[var(--ds-control-hover)] hover:text-[var(--selection-text)] focus-visible:bg-[var(--ds-control-hover)]'}`}
                >
                  {hasSectionArt(item.path) ? (
                    <NavSectionArt path={item.path} className="h-[72px] w-[72px]" />
                  ) : (
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? 'bg-white/80 shadow-[var(--ds-shadow-1)]' : 'ds-control'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-emphasis text-[13px] font-bold leading-tight">{item.label}</span>
                    {item.description && <span className="mt-0.5 block truncate text-[11px] leading-tight text-slate-500">{item.description}</span>}
                  </span>
                  <ClusterBadge count={item.badgeCount ?? 0} />
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const focusFirstItem = (panel: HTMLDivElement | null) => {
  window.requestAnimationFrame(() => panel?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
}

/**
 * Horizontal navbar of functional clusters: text-only tabs (icons live in the submenus). Clusters with more than one
 * page show a chevron and unroll their submenu downward on hover (or click/keyboard).
 */
export function NavClusterBar({ clusters }: { clusters: NavCluster[] }) {
  const { pathname } = useLocation()
  const { openId, openSoon, closeSoon, openNow } = useHoverMenu()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openId) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') openNow(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex items-center gap-1.5" onMouseLeave={closeSoon}>
      {clusters.map((cluster) => {
        const active = clusterIsActive(pathname, cluster)
        const single = cluster.items.length === 1 ? cluster.items[0] : null
        const open = openId === cluster.id
        const tabClass = [
          'group relative flex min-h-[var(--selection-height)] items-center gap-1.5 rounded-[var(--selection-radius)] px-[calc(var(--selection-padding-x)+0.375rem)] py-1.5',
          'font-emphasis text-xs font-bold whitespace-nowrap transition-[background-color,box-shadow,color] duration-150',
          'focus-visible:outline-none focus-visible:shadow-[var(--ds-shadow-focus)]',
          active
            ? 'ds-selected'
            : open
              ? 'bg-[var(--ds-control-hover)] text-[var(--selection-text)] shadow-[var(--ds-shadow-1)]'
              : 'bg-transparent text-slate-600 hover:bg-[var(--ds-control-hover)] hover:text-[var(--selection-text)] hover:shadow-[var(--ds-shadow-1)]',
        ].join(' ')
        const content = (
          <>
            <span>{cluster.label}</span>
            {!single && (
              <ChevronDown
                className={`-mr-0.5 h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-200 ${open ? 'rotate-180 opacity-100' : 'group-hover:translate-y-[2px] group-hover:opacity-100'}`}
                aria-hidden="true"
              />
            )}
            <ClusterBadge count={clusterBadge(cluster)} className="absolute -right-1 -top-1" />
          </>
        )
        if (single) {
          return (
            <Link key={cluster.id} to={single.path} className={tabClass} onMouseEnter={() => openNow(null)} aria-current={active ? 'page' : undefined}>
              {content}
            </Link>
          )
        }
        const onKeyDown = (event: ReactKeyboardEvent) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openNow(cluster.id)
            focusFirstItem(panelRef.current)
          }
        }
        return (
          <div key={cluster.id} className={clusterHasRecents(cluster) ? '' : 'relative'} onMouseEnter={() => openSoon(cluster.id)}>
            <button
              type="button"
              className={tabClass}
              aria-haspopup={"menu"}
              aria-expanded={open}
              onClick={() => openNow(open ? null : cluster.id)}
              onKeyDown={onKeyDown}
            >
              {content}
            </button>
            {open && (
              // pt-2 bridges the gap so the pointer can reach the panel without closing it.
              // Wide panels (with recents) anchor to the whole bar so they never overflow the viewport.
              <div className={`absolute top-full z-50 pt-2 left-1/2 -translate-x-1/2`} onMouseEnter={() => openSoon(cluster.id)}>
                <ClusterPanel cluster={cluster} pathname={pathname} onPick={() => openNow(null)} panelRef={panelRef} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Vertical rail (medium screens): icon with its label underneath; submenus unroll to the side on hover. */
export function NavClusterRail({ clusters }: { clusters: NavCluster[] }) {
  const { pathname } = useLocation()
  const { openId, openSoon, closeSoon, openNow } = useHoverMenu()

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      {clusters.map((cluster) => {
        const Icon = cluster.icon
        const active = clusterIsActive(pathname, cluster)
        const single = cluster.items.length === 1 ? cluster.items[0] : null
        const open = openId === cluster.id
        const buttonClass = `relative flex w-full flex-col items-center gap-1 rounded-[var(--ds-radius-control)] px-1 py-2 transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ds-shadow-focus)] ${active
          ? 'ds-selected'
          : open
            ? 'bg-[var(--ds-control-hover)] text-[var(--selection-text)] shadow-[var(--ds-shadow-1)]'
            : 'text-slate-600 hover:bg-[var(--ds-control-hover)] hover:text-[var(--selection-text)]'}`
        const content = (
          <>
            <Icon className="h-5 w-5" />
            <span className="max-w-full whitespace-nowrap font-emphasis text-[9px] font-bold leading-none tracking-tight">{cluster.label}</span>
            {!single && (
              <ChevronRight
                className={`absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 opacity-50 transition-transform duration-200 ${open ? 'translate-x-[2px] opacity-100' : ''}`}
                aria-hidden="true"
              />
            )}
            <ClusterBadge count={clusterBadge(cluster)} className="absolute right-0 top-0" />
          </>
        )
        return (
          <div
            key={cluster.id}
            className="relative w-full"
            onMouseEnter={() => (single ? openNow(null) : openSoon(cluster.id))}
            onMouseLeave={closeSoon}
          >
            {single ? (
              <Link to={single.path} aria-label={cluster.label} className={buttonClass}>{content}</Link>
            ) : (
              <button type="button" aria-label={cluster.label} aria-haspopup={"menu"} aria-expanded={open} onClick={() => openNow(open ? null : cluster.id)} className={buttonClass}>
                {content}
              </button>
            )}
            {open && !single && (
              <div className="absolute left-full top-0 z-50 pl-2">
                <ClusterPanel cluster={cluster} pathname={pathname} onPick={() => openNow(null)} side />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
