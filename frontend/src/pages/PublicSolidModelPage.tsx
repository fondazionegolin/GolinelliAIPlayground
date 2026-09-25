import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Loader2 } from 'lucide-react'
import { solidModelerApi } from '@/lib/api'
import type { SceneObject } from '@/components/solidModeler/types'

const SolidModelViewer = lazy(() => import('@/components/solidModeler/SolidModelViewer'))

export default function PublicSolidModelPage() {
  const { token = '' } = useParams()
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
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Golinelli.ai · 3D Lab</p>
          <p className="truncate text-sm font-black text-slate-900">{model.data?.name ?? 'Modello 3D'}</p>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {model.isLoading && <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {model.isError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-lg font-black text-slate-900">Link non valido</p>
            <p className="max-w-sm text-sm text-slate-500">Il modello non esiste più oppure il docente ha disattivato la condivisione.</p>
          </div>
        )}
        {model.data && (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
            <SolidModelViewer name={model.data.name} author={model.data.author} objects={model.data.scene as SceneObject[]} />
          </Suspense>
        )}
      </main>
    </div>
  )
}
