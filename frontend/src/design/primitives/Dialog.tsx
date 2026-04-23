import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const dialogOverlayVariants = cva(
  'fixed inset-0 z-50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  {
    variants: {
      tone: {
        soft: 'bg-[var(--overlay-soft)]',
        modal: 'bg-[var(--overlay-modal)]',
      },
    },
    defaultVariants: {
      tone: 'modal',
    },
  }
)

const dialogContentVariants = cva(
  'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 border p-6 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-2xl',
  {
    variants: {
      size: {
        sm: 'max-w-md',
        md: 'max-w-xl',
        lg: 'max-w-3xl',
        xl: 'max-w-5xl',
        full: 'h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]',
      },
      surface: {
        base: 'border-[var(--border-subtle)] bg-[var(--surface-base)] shadow-[var(--shadow-xl)]',
        elevated:
          'border-white/60 bg-[var(--surface-elevated)] shadow-[var(--shadow-xl)] backdrop-blur-xl',
        glass:
          'border-white/50 bg-[var(--surface-glass)] shadow-[var(--shadow-xl)] backdrop-blur-2xl',
      },
    },
    defaultVariants: {
      size: 'md',
      surface: 'elevated',
    },
  }
)

type DialogOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> &
  VariantProps<typeof dialogOverlayVariants>

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(({ className, tone, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(dialogOverlayVariants({ tone }), className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  overlayTone?: NonNullable<VariantProps<typeof dialogOverlayVariants>['tone']>
  showClose?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      size,
      surface,
      overlayTone,
      showClose = true,
      ...props
    },
    ref
  ) => (
    <DialogPortal>
      <DialogOverlay tone={overlayTone} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(dialogContentVariants({ size, surface }), className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
)
DialogContent.displayName = DialogPrimitive.Content.displayName

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'left' | 'center'
}

const DialogHeader = ({
  className,
  align = 'left',
  ...props
}: DialogHeaderProps) => (
  <div
    className={cn(
      'flex flex-col gap-1.5',
      align === 'center' ? 'text-center' : 'text-left',
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  layout?: 'stack' | 'inline'
}

const DialogFooter = ({
  className,
  layout = 'inline',
  ...props
}: DialogFooterProps) => (
  <div
    className={cn(
      layout === 'stack'
        ? 'flex flex-col-reverse gap-2'
        : 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-[var(--font-size-2xl)] font-semibold leading-[var(--line-height-title)] tracking-[var(--letter-spacing-tight)] text-[var(--text-primary)]',
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(
      'text-[var(--font-size-sm)] leading-[var(--line-height-sm)] text-[var(--text-secondary)]',
      className
    )}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

const DialogBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('grid gap-4 text-[var(--text-primary)]', className)}
    {...props}
  />
))
DialogBody.displayName = 'DialogBody'

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogBody,
  dialogContentVariants,
  dialogOverlayVariants,
}
