import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const inputVariants = cva(
  'flex w-full rounded-lg border text-[var(--text-primary)] transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
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
        compact: 'h-9 px-3 py-2 text-sm',
        default: 'h-10 px-3 py-2 text-sm',
        roomy: 'h-11 px-4 py-2.5 text-base',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      surface: 'base',
      density: 'default',
    },
  }
)

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {
  invalid?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
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
      <input
        type={type}
        className={cn(
          inputVariants({
            tone: resolvedTone,
            surface,
            density,
          }),
          className
        )}
        ref={ref}
        aria-invalid={invalid || props['aria-invalid'] === true}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input, inputVariants }
