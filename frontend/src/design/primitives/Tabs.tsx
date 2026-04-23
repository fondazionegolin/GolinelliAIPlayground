import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  onValueChange: (value: string) => void
  density: NonNullable<VariantProps<typeof tabsListVariants>['density']>
  tone: NonNullable<VariantProps<typeof tabsTriggerVariants>['tone']>
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined)

const tabsListVariants = cva(
  'inline-flex items-center rounded-xl border',
  {
    variants: {
      density: {
        compact: 'h-9 gap-1 p-1',
        default: 'h-10 gap-1 p-1',
        roomy: 'h-11 gap-1.5 p-1.5',
      },
      surface: {
        muted: 'border-[var(--border-subtle)] bg-[var(--surface-muted)]',
        base: 'border-[var(--border-subtle)] bg-[var(--surface-base)] shadow-[var(--shadow-sm)]',
        glass: 'border-white/50 bg-[var(--surface-glass)] backdrop-blur-md',
      },
    },
    defaultVariants: {
      density: 'default',
      surface: 'muted',
    },
  }
)

const tabsTriggerVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      density: {
        compact: 'px-2.5 py-1 text-xs',
        default: 'px-3 py-1.5 text-sm',
        roomy: 'px-4 py-2 text-sm',
      },
      tone: {
        neutral: '',
        accent: '',
      },
      active: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      {
        tone: 'neutral',
        active: true,
        className:
          'bg-[var(--surface-base)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]',
      },
      {
        tone: 'neutral',
        active: false,
        className:
          'text-[var(--text-secondary)] hover:bg-[var(--surface-base)]/70 hover:text-[var(--text-primary)]',
      },
      {
        tone: 'accent',
        active: true,
        className: 'bg-primary text-primary-foreground shadow-[var(--shadow-sm)]',
      },
      {
        tone: 'accent',
        active: false,
        className: 'text-primary hover:bg-primary/10',
      },
    ],
    defaultVariants: {
      density: 'default',
      tone: 'neutral',
      active: false,
    },
  }
)

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  density?: NonNullable<VariantProps<typeof tabsListVariants>['density']>
  tone?: NonNullable<VariantProps<typeof tabsTriggerVariants>['tone']>
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      className,
      value,
      defaultValue,
      onValueChange,
      children,
      density = 'default',
      tone = 'neutral',
      ...props
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue || '')
    const currentValue = value !== undefined ? value : internalValue

    const handleValueChange = React.useCallback(
      (newValue: string) => {
        if (value === undefined) {
          setInternalValue(newValue)
        }
        onValueChange?.(newValue)
      },
      [value, onValueChange]
    )

    return (
      <TabsContext.Provider value={{ value: currentValue, onValueChange: handleValueChange, density, tone }}>
        <div ref={ref} className={cn('w-full', className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = 'Tabs'

interface TabsListProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tabsListVariants> {}

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, density, surface, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    const resolvedDensity = density ?? context?.density ?? 'default'

    return (
      <div
        ref={ref}
        className={cn(
          tabsListVariants({
            density: resolvedDensity,
            surface,
          }),
          className
        )}
        {...props}
      />
    )
  }
)
TabsList.displayName = 'TabsList'

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
  tone?: NonNullable<VariantProps<typeof tabsTriggerVariants>['tone']>
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, tone, onClick, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (!context) throw new Error('TabsTrigger must be used within Tabs')

    const isActive = context.value === value

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) {
            context.onValueChange(value)
          }
        }}
        className={cn(
          tabsTriggerVariants({
            density: context.density,
            tone: tone ?? context.tone,
            active: isActive,
          }),
          className
        )}
        {...props}
      />
    )
  }
)
TabsTrigger.displayName = 'TabsTrigger'

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (!context) throw new Error('TabsContent must be used within Tabs')

    if (context.value !== value) return null

    return (
      <div
        ref={ref}
        role="tabpanel"
        className={cn('mt-3 ring-offset-background focus-visible:outline-none', className)}
        {...props}
      />
    )
  }
)
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants, tabsTriggerVariants }
