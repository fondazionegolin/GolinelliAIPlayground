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
        'group flex min-h-[36px] items-center px-2.5 py-1.5 rounded-lg text-[11px] font-medium',
        'transition-all duration-150 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/70',
        isActive
          ? `${accentClass ?? 'bg-slate-100'} ${accentTextClass ?? 'text-slate-900'} border-[color:rgba(255,255,255,0.36)] ring-1 ring-[color:rgba(255,255,255,0.18)] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]`
          : 'text-slate-600 hover:bg-white/58 hover:text-slate-900 hover:border-white/30 border-transparent',
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
