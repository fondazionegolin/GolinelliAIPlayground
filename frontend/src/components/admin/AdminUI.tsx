import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * Building blocks shared by every admin section, so pages keep one rigid layout:
 * a flat page header, monochrome stat tiles, hairline sections and muted notices.
 * Colour is reserved for state (success / warning / danger) and the platform accent.
 */

type IconType = ComponentType<{ className?: string }>

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="admin-page-header flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="admin-eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-[1.375rem] font-semibold leading-tight tracking-tight text-[var(--admin-ink)]">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--admin-ink-2)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function AdminStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('admin-stat-grid grid grid-cols-2 xl:grid-cols-4', className)}>{children}</div>
}

export function AdminStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  icon?: IconType
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  return (
    <div className="admin-stat">
      <div className="flex items-center justify-between gap-2">
        <span className="admin-eyebrow">{label}</span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-[var(--admin-ink-3)]" />}
      </div>
      <div
        className={cn(
          'mt-2 text-2xl font-semibold tracking-tight',
          tone === 'warning' ? 'text-amber-700' : tone === 'danger' ? 'text-red-700' : 'text-[var(--admin-ink)]',
        )}
      >
        {value}
      </div>
      {hint && <p className="mt-1 text-xs text-[var(--admin-ink-2)]">{hint}</p>}
    </div>
  )
}

export function AdminSection({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** Body without padding, for tables that run edge to edge. */
  flush?: boolean
}) {
  return (
    <section className={cn('admin-panel', className)}>
      {(title || actions) && (
        <div className="admin-panel-head">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-[var(--admin-ink)]">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-[var(--admin-ink-2)]">{description}</p>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(flush ? '' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

const NOTICE_TONES = {
  info: 'admin-notice-info',
  success: 'admin-notice-success',
  warning: 'admin-notice-warning',
  danger: 'admin-notice-danger',
} as const

export function AdminNotice({
  tone = 'info',
  icon: Icon,
  children,
  onClose,
  className,
}: {
  tone?: keyof typeof NOTICE_TONES
  icon?: IconType
  children: ReactNode
  onClose?: () => void
  className?: string
}) {
  return (
    <div className={cn('admin-notice', NOTICE_TONES[tone], className)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 text-xs font-medium opacity-60 hover:opacity-100" aria-label="Chiudi">
          ✕
        </button>
      )}
    </div>
  )
}

const BADGE_TONES = {
  neutral: 'admin-badge-neutral',
  accent: 'admin-badge-accent',
  success: 'admin-badge-success',
  warning: 'admin-badge-warning',
  danger: 'admin-badge-danger',
} as const

export type AdminBadgeTone = keyof typeof BADGE_TONES

export function AdminBadge({ tone = 'neutral', children, className, title }: { tone?: AdminBadgeTone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn('admin-badge', BADGE_TONES[tone], className)}>{children}</span>
}

/** Underlined tab strip used to switch views inside a page. */
export function AdminTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<readonly [T, ReactNode]>
  className?: string
}) {
  return (
    <div role="tablist" className={cn('admin-tabs', className)}>
      {options.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)} className="admin-tab">
          {label}
        </button>
      ))}
    </div>
  )
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-[var(--admin-ink-3)]">{children}</div>
}
