import { useSearchParams } from 'react-router-dom'
import { Box, Smartphone } from '@/components/icons'
import { isBoardModelPath, ModelViewer } from '@/components/CanvasModel3D'
import { tl } from '@/i18n/tl'
import '@google/model-viewer'

/** Opened from the QR code on a smart-canvas board: the model, orbitable, with the device's AR viewer. */
export default function PublicArPage() {
  const [params] = useSearchParams()
  const src = params.get('m')
  const title = (params.get('t') || '').slice(0, 120) || tl("Modello 3D")
  const poster = params.get('p'), usdz = params.get('u')
  const valid = isBoardModelPath(src)
  return (
    <div className="flex h-[100dvh] flex-col bg-slate-100">
      <header className="flex items-center gap-2 bg-white px-4 py-2.5 shadow-sm">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white"><Box className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-400">{tl("Golinelli.ai · Canvas intelligente")}</p>
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {valid ? (
          <>
            <ModelViewer src={src} poster={isBoardModelPath(poster, 'png') ? poster : undefined} iosSrc={isBoardModelPath(usdz, 'usdz') ? usdz : undefined} interactive ar />
            <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-slate-500">{tl("Trascina per ruotare, pizzica per ingrandire")}</p>
            <p className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-1.5 px-6 text-center text-xs text-slate-500"><Smartphone className="h-3.5 w-3.5 shrink-0" />{tl("Tocca «Vedi nello spazio» per metterlo sul tavolo con la fotocamera")}</p>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-lg font-semibold text-slate-900">{tl("Link non valido")}</p>
            <p className="max-w-sm text-sm text-slate-500">{tl("Il modello non esiste più oppure il collegamento è incompleto.")}</p>
          </div>
        )}
      </main>
    </div>
  )
}
