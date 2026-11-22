import { useMemo, useRef, useState } from 'react'
import { FileText, ImagePlus, Loader2, Sparkles, Trash2, Upload, X } from '@/components/icons'
import { Button } from '@/design'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { llmApi, teacherApi } from '@/lib/api'
import { fileToDocImageSrc, newDocImageId, urlToDocImageSrc } from '@/lib/docImages'
import type { DocImage } from '@/lib/docMarkdown'
import { parseDispensaPayload } from '@/components/teacher/reportTemplates'
import type { GeneratedDoc } from '@/components/teacher/DocumentCanvas'
import { tl } from '@/i18n/tl'

type PdfCandidate = { id: string; page: number; data_url: string; width: number; height: number }

/** Where an image goes: a dispensa section (by index), or the start/end of an HTML document. */
type Placement = 'start' | 'end' | `section:${number}`

function figureHtml(image: DocImage): string {
  const alt = (image.caption || '').replace(/"/g, '&quot;')
  return `<figure class="doc-figure" style="margin:22px auto;max-width:100%;text-align:center"><img src="img:${image.id}" alt="${alt}" style="max-width:100%;height:auto;border-radius:14px">${image.caption ? `<figcaption style="margin-top:8px;font-size:13px;opacity:.75;font-style:italic">${image.caption}</figcaption>` : ''}</figure>`
}

/** Pure: returns the document content with the picture referenced at the requested place. */
export function insertImageIntoContent(doc: GeneratedDoc, image: DocImage, placement: Placement): string {
  const payload = doc.type === 'dispensa' ? parseDispensaPayload(doc.content) : null
  if (payload) {
    const ref = `![${image.caption || ''}](img:${image.id})`
    const index = placement.startsWith('section:') ? Number(placement.slice(8)) : placement === 'start' ? 0 : payload.sections.length - 1
    const section = payload.sections[Math.min(Math.max(index, 0), payload.sections.length - 1)]
    section.intro = `${section.intro}\n\n${ref}`
    return `\`\`\`dispensa_data\n${JSON.stringify(payload, null, 2)}\n\`\`\``
  }
  const figure = figureHtml(image)
  const html = doc.content
  if (placement === 'start' || placement.startsWith('section:')) {
    const afterTitle = html.match(/<\/h1>/i)
    if (afterTitle?.index !== undefined) return html.slice(0, afterTitle.index + afterTitle[0].length) + figure + html.slice(afterTitle.index + afterTitle[0].length)
    const body = html.match(/<body[^>]*>/i)
    if (body?.index !== undefined) return html.slice(0, body.index + body[0].length) + figure + html.slice(body.index + body[0].length)
    return figure + html
  }
  const closing = html.search(/<\/body>/i)
  return closing >= 0 ? html.slice(0, closing) + figure + html.slice(closing) : html + figure
}

interface Props {
  doc: GeneratedDoc
  onChange: (doc: GeneratedDoc) => void
  onClose: () => void
}

export default function DocImagePanel({ doc, onChange, onClose }: Props) {
  const { toast } = useToast()
  const uploadRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const pdfFileRef = useRef<File | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<null | 'ai' | 'upload' | 'pdf'>(null)
  const [pdfCandidates, setPdfCandidates] = useState<PdfCandidate[] | null>(null)
  const [pdfMode, setPdfMode] = useState<'images' | 'pages'>('images')
  const [placement, setPlacement] = useState<Placement>('end')
  const images = doc.images || []

  const sectionOptions = useMemo(() => {
    const payload = doc.type === 'dispensa' ? parseDispensaPayload(doc.content) : null
    return payload ? payload.sections.map((section, index) => ({ value: `section:${index}` as Placement, label: `${index + 1}. ${section.title}` })) : []
  }, [doc])

  const commit = (next: DocImage[], content = doc.content) => onChange({ ...doc, images: next, content })
  const fail = (title: string, error: unknown) => toast({
    title, variant: 'destructive',
    description: (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (error as Error)?.message || tl("Riprova tra poco."),
  })

  const addImages = (sources: { src: string; caption?: string; source: DocImage['source'] }[]) => {
    const next = [...images]
    for (const item of sources) next.push({ id: newDocImageId(next), src: item.src, caption: item.caption, source: item.source })
    commit(next)
    return next
  }

  const generate = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy('ai')
    try {
      const response = await llmApi.generateImage(text)
      const url = response.data?.image_url as string | undefined
      if (!url) throw new Error(tl("Nessuna immagine generata"))
      addImages([{ src: await urlToDocImageSrc(url), caption: text.slice(0, 120), source: 'ai' }])
      setPrompt('')
    } catch (error) { fail(tl("Generazione immagine non riuscita"), error) } finally { setBusy(null) }
  }

  const upload = async (files: FileList | null) => {
    const list = Array.from(files || []).filter(file => file.type.startsWith('image/'))
    if (!list.length) return
    setBusy('upload')
    try {
      const sources = []
      for (const file of list) sources.push({ src: await fileToDocImageSrc(file), caption: file.name.replace(/\.[^.]+$/, ''), source: 'upload' as const })
      addImages(sources)
    } catch (error) { fail(tl("Caricamento non riuscito"), error) } finally { setBusy(null); if (uploadRef.current) uploadRef.current.value = '' }
  }

  const loadPdf = async (file: File, mode: 'images' | 'pages') => {
    setBusy('pdf')
    try {
      const response = await teacherApi.extractDocImagesFromPdf(file, mode)
      pdfFileRef.current = file
      setPdfMode(mode)
      if (!response.data.images.length && mode === 'images') return loadPdf(file, 'pages')
      setPdfCandidates(response.data.images)
      if (!response.data.images.length) toast({ title: tl("Nessuna immagine trovata nel PDF") })
    } catch (error) { fail(tl("Lettura PDF non riuscita"), error) } finally { setBusy(null); if (pdfRef.current) pdfRef.current.value = '' }
  }

  const usePdfImage = (candidate: PdfCandidate) => {
    addImages([{ src: candidate.data_url, caption: tl("Pagina {0}", candidate.page), source: 'pdf' }])
    setPdfCandidates(current => current?.filter(item => item.id !== candidate.id) ?? null)
  }

  const insert = (image: DocImage) => {
    onChange({ ...doc, content: insertImageIntoContent(doc, image, placement) })
    toast({ title: tl("Immagine inserita"), description: tl("Puoi chiedere all'AI di spostarla o ridimensionarla.") })
  }

  const rename = (id: string, caption: string) => commit(images.map(image => image.id === id ? { ...image, caption } : image))
  const remove = (id: string) => {
    const stripped = doc.content
      .replace(new RegExp(`<figure[^>]*>\\s*<img[^>]*src="img:${id}"[\\s\\S]*?</figure>`, 'g'), '')
      .replace(new RegExp(`\\\\n\\\\n!\\[[^\\]]*\\]\\(img:${id}\\)|!\\[[^\\]]*\\]\\(img:${id}\\)`, 'g'), '')
    commit(images.filter(image => image.id !== id), stripped)
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-40 flex w-[min(360px,100%)] flex-col border-l border-slate-200 bg-white shadow-xl animate-in slide-in-from-right-4 duration-150" aria-label={tl("Immagini del documento")}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <ImagePlus className="h-4 w-4 text-slate-500" />
        <span className="flex-1 text-sm font-semibold text-slate-800">{tl("Immagini")}</span>
        <Button tone="neutral" surface="ghost" density="icon" onClick={onClose} aria-label={tl("Chiudi")}><X className="h-4 w-4" /></Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">{tl("Aggiungi")}</div>
          <div className="flex gap-2">
            <Input value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void generate() }} placeholder={tl("Descrivi l'immagine da generare…")} className="h-9" />
            <Button tone="accent" surface="solid" density="compact" disabled={!prompt.trim() || !!busy} onClick={() => void generate()} aria-label={tl("Genera immagine")}>
              {busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button tone="neutral" surface="soft" density="compact" fullWidth disabled={!!busy} onClick={() => uploadRef.current?.click()}>
              {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{tl("Carica")}
            </Button>
            <Button tone="neutral" surface="soft" density="compact" fullWidth disabled={!!busy} onClick={() => pdfRef.current?.click()}>
              {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}{tl("Da PDF")}
            </Button>
          </div>
          <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={event => void upload(event.target.files)} />
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void loadPdf(file, 'images') }} />
        </div>

        {pdfCandidates && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs font-semibold text-slate-700">
                {pdfMode === 'images' ? tl("Immagini nel PDF") : tl("Pagine del PDF")} · {pdfCandidates.length}
              </span>
              {pdfMode === 'images' && pdfFileRef.current && (
                <Button tone="neutral" surface="ghost" density="compact" disabled={!!busy} onClick={() => void loadPdf(pdfFileRef.current!, 'pages')}>{tl("Usa pagine intere")}</Button>
              )}
              <Button tone="neutral" surface="ghost" density="icon" onClick={() => setPdfCandidates(null)} aria-label={tl("Chiudi")}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
              {pdfCandidates.map(candidate => (
                <button key={candidate.id} type="button" onClick={() => usePdfImage(candidate)} className="group relative overflow-hidden rounded-lg bg-white" title={tl("Pagina {0} — clic per aggiungere", candidate.page)}>
                  <img src={candidate.data_url} alt="" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">p.{candidate.page}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">{tl("Clic su un'immagine per aggiungerla alla libreria del documento.")}</p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] font-semibold text-slate-400">{tl("Libreria")} · {images.length}</span>
            <select value={placement} onChange={event => setPlacement(event.target.value as Placement)} className="ds-field h-8 max-w-[170px] rounded-[var(--control-radius)] border-0 px-2 text-xs" aria-label={tl("Posizione")}>
              <option value="end">{tl("In fondo")}</option>
              <option value="start">{tl("Dopo il titolo")}</option>
              {sectionOptions.map(option => <option key={option.value} value={option.value}>{tl("Sezione")} {option.label}</option>)}
            </select>
          </div>
          {images.length === 0 && <p className="text-xs text-slate-400">{tl("Nessuna immagine: generane una, caricala o prendila da un PDF. L'AI potrà usarla nelle modifiche successive.")}</p>}
          {images.map(image => (
            <div key={image.id} className="flex gap-2 rounded-xl bg-slate-50 p-2">
              <img src={image.src} alt={image.caption || ''} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Input value={image.caption || ''} onChange={event => rename(image.id, event.target.value)} placeholder={tl("Didascalia")} className="h-7 text-xs" />
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate font-mono text-[10px] text-slate-400">img:{image.id}</span>
                  <Button tone="accent" surface="soft" density="compact" onClick={() => insert(image)}>{tl("Inserisci")}</Button>
                  <Button tone="neutral" surface="ghost" density="icon" onClick={() => remove(image.id)} aria-label={tl("Elimina")}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
