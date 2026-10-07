import type React from 'react'
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import type { IconProps } from './createIcon'

/**
 * Builds one icon component backed by the Flaticon UIcons webfont (solid, rounded).
 * Same props as the SVG icons; the glyph always fills the element's box (see `.app-icon-font` in index.css),
 * so size classes like `h-4 w-4` keep working.
 */
export function createFontIcon(displayName: string, glyph: string) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size, color, strokeWidth: _strokeWidth, className, style, ...props },
    ref,
  ) {
    const merged = {
      ...(size !== undefined ? { '--icon-size': typeof size === 'number' ? `${size}px` : size } : null),
      ...(color ? { color } : null),
      ...style,
    } as CSSProperties
    return (
      <i
        // Typed like the SVG icons so call sites' refs compile; the element is an <i>.
        ref={ref as unknown as React.Ref<HTMLElement>}
        aria-hidden={props['aria-label'] ? undefined : true}
        className={`fi-sr-${glyph} app-icon app-icon-font${className ? ` ${className}` : ''}`}
        style={merged}
        {...(props as HTMLAttributes<HTMLElement>)}
      />
    )
  })
  Icon.displayName = displayName
  return Icon
}
