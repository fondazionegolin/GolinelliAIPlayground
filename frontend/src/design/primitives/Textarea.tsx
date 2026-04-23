import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const textareaVariants = cva(
  'flex min-h-[96px] w-full rounded-lg border text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
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
        compact: 'px-3 py-2 text-sm leading-[var(--line-height-sm)]',
        default: 'px-3 py-2.5 text-sm leading-[var(--line-height-md)]',
        roomy: 'px-4 py-3 text-base leading-[var(--line-height-lg)]',
      },
      resize: {
        none: 'resize-none',
        vertical: 'resize-y',
        both: 'resize',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      surface: 'base',
      density: 'default',
      resize: 'vertical',
    },
  }
)

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  invalid?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      tone,
      surface,
      density,
      resize,
      invalid = false,
      ...props
    },
    ref
  ) => {
    const resolvedTone = invalid ? 'danger' : tone

    return (
      <textarea
        ref={ref}
        className={cn(
          textareaVariants({
            tone: resolvedTone,
            surface,
            density,
            resize,
          }),
          className
        )}
        aria-invalid={invalid || props['aria-invalid'] === true}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
