import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const textareaVariants = cva(
  'flex min-h-[96px] w-full rounded-[var(--control-radius)] border text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      tone: {
        neutral:
          'border-[var(--border-subtle)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-violet)] focus-visible:ring-[var(--logo-violet)]/25',
        accent:
          'border-[var(--logo-violet)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-violet)] focus-visible:ring-[var(--logo-violet)]/25',
        success:
          'border-[var(--logo-blue)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-violet)] focus-visible:ring-[var(--logo-violet)]/25',
        danger:
          'border-[var(--logo-pink)] bg-[var(--surface-base)] focus-visible:border-[var(--logo-pink)] focus-visible:ring-[var(--logo-pink)]/25',
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
