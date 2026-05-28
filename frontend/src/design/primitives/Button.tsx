import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--button-radius)] font-[var(--button-font-weight)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
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
        compact: 'h-[var(--button-height-compact)] px-[var(--button-padding-x-compact)] text-sm',
        default: 'h-[var(--button-height-default)] px-[var(--button-padding-x-default)] text-sm',
        roomy: 'h-[var(--button-height-roomy)] px-[var(--button-padding-x-roomy)] text-base',
        icon: 'h-[var(--button-height-icon)] w-[var(--button-height-icon)] p-0',
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
          'border border-slate-700 bg-[var(--text-primary)] text-white shadow-[var(--shadow-sm)] hover:-translate-y-px hover:bg-slate-800 hover:shadow-[var(--shadow-md)] focus-visible:ring-slate-400',
      },
      {
        tone: 'accent',
        surface: 'solid',
        className:
          'border border-transparent bg-[image:var(--button-accent-bg)] text-white shadow-[var(--button-accent-shadow)] hover:-translate-y-px hover:brightness-[0.98] hover:shadow-[var(--button-accent-shadow-hover)] focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'solid',
        className:
          'border border-transparent bg-[image:var(--button-blue-bg)] text-white shadow-[var(--shadow-sm)] hover:-translate-y-px hover:brightness-[0.98] hover:shadow-[var(--shadow-md)] focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'solid',
        className:
          'border border-transparent bg-[image:var(--button-violet-bg)] text-white shadow-[var(--shadow-sm)] hover:-translate-y-px hover:brightness-[0.98] hover:shadow-[var(--shadow-md)] focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'solid',
        className:
          'border border-transparent bg-[image:var(--button-accent-bg)] text-white shadow-[var(--button-accent-shadow)] hover:-translate-y-px hover:brightness-[0.98] hover:shadow-[var(--button-accent-shadow-hover)] focus-visible:ring-[var(--logo-pink)]',
      },
      {
        tone: 'neutral',
        surface: 'soft',
        className:
          'border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-slate-200',
      },
      {
        tone: 'accent',
        surface: 'soft',
        className:
          'border border-transparent bg-[image:var(--button-accent-bg)] text-white shadow-[var(--shadow-sm)] hover:-translate-y-px hover:brightness-[0.98] focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'soft',
        className:
          'border border-transparent bg-[image:var(--button-blue-bg)] text-white hover:brightness-[0.98] focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'soft',
        className:
          'border border-transparent bg-[image:var(--button-violet-bg)] text-white hover:brightness-[0.98] focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'soft',
        className:
          'border border-transparent bg-[image:var(--button-accent-bg)] text-white hover:brightness-[0.98] focus-visible:ring-[var(--logo-pink)]',
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
          'border border-[var(--app-accent,var(--ring))] bg-[var(--surface-base)] text-[var(--app-accent-text,var(--primary))] hover:border-[var(--app-accent,var(--ring))] hover:bg-[var(--app-accent,var(--primary))] hover:text-white focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'outline',
        className:
          'border border-[var(--logo-blue)] bg-[var(--surface-base)] text-[var(--logo-blue)] hover:bg-[var(--logo-blue)] hover:text-white focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'outline',
        className:
          'border border-[var(--logo-violet)] bg-[var(--surface-base)] text-[var(--logo-violet)] hover:bg-[var(--logo-violet)] hover:text-white focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'outline',
        className:
          'border border-[var(--logo-pink)] bg-[var(--surface-base)] text-[var(--logo-pink)] hover:bg-[var(--logo-pink)] hover:text-white focus-visible:ring-[var(--logo-pink)]',
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
          'text-[var(--app-accent-text,var(--primary))] hover:bg-[var(--app-accent,var(--primary))] hover:text-white focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'ghost',
        className:
          'text-[var(--logo-blue)] hover:bg-[var(--logo-blue)] hover:text-white focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'ghost',
        className:
          'text-[var(--logo-violet)] hover:bg-[var(--logo-violet)] hover:text-white focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'ghost',
        className:
          'text-[var(--logo-pink)] hover:bg-[var(--logo-pink)] hover:text-white focus-visible:ring-[var(--logo-pink)]',
      },
      {
        tone: 'neutral',
        surface: 'link',
        className: 'text-[var(--text-primary)]',
      },
      {
        tone: 'accent',
        surface: 'link',
        className: 'text-[var(--app-accent-text,var(--primary))]',
      },
      {
        tone: 'success',
        surface: 'link',
        className: 'text-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'link',
        className: 'text-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'link',
        className: 'text-[var(--logo-pink)]',
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

type LegacySize = 'default' | 'sm' | 'lg' | 'icon'

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

function resolveLegacySize(size?: LegacySize) {
  switch (size) {
    case 'sm':
      return 'compact' as const
    case 'lg':
      return 'roomy' as const
    case 'icon':
      return 'icon' as const
    case 'default':
    default:
      return 'default' as const
  }
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'tone' | 'surface'> {
  asChild?: boolean
  tone?: NonNullable<VariantProps<typeof buttonVariants>['tone']>
  surface?: NonNullable<VariantProps<typeof buttonVariants>['surface']>
  variant?: LegacyVariant
  size?: LegacySize
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
      size,
      asChild = false,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    const legacy = resolveLegacyVariant(variant)
    const legacyDensity = resolveLegacySize(size)

    return (
      <Comp
        className={cn(
          buttonVariants({
            tone: tone ?? legacy.tone,
            surface: surface ?? legacy.surface,
            density: density ?? legacyDensity,
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
