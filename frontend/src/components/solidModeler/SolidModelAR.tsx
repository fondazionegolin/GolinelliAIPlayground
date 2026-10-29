import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import '@google/model-viewer'
import { ArrowLeft, Box, Check, Loader2, Move, RefreshCw, Smartphone, X } from '@/components/icons'
import { ArPlacementSession, isWebXrArSupported, type ArStage } from './arPlacement'
import { exportGLB, worldBox } from './geometry'
import type { SceneObject } from './types'
import { tl } from '@/i18n/tl'

interface Props {
  name: string
  objects: SceneObject[]
  /** Server GLB snapshot (absolute or same-origin): enables Android Scene Viewer as well. */
  glbUrl?: string | null
  /** Public AR page opened by the QR code shown on computers; without it no QR is offered. */
  shareUrl?: string | null
  onBack: () => void
}

const STAGE_TEXT: Record<ArStage, { title: string; hint: string }> = {
  starting: { title: tl("Avvio la fotocamera…"), hint: tl("Consenti l’accesso alla fotocamera se richiesto.") },
  scanning: { title: tl("Cerco una superficie"), hint: tl("Inquadra il pavimento o il tavolo e muovi piano il telefono a destra e sinistra.") },
  vertical: { title: tl("Questa è una parete"), hint: tl("Punta il mirino verso il pavimento o un tavolo: l’oggetto va appoggiato in piano.") },
  aiming: { title: tl("Superficie trovata"), hint: tl("Porta il mirino dove vuoi l’oggetto e tocca «Posiziona qui» (o lo schermo).") },
  placed: { title: tl("Oggetto posizionato"), hint: tl("Trascina con un dito per ruotarlo, pizzica con due dita per ingrandirlo o rimpicciolirlo.") },
}

type ArStatus = 'loading' | 'ready' | 'unsupported' | 'session' | 'failed'

interface ModelViewerElement extends HTMLElement {
  canActivateAR?: boolean
  activateAR?: () => Promise<void>
}

function sizeLabel(objects: SceneObject[]): string {
  const solids = objects.filter(o => !o.hole)
  if (!solids.length) return ''
  const box = solids.reduce((acc, o) => acc.union(worldBox(o)), worldBox(solids[0]))
  const s = box.getSize(box.min.clone())
  const cm = (mm: number) => (mm / 10).toLocaleString('it-IT', { maximumFractionDigits: mm < 100 ? 1 : 0 })
  return `${cm(s.x)} × ${cm(s.y)} × ${cm(s.z)} cm`
}

/** Augmented-reality view of a shared model: WebXR / Scene Viewer on Android, Quick Look on iOS. */
export default function SolidModelAR({ name, objects, glbUrl, shareUrl, onBack }: Props) {
  const viewer = useRef<ModelViewerElement | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [buildError, setBuildError] = useState(false)
  const [status, setStatus] = useState<ArStatus>('loading')
  const [qr, setQr] = useState('')
  const size = useMemo(() => sizeLabel(objects), [objects])
  const overlay = useRef<HTMLDivElement | null>(null)
  const session = useRef<ArPlacementSession | null>(null)
  const [webxr, setWebxr] = useState(false)
  const [xrStage, setXrStage] = useState<ArStage | null>(null)
  const [xrScale, setXrScale] = useState(1)
  const [xrPlanes, setXrPlanes] = useState(0)

  useEffect(() => { void isWebXrArSupported().then(setWebxr) }, [])
  // WebXR support may resolve after the model loaded.
  useEffect(() => { if (webxr) setStatus(s => (s === 'unsupported' ? 'ready' : s)) }, [webxr])
  useEffect(() => () => session.current?.end(), [])

  // Without a server snapshot the model is built here (WebXR and Quick Look accept blob URLs).
  useEffect(() => {
    if (glbUrl) return
    let url: string | null = null
    let alive = true
    exportGLB(objects)
      .then(blob => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setBlobUrl(url)
      })
      .catch(err => { console.warn('GLB export failed', err); if (alive) setBuildError(true) })
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [objects, glbUrl])

  const src = glbUrl ? new URL(glbUrl, window.location.origin).href : blobUrl

  useEffect(() => {
    const el = viewer.current
    if (!el || !src) return
    // model-viewer picks its AR mode asynchronously (WebXR / Scene Viewer / Quick Look probes), so
    // canActivateAR can still be false when `load` fires: wait for it before declaring AR unsupported.
    let timer = 0
    let alive = true
    const settle = (tries: number) => {
      if (!alive) return
      if (el.canActivateAR || webxr) setStatus(s => (s === 'session' || s === 'failed' ? s : 'ready'))
      else if (tries > 0) timer = window.setTimeout(() => settle(tries - 1), 200)
      else setStatus('unsupported')
    }
    const onLoad = () => settle(15)
    if ((el as ModelViewerElement & { loaded?: boolean }).loaded) onLoad()
    const onAr = (e: Event) => {
      const s = (e as CustomEvent<{ status: string }>).detail?.status
      if (s === 'session-started') setStatus('session')
      else if (s === 'failed') setStatus('failed')
      else if (s === 'not-presenting') setStatus(el.canActivateAR ? 'ready' : 'unsupported')
    }
    el.addEventListener('load', onLoad)
    el.addEventListener('ar-status', onAr)
    return () => { alive = false; window.clearTimeout(timer); el.removeEventListener('load', onLoad); el.removeEventListener('ar-status', onAr) }
  }, [src, webxr])

  // On a computer: QR code to open this same AR view on a phone.
  useEffect(() => {
    if (status !== 'unsupported' || !shareUrl) return
    QRCode.toDataURL(shareUrl, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [status, shareUrl])

  // Android Chrome: our own session with visible surfaces and precise placement; elsewhere the
  // system viewer (Quick Look on iOS, Scene Viewer) through model-viewer.
  const startAr = () => {
    if (!webxr || !src || !overlay.current) { void viewer.current?.activateAR?.(); return }
    setXrStage('starting'); setXrScale(1); setXrPlanes(0)
    const s = new ArPlacementSession(overlay.current, {
      onStage: setXrStage,
      onScale: setXrScale,
      onPlanes: setXrPlanes,
      onEnd: () => { session.current = null; setXrStage(null) },
    })
    session.current = s
    s.start(src).catch(err => {
      console.warn('WebXR AR failed, falling back to the system viewer', err)
      session.current = null
      setXrStage(null)
      if (viewer.current?.canActivateAR) void viewer.current.activateAR?.()
      else setStatus('failed')
    })
  }
  const stageText = xrStage ? STAGE_TEXT[xrStage] : null
  const scaleText = xrScale.toLocaleString('it-IT', { maximumFractionDigits: 1 })

  return (
    <div className="relative flex h-full min-h-[320px] w-full flex-col overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200">
      {src && createElement('model-viewer', {
        ref: viewer,
        src,
        alt: name,
        ar: true,
        'ar-modes': glbUrl ? 'webxr scene-viewer quick-look' : 'webxr quick-look',
        'ar-scale': 'auto',
        'ar-placement': 'floor',
        'camera-controls': true,
        'touch-action': 'pan-y',
        'shadow-intensity': '1',
        exposure: '1',
        'environment-image': 'neutral',
        style: { width: '100%', height: '100%', background: 'transparent' },
      },
      // Hide model-viewer's default AR button: ours below carries the instructions.
      createElement('span', { slot: 'ar-button', style: { display: 'none' } }))}

      {!src && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
          {buildError ? tl("Impossibile preparare il modello per la realtà aumentata.") : <><Loader2 className="h-5 w-5 animate-spin" /> {tl("Preparo il modello…")}</>}
        </div>
      )}

      <button type="button" onClick={onBack} className="absolute left-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-white">
        <ArrowLeft className="h-4 w-4" /> {tl("Vista 3D")}
      </button>
      {size && (
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-xl bg-white/90 px-3 py-2 text-[11px] font-bold text-slate-600 shadow-sm">
          <Box className="h-3.5 w-3.5" /> {size}
        </span>
      )}

      <div className="absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg">
        {(status === 'ready' || status === 'failed' || status === 'session') && (
          <>
            <button type="button" onClick={startAr} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-violet-700 active:bg-violet-800">
              <Smartphone className="h-5 w-5" /> {tl("Vedi nello spazio")}
            </button>
            <p className="mt-2 text-center text-[11px] leading-4 text-slate-500">
              {status === 'failed'
                ? tl("La realtà aumentata non è partita: concedi l’accesso alla fotocamera e riprova in un ambiente illuminato.")
                : tl("Muovi piano il telefono per trovare il pavimento o il tavolo, tocca per appoggiare l’oggetto. Trascina per spostarlo, due dita per ruotarlo e ridimensionarlo.")}
            </p>
          </>
        )}
        {status === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {tl("Carico il modello…")}</p>
        )}
        {status === 'unsupported' && (
          <div className="flex items-center gap-3">
            {qr && <img src={qr} alt={tl("QR code per aprire la realtà aumentata sul telefono")} className="h-24 w-24 shrink-0 rounded-lg border border-slate-200" />}
            <p className="min-w-0 text-[11px] leading-4 text-slate-600">
              <span className="block text-xs font-black text-slate-900">{tl("Realtà aumentata non disponibile qui")}</span>
              {shareUrl
                ? tl("Inquadra il QR code con uno smartphone (Android con ARCore o iPhone/iPad) per posizionare il modello nello spazio. Intanto puoi ruotarlo con il dito o il mouse.")
                : tl("Questo dispositivo non supporta la realtà aumentata. Apri il modello da uno smartphone (Android con ARCore o iPhone/iPad).")}
            </p>
          </div>
        )}
      </div>

      {/* WebXR DOM overlay: shown full screen over the camera while the session runs. */}
      <div ref={overlay} className={xrStage ? 'fixed inset-0 z-50 flex flex-col justify-between p-3 text-white' : 'pointer-events-none invisible fixed inset-0 -z-10'} style={{ touchAction: 'none' }}>
        {stageText && (
          <div data-ar-ui className="flex items-start gap-2">
            <div className="min-w-0 flex-1 rounded-2xl bg-slate-950/70 px-3.5 py-2.5 shadow-lg backdrop-blur">
              <p className="flex items-center gap-2 text-sm font-black">
                {xrStage === 'scanning' || xrStage === 'starting'
                  ? <Smartphone className="animate-pulse h-4 w-4 shrink-0 text-violet-300" />
                  : xrStage === 'vertical'
                    ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                    : <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
                {stageText.title}
                {xrPlanes > 0 && xrStage !== 'placed' && <span className="ml-auto shrink-0 rounded-full bg-violet-500/30 px-2 py-0.5 text-[10px] font-bold text-violet-100">{xrPlanes === 1 ? tl("1 piano") : `${xrPlanes} piani`}</span>}
              </p>
              <p className="mt-0.5 text-[12px] leading-4 text-white/80">{stageText.hint}</p>
            </div>
            <button type="button" aria-label={tl("Esci dalla realtà aumentata")} onClick={() => session.current?.end()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950/70 shadow-lg backdrop-blur">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div data-ar-ui className="mx-auto flex w-full max-w-sm flex-col items-center gap-2">
          {xrScale !== 1 && (
            <span className="rounded-full bg-slate-950/70 px-3 py-1 text-[11px] font-bold backdrop-blur">{tl("Scala ×")}{scaleText}</span>
          )}
          {xrStage === 'aiming' && (
            <button type="button" onClick={() => session.current?.place()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3.5 text-base font-black shadow-xl active:bg-violet-800">
              <Check className="h-5 w-5" /> {tl("Posiziona qui")}
            </button>
          )}
          {xrStage === 'placed' && (
            <div className="flex w-full gap-2">
              <button type="button" onClick={() => session.current?.move()} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white px-3 py-3 text-sm font-black text-slate-900 shadow-xl">
                <Move className="h-4 w-4" /> {tl("Sposta")}
              </button>
              {xrScale !== 1 && (
                <button type="button" onClick={() => session.current?.resetScale()} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-slate-950/70 px-3 py-3 text-sm font-black shadow-xl backdrop-blur">
                  <RefreshCw className="h-4 w-4" /> {tl("Misura reale")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
