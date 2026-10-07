import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Minus, Plus } from '@/components/icons'

const PX_PER_CM = 96 / 2.54
const MIN_MARGIN = 16
const MAX_MARGIN = 220

type Props = {
  scrollRef: RefObject<HTMLElement>
  pageRef: RefObject<HTMLElement>
  pageWidth: number
  scale: number
  marginHorizontal: number
  marginVertical: number
  onHorizontalChange: (px: number) => void
  onVerticalChange: (px: number) => void
  disabled?: boolean
  isEnglish?: boolean
}

const clamp = (value: number) => Math.round(Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, value)))
const toCm = (px: number) => (px / PX_PER_CM).toFixed(1)

/**
 * Word-style ruler that sits between the toolbar and the sheet, OUTSIDE the document, so the page
 * margins can be dragged without adding any chrome to the page itself. It follows the sheet's
 * zoom and horizontal position; a stepper at its right edge sets the top/bottom margin.
 */
export function DocumentRuler({ scrollRef, pageRef, pageWidth, scale, marginHorizontal, marginVertical, onHorizontalChange, onVerticalChange, disabled, isEnglish }: Props) {
  const [geometry, setGeometry] = useState<{ width: number; pageLeft: number } | null>(null)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  const frame = useRef(0)

  const measure = useCallback(() => {
    frame.current = 0
    const scroller = scrollRef.current
    const page = pageRef.current
    if (!scroller || !page) return
    const scrollerRect = scroller.getBoundingClientRect()
    const pageRect = page.getBoundingClientRect()
    setGeometry({ width: scroller.clientWidth, pageLeft: pageRect.left - scrollerRect.left })
  }, [scrollRef, pageRef])

  useEffect(() => {
    const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(measure) }
    schedule()
    const scroller = scrollRef.current
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (scroller) observer?.observe(scroller)
    scroller?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      observer?.disconnect()
      scroller?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [measure, scrollRef, scale, pageWidth, marginHorizontal])

  useEffect(() => {
    if (!dragging) return
    const move = (event: MouseEvent) => {
      const page = pageRef.current
      if (!page) return
      const rect = page.getBoundingClientRect()
      const factor = rect.width / pageWidth
      if (factor <= 0) return
      onHorizontalChange(clamp(dragging === 'left' ? (event.clientX - rect.left) / factor : (rect.right - event.clientX) / factor))
    }
    const stop = () => setDragging(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    document.body.style.cursor = 'ew-resize'
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      document.body.style.cursor = ''
    }
  }, [dragging, onHorizontalChange, pageRef, pageWidth])

  const pageSpan = pageWidth * scale
  const left = geometry?.pageLeft ?? 0
  const marginLeft = marginHorizontal * scale
  const centimetres = Math.floor(pageWidth / PX_PER_CM)
  const handle = 'absolute bottom-0 z-10 h-4 w-3 -translate-x-1/2 cursor-ew-resize'
  const handleShape = `h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent ${disabled ? 'border-t-slate-300' : 'border-t-violet-600'}`

  return (
    <div className="theme-keep flex h-8 shrink-0 select-none items-stretch border-b border-slate-200 bg-white" aria-label={isEnglish ? 'Page ruler' : 'Righello'}>
      <div className="relative min-w-0 flex-1 overflow-hidden bg-slate-50">
        {geometry && (
          <div className="absolute inset-y-0" style={{ left, width: pageSpan }}>
            {/* page strip: darker where the margins are */}
            <div className="absolute inset-y-1.5 left-0 right-0 border border-slate-300 bg-white" />
            <div className="absolute inset-y-1.5 left-0 bg-slate-200" style={{ width: marginLeft }} />
            <div className="absolute inset-y-1.5 right-0 bg-slate-200" style={{ width: marginLeft }} />
            {Array.from({ length: centimetres + 1 }, (_, cm) => (
              <div key={cm} className="absolute top-1.5 flex flex-col items-center" style={{ left: cm * PX_PER_CM * scale }}>
                <span className="h-1.5 w-px bg-slate-400" />
                {cm > 0 && <span className="-mt-px translate-x-0 text-[9px] leading-none text-slate-500">{cm}</span>}
              </div>
            ))}
            {Array.from({ length: centimetres * 2 + 1 }, (_, half) => half % 2 === 1 && (
              <span key={`h${half}`} className="absolute top-1.5 h-1 w-px bg-slate-300" style={{ left: (half / 2) * PX_PER_CM * scale }} />
            ))}
            <button type="button" disabled={disabled} className={`${handle} ${disabled ? 'cursor-not-allowed' : ''}`} style={{ left: marginLeft }}
              onMouseDown={(event) => { event.preventDefault(); if (!disabled) setDragging('left') }}
              aria-label={isEnglish ? 'Left margin' : 'Margine sinistro'} title={`${isEnglish ? 'Left margin' : 'Margine sinistro'}: ${toCm(marginHorizontal)} cm`}>
              <span className={handleShape} />
            </button>
            <button type="button" disabled={disabled} className={`${handle} ${disabled ? 'cursor-not-allowed' : ''}`} style={{ left: pageSpan - marginLeft }}
              onMouseDown={(event) => { event.preventDefault(); if (!disabled) setDragging('right') }}
              aria-label={isEnglish ? 'Right margin' : 'Margine destro'} title={`${isEnglish ? 'Right margin' : 'Margine destro'}: ${toCm(marginHorizontal)} cm`}>
              <span className={handleShape} />
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-l border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600" title={isEnglish ? 'Top and bottom margin' : 'Margine superiore e inferiore'}>
        <span>{isEnglish ? 'Top/bottom' : 'Sup./inf.'}</span>
        <button type="button" disabled={disabled || marginVertical <= MIN_MARGIN} onClick={() => onVerticalChange(clamp(marginVertical - 8))} className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label={isEnglish ? 'Decrease vertical margin' : 'Riduci margine verticale'}><Minus className="h-3 w-3" /></button>
        <span className="w-12 text-center tabular-nums">{toCm(marginVertical)} cm</span>
        <button type="button" disabled={disabled || marginVertical >= MAX_MARGIN} onClick={() => onVerticalChange(clamp(marginVertical + 8))} className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-100 disabled:opacity-30" aria-label={isEnglish ? 'Increase vertical margin' : 'Aumenta margine verticale'}><Plus className="h-3 w-3" /></button>
      </div>
    </div>
  )
}
