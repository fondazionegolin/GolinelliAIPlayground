import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const selectVariants = cva(
  'flex w-full appearance-none rounded-[var(--control-radius)] border text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      tone: {
        neutral:
          'border-[var(--border-subtle)] bg-[var(--surface-base)] focus-visible:border-slate-300 focus-visible:ring-slate-300',
        accent:
          'border-[var(--logo-pink)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-pink)] focus-visible:ring-[var(--logo-pink)]/25',
        success:
          'border-[var(--logo-blue)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-blue)] focus-visible:ring-[var(--logo-blue)]/25',
        danger:
          'border-[var(--logo-pink)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-pink)] focus-visible:ring-[var(--logo-pink)]/25',
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
