import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, FileText, Loader2, X } from '@/components/icons'
import { DrivePreview } from '@/components/drive/DrivePreview'
import type { DriveItem } from '@/components/drive/driveTypes'
import { driveApi } from '@/lib/api'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_GALLERY = 40
const isDataImage = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image/')

export type NodeArtifacts = {
  images: Array<{ port: string; src: string }>
  /** Drive items the node created/read (documents, presentations, sheets, saved images, files). */
  driveIds: Array<{ port: string; id: string }>
}

/** Scans a node output for things a human wants to *see*: generated images and Drive items/documents. */
export function extractArtifacts(output: Record<string, unknown>): NodeArtifacts {
  const images: NodeArtifacts['images'] = []
  const driveIds: NodeArtifacts['driveIds'] = []
  const seenIds = new Set<string>()
  const addId = (port: string, id: unknown) => {
    if (typeof id === 'string' && UUID.test(id) && !seenIds.has(id)) { seenIds.add(id); driveIds.push({ port, id }) }
  }
  for (const [port, value] of Object.entries(output)) {
    if (isDataImage(value)) images.push({ port, src: value })
    else if (Array.isArray(value) && value.some(isDataImage)) value.filter(isDataImage).slice(0, MAX_GALLERY).forEach((src, index) => images.push({ port: `${port} #${index + 1}`, src }))
    else if (port === 'image_data' && typeof value === 'string' && typeof output.image_mime === 'string' && !isDataImage(output.data_uri)) images.push({ port, src: `data:${output.image_mime};base64,${value}` })
    else if (['drive_item_id', 'item_id'].includes(port)) addId(port, value)
    else if (port === 'item' && value && typeof value === 'object') addId(port, (value as { id?: unknown }).id)
    else if (port === 'document_id') addId(port, output.drive_item_id)
  }
  return { images, driveIds }
}

export function hasArtifacts(artifacts: NodeArtifacts) { return artifacts.images.length > 0 || artifacts.driveIds.length > 0 }

function ImageModal({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col bg-slate-950/90" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-4 text-white">
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="Chiudi anteprima"><X className="h-5 w-5" /></button>
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{title}</p>
        <a href={src} download="immagine-generata.png" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="Scarica"><Download className="h-4 w-4" /></a>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-6" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <img src={src} alt={title} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
      </div>
    </div>,
    document.body,
  )
}

/** Thumbnails + "open" chips for the artifacts of a node output; each opens a full modal preview. */
export function ArtifactPreviews({ artifacts, nodeLabel }: { artifacts: NodeArtifacts; nodeLabel: string }) {
  const [image, setImage] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [item, setItem] = useState<DriveItem | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const openDrive = async (id: string) => {
    setLoadingId(id); setFailed(null)
    try { setItem((await driveApi.get(id)).data as DriveItem) } catch { setFailed('Elemento non più disponibile nel drive') } finally { setLoadingId(null) }
  }

  return <div className="space-y-1.5 p-2">
    {artifacts.images.map(({ port, src }) => (
      <button key={port} type="button" onClick={() => setImage(src)} title="Apri l'immagine" className="group relative block w-full overflow-hidden rounded-lg bg-slate-100">
        <img src={src} alt={`${nodeLabel} · ${port}`} className="max-h-48 w-full object-contain transition-transform group-hover:scale-[1.02]" />
        <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-0.5 text-[8px] font-bold text-white"><ExternalLink className="h-2.5 w-2.5" /> Ingrandisci</span>
      </button>
    ))}
    {artifacts.driveIds.map(({ port, id }) => (
      <button key={id} type="button" onClick={() => void openDrive(id)} disabled={loadingId === id} className="flex w-full items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-2 text-left text-[10px] font-bold text-slate-700 hover:bg-slate-200">
        {loadingId === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        <span className="flex-1 truncate">Anteprima · {port === 'item' || port === 'item_id' || port === 'drive_item_id' ? 'file nel drive' : port}</span>
        <ExternalLink className="h-3 w-3 text-slate-400" />
      </button>
    ))}
    {failed && <p className="text-[9px] text-rose-600">{failed}</p>}
    {image && <ImageModal src={image} title={`${nodeLabel} · immagine`} onClose={() => setImage(null)} />}
    {item && createPortal(<DrivePreview item={item} items={[item]} isTeacher onNavigate={setItem} onClose={() => setItem(null)} />, document.body)}
  </div>
}
