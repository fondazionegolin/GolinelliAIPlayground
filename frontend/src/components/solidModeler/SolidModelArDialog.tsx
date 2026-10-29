import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Check, Copy, Download, Globe, Loader2, Smartphone, X } from '@/components/icons'
import { solidModelerApi, type SolidModelSummary } from '@/lib/api'
import { publishArModel } from './arPublish'
import type { SceneObject } from './types'
import { tl } from '@/i18n/tl'

const SolidModelAR = lazy(() => import('./SolidModelAR'))

/** Phone or tablet held in hand (touch screen, not a desktop with a mouse). */
function isMobileDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  } catch {
    return false
  }
}

interface Props {
  /** Saved project id; null for students (no public link: AR on this device only). */
  modelId: string | null
  name: string
  objects: SceneObject[]
  onClose: () => void
}

/** "Visualizza in AR": QR code for any phone (public link) or AR straight on this device. */
export default function SolidModelArDialog({ modelId, name, objects, onClose }: Props) {
  const queryClient = useQueryClient()
  const [model, setModel] = useState<SolidModelSummary | null>(null)
  const [loading, setLoading] = useState(!!modelId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arState, setArState] = useState<'idle' | 'working' | 'ready'>('idle')
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [local, setLocal] = useState(false)
  const mobile = useMemo(isMobileDevice, [])

  useEffect(() => {
    if (!modelId) return
    solidModelerApi.get(modelId)
      .then(r => setModel(r.data))
      .catch(() => setError(tl("Impossibile caricare il progetto")))
      .finally(() => setLoading(false))
  }, [modelId])

  const isPublic = !!model?.public_enabled
  useEffect(() => {
    if (!isPublic || !modelId) return
    let alive = true
    setArState('working')
    publishArModel(modelId, objects).then(() => { if (alive) setArState('ready') })
    return () => { alive = false }
  }, [isPublic, modelId, objects])

  const arUrl = isPublic && model?.public_token ? `${window.location.origin}/3d/${model.public_token}?ar=1` : ''
  useEffect(() => {
    if (!arUrl) { setQr(''); return }
    QRCode.toDataURL(arUrl, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [arUrl])

  const enablePublic = async () => {
    if (!modelId) return
    setBusy(true)
    setError(null)
    try {
      const res = await solidModelerApi.share(modelId, { public_enabled: true })
      setModel(m => (m ? { ...m, ...res.data } : res.data))
      queryClient.invalidateQueries({ queryKey: ['solid-models'] })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || tl("Attivazione non riuscita"))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(arUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const downloadQr = () => {
    const a = document.createElement('a')
    a.href = qr
    a.download = `qr-ar-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'modello'}.png`
    a.click()
  }

  if (local) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-100">
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
          <SolidModelAR name={name} objects={objects} onBack={() => setLocal(false)} />
        </Suspense>
      </div>
    )
  }

  const hasSolids = objects.some(o => !o.hole)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-600">{tl("Visualizza in realtà aumentata")}</p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-950">{name}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {mobile
                ? tl("Apri il modello in realtà aumentata: lo posizioni sul pavimento o sul tavolo, a grandezza reale.")
                : tl("Inquadra il QR code con un telefono o un tablet, anche senza account: il modello si apre pronto da posizionare sul pavimento o sul tavolo, a grandezza reale.")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {!hasSolids && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{tl("Aggiungi almeno un solido alla scena per vederlo in AR.")}</p>}

        {!mobile && modelId && hasSolids && (
          <section className="mt-4 rounded-xl border border-slate-200 p-4">
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> {tl("Carico…")}</p>
            ) : !isPublic ? (
              <div className="text-center">
                <Globe className="mx-auto h-8 w-8 text-violet-500" />
                <p className="mt-2 text-sm font-black text-slate-900">{tl("Serve il link pubblico")}</p>
                <p className="mx-auto mt-1 max-w-sm text-[11px] leading-4 text-slate-500">
                  {tl("Chi inquadra il QR vede il modello in sola lettura. Puoi disattivarlo quando vuoi da «Condividi».")}
                </p>
                <button type="button" disabled={busy} onClick={enablePublic} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-black text-white hover:bg-violet-700 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} {tl("Crea il QR per l'AR")}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-56 rounded-xl border border-slate-200 bg-white p-2">
                  {qr ? <img src={qr} alt={tl("QR code per la realtà aumentata")} className="aspect-square w-full" /> : <div className="flex aspect-square items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
                </div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  {arState === 'working'
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {tl("Preparo il modello per AR…")}</>
                    : <><Check className="h-3.5 w-3.5 text-emerald-600" /> {tl("Pronto per Android e iPhone/iPad")}</>}
                </p>
                <div className="flex w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700">{arUrl}</span>
                  <button type="button" title={tl("Copia link")} onClick={copy} className="rounded p-1 text-slate-500 hover:bg-white">{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
                </div>
                <button type="button" disabled={!qr} onClick={downloadQr} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> {tl("Scarica QR (da stampare o proiettare)")}</button>
              </div>
            )}
          </section>
        )}

        {!mobile && !modelId && hasSolids && (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{tl("Da computer il QR code richiede un progetto salvato dal docente. Apri Golinelli AI da uno smartphone per vedere il modello in AR.")}</p>
        )}

        {mobile && hasSolids && (
          <button type="button" onClick={() => setLocal(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-black text-white hover:bg-violet-700">
            <Smartphone className="h-4 w-4" /> {tl("Apri in realtà aumentata")}
          </button>
        )}
        {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
      </div>
    </div>
  )
}
