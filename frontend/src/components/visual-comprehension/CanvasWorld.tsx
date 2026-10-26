import { useId } from 'react'
import type { DrawingLayout } from './blackboard'

/** The cards of the infinite canvas: the source image and the boards, with soft shadows and rounded corners. */
export default function CanvasWorld({ layout, imageUrl }: { layout: DrawingLayout; imageUrl: string }) {
  const id = useId().replace(/:/g, '')
  const unit = Math.max(layout.image.width, layout.image.height)
  const radius = unit * .012
  const { image } = layout
  return <g className="vc-world">
    <defs>
      <filter id={`${id}-card`} x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy={unit * .004} stdDeviation={unit * .008} floodColor="#0f172a" floodOpacity=".14" />
      </filter>
      <clipPath id={`${id}-source`}><rect {...image} rx={radius} /></clipPath>
    </defs>
    {layout.boards.map(b => <g key={b.id}>
      <rect {...b.frame} rx={radius} fill="#ffffff" filter={`url(#${id}-card)`} />
      {b.title && <text x={b.frame.x + unit * .02} y={b.frame.y - unit * .015} fontSize={unit * .022} fontWeight={600} fill="#64748b"
        fontFamily="ui-sans-serif, system-ui, sans-serif">{b.title}</text>}
    </g>)}
    <rect {...image} rx={radius} fill="#ffffff" filter={`url(#${id}-card)`} />
    <image href={imageUrl} {...image} preserveAspectRatio="none" clipPath={`url(#${id}-source)`} />
  </g>
}
