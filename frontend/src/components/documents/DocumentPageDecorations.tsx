import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { RULE_GAP, bandHasContent, bandMetrics, textLineHeight, type BandItem, type HeaderFooterBand, type HeaderFooterConfig } from '@/lib/documentHeaderFooter'

export type BandKind = 'header' | 'footer'

type BandViewProps = {
  band: HeaderFooterBand
  kind: BandKind
  page: number
  pageCount: number
  marginVertical: number
  isEnglish?: boolean
  style?: CSSProperties
  className?: string
  /** Drag an item along the band (x = 0–100 % of the free width). */
  onItemMove?: (itemId: string, x: number) => void
  onItemSelect?: (itemId: string) => void
  selectedId?: string | null
  onDoubleClick?: () => void
  title?: string
}

/** One header/footer band exactly as it is drawn on the sheet (also used for the live preview in the dialog). */
export function BandView({ band, kind, page, pageCount, marginVertical, isEnglish, style, className, onItemMove, onItemSelect, selectedId, onDoubleClick, title }: BandViewProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const pageLabel = isEnglish ? `Page ${page} of ${pageCount}` : `Pagina ${page} di ${pageCount}`
  const metrics = bandMetrics(band, marginVertical)

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: BandItem) => {
    onItemSelect?.(item.id)
    if (!onItemMove || !rowRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const box = event.currentTarget.getBoundingClientRect()
    const grab = event.clientX - box.left
    const move = (next: PointerEvent) => {
      const row = rowRef.current?.getBoundingClientRect()
      if (!row) return
      // Rects include the zoom/preview transform, so the ratio is scale-independent.
      const room = row.width - box.width
      if (room <= 0) return
      onItemMove(item.id, Math.round(Math.min(100, Math.max(0, ((next.clientX - grab - row.left) / room) * 100)) * 10) / 10)
    }
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const textStyle = (item: BandItem): CSSProperties => ({
    fontFamily: `'${item.fontFamily || 'Arial'}', Arial, sans-serif`,
    fontSize: `${item.sizePt ?? 9}pt`,
    color: item.color || '#64748b',
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? 'italic' : 'normal',
    lineHeight: textLineHeight,
    whiteSpace: 'nowrap',
  })

  return (
    <div
      className={className}
      style={{
        ...style,
        height: metrics.outerHeight,
        boxSizing: 'border-box',
        ...(kind === 'header'
          ? { paddingBottom: RULE_GAP, borderBottom: band.showRule ? '1px solid #cbd5e1' : undefined }
          : { paddingTop: RULE_GAP, borderTop: band.showRule ? '1px solid #cbd5e1' : undefined }),
      }}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      <div
        ref={rowRef}
        className="relative w-full"
        style={{ height: metrics.contentHeight }}
      >
        {band.items.map((item) => {
          if (item.type === 'text' && !item.text?.trim()) return null
          const selected = selectedId === item.id
          const draggable = Boolean(onItemMove)
          return (
            <div
              key={item.id}
              className={`absolute ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${selected ? 'rounded outline outline-1 outline-offset-2 outline-violet-500' : ''}`}
              // max-content: an absolutely positioned box would otherwise shrink to the room left of `left: x%`
              // (a logo dragged to the right edge got squeezed to nothing). Bottom-aligned like inline content in Word.
              style={{ left: `${item.x}%`, bottom: item.type === 'logo' ? metrics.descent : 0, width: 'max-content', transform: `translateX(-${item.x}%)` }}
              onPointerDown={(event) => startDrag(event, item)}
              title={draggable ? (isEnglish ? 'Drag to move' : 'Trascina per spostare') : undefined}
            >
              {item.type === 'logo' && item.url && (
                <img src={item.url} alt="" draggable={false} style={{ display: 'block', flexShrink: 0, maxWidth: 'none', height: Math.min(item.height ?? 36, metrics.logoMax), width: 'auto' }} />
              )}
              {item.type === 'text' && <span style={textStyle(item)}>{item.text}</span>}
              {item.type === 'page' && <span className="tabular-nums" style={textStyle(item)}>{pageLabel}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Props = {
  config: HeaderFooterConfig
  pageCount: number
  pageHeight: number
  pageGap: number
  marginVertical: number
  marginHorizontal: number
  isEnglish?: boolean
  /** Double-click on a band opens the editor. */
  onEdit?: (band: BandKind) => void
  /** Drag an item anywhere along its band. */
  onItemMove?: (band: BandKind, itemId: string, x: number) => void
}

/** Repeats the document header/footer on every sheet, inside the top/bottom margin of each page. */
export function DocumentPageDecorations({ config, pageCount, pageHeight, pageGap, marginVertical, marginHorizontal, isEnglish, onEdit, onItemMove }: Props) {
  const showHeader = bandHasContent(config.header)
  const showFooter = bandHasContent(config.footer)
  if (!showHeader && !showFooter) return null
  const footerOuter = bandMetrics(config.footer, marginVertical).outerHeight
  const view = (kind: BandKind, band: HeaderFooterBand, top: number, page: number) => (
    <BandView
      band={band}
      kind={kind}
      page={page}
      pageCount={pageCount}
      marginVertical={marginVertical}
      isEnglish={isEnglish}
      className={`absolute z-[5] ${onEdit ? '' : 'pointer-events-none'}`}
      style={{ top, left: marginHorizontal, right: marginHorizontal }}
      onItemMove={onItemMove ? (itemId, x) => onItemMove(kind, itemId, x) : undefined}
      onDoubleClick={onEdit ? () => onEdit(kind) : undefined}
      title={onEdit ? (isEnglish ? 'Double-click to edit' : 'Doppio clic per modificare') : undefined}
    />
  )
  return (
    <>
      {Array.from({ length: pageCount }, (_, index) => {
        const pageTop = index * (pageHeight + pageGap)
        return (
          <div key={index} className="contents">
            {showHeader && view('header', config.header, pageTop + config.header.edgeOffset, index + 1)}
            {showFooter && view('footer', config.footer, pageTop + pageHeight - footerOuter - config.footer.edgeOffset, index + 1)}
          </div>
        )
      })}
    </>
  )
}
