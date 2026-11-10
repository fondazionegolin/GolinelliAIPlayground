import { useEffect, useRef, useState } from 'react'
import type { CanvasItem } from './CollaborativeCanvas'
import { shapePath } from './canvasAi'
import { shadeTopFor } from './canvasColors'

/** Recompute geometry from the live box, including transient collaborative resizes.
 * Only this shape rerenders; the document and undo history change on pointer release.
 * Figures are drawn with a soft vertical shading (lighter top, the fill at the bottom), round joins and a faint
 * shadow; translucent highlights (annotations on images) stay flat so they never hide what they mark.
 */
export function CanvasShape({ item }: { item: Extract<CanvasItem, { type: 'shape' }> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: item.w, h: item.h })

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) setSize((prev) => prev.w === w && prev.h === h ? prev : { w, h })
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const opacity = item.fillOpacity ?? 1
  const solid = opacity >= 0.6
  const gradientId = `shade-${item.id}`
  const shadowId = `soft-${item.id}`
  const fill = solid ? `url(#${gradientId})` : item.fill
  const common = {
    fill, fillOpacity: opacity, stroke: item.stroke, strokeWidth: item.borderWidth ?? 2,
    strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const,
    strokeDasharray: item.borderStyle === 'dashed' ? '8 5' : undefined,
    filter: item.borderStyle === 'hand-drawn' ? `url(#rough-shape-${item.id})` : undefined,
  }
  const radius = Math.min(22, size.w / 4, size.h / 3.2)
  const inset = 4
  const triangle = `M${size.w / 2} ${inset + 1}Q${size.w / 2 + 3} ${inset - 1} ${size.w / 2 + 5} ${inset + 3}L${size.w - inset} ${size.h - inset - 4}Q${size.w - inset + 1} ${size.h - inset} ${size.w - inset - 5} ${size.h - inset}L${inset + 5} ${size.h - inset}Q${inset - 1} ${size.h - inset} ${inset} ${size.h - inset - 4}L${size.w / 2 - 5} ${inset + 3}Q${size.w / 2 - 3} ${inset - 1} ${size.w / 2} ${inset + 1}Z`

  return (
    <svg ref={svgRef} preserveAspectRatio="none" className="h-full w-full overflow-visible" viewBox={`0 0 ${size.w} ${size.h}`}>
      <defs>
        {solid && (
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shadeTopFor(item.fill)} />
            <stop offset="100%" stopColor={item.fill} />
          </linearGradient>
        )}
        {solid && (
          <filter id={shadowId} x="-12%" y="-12%" width="124%" height="134%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={item.stroke} floodOpacity="0.16" />
          </filter>
        )}
        {item.borderStyle === 'hand-drawn' && (
          <filter id={`rough-shape-${item.id}`} x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="11" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
      </defs>
      <g filter={solid ? `url(#${shadowId})` : undefined}>
        {item.shape === 'rounded-rect' && <rect x={inset} y={inset} width={Math.max(size.w - 2 * inset, 1)} height={Math.max(size.h - 2 * inset, 1)} rx={radius} ry={radius} {...common} />}
        {item.shape === 'rect' && <rect x={inset} y={inset} width={Math.max(size.w - 2 * inset, 1)} height={Math.max(size.h - 2 * inset, 1)} rx={Math.min(6, radius)} ry={Math.min(6, radius)} {...common} />}
        {(item.shape === 'ellipse' || item.shape === 'diamond' || item.shape === 'star' || item.shape === 'hexagon') && <path d={shapePath(item.shape, size.w, size.h)} {...common} />}
        {item.shape === 'triangle' && <path d={triangle} {...common} />}
        {item.shape === 'parallelogram' && <polygon points={`24,5 ${size.w - 5},5 ${size.w - 24},${size.h - 5} 5,${size.h - 5}`} {...common} />}
      </g>
      {item.borderStyle === 'hand-drawn' && item.shape === 'rounded-rect' && <rect x="6" y="3" width={Math.max(size.w - 10, 1)} height={Math.max(size.h - 7, 1)} rx={radius + 1} ry={radius - 1} fill="none" stroke={item.stroke} strokeWidth={Math.max(0.8, (item.borderWidth ?? 2) * 0.5)} opacity="0.58" />}
      {item.borderStyle === 'hand-drawn' && item.shape === 'triangle' && <polygon points={`${size.w / 2 + 2},3 ${size.w - 3},${size.h - 6} 4,${size.h - 3}`} fill="none" stroke={item.stroke} strokeWidth={Math.max(0.8, (item.borderWidth ?? 2) * 0.5)} opacity="0.58" />}
      {item.borderStyle === 'hand-drawn' && item.shape === 'parallelogram' && <polygon points={`26,3 ${size.w - 3},6 ${size.w - 26},${size.h - 3} 4,${size.h - 6}`} fill="none" stroke={item.stroke} strokeWidth={Math.max(0.8, (item.borderWidth ?? 2) * 0.5)} opacity="0.58" />}
    </svg>
  )
}
