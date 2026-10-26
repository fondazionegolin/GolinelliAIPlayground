import { forwardRef, type SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Width and height (number = px). Defaults to 24, like the previous icon set; size classes override it. */
  size?: number | string
  /** Line thickness in SVG units. Defaults to the Untitled UI line weight (2). */
  strokeWidth?: number | string
}

export type AppIcon = ReturnType<typeof createIcon>

/**
 * Builds one icon component from an Untitled UI glyph body (24×24 grid).
 * The body is static markup generated at build time from the official Untitled UI components, never user input.
 */
export function createIcon(displayName: string, body: string) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size = 24, color, strokeWidth = 2, className, style, ...props },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={props['aria-label'] ? undefined : true}
        focusable="false"
        className={className ? `app-icon ${className}` : 'app-icon'}
        style={color ? { color, ...style } : style}
        dangerouslySetInnerHTML={{ __html: body }}
        {...props}
      />
    )
  })
  Icon.displayName = displayName
  return Icon
}
