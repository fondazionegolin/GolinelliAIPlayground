/**
 * NavTab — icon rail button with animated label expansion.
 *
 * Active item: label always visible, full accent style.
 * Adjacent to active: label always visible, subdued.
 * Inactive: icon only, label slides in on hover.
 */
interface NavTabProps {
  icon: React.ElementType
  label: string
  isActive: boolean
  isAdjacent?: boolean
  onClick?: () => void
  accentClass?: string       // active background colour class
  accentTextClass?: string   // active text colour class
}

export function NavTab({ icon: Icon, label, isActive, isAdjacent, onClick, accentClass }: NavTabProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'group flex min-h-[var(--selection-height)] items-center px-[var(--selection-padding-x)] py-1.5 rounded-[var(--selection-radius)] text-[11px] font-semibold',
        'transition-all duration-150 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--selection-border-hover)]',
        isActive
          ? `${accentClass ?? 'bg-[image:var(--selection-active-bg)]'} text-[var(--selection-active-text)] border-[color:var(--selection-border-hover)] shadow-[var(--selection-shadow)]`
          : 'border-transparent text-slate-600 hover:border-[color:var(--selection-border)] hover:bg-[image:var(--selection-bg)] hover:text-[var(--selection-text)]',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={[
          'overflow-hidden whitespace-nowrap',
          'transition-[max-width,opacity,margin-left] duration-200 ease-out',
          isActive
            ? 'max-w-[84px] opacity-100 ml-1.5'
            : isAdjacent
              ? 'max-w-[84px] opacity-60 ml-1.5 group-hover:opacity-100'
              : 'max-w-0 opacity-0 ml-0 group-hover:max-w-[84px] group-hover:opacity-100 group-hover:ml-1.5',
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  )
}
