import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Share2, X } from 'lucide-react'
import { driveApi } from '@/lib/api'
import { CATEGORY_META, categoryOf, editorPathFor, filenameFromDisposition, formatBytes, formatDate, saveBlob, type DriveItem } from './driveTypes'
import { GlbViewer } from './GlbViewer'

const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024
const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'py', 'js', 'ts', 'tsx', 'html', 'css', 'xml', 'yaml', 'yml', 'c', 'cpp', 'java', 'ino', 'log']

type Loaded =
  | { kind: 'url'; url: string; blob: Blob }
  | { kind: 'text'; text: string }
  | { kind: 'model'; blob: Blob; format: 'glb' | 'stl' }
  | { kind: 'none' }

function extensionOf(name: string) {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

async function loadPreview(item: DriveItem): Promise<Loaded> {
  const category = categoryOf(item)
  const ext = extensionOf(item.name)
  if (item.source_type === 'document' || item.source_type === 'presentation') {
    const res = await driveApi.exportItem(item.id, 'pdf')
    const blob = new Blob([res.data], { type: 'application/pdf' })
    return { kind: 'url', url: URL.createObjectURL(blob), blob }
  }
  if (item.kind !== 'file') return { kind: 'none' }
  const isText = TEXT_EXTENSIONS.includes(ext) || (item.mime_type || '').startsWith('text/')
  const previewable = ['image', 'pdf', 'video', 'audio', 'model3d'].includes(category) || isText
  if (!previewable) return { kind: 'none' }
  if (isText && (item.size_bytes ?? 0) > TEXT_PREVIEW_LIMIT) return { kind: 'none' }
  const res = await driveApi.content(item.id)
  const blob: Blob = res.data
  if (category === 'model3d') {
    if (ext === 'glb' || ext === 'gltf' || ext === 'stl') return { kind: 'model', blob, format: ext === 'stl' ? 'stl' : 'glb' }
    return { kind: 'none' }
  }
  if (isText && !['image', 'pdf', 'video', 'audio'].includes(category)) return { kind: 'text', text: await blob.text() }
  const typed = blob.type ? blob : new Blob([blob], { type: item.mime_type || 'application/octet-stream' })
  return { kind: 'url', url: URL.createObjectURL(typed), blob: typed }
}

export async function downloadDriveItem(item: DriveItem, format?: string) {
  if (item.kind === 'folder') {
    const res = await driveApi.zip([item.id])
    saveBlob(res.data, `${item.name}.zip`)
    return
  }
  const res = item.kind === 'file' && !format ? await driveApi.content(item.id) : await driveApi.exportItem(item.id, format)
  saveBlob(res.data, filenameFromDisposition(res.headers['content-disposition'], item.name))
}

export function DrivePreview({
  item, items, onNavigate, onClose, onShare, isTeacher,
}: {
  item: DriveItem
  items: DriveItem[]
  onNavigate: (item: DriveItem) => void
  onClose: () => void
  onShare?: (item: DriveItem) => void
  isTeacher: boolean
}) {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const files = items.filter((entry) => entry.kind !== 'folder')
  const index = files.findIndex((entry) => entry.id === item.id)
  const prev = index > 0 ? files[index - 1] : null
  const next = index >= 0 && index < files.length - 1 ? files[index + 1] : null
  const category = categoryOf(item)
  const meta = CATEGORY_META[category]
  const editorPath = isTeacher ? editorPathFor(item) : null

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setLoaded(null)
    setError(null)
    if (item.source_type === 'solid_model') {
      setLoaded({ kind: 'none' })
      return
    }
    loadPreview(item)
      .then((result) => {
        if (cancelled) {
          if (result.kind === 'url') URL.revokeObjectURL(result.url)
          return
        }
        if (result.kind === 'url') url = result.url
        setLoaded(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.status === 404 ? 'File non più disponibile' : 'Anteprima non riuscita')
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [item])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && prev) onNavigate(prev)
      else if (event.key === 'ArrowRight' && next) onNavigate(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onClose, onNavigate])

  const download = async () => {
    setDownloading(true)
    try { await downloadDriveItem(item) } finally { setDownloading(false) }
  }

  const Icon = meta.icon
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-slate-950/90" role="dialog" aria-modal="true" aria-label={item.name}>
      <header className="flex h-14 shrink-0 items-center gap-3 px-4 text-white">
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="Chiudi anteprima">
          <X className="h-5 w-5" />
        </button>
        <Icon className="h-5 w-5 shrink-0" style={{ color: meta.tone }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{item.name}</p>
          <p className="truncate text-[11px] text-white/60">
            {meta.label} · {formatBytes(item.size_bytes)} · modificato {formatDate(item.updated_at)}
            {item.created_by_student ? ` · di ${item.created_by_student}` : ''}
          </p>
        </div>
        {editorPath && (
          <button type="button" onClick={() => navigate(editorPath)} className="flex h-9 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-bold hover:bg-white/20">
            <ExternalLink className="h-4 w-4" /> Apri nell'editor
          </button>
        )}
        {onShare && item.role === 'owner' && (
          <button type="button" onClick={() => onShare(item)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="Condividi">
            <Share2 className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={() => void download()} disabled={downloading} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-50" aria-label="Scarica">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-6" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
        {prev && (
          <button type="button" onClick={() => onNavigate(prev)} className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Precedente">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {next && (
          <button type="button" onClick={() => onNavigate(next)} className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Successivo">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
        {error ? (
          <p className="text-sm text-white/70">{error}</p>
        ) : !loaded ? (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <Loader2 className="h-7 w-7 animate-spin" />
            {(item.source_type === 'document' || item.source_type === 'presentation') && <p className="text-xs">Preparo l'anteprima…</p>}
          </div>
        ) : loaded.kind === 'url' && category === 'image' ? (
          <img src={loaded.url} alt={item.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        ) : loaded.kind === 'url' && category === 'video' ? (
          <video src={loaded.url} controls autoPlay className="max-h-full max-w-full rounded-lg shadow-2xl" />
        ) : loaded.kind === 'url' && category === 'audio' ? (
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><audio src={loaded.url} controls autoPlay className="w-full" /></div>
        ) : loaded.kind === 'url' ? (
          <iframe src={loaded.url} title={item.name} className="h-full w-full max-w-5xl rounded-lg bg-white shadow-2xl" />
        ) : loaded.kind === 'text' ? (
          <pre className="h-full w-full max-w-5xl overflow-auto rounded-lg bg-white p-6 font-mono text-xs leading-relaxed text-slate-800 shadow-2xl">{loaded.text}</pre>
        ) : loaded.kind === 'model' ? (
          <div className="h-full w-full max-w-5xl"><GlbViewer blob={loaded.blob} format={loaded.format} /></div>
        ) : (
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-3xl bg-white p-8 text-center shadow-2xl">
            {item.thumbnail ? (
              <img src={item.thumbnail} alt="" className="h-40 w-40 rounded-2xl object-contain" />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-3xl" style={{ background: `color-mix(in srgb, ${meta.tone} 14%, white)` }}>
                <Icon className="h-10 w-10" style={{ color: meta.tone }} />
              </span>
            )}
            <div>
              <p className="text-sm font-bold text-slate-800">{item.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {item.source_type === 'solid_model' ? 'Progetto del 3D Lab: aprilo nel modellatore o esportalo.' : 'Anteprima non disponibile per questo formato.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {editorPath && (
                <button type="button" onClick={() => navigate(editorPath)} className="flex h-9 items-center gap-2 rounded-full bg-[var(--app-accent)] px-4 text-xs font-bold text-white">
                  <ExternalLink className="h-4 w-4" /> Apri
                </button>
              )}
              <button type="button" onClick={() => void download()} className="flex h-9 items-center gap-2 rounded-full bg-slate-100 px-4 text-xs font-bold text-slate-700 hover:bg-slate-200">
                <Download className="h-4 w-4" /> Scarica
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
