import { useEffect, useRef } from 'react'
import { Download, Home, Maximize } from '@/components/icons'
import SolidModelerViewport, { type ViewportApi } from './SolidModelerViewport'
import { exportSTL } from './geometry'
import type { SceneObject } from './types'

interface Props {
  name: string
  author?: string
  objects: SceneObject[]
}

/** Read-only 3D viewer for shared models (students, public QR link). */
export default function SolidModelViewer({ name, author, objects }: Props) {
  const api = useRef<ViewportApi | null>(null)
  const solids = objects.filter(o => !o.hole)

  useEffect(() => {
    const t = setTimeout(() => api.current?.setView('fit'), 60)
    return () => clearTimeout(t)
  }, [objects])

  const downloadStl = () => {
    const blob = exportSTL(objects)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modello'}.stl`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden">
      <SolidModelerViewport objects={objects} readOnly apiRef={api} />
      <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-xl bg-white/90 px-3 py-2 shadow-sm">
        <p className="truncate text-sm font-black text-slate-900">{name}</p>
        {author && <p className="truncate text-[11px] text-slate-500">di {author}</p>}
      </div>
      <div className="absolute right-3 top-3 flex gap-1 rounded-xl border border-slate-200 bg-white/90 p-1 shadow-sm">
        <button type="button" title="Vista iniziale" onClick={() => api.current?.setView('home')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><Home className="h-4 w-4" /></button>
        <button type="button" title="Inquadra" onClick={() => api.current?.setView('fit')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><Maximize className="h-4 w-4" /></button>
        <button type="button" disabled={!solids.length} onClick={downloadStl} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"><Download className="h-4 w-4" /> STL</button>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-140px)] rounded-lg bg-white/85 px-2.5 py-1.5 text-[10.5px] text-slate-500 shadow-sm">
        Trascina per ruotare · Rotella/pizzico per zoom · Tasto destro/due dita per spostare · Cubo: viste
      </p>
    </div>
  )
}
