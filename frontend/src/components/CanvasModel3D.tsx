import { createElement, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, QrCode, Smartphone, X } from '@/components/icons'
import { Dialog, DialogContent, DialogTitle, Button } from '@/design'
import { tl } from '@/i18n/tl'
import '@google/model-viewer'

/** Public AR page for a model stored on a board. The path itself is the capability (unguessable file name). */
export type BoardModel = { src: string; poster?: string; usdz?: string; title?: string }

export function arPageUrl(model: BoardModel): string {
  const params = new URLSearchParams({ m: model.src })
  if (model.title) params.set('t', model.title)
  if (model.poster) params.set('p', model.poster) // shown at once while the model downloads
  if (model.usdz) params.set('u', model.usdz) // iOS opens this directly instead of converting the GLB on the phone
  return `${window.location.origin}/ar?${params.toString()}`
}

/** Only models the board itself stored may be opened by the public AR page. */
export function isBoardModelPath(path: string | null, ext: 'glb' | 'png' | 'usdz' = 'glb'): path is string {
  return !!path && new RegExp(`^/uploads/smart_canvas/[0-9a-f-]{36}/[0-9a-f]{32}\\.${ext}$`).test(path)
}

const viewerStyle = { width: '100%', height: '100%', background: 'transparent', ['--poster-color' as string]: 'transparent' }

/** Interactive viewer. In the board it only takes the pointer once the item is entered (double click), so it can still be moved. */
export function ModelViewer({ src, poster, iosSrc, interactive, autoRotate = true, ar = false }: { src: string; poster?: string; iosSrc?: string; interactive: boolean; autoRotate?: boolean; ar?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el || !interactive) return
    // the board zooms on wheel: while exploring the model the wheel belongs to the model
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [interactive])
  return (
    <div ref={wrap} className="h-full w-full" style={{ pointerEvents: interactive ? 'auto' : 'none', touchAction: interactive ? 'none' : undefined }}>
      {createElement('model-viewer', {
        src,
        poster,
        'ios-src': iosSrc,
        loading: 'eager',
        'camera-controls': interactive ? '' : undefined,
        'auto-rotate': autoRotate ? '' : undefined,
        'interaction-prompt': interactive ? 'auto' : 'none',
        'environment-image': 'neutral',
        'shadow-intensity': '1.2',
        'shadow-softness': '0.7',
        exposure: '1.05',
        ar: ar ? '' : undefined,
        'ar-modes': ar ? 'webxr scene-viewer quick-look' : undefined,
        style: viewerStyle,
      }, ar ? createElement('button', { slot: 'ar-button', type: 'button', className: 'absolute bottom-14 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg' }, tl("Vedi nello spazio")) : null)}
    </div>
  )
}

/** QR code popover generated on the board: scanning it opens the model in AR on a phone. */
export function ModelQrPopover({ model, onClose }: { model: BoardModel; onClose: () => void }) {
  const url = arPageUrl(model)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } })
      .then((dataUrl) => { if (alive) setQr(dataUrl) })
      .catch(() => { if (alive) setQr('') })
    return () => { alive = false }
  }, [url])
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800) } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="ds-popover w-56 rounded-2xl p-3 text-left" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"><Smartphone className="h-3.5 w-3.5" />{tl("Guardalo in AR")}</p>
        <button type="button" onClick={onClose} aria-label={tl("Chiudi")} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--ds-control-hover)]"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-white p-1">
        {qr ? <img src={qr} alt={tl("Codice QR per aprire il modello in realtà aumentata")} className="h-full w-full" draggable={false} /> : <QrCode className="h-8 w-8 text-slate-300" />}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[var(--text-secondary)]">{tl("Inquadra il codice con il telefono, poi tocca «Vedi nello spazio» e punta la fotocamera su un tavolo.")}</p>
      <Button type="button" surface="soft" density="compact" className="mt-2 w-full" onClick={() => void copy()}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? tl("Copiato") : tl("Copia link")}
      </Button>
    </div>
  )
}

/** Large explorer (orbit, zoom, auto-rotate switch) with the QR code beside it. */
export function ModelExplorerDialog({ model, onClose }: { model: BoardModel; onClose: () => void }) {
  const { src, poster, title } = model
  const [rotate, setRotate] = useState(true)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="xl" className="!h-[min(78vh,720px)] grid-rows-[auto_1fr]">
        <DialogTitle className="truncate text-base font-semibold text-[var(--text-primary)]">{title || tl("Modello 3D")}</DialogTitle>
        <div className="grid min-h-0 gap-4 md:grid-cols-[1fr_15rem]">
          <div className="relative min-h-[260px] overflow-hidden rounded-2xl bg-[var(--ds-well)]">
            <ModelViewer src={src} poster={poster} interactive autoRotate={rotate} />
            <div className="absolute bottom-3 left-3">
              <Button type="button" surface="soft" density="compact" aria-pressed={rotate} onClick={() => setRotate((v) => !v)}>{rotate ? tl("Ferma la rotazione") : tl("Fai ruotare")}</Button>
            </div>
          </div>
          <ModelQrPopover model={model} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
