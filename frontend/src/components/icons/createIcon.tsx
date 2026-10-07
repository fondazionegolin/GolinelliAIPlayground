import { forwardRef, type SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Width and height (number = px). Defaults to 24, like the previous icon set; size classes override it. */
  size?: number | string
  /** Kept for compatibility with existing call sites; Phosphor glyphs are filled shapes, so it has no effect. */
  strokeWidth?: number | string
}

export type AppIcon = ReturnType<typeof createIcon>

/**
 * Builds one icon component from a Phosphor glyph body (inner SVG markup, 256×256 grid).
 * The body is static markup generated at build time from the official Phosphor assets, never user input.
 */
export function createIcon(displayName: string, body: string) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size = 24, color, strokeWidth: _strokeWidth, className, style, ...props },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        fill="currentColor"
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
