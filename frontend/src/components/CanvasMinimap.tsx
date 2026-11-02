import { useMemo, useRef } from 'react'

export type MinimapItem = { id: string; x: number; y: number; w: number; h: number; kind: 'frame' | 'image' | 'plot' | 'ai' | 'item'; selected: boolean }

const WIDTH = 208
const HEIGHT = 136
const PAD = 120

const FILL: Record<MinimapItem['kind'], string> = { frame: 'transparent', image: '#94a3b8', plot: '#fca5a5', ai: '#e85c8d', item: '#64748b' }

/** Overview of the whole board: every item as a small block, the visible area as a frame; click or drag to move there. */
export function CanvasMinimap({ items, pan, zoom, viewW, viewH, onJump }: {
  items: MinimapItem[]; pan: { x: number; y: number }; zoom: number; viewW: number; viewH: number
  onJump: (worldX: number, worldY: number) => void
}) {
  const dragging = useRef(false)
  const view = { x: -pan.x / zoom, y: -pan.y / zoom, w: viewW / zoom, h: viewH / zoom }
  const geo = useMemo(() => {
    const xs = [view.x, view.x + view.w, ...items.flatMap((i) => [i.x, i.x + i.w])]
    const ys = [view.y, view.y + view.h, ...items.flatMap((i) => [i.y, i.y + i.h])]
    const minX = Math.min(...xs) - PAD, minY = Math.min(...ys) - PAD
    const w = Math.max(...xs) + PAD - minX, h = Math.max(...ys) + PAD - minY
    const scale = Math.min(WIDTH / w, HEIGHT / h)
    return { minX, minY, scale, offX: (WIDTH - w * scale) / 2, offY: (HEIGHT - h * scale) / 2 }
  }, [items, view.x, view.y, view.w, view.h])

  const toX = (x: number) => geo.offX + (x - geo.minX) * geo.scale
  const toY = (y: number) => geo.offY + (y - geo.minY) * geo.scale
  const jump = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onJump((e.clientX - rect.left - geo.offX) / geo.scale + geo.minX, (e.clientY - rect.top - geo.offY) / geo.scale + geo.minY)
  }

  return (
    <svg
      role="img" aria-label="Mappa della lavagna" width={WIDTH} height={HEIGHT}
      className="theme-keep touch-none cursor-pointer rounded-lg border border-slate-200 bg-white/90 shadow-md backdrop-blur"
      onPointerDown={(e) => { e.stopPropagation(); dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); jump(e) }}
      onPointerMove={(e) => { if (dragging.current) jump(e) }}
      onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); e.stopPropagation() }}
      onPointerCancel={() => { dragging.current = false }}
    >
      {items.map((i) => (
        <rect key={i.id} x={toX(i.x)} y={toY(i.y)} width={Math.max(i.w * geo.scale, 2)} height={Math.max(i.h * geo.scale, 2)} rx={1.5}
          fill={FILL[i.kind]} fillOpacity={i.kind === 'ai' ? 0.9 : 0.55} stroke={i.selected ? '#2563eb' : i.kind === 'frame' ? '#94a3b8' : 'none'} strokeWidth={i.selected ? 1.5 : 1} />
      ))}
      <rect x={toX(view.x)} y={toY(view.y)} width={view.w * geo.scale} height={view.h * geo.scale} fill="#3b82f61a" stroke="#2563eb" strokeWidth={1.5} rx={2} />
    </svg>
  )
}
