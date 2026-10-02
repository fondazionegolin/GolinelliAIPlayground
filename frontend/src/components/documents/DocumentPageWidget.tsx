import { useEffect, useState, type RefObject } from 'react'
import { Minus, Plus } from 'lucide-react'

const MIN_SCALE = 0.5
const MAX_SCALE = 2
const STEP = 0.1

type Props = {
  scrollRef: RefObject<HTMLElement>
  pageRef: RefObject<HTMLElement>
  pageHeight: number
  pageGap: number
  pageCount: number
  scale: number
  onScaleChange: (scale: number) => void
  isEnglish?: boolean
}

/** Floating "Page X of Y" + zoom control for the word-processor view (bottom right of the canvas). */
export default function DocumentPageWidget({ scrollRef, pageRef, pageHeight, pageGap, pageCount, scale, onScaleChange, isEnglish }: Props) {
  const [page, setPage] = useState(1)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const pageEl = pageRef.current
      if (!pageEl) return
      const viewport = scroller.getBoundingClientRect()
      // Distance from the top of the first sheet to the vertical middle of the viewport; the rects
      // already include the zoom transform, so the stride is the scaled sheet height + gap.
      const offset = viewport.top + viewport.height / 2 - pageEl.getBoundingClientRect().top
      const stride = (pageHeight + pageGap) * scale
      setPage(Math.min(pageCount, Math.max(1, Math.floor(offset / stride) + 1)))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollRef, pageRef, pageHeight, pageGap, pageCount, scale])

  const clamp = (value: number) => Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 100) / 100
  const buttonClass = 'flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div
      className="theme-keep pointer-events-auto absolute bottom-4 right-5 z-20 flex items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur"
      onClick={(event) => event.stopPropagation()}
      role="group"
      aria-label={isEnglish ? 'Page and zoom' : 'Pagina e zoom'}
    >
      <span className="px-1.5 text-xs font-semibold tabular-nums text-slate-700" aria-live="polite">
        {isEnglish ? `Page ${page} of ${pageCount}` : `Pagina ${page} di ${pageCount}`}
      </span>
      <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
      <button type="button" className={buttonClass} disabled={scale <= MIN_SCALE} onClick={() => onScaleChange(clamp(scale - STEP))} aria-label={isEnglish ? 'Zoom out' : 'Riduci zoom'}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="w-11 rounded-lg py-1 text-center text-xs font-semibold tabular-nums text-slate-700 transition hover:bg-slate-100"
        onClick={() => onScaleChange(1)}
        title={isEnglish ? 'Reset zoom to 100%' : 'Ripristina zoom al 100%'}
      >
        {Math.round(scale * 100)}%
      </button>
      <button type="button" className={buttonClass} disabled={scale >= MAX_SCALE} onClick={() => onScaleChange(clamp(scale + STEP))} aria-label={isEnglish ? 'Zoom in' : 'Aumenta zoom'}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
