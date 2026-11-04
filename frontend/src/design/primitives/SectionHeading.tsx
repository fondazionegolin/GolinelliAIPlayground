import type { HTMLAttributes, ReactNode } from 'react'
import { NavSectionArt } from '@/components/NavSectionArt'
import { cn } from '@/lib/utils'

/** Decorative artwork shared with the navbar; a page illustration spans title and subtitle. */
export function SectionIllustration({ section, compact = false, className }: { section: string; compact?: boolean; className?: string }) {
  return <NavSectionArt path={section} variant="heading" className={cn(compact ? 'h-10 w-10' : 'h-[4.5rem] w-[4.5rem] sm:h-20 sm:w-20', className)} />
}

export function SectionHeading({ section, as: Heading = 'h1', compact = false, className, titleClassName, subtitle, subtitleClassName, children, ...props }:
  HTMLAttributes<HTMLHeadingElement> & { section: string; as?: 'h1' | 'h2'; compact?: boolean; titleClassName?: string; subtitle?: ReactNode; subtitleClassName?: string }) {
  if (subtitle !== undefined) return <div className="flex min-w-0 items-center gap-3 sm:gap-4" data-section-heading>
    <SectionIllustration section={section} compact={compact} className={compact ? 'h-14 w-14' : undefined} />
    <div className="min-w-0 flex-1">
      <Heading className={cn('min-w-0', className, titleClassName)} {...props}>{children}</Heading>
      <p className={subtitleClassName}>{subtitle}</p>
    </div>
  </div>
  return <Heading className={cn('flex min-w-0 items-center gap-3', className)} {...props}>
    <SectionIllustration section={section} compact={compact} />
    <span className={cn('min-w-0 [overflow:inherit] [text-overflow:inherit]', titleClassName)}>{children}</span>
  </Heading>
}
