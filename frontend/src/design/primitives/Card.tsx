import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const cardVariants = cva(
  'rounded-2xl border text-[var(--text-primary)] transition-colors',
  {
    variants: {
      surface: {
        base: 'border-[var(--border-subtle)] bg-[var(--surface-base)] shadow-[var(--shadow-sm)]',
        elevated:
          'border-white/60 bg-[var(--surface-elevated)] shadow-[var(--shadow-md)] backdrop-blur-md',
        muted: 'border-[var(--border-subtle)] bg-[var(--surface-muted)] shadow-none',
        glass:
          'border-white/50 bg-[var(--surface-glass)] shadow-[var(--shadow-lg)] backdrop-blur-xl',
      },
      density: {
        compact: '',
        default: '',
        roomy: '',
      },
      interactive: {
        true: 'hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-lg)]',
        false: '',
      },
    },
    defaultVariants: {
      surface: 'elevated',
      density: 'default',
      interactive: false,
    },
  }
)

const cardSectionVariants = cva('', {
  variants: {
    density: {
      compact: 'p-4',
      default: 'p-6',
      roomy: 'p-7',
    },
    flushTop: {
      true: 'pt-0',
      false: '',
    },
    flushBottom: {
      true: 'pb-0',
      false: '',
    },
  },
  defaultVariants: {
    density: 'default',
    flushTop: false,
    flushBottom: false,
  },
})

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, surface, density, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ surface, density, interactive }), className)}
      {...props}
    />
  )
)
Card.displayName = 'Card'

export interface CardSectionProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardSectionVariants> {}

const CardHeader = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, density, flushTop, flushBottom, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-1.5',
        cardSectionVariants({ density, flushTop, flushBottom }),
        className
      )}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-[var(--font-size-2xl)] font-semibold leading-[var(--line-height-title)] tracking-[var(--letter-spacing-tight)]',
      className
    )}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'text-[var(--font-size-sm)] leading-[var(--line-height-sm)] text-[var(--text-secondary)]',
      className
    )}
    {...props}
  />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, density, flushTop = true, flushBottom, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        cardSectionVariants({ density, flushTop, flushBottom }),
        className
      )}
      {...props}
    />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, density, flushTop = true, flushBottom = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-3',
        cardSectionVariants({ density, flushTop, flushBottom }),
        className
      )}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants }
