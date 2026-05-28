import { Loader2 } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const spinnerVariants = cva('animate-spin', {
  variants: {
    size: {
      sm: 'h-4 w-4',
      default: 'h-5 w-5',
      lg: 'h-6 w-6',
    },
    tone: {
      neutral: 'text-[var(--text-secondary)]',
      accent: 'text-[var(--logo-pink)]',
      success: 'text-[var(--logo-blue)]',
      warning: 'text-[var(--logo-violet)]',
      danger: 'text-[var(--logo-pink)]',
      inverse: 'text-white',
    },
  },
  defaultVariants: {
    size: 'default',
    tone: 'accent',
  },
})

export interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string
}

export function Spinner({ className, size, tone }: SpinnerProps) {
  return <Loader2 className={cn(spinnerVariants({ size, tone }), className)} />
}

export { spinnerVariants }
