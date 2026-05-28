import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium transition-colors',
  {
    variants: {
      tone: {
        neutral: '',
        accent: '',
        success: '',
        warning: '',
        danger: '',
      },
      surface: {
        solid: '',
        soft: '',
        outline: '',
      },
      density: {
        compact: 'px-2 py-0.5 text-[11px]',
        default: 'px-2.5 py-1 text-xs',
        roomy: 'px-3 py-1.5 text-sm',
      },
    },
    compoundVariants: [
      {
        tone: 'neutral',
        surface: 'solid',
        className: 'border-transparent bg-slate-700 text-white',
      },
      {
        tone: 'accent',
        surface: 'solid',
        className: 'border-transparent bg-[var(--app-accent)] text-white',
      },
      {
        tone: 'success',
        surface: 'solid',
        className: 'border-transparent bg-[var(--logo-blue)] text-white',
      },
      {
        tone: 'warning',
        surface: 'solid',
        className: 'border-transparent bg-[var(--logo-violet)] text-white',
      },
      {
        tone: 'danger',
        surface: 'solid',
        className: 'border-transparent bg-[var(--logo-pink)] text-white',
      },
      {
        tone: 'neutral',
        surface: 'soft',
        className: 'border-transparent bg-slate-100 text-slate-700',
      },
      {
        tone: 'accent',
        surface: 'soft',
        className: 'border-transparent bg-[var(--app-accent)] text-white',
      },
      {
        tone: 'success',
        surface: 'soft',
        className: 'border-transparent bg-[var(--logo-blue)] text-white',
      },
      {
        tone: 'warning',
        surface: 'soft',
        className: 'border-transparent bg-[var(--logo-violet)] text-white',
      },
      {
        tone: 'danger',
        surface: 'soft',
        className: 'border-transparent bg-[var(--logo-pink)] text-white',
      },
      {
        tone: 'neutral',
        surface: 'outline',
        className: 'border-[var(--border-subtle)] bg-transparent text-[var(--text-primary)]',
      },
      {
        tone: 'accent',
        surface: 'outline',
        className: 'border-[var(--app-accent)] bg-transparent text-[var(--app-accent-text)]',
      },
      {
        tone: 'success',
        surface: 'outline',
        className: 'border-[var(--logo-blue)] bg-transparent text-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'outline',
        className: 'border-[var(--logo-violet)] bg-transparent text-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'outline',
        className: 'border-[var(--logo-pink)] bg-transparent text-[var(--logo-pink)]',
      },
    ],
    defaultVariants: {
      tone: 'accent',
      surface: 'soft',
      density: 'default',
    },
  }
)

type LegacyVariant = 'default' | 'secondary' | 'destructive' | 'outline'

function resolveLegacyVariant(variant?: LegacyVariant) {
  switch (variant) {
    case 'secondary':
      return { tone: 'neutral' as const, surface: 'soft' as const }
    case 'destructive':
      return { tone: 'danger' as const, surface: 'solid' as const }
    case 'outline':
      return { tone: 'neutral' as const, surface: 'outline' as const }
    case 'default':
    default:
      return { tone: 'accent' as const, surface: 'soft' as const }
  }
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    Omit<VariantProps<typeof badgeVariants>, 'tone' | 'surface'> {
  tone?: NonNullable<VariantProps<typeof badgeVariants>['tone']>
  surface?: NonNullable<VariantProps<typeof badgeVariants>['surface']>
  variant?: LegacyVariant
}

function Badge({
  className,
  tone,
  surface,
  density,
  variant,
  ...props
}: BadgeProps) {
  const legacy = resolveLegacyVariant(variant)

  return (
    <div
      className={cn(
        badgeVariants({
          tone: tone ?? legacy.tone,
          surface: surface ?? legacy.surface,
          density,
        }),
        className
      )}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
