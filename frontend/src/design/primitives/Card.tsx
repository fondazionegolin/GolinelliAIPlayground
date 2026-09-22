import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const cardVariants = cva(
  'rounded-[var(--card-radius)] !border-0 bg-[image:var(--ds-semantic-shading)] text-[var(--text-primary)] shadow-[var(--shadow-sm)] transition-all',
  {
    variants: {
      surface: {
        base: 'bg-[var(--ds-surface)] hover:bg-[var(--ds-surface-raised)]',
        elevated:
          'bg-[var(--ds-surface-raised)] hover:bg-[var(--ds-surface-raised)]',
        muted: 'bg-[var(--ds-surface-muted)]',
        glass:
          'bg-[var(--ds-surface)]',
      },
      density: {
        compact: '',
        default: '',
        roomy: '',
      },
      interactive: {
        true: 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)] active:translate-y-0',
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
      compact: 'p-3',
      default: 'p-5',
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
      'text-[1.125rem]',
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
