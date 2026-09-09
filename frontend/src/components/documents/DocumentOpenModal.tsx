import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Eye, FileSpreadsheet, Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { filesApi } from '@/lib/api'
import DocumentThumbnail from './DocumentThumbnail'

export type OpenableDocument = {
  title: string
  type: 'presentation' | 'document' | 'sheet' | 'canvas' | 'pdf' | 'web'
  contentJson: string
}

type ParsedContent = {
  slides?: unknown[]
  htmlContent?: string
  content?: string
  data?: string[][]
  styles?: Record<string, CSSProperties>
  dimensions?: { columnWidths?: number[]; rowHeights?: number[] }
  url?: string
  previewImage?: string
  source?: { fileId?: string; extension?: string; mimeType?: string }
}

interface DocumentOpenModalProps {
  document: OpenableDocument
  onClose: () => void
  onEdit?: () => void | Promise<void>
  editLabel?: string
  isEnglish?: boolean
}

export default function DocumentOpenModal({ document, onClose, onEdit, editLabel, isEnglish = false }: DocumentOpenModalProps) {
  const [viewing, setViewing] = useState(false)
  const [slideIndex, setSlideIndex] = useState(0)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const content = useMemo<ParsedContent>(() => {
    try { return JSON.parse(document.contentJson || '{}') }
    catch { return {} }
  }, [document.contentJson])
  const sourceExtension = content.source?.extension?.toLowerCase()
  const canShowOriginal = sourceExtension === 'pdf' && Boolean(content.source?.fileId)

  useEffect(() => {
    if (!viewing || !canShowOriginal || !content.source?.fileId) return
    let disposed = false
    let objectUrl: string | null = null
    setSourceLoading(true)
    void filesApi.getContent(content.source.fileId)
      .then(response => {
        if (disposed) return
        objectUrl = URL.createObjectURL(response.data)
        setSourceUrl(objectUrl)
      })
      .catch(() => setSourceUrl(null))
      .finally(() => { if (!disposed) setSourceLoading(false) })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [canShowOriginal, content.source?.fileId, viewing])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (!viewing || !content.slides?.length) return
      if (event.key === 'ArrowLeft') setSlideIndex(index => Math.max(0, index - 1))
      if (event.key === 'ArrowRight') setSlideIndex(index => Math.min(content.slides!.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [content.slides, onClose, viewing])

  const html = content.htmlContent || content.content || ''
  const currentSlideJson = content.slides?.length
    ? JSON.stringify({ ...content, slides: [content.slides[slideIndex]] })
    : document.contentJson

  const edit = async () => {
    if (!onEdit) return
    await onEdit()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={document.title} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`flex w-full flex-col overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl ${viewing ? 'h-[92vh] max-w-6xl' : 'max-w-xl'}`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black text-slate-950">{document.title}</p>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{sourceExtension || (document.type === 'sheet' ? (isEnglish ? 'Tables' : 'Tabelle') : document.type)}</p>
          </div>
          {viewing && onEdit && <Button size="sm" onClick={() => void edit()}><Pencil className="mr-2 h-4 w-4" />{editLabel || (isEnglish ? 'Edit' : 'Modifica')}</Button>}
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label={isEnglish ? 'Close' : 'Chiudi'}><X className="h-5 w-5" /></button>
        </header>

        {!viewing ? (
          <div className="p-5">
            <DocumentThumbnail contentJson={document.contentJson} type={document.type} title={document.title} className="mx-auto max-w-md" />
            <p className="mt-4 text-center text-sm text-slate-600">{isEnglish ? 'Open without changing it, or enter editing mode.' : 'Apri senza modificare il contenuto, oppure entra in modalità di editing.'}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Button variant="outline" className="h-12" onClick={() => setViewing(true)}><Eye className="mr-2 h-4 w-4" />{isEnglish ? 'View' : 'Visualizza'}</Button>
              {onEdit && <Button className="h-12" onClick={() => void edit()}><Pencil className="mr-2 h-4 w-4" />{editLabel || (isEnglish ? 'Edit' : 'Modifica')}</Button>}
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-auto bg-slate-100 p-4 sm:p-7">
            {sourceLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /></div>
              : sourceUrl ? <iframe src={sourceUrl} title={document.title} className="h-full min-h-[70vh] w-full rounded-xl border-0 bg-white shadow" />
              : content.slides?.length ? (
                <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-4">
                  <DocumentThumbnail contentJson={currentSlideJson} type="presentation" title={document.title} className="aspect-video w-full shadow-xl" />
                  <div className="flex items-center gap-3 rounded-full bg-white px-2 py-1 shadow">
                    <button className="rounded-full p-2 hover:bg-slate-100 disabled:opacity-30" disabled={slideIndex === 0} onClick={() => setSlideIndex(index => index - 1)}><ChevronLeft className="h-5 w-5" /></button>
                    <span className="min-w-20 text-center text-sm font-bold text-slate-700">{slideIndex + 1} / {content.slides.length}</span>
                    <button className="rounded-full p-2 hover:bg-slate-100 disabled:opacity-30" disabled={slideIndex === content.slides.length - 1} onClick={() => setSlideIndex(index => index + 1)}><ChevronRight className="h-5 w-5" /></button>
                  </div>
                </div>
              ) : Array.isArray(content.data) ? (
                <div className="overflow-auto rounded-xl bg-white shadow">
                  <table className="min-w-full table-fixed border-collapse text-sm"><colgroup>{Array.from({ length: Math.max(0, ...content.data.map(row => row.length)) }, (_, index) => <col key={index} style={{ width: content.dimensions?.columnWidths?.[index] || 120 }} />)}</colgroup><tbody>{content.data.map((row, rowIndex) => <tr key={rowIndex} style={{ height: content.dimensions?.rowHeights?.[rowIndex] || 36 }}>{row.map((cell, colIndex) => <td key={colIndex} style={content.styles?.[`${rowIndex}:${colIndex}`]} className="border border-slate-200 px-3 py-2 text-slate-700">{cell}</td>)}</tr>)}</tbody></table>
                </div>
              ) : html ? (
                <article className="prose prose-slate mx-auto min-h-full max-w-[794px] rounded-sm bg-white px-10 py-12 shadow-xl sm:px-16" dangerouslySetInnerHTML={{ __html: html }} />
              ) : content.url ? <iframe src={content.url} title={document.title} sandbox="" className="h-full min-h-[70vh] w-full rounded-xl border-0 bg-white shadow" />
              : <div className="flex h-full flex-col items-center justify-center text-slate-400"><FileSpreadsheet className="mb-3 h-10 w-10" /><p>{isEnglish ? 'Preview unavailable' : 'Anteprima non disponibile'}</p></div>}
          </div>
        )}
      </div>
    </div>
  )
}
