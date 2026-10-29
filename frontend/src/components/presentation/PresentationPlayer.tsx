import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, StickyNote, X } from '@/components/icons'
import { SlidePreview } from '@/components/documents/DocumentThumbnail'
import type { StudioSlide } from '@/lib/presentationStudio'
import { tl } from '@/i18n/tl'

type Props = {
  slides: StudioSlide[]
  format: '16:9' | '4:3'
  startIndex?: number
  onClose: () => void
}

/** Full-screen slideshow: ←/→, Space, PageUp/PageDown, Home/End, click to advance, N = speaker notes, Esc = exit. */
export default function PresentationPlayer({ slides, format, startIndex = 0, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), Math.max(0, slides.length - 1)))
  const [showNotes, setShowNotes] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideTimer = useRef<number>()

  // Stable handle: the parent passes an inline callback, which must not restart fullscreen on re-render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const go = useCallback((delta: number) => setIndex(current => Math.min(slides.length - 1, Math.max(0, current + delta))), [slides.length])

  useEffect(() => {
    const root = rootRef.current
    root?.requestFullscreen?.().catch(() => undefined)
    const onFullscreenChange = () => { if (!document.fullscreenElement) onCloseRef.current() }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Captured first and never passed on: the editor underneath must not nudge/delete objects.
      event.stopPropagation()
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); go(1) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key)) { event.preventDefault(); go(-1) }
      else if (event.key === 'Home') setIndex(0)
      else if (event.key === 'End') setIndex(slides.length - 1)
      else if (event.key.toLowerCase() === 'n') setShowNotes(value => !value)
      else if (event.key === 'Escape' && !document.fullscreenElement) onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [go, slides.length])

  const revealChrome = () => {
    setChromeVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setChromeVisible(false), 2200)
  }
  useEffect(() => { revealChrome(); return () => window.clearTimeout(hideTimer.current) }, [])

  const slide = slides[index]
  const content = useMemo(() => ({ format, slides: slide ? [slide] : [] }), [format, slide])
  const notes = slide?.speakerNotes?.trim()

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[80] flex flex-col bg-black ${chromeVisible ? '' : 'cursor-none'}`}
      onMouseMove={revealChrome}
      role="dialog"
      aria-modal="true"
      aria-label={tl("Presentazione a schermo intero")}
    >
      <div className="relative min-h-0 flex-1" onClick={() => go(1)}>
        {slide && <SlidePreview key={slide.id} content={content} title={slide.title} backdrop="bg-black" />}
      </div>
      {showNotes && (
        <div className="max-h-[30vh] overflow-y-auto border-t border-white/10 bg-neutral-900 px-8 py-4 text-base leading-relaxed text-neutral-100">
          {notes || <span className="text-neutral-500">{tl("Nessuna nota per questa slide.")}</span>}
        </div>
      )}
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-5 transition-opacity duration-300 ${chromeVisible ? 'opacity-100' : 'opacity-0'}`}
        style={showNotes ? { bottom: 'min(30vh, 100%)' } : undefined}>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-1.5 text-sm text-white shadow-2xl backdrop-blur">
          <button type="button" onClick={() => go(-1)} disabled={index === 0} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30" aria-label={tl("Slide precedente")}><ChevronLeft className="h-5 w-5" /></button>
          <span className="min-w-[4.5rem] text-center tabular-nums">{index + 1} / {slides.length}</span>
          <button type="button" onClick={() => go(1)} disabled={index >= slides.length - 1} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30" aria-label={tl("Slide successiva")}><ChevronRight className="h-5 w-5" /></button>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <button type="button" onClick={() => setShowNotes(value => !value)} className={`rounded-full p-2 hover:bg-white/10 ${showNotes ? 'text-amber-300' : ''}`} aria-label={tl("Note per chi presenta (N)")} title={tl("Note per chi presenta (N)")}><StickyNote className="h-5 w-5" /></button>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label={tl("Esci (Esc)")} title={tl("Esci (Esc)")}><X className="h-5 w-5" /></button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
