import type { ReactNode } from 'react'

interface PageFrameProps {
  children: ReactNode
  /** When true (default) the frame body scrolls; pass false for pages that manage their own scroll areas. */
  scroll?: boolean
  /** Drop the outer gutter/frame chrome (mobile layouts render edge to edge). */
  bare?: boolean
  className?: string
}

/**
 * The single floating page frame used by every desktop page: fixed gutter, capped width,
 * rounded `.ds-page-frame` surface. Pages render their blocks inside it and keep their own
 * backgrounds transparent so the frame reads as one element on the page backdrop.
 */
export function PageFrame({ children, scroll = true, bare = false, className = '' }: PageFrameProps) {
  if (bare) return <>{children}</>

  return (
    <div className="ds-page-frame-gutter h-full min-h-0 w-full">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1800px]">
        <div className={`ds-page-frame flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${className}`}>
          {scroll ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          ) : children}
        </div>
      </div>
    </div>
  )
}
