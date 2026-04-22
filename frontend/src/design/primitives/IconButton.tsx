import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/design/primitives/Button'

export interface IconButtonProps extends Omit<ButtonProps, 'density'> {
  size?: 'sm' | 'default' | 'lg'
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'default', className, ...props }, ref) => {
    const sizeClass =
      size === 'sm'
        ? 'h-8 w-8 p-0'
        : size === 'lg'
          ? 'h-10 w-10 p-0'
          : 'h-9 w-9 p-0'

    return <Button ref={ref} density="icon" className={cn(sizeClass, className)} {...props} />
  }
)

IconButton.displayName = 'IconButton'
