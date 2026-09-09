/**
 * NavTab — icon rail button with animated label expansion.
 *
 * Active item: label always visible, full accent style.
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
  badgeCount?: number
}

export function NavTab({ icon: Icon, label, isActive, onClick, accentClass, badgeCount = 0 }: NavTabProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={[
        'group relative flex min-h-[var(--selection-height)] items-center px-[var(--selection-padding-x)] py-1.5 rounded-[var(--selection-radius)] font-emphasis text-xs font-bold',
        'transition-all duration-150 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--selection-border-hover)]',
        isActive
          ? `${accentClass ?? 'bg-[image:var(--selection-active-bg)]'} text-[var(--selection-active-text)] border-[color:var(--selection-border-hover)] shadow-[var(--selection-shadow)]`
          : 'border-transparent text-slate-600 hover:border-[color:var(--selection-border)] hover:bg-[image:var(--selection-bg)] hover:text-[var(--selection-text)]',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {badgeCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fe004d] px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
      <span
        className={[
          'overflow-hidden whitespace-nowrap',
          'transition-[max-width,opacity,margin-left] duration-200 ease-out',
          isActive
            ? 'max-w-[84px] opacity-100 ml-1.5'
            : 'max-w-0 opacity-0 ml-0 group-hover:max-w-[84px] group-hover:opacity-100 group-hover:ml-1.5',
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  )
}
