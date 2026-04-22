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
          'bg-[#E91E63] text-white shadow-sm hover:bg-[#d61b5b] focus-visible:ring-[#f4b6cf]',
      },
      {
        tone: 'success',
        surface: 'solid',
        className:
          'bg-[#2196F3] text-white shadow-sm hover:bg-[#1d84d8] focus-visible:ring-[#b5dbfb]',
      },
      {
        tone: 'warning',
        surface: 'solid',
        className:
          'bg-[#BA68C8] text-white shadow-sm hover:bg-[#a95db5] focus-visible:ring-[#d8bbe3]',
      },
      {
        tone: 'danger',
        surface: 'solid',
        className:
          'bg-[#E91E63] text-white shadow-sm hover:bg-[#d61b5b] focus-visible:ring-[#f4b6cf]',
      },
      {
        tone: 'neutral',
        surface: 'soft',
        className:
          'bg-[#f1e7f5] text-[#6a5872] hover:bg-[#e6d9ec] focus-visible:ring-[#d8c5e0]',
      },
      {
        tone: 'accent',
        surface: 'soft',
        className:
          'bg-[#fad6e4] text-[#b51f5f] hover:bg-[#f4b6cf] focus-visible:ring-[#f4b6cf]',
      },
      {
        tone: 'success',
        surface: 'soft',
        className:
          'bg-[#d8ecfd] text-[#1d7dd8] hover:bg-[#b5dbfb] focus-visible:ring-[#b5dbfb]',
      },
      {
        tone: 'warning',
        surface: 'soft',
        className:
          'bg-[#ead8ef] text-[#9452a3] hover:bg-[#d8bbe3] focus-visible:ring-[#d8bbe3]',
      },
      {
        tone: 'danger',
        surface: 'soft',
        className:
          'bg-[#fad6e4] text-[#b51f5f] hover:bg-[#f4b6cf] focus-visible:ring-[#f4b6cf]',
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
          'border border-[#f4b6cf] bg-[var(--surface-base)] text-[#b51f5f] hover:bg-[#fdf0f5] focus-visible:ring-[#f4b6cf]',
      },
      {
        tone: 'success',
        surface: 'outline',
        className:
          'border border-[#b5dbfb] bg-[var(--surface-base)] text-[#1d7dd8] hover:bg-[#eef7fe] focus-visible:ring-[#b5dbfb]',
      },
      {
        tone: 'warning',
        surface: 'outline',
        className:
          'border border-[#d8bbe3] bg-[var(--surface-base)] text-[#9452a3] hover:bg-[#f7eff9] focus-visible:ring-[#d8bbe3]',
      },
      {
        tone: 'danger',
        surface: 'outline',
        className:
          'border border-[#f4b6cf] bg-[var(--surface-base)] text-[#b51f5f] hover:bg-[#fdf0f5] focus-visible:ring-[#f4b6cf]',
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
          'text-[#b51f5f] hover:bg-[#fdf0f5] focus-visible:ring-[#f4b6cf]',
      },
      {
        tone: 'success',
        surface: 'ghost',
        className:
          'text-[#1d7dd8] hover:bg-[#eef7fe] focus-visible:ring-[#b5dbfb]',
      },
      {
        tone: 'warning',
        surface: 'ghost',
        className:
          'text-[#9452a3] hover:bg-[#f7eff9] focus-visible:ring-[#d8bbe3]',
      },
      {
        tone: 'danger',
        surface: 'ghost',
        className:
          'text-[#b51f5f] hover:bg-[#fdf0f5] focus-visible:ring-[#f4b6cf]',
      },
      {
        tone: 'neutral',
        surface: 'link',
        className: 'text-[var(--text-primary)]',
      },
      {
        tone: 'accent',
        surface: 'link',
        className: 'text-[#b51f5f]',
      },
      {
        tone: 'success',
        surface: 'link',
        className: 'text-[#1d7dd8]',
      },
      {
        tone: 'warning',
        surface: 'link',
        className: 'text-[#9452a3]',
      },
      {
        tone: 'danger',
        surface: 'link',
        className: 'text-[#b51f5f]',
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
