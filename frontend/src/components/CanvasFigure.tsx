import { useEffect, useMemo, useRef, useState } from 'react'
import { figureSvg, isEngine, type FigureSpec, type JsxGraphSpec, type VegaSpec } from './canvasFigures'
import { buildJsxElements, jsxBoardOptions, sanitizeVega, saveSnapshot, snapshotKey, vegaSpecFor, VEGA_LOCALE } from './canvasFigureEngines'
import { tl } from '@/i18n/tl'

type FigItem = { id: string; w: number; h: number; spec: FigureSpec }

function VegaFigure({ item, spec }: { item: FigItem; spec: VegaSpec }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const clean = useMemo(() => sanitizeVega(spec.def), [spec.def])
  const key = snapshotKey(item.id, [spec, Math.round(item.w), Math.round(item.h)])
  useEffect(() => {
    const el = host.current
    if (!el) return
    if (!clean) { setError(tl("Specifica del grafico non valida")); return }
    let alive = true
    let finalize: (() => void) | undefined
    const timer = window.setTimeout(async () => {
      try {
        const embed = (await import('vega-embed')).default
        const result = await embed(el, vegaSpecFor(clean, item.w, item.h, spec.title) as never, { actions: false, renderer: 'svg', formatLocale: VEGA_LOCALE as never })
        finalize = result.finalize
        if (!alive) { result.finalize(); return }
        setError('')
        try { saveSnapshot(key, await result.view.toImageURL('png', 1)) } catch { /* the board still shows it */ }
      } catch (err) { if (alive) setError(err instanceof Error ? err.message.slice(0, 160) : tl("Grafico non valido")) }
    }, 120)  // resizing redraws often: wait for the size to settle
    return () => { alive = false; window.clearTimeout(timer); finalize?.() }
  }, [clean, item.w, item.h, spec.title, key])
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-white shadow-sm" style={{ pointerEvents: 'none' }}>
      <div ref={host} className="h-full w-full [&_svg]:max-h-full" />
      {error && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )
}

function JsxGraphFigure({ item, spec, interactive }: { item: FigItem; spec: JsxGraphSpec; interactive: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const key = snapshotKey(item.id, [spec, Math.round(item.w), Math.round(item.h)])
  useEffect(() => {
    const el = host.current
    if (!el) return
    let alive = true
    let board: { create: never; update?: () => void } | null = null
    let JXGlib: { JSXGraph: { freeBoard: (b: unknown) => void } } | null = null
    const timer = window.setTimeout(async () => {
      try {
        const JXG = ((await import('jsxgraph')) as unknown as { default: never }).default as unknown as { JSXGraph: { initBoard: (el: HTMLElement, o: unknown) => never; freeBoard: (b: unknown) => void } }
        await import('./jsxgraph.css')
        if (!alive) return
        JXGlib = JXG
        el.innerHTML = ''
        const holder = document.createElement('div')
        holder.style.width = '100%'; holder.style.height = '100%'
        el.appendChild(holder)
        board = JXG.JSXGraph.initBoard(holder, jsxBoardOptions(spec.def))
        const failed = buildJsxElements(board as never, spec.def.elements)
        setError(failed.length ? tl("Alcuni elementi non sono stati disegnati: {0}", failed.slice(0, 3).join(', ')) : '')
        window.setTimeout(() => { try { const svg = holder.querySelector('svg'); if (svg && alive) { const copy = svg.cloneNode(true) as SVGElement; copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); saveSnapshot(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`) } } catch { /* optional */ } }, 400)
      } catch (err) { if (alive) setError(err instanceof Error ? err.message.slice(0, 160) : tl("Costruzione non valida")) }
    }, 120)
    return () => { alive = false; window.clearTimeout(timer); try { if (board && JXGlib) JXGlib.JSXGraph.freeBoard(board) } catch { /* already gone */ } }
  }, [spec, item.w, item.h, key])
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el || !interactive) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [interactive])
  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden rounded-2xl bg-white shadow-sm" style={{ pointerEvents: interactive ? 'auto' : 'none', touchAction: interactive ? 'none' : undefined }}>
      <div ref={host} className="h-full w-full" />
      {spec.title && <p className="pointer-events-none absolute left-4 top-3 text-[15px] font-semibold text-slate-900">{spec.title}</p>}
      {!interactive && <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] font-medium text-slate-500">{tl("Doppio clic per muovere i punti")}</p>}
      {error && <p className="absolute inset-x-0 bottom-6 px-4 text-center text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )
}

/** A figure on the board: built-in ones are plain SVG redrawn at the item's size (always crisp), engines draw themselves. */
export function CanvasFigure({ item, interactive }: { item: FigItem; interactive: boolean }) {
  const { spec } = item
  const svg = useMemo(() => (isEngine(spec) ? '' : figureSvg(spec, item.w, item.h)), [spec, item.w, item.h])
  if (spec.fig === 'vega') return <VegaFigure item={item} spec={spec} />
  if (spec.fig === 'jsxgraph') return <JsxGraphFigure item={item} spec={spec} interactive={interactive} />
  return <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" role="img" aria-label={spec.title || spec.fig} dangerouslySetInnerHTML={{ __html: svg }} />
}
