import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
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
        ghost: '',
        link: 'rounded-none px-0 shadow-none underline-offset-4 hover:underline',
      },
      density: {
        compact: 'h-9 px-3 text-sm',
        default: 'h-10 px-4 text-sm',
        roomy: 'h-11 px-5 text-base',
        icon: 'h-10 w-10 p-0',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      {
        tone: 'neutral',
        surface: 'solid',
        className:
          'bg-[var(--text-primary)] text-white shadow-sm hover:opacity-92 focus-visible:ring-slate-400',
      },
      {
        tone: 'accent',
        surface: 'solid',
        className:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-primary/40',
      },
      {
        tone: 'success',
        surface: 'solid',
        className:
          'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 focus-visible:ring-emerald-400',
      },
      {
        tone: 'warning',
        surface: 'solid',
        className:
          'bg-amber-500 text-slate-950 shadow-sm hover:bg-amber-400 focus-visible:ring-amber-300',
      },
      {
        tone: 'danger',
        surface: 'solid',
        className:
          'bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-400',
      },
      {
        tone: 'neutral',
        surface: 'soft',
        className:
          'bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-slate-300',
      },
      {
        tone: 'accent',
        surface: 'soft',
        className:
          'bg-accent text-accent-foreground hover:bg-accent/80 focus-visible:ring-primary/30',
      },
      {
        tone: 'success',
        surface: 'soft',
        className:
          'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:ring-emerald-200',
      },
      {
        tone: 'warning',
        surface: 'soft',
        className:
          'bg-amber-50 text-amber-700 hover:bg-amber-100 focus-visible:ring-amber-200',
      },
      {
        tone: 'danger',
        surface: 'soft',
        className:
          'bg-rose-50 text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-200',
      },
      {
        tone: 'neutral',
        surface: 'outline',
        className:
          'border border-[var(--border-subtle)] bg-[var(--surface-base)] text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:ring-slate-300',
      },
      {
        tone: 'accent',
        surface: 'outline',
        className:
          'border border-primary/25 bg-[var(--surface-base)] text-primary hover:bg-primary/5 focus-visible:ring-primary/30',
      },
      {
        tone: 'success',
        surface: 'outline',
        className:
          'border border-emerald-200 bg-[var(--surface-base)] text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-200',
      },
      {
        tone: 'warning',
        surface: 'outline',
        className:
          'border border-amber-200 bg-[var(--surface-base)] text-amber-700 hover:bg-amber-50 focus-visible:ring-amber-200',
      },
      {
        tone: 'danger',
        surface: 'outline',
        className:
          'border border-rose-200 bg-[var(--surface-base)] text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-200',
      },
      {
        tone: 'neutral',
        surface: 'ghost',
        className:
          'text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:ring-slate-300',
      },
      {
        tone: 'accent',
        surface: 'ghost',
        className:
          'text-primary hover:bg-primary/10 focus-visible:ring-primary/30',
      },
      {
        tone: 'success',
        surface: 'ghost',
        className:
          'text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-200',
      },
      {
        tone: 'warning',
        surface: 'ghost',
        className:
          'text-amber-700 hover:bg-amber-50 focus-visible:ring-amber-200',
      },
      {
        tone: 'danger',
        surface: 'ghost',
        className:
          'text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-200',
      },
      {
        tone: 'neutral',
        surface: 'link',
        className: 'text-[var(--text-primary)]',
      },
      {
        tone: 'accent',
        surface: 'link',
        className: 'text-primary',
      },
      {
        tone: 'success',
        surface: 'link',
        className: 'text-emerald-700',
      },
      {
        tone: 'warning',
        surface: 'link',
        className: 'text-amber-700',
      },
      {
        tone: 'danger',
        surface: 'link',
        className: 'text-rose-700',
      },
    ],
    defaultVariants: {
      tone: 'accent',
      surface: 'solid',
      density: 'default',
      fullWidth: false,
    },
  }
)

type LegacyVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link'

function resolveLegacyVariant(variant?: LegacyVariant) {
  switch (variant) {
    case 'destructive':
      return { tone: 'danger' as const, surface: 'solid' as const }
    case 'outline':
      return { tone: 'neutral' as const, surface: 'outline' as const }
    case 'secondary':
      return { tone: 'neutral' as const, surface: 'soft' as const }
    case 'ghost':
      return { tone: 'neutral' as const, surface: 'ghost' as const }
    case 'link':
      return { tone: 'accent' as const, surface: 'link' as const }
    case 'default':
    default:
      return { tone: 'accent' as const, surface: 'solid' as const }
  }
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'tone' | 'surface'> {
  asChild?: boolean
  tone?: NonNullable<VariantProps<typeof buttonVariants>['tone']>
  surface?: NonNullable<VariantProps<typeof buttonVariants>['surface']>
  variant?: LegacyVariant
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      tone,
      surface,
      density,
      fullWidth,
      variant,
      asChild = false,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    const legacy = resolveLegacyVariant(variant)

    return (
      <Comp
        className={cn(
          buttonVariants({
            tone: tone ?? legacy.tone,
            surface: surface ?? legacy.surface,
            density,
            fullWidth,
          }),
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
