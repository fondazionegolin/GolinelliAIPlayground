import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Box, Loader2, Users } from '@/components/icons'
import { Button } from '@/design/primitives/Button'
import { useMobile } from '@/hooks/useMobile'
import { solidModelerApi } from '@/lib/api'
import type { SceneObject } from '@/components/solidModeler/types'

const SolidModelViewer = lazy(() => import('@/components/solidModeler/SolidModelViewer'))
const SolidModeler = lazy(() => import('@/components/solidModeler/SolidModeler'))

const spinner = <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>

/** Student 3D Lab: generative AI, desktop solid modeler, and teacher-shared gallery. */
export default function StudentSolidModelsModule({ canEdit = false }: { canEdit?: boolean; sessionId?: string }) {
  const { isMobile } = useMobile()
  const [view, setView] = useState<'modeler' | 'shared'>('modeler')
  // Generative AI 3D (Meshy) has its own navbar entry; this module is the solid modeler + shared gallery.
  if (!canEdit || isMobile) return <SharedModelsGallery />
  if (view === 'shared') return <SharedModelsGallery onBack={() => setView('modeler')} />

  const tabs = (
    <Button type="button" onClick={() => setView('shared')} tone="neutral" surface="ghost" density="compact" className="rounded-full">
      <Users /> Condivisi dal docente
    </Button>
  )

  return (
    <div className="relative h-full min-h-0">
      <Suspense fallback={spinner}>
        <SolidModeler student leading={tabs} />
      </Suspense>
    </div>
  )
}

/** Read-only gallery of 3D Lab models the teacher shared with the student's class. */
function SharedModelsGallery({ onBack }: { onBack?: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useQuery({
    queryKey: ['student-solid-models'],
    queryFn: async () => (await solidModelerApi.studentList()).data,
  })
  const detail = useQuery({
    queryKey: ['student-solid-model', openId],
    queryFn: async () => (await solidModelerApi.studentGet(openId!)).data,
    enabled: Boolean(openId),
  })

  if (openId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white/80 px-3 py-2">
          <button type="button" onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" /> Tutti i modelli
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {detail.isLoading && <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {detail.isError && <p className="p-6 text-sm text-slate-500">Modello non più disponibile.</p>}
          {detail.data && (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
              <SolidModelViewer name={detail.data.name} author={detail.data.author} objects={detail.data.scene as SceneObject[]} />
            </Suspense>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto max-w-5xl">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" /> Torna al 3D Lab
          </button>
        )}
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">3D Lab</p>
        <h2 className="mt-1 text-2xl font-black text-slate-950">Modelli 3D della classe</h2>
        <p className="mt-1 text-sm text-slate-500">Modelli condivisi dal docente: ruotali, osservali da ogni lato e scarica l'STL per la stampa 3D.</p>
        {list.isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        {list.data?.length === 0 && <p className="mt-10 text-center text-sm text-slate-400">Nessun modello condiviso per ora.</p>}
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {list.data?.map(m => (
            <button key={m.id} type="button" onClick={() => setOpenId(m.id)} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="aspect-[16/10] bg-slate-100">
                {m.thumbnail ? <img src={m.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Box className="h-8 w-8 text-slate-300" /></div>}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-black text-slate-900">{m.name}</p>
                <p className="text-[11px] text-slate-400">{m.object_count} parti · {new Date(m.updated_at).toLocaleDateString('it-IT')}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
