import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { Button, Input, SectionIllustration, Select } from '@/design'
import { ChevronLeft, ChevronRight, MonitorPlay, Plus, Save, Trash2 } from '@/components/icons'
import { RichTextEditor } from '@/components/RichTextEditor'
import { SlideEditor, type SlideBlock, type SlideBlockType } from '@/components/SlideEditor'
import { UnifiedToolbar } from '@/components/UnifiedToolbar'
import { SlidePreview } from '@/components/documents/DocumentThumbnail'
import { DocumentPageDecorations } from '@/components/documents/DocumentPageDecorations'
import PresentationPlayer from '@/components/presentation/PresentationPlayer'
import { applyStyleToBlocks, createShapeBlock } from '@/lib/slideBlocks'
import { PublicDocumentError, publicDocumentApi, type SharedDocument } from '@/lib/documentShares'
import { pageDimensions, readPageSetup } from '@/lib/documentPage'
import { readHeaderFooter } from '@/lib/documentHeaderFooter'
import { sanitizeDocumentHtml } from '@/lib/sanitizeDocumentHtml'
import type { StudioSlide } from '@/lib/presentationStudio'
import { tl } from '@/i18n/tl'

type Content = {
  type?: string; format?: '16:9' | '4:3'; htmlContent?: string; slides?: (StudioSlide & { backgroundColor?: string })[];
  header?: unknown; headerFooter?: unknown; page?: unknown; margins?: { horizontal?: number; vertical?: number };
  [key: string]: unknown;
}

export default function PublicDocumentPage() {
  const { token = '' } = useParams()
  const [meta, setMeta] = useState<SharedDocument | null>(null)
  const [content, setContent] = useState<Content>({})
  const [title, setTitle] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [activeBlockEditor, setActiveBlockEditor] = useState<Editor | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const [scale, setScale] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [loadId, setLoadId] = useState(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const ready = useRef(false)
  const lock = useRef(false)
  const editable = meta?.permission === 'edit' && !blocked && !saving
  const slides = content.slides || []
  const slide = slides[index]
  const isSlides = meta?.doc_type === 'presentation'
  const dimensions = content.format === '4:3' ? { width: 800, height: 600 } : { width: 960, height: 540 }
  const page = pageDimensions(readPageSetup(content.page))
  const marginX = Number(content.margins?.horizontal ?? 64)
  const marginY = Number(content.margins?.vertical ?? 64)

  const load = useCallback(async () => {
    setLoading(true); setError(''); ready.current = false
    try {
      const next = await publicDocumentApi.read(token)
      const parsed = JSON.parse(next.content_json) as Content
      if (typeof parsed.htmlContent === 'string') parsed.htmlContent = sanitizeDocumentHtml(parsed.htmlContent)
      setMeta(next); setTitle(next.title); setContent(parsed); setDirty(false); setConflict(false); setBlocked(false)
      setIndex(current => Math.max(0, Math.min(current, (parsed.slides?.length || 1) - 1)))
      setSelected(null); setEditor(null); setLoadId(value => value + 1)
    } catch (cause) {
      setMeta(null)
      setError(cause instanceof PublicDocumentError ? cause.message : tl('Impossibile aprire il documento. Riprova.'))
    } finally { setLoading(false); window.setTimeout(() => { ready.current = true }, 100) }
  }, [token])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const tags = ['referrer', 'robots'].map((name, index) => {
      const tag = document.createElement('meta'); tag.name = name
      tag.content = index === 0 ? 'no-referrer' : 'noindex, nofollow'
      document.head.appendChild(tag); return tag
    })
    return () => tags.forEach(tag => tag.remove())
  }, [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    const node = host.current
    if (!node) return
    const resize = () => setScale(Math.min(1, Math.max(0.1, (node.clientWidth - 32) / (isSlides ? dimensions.width : page.width))))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [loading, isSlides, dimensions.width, page.width])
  useEffect(() => { editor?.setEditable(Boolean(editable), false) }, [editor, editable])

  const edit = (update: (value: Content) => Content) => {
    if (!editable || !ready.current) return
    // Keep save/conflict errors visible through the slide editor's font-fit callbacks.
    setContent(update); setDirty(true)
  }
  const setBlocks = (blocks: SlideBlock[]) => edit(value => ({ ...value,
    slides: (value.slides || []).map((item, i) => i === index ? { ...item, blocks, customized: true } : item),
  }))
  const addBlock = (type: SlideBlockType) => {
    if (!slide) return
    let block: SlideBlock
    if (type === 'rectangle' || type === 'ellipse' || type === 'line') block = createShapeBlock(type, dimensions)
    else if (type === 'text') block = { id: crypto.randomUUID(), type: 'text', content: '<p>Testo</p>', x: 80, y: 80, width: 360, height: 100, style: { fontSize: 28, color: '#171717', padding: 0 } }
    else if (type === 'video') {
      const url = window.prompt(tl('URL del video'))
      if (!url || !/^https?:\/\//i.test(url)) return
      block = { id: crypto.randomUUID(), type: 'video', content: url, x: 80, y: 100, width: 480, height: 270, style: {} }
    }
    else { imageInput.current?.click(); return }
    setBlocks([...slide.blocks, { ...block, zIndex: slide.blocks.length }]); setSelected(block.id)
  }
  const insertImage = async (file?: File) => {
    if (!file || !editable) return
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) { setError(tl('Scegli un’immagine fino a 8 MB.')); return }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
    })
    if (isSlides && slide) {
      const block: SlideBlock = { id: crypto.randomUUID(), type: 'image', content: data, x: 80, y: 100, width: 400, height: 260, style: { padding: 0 }, zIndex: slide.blocks.length }
      setBlocks([...slide.blocks, block]); setSelected(block.id)
    } else editor?.chain().focus().setImage({ src: data }).run()
  }
  const save = async () => {
    if (!meta || lock.current || !dirty || blocked) return
    lock.current = true; setSaving(true); setError('')
    try {
      const result = await publicDocumentApi.save(token, { title, content_json: JSON.stringify(content), revision: meta.revision })
      setMeta(result); setDirty(false); setConflict(false)
    } catch (cause) {
      setError(cause instanceof PublicDocumentError ? cause.message : tl('Salvataggio non riuscito. Le modifiche sono ancora aperte qui.'))
      if (cause instanceof PublicDocumentError && cause.status === 409) setConflict(true)
      if (cause instanceof PublicDocumentError && [403, 404, 410].includes(cause.status)) setBlocked(true)
    } finally { lock.current = false; setSaving(false) }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-[var(--bg-primary)] text-[var(--text-primary)]"><p role="status">{tl('Caricamento documento…')}</p></main>
  if (!meta) return <main className="grid min-h-screen place-items-center bg-[var(--bg-primary)] p-6 text-[var(--text-primary)]"><div className="grid max-w-md gap-4"><h1 className="text-xl font-bold">{tl('Documento non disponibile')}</h1><p role="alert">{error}</p><Button onClick={() => void load()}>{tl('Riprova')}</Button></div></main>

  return <main className="flex h-dvh flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
    <header className="ds-panel flex shrink-0 flex-wrap items-center gap-3 rounded-none px-4 py-3">
      <SectionIllustration section="/teacher/documents" compact />
      <div className="min-w-0 flex-1">
        {meta.permission === 'edit' ? <Input aria-label={tl('Titolo documento')} value={title} disabled={!editable} onChange={event => { setTitle(event.target.value); setDirty(true) }} />
          : <h1 className="truncate text-lg font-bold">{title}</h1>}
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{meta.permission === 'edit' ? tl('Modifica tramite link') : tl('Sola lettura')} · {tl('Golinelli AI')}</p>
      </div>
      {isSlides && <Button surface="ghost" onClick={() => setPresenting(true)} disabled={!slides.length}><MonitorPlay className="mr-2 h-4 w-4" />{tl('Presenta')}</Button>}
      {meta.permission === 'edit' && <Button tone="accent" surface="solid" onClick={() => void save()} disabled={saving || !dirty || blocked || conflict}><Save className="mr-2 h-4 w-4" />{saving ? tl('Salvataggio…') : dirty ? tl('Salva modifiche') : tl('Salvato')}</Button>}
    </header>
    {error && <div className="ds-panel flex shrink-0 flex-wrap items-center gap-3 p-3 text-sm"><p role="alert" className="flex-1">{error}</p>{conflict && <><Button density="compact" onClick={() => {
      const blob = new Blob([JSON.stringify({ title, ...content }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'modifiche-documento.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>{tl('Scarica le mie modifiche')}</Button><Button density="compact" onClick={() => void load()}>{tl('Ricarica versione aggiornata')}</Button></>}</div>}
    {editable && <div className="shrink-0 overflow-x-auto">
      <UnifiedToolbar allowAI={false} mode={isSlides ? 'slides' : 'document'} editor={editor} scale={scale} setScale={setScale}
        onInsertImage={() => imageInput.current?.click()} onAddSlideBlock={addBlock} selectedBlock={slide?.blocks.find(b => b.id === selected) as SlideBlock | undefined}
        activeBlockEditor={activeBlockEditor} onUpdateBlockStyle={(key, value) => { if (slide && selected) setBlocks(applyStyleToBlocks(slide.blocks, [selected], key, value)) }} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={event => { void insertImage(event.target.files?.[0]).catch(() => setError(tl('Impossibile leggere l’immagine.'))); event.target.value = '' }} />
    </div>}
    {isSlides && <nav className="flex shrink-0 flex-wrap items-center justify-center gap-2 p-2" aria-label={tl('Navigazione slide')}>
      <Button density="compact" surface="ghost" aria-label={tl('Slide precedente')} disabled={index === 0} onClick={() => { setIndex(i => i - 1); setSelected(null) }}><ChevronLeft className="h-4 w-4" /></Button>
      <div className="max-w-64"><Select aria-label={tl('Slide corrente')} value={index} onChange={event => { setIndex(Number(event.target.value)); setSelected(null) }}>{slides.map((item, i) => <option key={item.id} value={i}>{i + 1}. {item.title}</option>)}</Select></div>
      <Button density="compact" surface="ghost" aria-label={tl('Slide successiva')} disabled={index >= slides.length - 1} onClick={() => { setIndex(i => i + 1); setSelected(null) }}><ChevronRight className="h-4 w-4" /></Button>
      {editable && <><Button density="compact" surface="ghost" onClick={() => { edit(value => ({ ...value, slides: [...(value.slides || []), { id: crypto.randomUUID(), title: tl('Nuova slide'), blocks: [] }] })); setIndex(slides.length); setSelected(null) }}><Plus className="mr-1 h-4 w-4" />{tl('Slide')}</Button>
        <Button density="compact" surface="ghost" aria-label={tl('Elimina slide')} disabled={slides.length < 2} onClick={() => { edit(value => ({ ...value, slides: (value.slides || []).filter((_, i) => i !== index) })); setIndex(Math.max(0, index - 1)); setSelected(null) }}><Trash2 className="h-4 w-4" /></Button></>}
    </nav>}
    <div ref={host} className="min-h-0 flex-1 overflow-auto p-4">
      {isSlides && slide ? <div className="mx-auto" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}>
        <div className="theme-keep relative bg-white shadow-lg" style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {editable ? <SlideEditor key={slide.id} blocks={slide.blocks} onChange={setBlocks} selectedBlockId={selected} onSelectBlock={setSelected} scale={scale}
            slideWidth={dimensions.width} slideHeight={dimensions.height} backgroundColor={slide.backgroundColor} onActiveTextEditorChange={setActiveBlockEditor} />
            : <SlidePreview content={{ format: content.format || '16:9', slides: [slide] }} title={slide.title} interactive />}
        </div>
      </div> : !isSlides && <div className="mx-auto" style={{ width: page.width * scale, height: (page.height * pageCount + 24 * (pageCount - 1)) * scale }}>
        <article className="document-sheet theme-keep relative overflow-hidden bg-white text-slate-900 shadow-lg" style={{ width: page.width, minHeight: page.height * pageCount + 24 * (pageCount - 1), padding: `${marginY}px ${marginX}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <DocumentPageDecorations config={readHeaderFooter(content.headerFooter)} pageCount={pageCount} pageHeight={page.height} pageGap={24} marginVertical={marginY} marginHorizontal={marginX} />
          <RichTextEditor key={loadId} content={content.htmlContent || ''} readOnly={!editable} onEditorReady={setEditor} enableSelectionAssist={false}
            onChange={html => edit(value => ({ ...value, htmlContent: html }))}
            contentClassName="relative z-10 min-h-full max-w-none p-0 [&_.ProseMirror]:min-h-[400px] [&_.ProseMirror]:text-[16px] [&_.ProseMirror]:leading-7 [&_.ProseMirror_p]:m-0"
            pagination={{ pageHeight: page.height, pageGap: 24, marginTop: marginY, marginBottom: marginY, onPageCountChange: setPageCount }} />
        </article>
      </div>}
    </div>
    {presenting && <PresentationPlayer slides={slides} format={content.format === '4:3' ? '4:3' : '16:9'} startIndex={index} onClose={() => setPresenting(false)} />}
  </main>
}
