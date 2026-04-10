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

export function NavTab({ icon: Icon, label, isActive, isAdjacent, onClick, accentClass, accentTextClass }: NavTabProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'group flex items-center px-2.5 py-1.5 rounded-xl text-[12px] font-medium',
        'transition-all duration-150 border',
        isActive
          ? `${accentClass ?? 'bg-slate-900'} ${accentTextClass ?? 'text-white'} border-white/35`
          : 'text-slate-500 hover:bg-white hover:text-slate-900 border-transparent',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={[
          'overflow-hidden whitespace-nowrap',
          'transition-[max-width,opacity,margin-left] duration-200 ease-out',
          isActive
            ? 'max-w-[96px] opacity-100 ml-1.5'
            : isAdjacent
              ? 'max-w-[96px] opacity-50 ml-1.5 group-hover:opacity-100'
              : 'max-w-0 opacity-0 ml-0 group-hover:max-w-[96px] group-hover:opacity-100 group-hover:ml-1.5',
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  )
}
