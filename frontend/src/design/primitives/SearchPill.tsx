import * as React from 'react'
import { Search, X } from '@/components/icons'

import { cn } from '@/lib/utils'
import { tl } from '@/i18n/tl'

export interface SearchPillProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  value: string
  onValueChange: (value: string) => void
  onClear?: () => void
  clearLabel?: string
  endAdornment?: React.ReactNode
}

export const SearchPill = React.forwardRef<HTMLInputElement, SearchPillProps>(
  ({ className, value, onValueChange, onClear, clearLabel = tl("Cancella ricerca"), endAdornment, placeholder = tl("Cerca…"), disabled, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => inputRef.current!)
    return (
      <div
        className={cn(
          'ui-search ds-search',
          disabled && 'opacity-50',
          className
        )}
        data-search-field
      >
        <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          data-field-appearance="plain"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
          className="min-w-0 w-full flex-1 appearance-none border-0 bg-transparent p-0 text-sm font-medium text-[var(--ds-field-ink)] outline-none placeholder:text-[var(--ds-field-placeholder)] [&::-webkit-search-cancel-button]:hidden"
          {...props}
        />
        {endAdornment}
        {value && (
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (onClear) onClear()
              else onValueChange('')
              inputRef.current?.focus()
            }}
            className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition hover:bg-[var(--ds-control-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--ds-shadow-focus)]"
            aria-label={clearLabel}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }
)

SearchPill.displayName = 'SearchPill'
