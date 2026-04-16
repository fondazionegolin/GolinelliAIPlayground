import * as React from 'react'
import { Button, type ButtonProps } from '@/design/primitives/Button'

export interface IconButtonProps extends Omit<ButtonProps, 'density'> {
  size?: 'sm' | 'default' | 'lg'
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'default', ...props }, ref) => {
    const density = size === 'sm' ? 'compact' : size === 'lg' ? 'roomy' : 'icon'
    return <Button ref={ref} density={density} {...props} />
  }
)

IconButton.displayName = 'IconButton'
