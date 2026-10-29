import { lazy, Suspense } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Loader2 } from '@/components/icons'
import { solidModelerApi } from '@/lib/api'
import type { SceneObject } from '@/components/solidModeler/types'
import { tl } from '@/i18n/tl'

const SolidModelViewer = lazy(() => import('@/components/solidModeler/SolidModelViewer'))
const SolidModelAR = lazy(() => import('@/components/solidModeler/SolidModelAR'))

export default function PublicSolidModelPage() {
  const { token = '' } = useParams()
  // ?ar=1 (QR code from the share dialog): open straight into the augmented-reality view.
  const [params, setParams] = useSearchParams()
  const ar = params.get('ar') === '1'
  const setAr = (on: boolean) => setParams(p => { const next = new URLSearchParams(p); if (on) next.set('ar', '1'); else next.delete('ar'); return next }, { replace: true })
  const model = useQuery({
    queryKey: ['public-solid-model', token],
    queryFn: async () => (await solidModelerApi.getPublic(token)).data,
    retry: false,
  })

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-100">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white"><Box className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{tl("Golinelli.ai · 3D Lab")}</p>
          <p className="truncate text-sm font-black text-slate-900">{model.data?.name ?? tl("Modello 3D")}</p>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {model.isLoading && <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {model.isError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-lg font-black text-slate-900">{tl("Link non valido")}</p>
            <p className="max-w-sm text-sm text-slate-500">{tl("Il modello non esiste più oppure il docente ha disattivato la condivisione.")}</p>
          </div>
        )}
        {model.data && (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
            {ar
              ? <SolidModelAR name={model.data.name} objects={model.data.scene as SceneObject[]} glbUrl={model.data.ar_glb_url} shareUrl={`${window.location.origin}/3d/${token}?ar=1`} onBack={() => setAr(false)} />
              : <SolidModelViewer name={model.data.name} author={model.data.author} objects={model.data.scene as SceneObject[]} onAr={() => setAr(true)} />}
          </Suspense>
        )}
      </main>
    </div>
  )
}
