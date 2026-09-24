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
  const activeMaterialStyle = isActive && !accentClass
    ? {
        backgroundColor: 'transparent',
        backgroundImage: 'var(--ds-choice-bg)',
        borderColor: 'transparent',
        color: 'var(--ds-choice-ink)',
        boxShadow: 'var(--ds-choice-ring-strong), var(--ds-choice-shadow)',
        backdropFilter: 'var(--ds-choice-blur)',
        WebkitBackdropFilter: 'var(--ds-choice-blur)',
      }
    : undefined

  return (
    <button
      onClick={onClick}
      title={label}
      style={activeMaterialStyle}
      className={[
        'group relative flex min-h-[var(--selection-height)] items-center px-[var(--selection-padding-x)] py-1.5 rounded-[var(--selection-radius)] font-emphasis text-xs font-bold',
        'border transition-all duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ds-shadow-focus)]',
        isActive
          ? `${accentClass ?? ''}`
          : 'border-transparent bg-transparent text-slate-600 shadow-none hover:bg-[var(--ds-control-hover)] hover:text-[var(--selection-text)] hover:shadow-[var(--ds-shadow-1)]',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {badgeCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fe004d] px-1 text-[10px] font-black leading-none text-white shadow-[var(--ds-shadow-1)]">
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
