import { useEffect, useRef, useState } from 'react'
import type { CanvasItem } from './CollaborativeCanvas'
import { shapePath } from './canvasAi'

/** Recompute geometry from the live box, including transient collaborative resizes.
 * Only this shape rerenders; the document and undo history change on pointer release.
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

  return (
    <svg ref={svgRef} preserveAspectRatio="none" className="h-full w-full overflow-visible" viewBox={`0 0 ${size.w} ${size.h}`}>
      {item.borderStyle === 'hand-drawn' && (
        <defs>
          <filter id={`rough-shape-${item.id}`} x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="11" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      )}
      {item.shape === 'rounded-rect' && <rect x="4" y="4" width={Math.max(size.w - 8, 1)} height={Math.max(size.h - 8, 1)} rx="16" ry="16" fill={item.fill} fillOpacity={item.fillOpacity ?? 1} stroke={item.stroke} strokeWidth={item.borderWidth ?? 2.5} strokeDasharray={item.borderStyle === 'dashed' ? '8 5' : undefined} filter={item.borderStyle === 'hand-drawn' ? `url(#rough-shape-${item.id})` : undefined} />}
      {(item.shape === 'rect' || item.shape === 'ellipse' || item.shape === 'diamond' || item.shape === 'star' || item.shape === 'hexagon') && <path d={shapePath(item.shape, size.w, size.h)} fill={item.fill} fillOpacity={item.fillOpacity ?? 1} stroke={item.stroke} strokeWidth={item.borderWidth ?? 2.5} strokeLinejoin="round" strokeDasharray={item.borderStyle === 'dashed' ? '8 5' : undefined} filter={item.borderStyle === 'hand-drawn' ? `url(#rough-shape-${item.id})` : undefined} />}
      {item.shape === 'triangle' && <polygon points={`${size.w / 2},5 ${size.w - 5},${size.h - 5} 5,${size.h - 5}`} fill={item.fill} fillOpacity={item.fillOpacity ?? 1} stroke={item.stroke} strokeWidth={item.borderWidth ?? 2.5} strokeDasharray={item.borderStyle === 'dashed' ? '8 5' : undefined} filter={item.borderStyle === 'hand-drawn' ? `url(#rough-shape-${item.id})` : undefined} />}
      {item.shape === 'parallelogram' && <polygon points={`24,5 ${size.w - 5},5 ${size.w - 24},${size.h - 5} 5,${size.h - 5}`} fill={item.fill} fillOpacity={item.fillOpacity ?? 1} stroke={item.stroke} strokeWidth={item.borderWidth ?? 2.5} strokeDasharray={item.borderStyle === 'dashed' ? '8 5' : undefined} filter={item.borderStyle === 'hand-drawn' ? `url(#rough-shape-${item.id})` : undefined} />}
      {item.borderStyle === 'hand-drawn' && item.shape === 'rounded-rect' && <rect x="6" y="3" width={Math.max(size.w - 10, 1)} height={Math.max(size.h - 7, 1)} rx="17" ry="15" fill="none" stroke={item.stroke} strokeWidth={Math.max(0.8, (item.borderWidth ?? 2.5) * 0.5)} opacity="0.58" />}
      {item.borderStyle === 'hand-drawn' && item.shape === 'triangle' && <polygon points={`${size.w / 2 + 2},3 ${size.w - 3},${size.h - 6} 4,${size.h - 3}`} fill="none" stroke={item.stroke} strokeWidth={Math.max(0.8, (item.borderWidth ?? 2.5) * 0.5)} opacity="0.58" />}
      {item.borderStyle === 'hand-drawn' && item.shape === 'parallelogram' && <polygon points={`26,3 ${size.w - 3},6 ${size.w - 26},${size.h - 3} 4,${size.h - 6}`} fill="none" stroke={item.stroke} strokeWidth={Math.max(0.8, (item.borderWidth ?? 2.5) * 0.5)} opacity="0.58" />}
    </svg>
  )
}
