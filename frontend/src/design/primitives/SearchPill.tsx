import * as React from 'react'
import { Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SearchPillProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: string
  onValueChange: (value: string) => void
  onClear?: () => void
}

export const SearchPill = React.forwardRef<HTMLInputElement, SearchPillProps>(
  ({ className, value, onValueChange, onClear, placeholder = 'Cerca…', ...props }, ref) => (
    <div
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 text-[var(--text-primary)] shadow-sm transition focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-300/60',
        className
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-secondary)] [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => (onClear ? onClear() : onValueChange(''))}
          className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          aria-label="Cancella ricerca"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
)

SearchPill.displayName = 'SearchPill'
