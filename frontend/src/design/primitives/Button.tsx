import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--button-radius)] font-[var(--button-font-weight)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:!border-[color:var(--border-subtle)] disabled:!bg-[image:none] disabled:!bg-[color:color-mix(in_srgb,var(--text-secondary)_6%,transparent)] disabled:!text-[var(--text-secondary)] disabled:!opacity-60 disabled:!shadow-none [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
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
          '[--btn-tone:var(--text-primary)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--text-primary)] shadow-[var(--button-chrome-shadow)] hover:-translate-y-px hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] hover:shadow-[var(--button-chrome-shadow-hover)] focus-visible:ring-slate-400',
      },
      {
        tone: 'accent',
        surface: 'solid',
        className:
          '[--btn-tone:var(--app-accent,var(--logo-pink))] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--app-accent-text,var(--logo-pink))] shadow-[var(--button-chrome-shadow)] hover:-translate-y-px hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] hover:shadow-[var(--button-chrome-shadow-hover)] focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'solid',
        className:
          '[--btn-tone:var(--logo-blue)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-blue-strong)] shadow-[var(--button-chrome-shadow)] hover:-translate-y-px hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] hover:shadow-[var(--button-chrome-shadow-hover)] focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'solid',
        className:
          '[--btn-tone:var(--logo-violet)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-violet-strong)] shadow-[var(--button-chrome-shadow)] hover:-translate-y-px hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] hover:shadow-[var(--button-chrome-shadow-hover)] focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'solid',
        className:
          '[--btn-tone:var(--logo-pink)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-pink)] shadow-[var(--button-chrome-shadow)] hover:-translate-y-px hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] hover:shadow-[var(--button-chrome-shadow-hover)] focus-visible:ring-[var(--logo-pink)]',
      },
      {
        tone: 'neutral',
        surface: 'soft',
        className:
          '[--btn-tone:var(--text-primary)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-slate-700 shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-slate-200',
      },
      {
        tone: 'accent',
        surface: 'soft',
        className:
          '[--btn-tone:var(--app-accent,var(--logo-pink))] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--app-accent-text,var(--logo-pink))] shadow-[var(--button-chrome-shadow)] hover:-translate-y-px hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'soft',
        className:
          '[--btn-tone:var(--logo-blue)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-blue-strong)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'soft',
        className:
          '[--btn-tone:var(--logo-violet)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-violet-strong)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'soft',
        className:
          '[--btn-tone:var(--logo-pink)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-pink)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--logo-pink)]',
      },
      {
        tone: 'neutral',
        surface: 'outline',
        className:
          '[--btn-tone:var(--text-primary)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--text-primary)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-slate-300',
      },
      {
        tone: 'accent',
        surface: 'outline',
        className:
          '[--btn-tone:var(--app-accent,var(--logo-pink))] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--app-accent-text,var(--primary))] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'outline',
        className:
          '[--btn-tone:var(--logo-blue)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-blue-strong)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'outline',
        className:
          '[--btn-tone:var(--logo-violet)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-violet-strong)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'outline',
        className:
          '[--btn-tone:var(--logo-pink)] border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--logo-pink)] shadow-[var(--button-chrome-shadow)] hover:border-[color:var(--button-chrome-border-hover)] hover:bg-[image:var(--button-chrome-bg-hover)] focus-visible:ring-[var(--logo-pink)]',
      },
      {
        tone: 'neutral',
        surface: 'ghost',
        className:
          '[--btn-tone:var(--text-primary)] border border-transparent text-[var(--text-primary)] hover:border-[color:var(--button-chrome-border)] hover:bg-[image:var(--button-chrome-bg)] hover:shadow-[var(--button-chrome-shadow)] focus-visible:ring-slate-300',
      },
      {
        tone: 'accent',
        surface: 'ghost',
        className:
          '[--btn-tone:var(--app-accent,var(--logo-pink))] border border-transparent text-[var(--app-accent-text,var(--primary))] hover:border-[color:var(--button-chrome-border)] hover:bg-[image:var(--button-chrome-bg)] hover:shadow-[var(--button-chrome-shadow)] focus-visible:ring-[var(--app-accent,var(--ring))]',
      },
      {
        tone: 'success',
        surface: 'ghost',
        className:
          '[--btn-tone:var(--logo-blue)] border border-transparent text-[var(--logo-blue-strong)] hover:border-[color:var(--button-chrome-border)] hover:bg-[image:var(--button-chrome-bg)] hover:shadow-[var(--button-chrome-shadow)] focus-visible:ring-[var(--logo-blue)]',
      },
      {
        tone: 'warning',
        surface: 'ghost',
        className:
          '[--btn-tone:var(--logo-violet)] border border-transparent text-[var(--logo-violet-strong)] hover:border-[color:var(--button-chrome-border)] hover:bg-[image:var(--button-chrome-bg)] hover:shadow-[var(--button-chrome-shadow)] focus-visible:ring-[var(--logo-violet)]',
      },
      {
        tone: 'danger',
        surface: 'ghost',
        className:
          '[--btn-tone:var(--logo-pink)] border border-transparent text-[var(--logo-pink)] hover:border-[color:var(--button-chrome-border)] hover:bg-[image:var(--button-chrome-bg)] hover:shadow-[var(--button-chrome-shadow)] focus-visible:ring-[var(--logo-pink)]',
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
        className: 'text-[var(--logo-blue-strong)]',
      },
      {
        tone: 'warning',
        surface: 'link',
        className: 'text-[var(--logo-violet-strong)]',
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

function normalizeReadableChromeClasses(className?: string) {
  if (!className || !/\b!?text-white\b/.test(className)) return className
  const hasSolidBackgroundClass = /(^|\s)(?:bg-|from-|to-|via-)/.test(className)
  if (hasSolidBackgroundClass) return className
  return className.replace(/\s*!?text-white\b/g, '')
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
          normalizeReadableChromeClasses(className)
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
