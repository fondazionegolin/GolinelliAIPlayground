import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const selectVariants = cva(
  'flex w-full appearance-none rounded-lg border text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      tone: {
        neutral:
          'border-[var(--border-subtle)] bg-[var(--surface-base)] focus-visible:border-slate-300 focus-visible:ring-slate-300',
        accent:
          'border-primary/20 bg-[var(--surface-base)] focus-visible:border-primary/40 focus-visible:ring-primary/25',
        success:
          'border-emerald-200 bg-[var(--surface-base)] focus-visible:border-emerald-300 focus-visible:ring-emerald-200',
        danger:
          'border-rose-200 bg-[var(--surface-base)] focus-visible:border-rose-300 focus-visible:ring-rose-200',
      },
      surface: {
        base: '',
        muted: 'bg-[var(--surface-muted)]',
        glass: 'bg-[var(--surface-glass)] backdrop-blur-sm',
      },
      density: {
        compact: 'h-9 px-3 pr-9 text-sm',
        default: 'h-10 px-3 pr-10 text-sm',
        roomy: 'h-11 px-4 pr-11 text-base',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      surface: 'base',
      density: 'default',
    },
  }
)

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    VariantProps<typeof selectVariants> {
  invalid?: boolean
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      children,
      tone,
      surface,
      density,
      invalid = false,
      ...props
    },
    ref
  ) => {
    const resolvedTone = invalid ? 'danger' : tone

    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={cn(
            selectVariants({
              tone: resolvedTone,
              surface,
              density,
            }),
            className
          )}
          aria-invalid={invalid || props['aria-invalid'] === true}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
      </div>
    )
  }
)

Select.displayName = 'Select'

export { selectVariants }
