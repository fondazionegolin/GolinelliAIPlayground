import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Plus, Trash2, Monitor, FileText, ChevronLeft, ChevronRight, Send, CheckCircle
} from 'lucide-react'
import { studentApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { SlideEditor, SlideBlock } from '@/components/SlideEditor'
import { RichTextEditor } from '@/components/RichTextEditor'
import { UnifiedToolbar } from '@/components/UnifiedToolbar'
import { Editor } from '@tiptap/react'

// Types
type Format = 'a4' | '16:9' | '4:3'
type EditorMode = 'slides' | 'document'
type Block = SlideBlock

interface Slide {
  id: string
  title: string
  blocks: Block[]
  backgroundColor?: string
}

interface DocumentHeader {
  title: string
  subtitle: string
  logoUrl: string
}

interface Document {
  id: string
  title: string
  format: Format
  slides: Slide[]
  textContent?: string
  header?: DocumentHeader
}

interface DraftDocument {
  id: string
  title: string
  type: 'presentation' | 'document'
  updatedAt: string
  contentJson: string
}

// Format dimensions
const FORMAT_DIMENSIONS = {
  '16:9': { width: 960, height: 540, label: '16:9 (Presentazione)' },
  '4:3': { width: 800, height: 600, label: '4:3 (Standard)' },
  'a4': { width: 794, height: 1123, label: 'A4 (Documento)' }
}

const DOC_PAGE_GAP = 28
const EMPTY_DOC_HTML = '<p></p>'

interface StudentDocumentsModuleProps {
  sessionId: string
}

export default function StudentDocumentsModule({ sessionId: _sessionId }: StudentDocumentsModuleProps) {
  // sessionId is available for future use (e.g., if we need session-specific features)
  void _sessionId
  const { toast } = useToast()

  // State
  const [mode, setMode] = useState<EditorMode>('document')
  const [document, setDocument] = useState<Document>({
    id: crypto.randomUUID(),
    title: 'Il mio documento',
    format: 'a4',
    slides: [
      { id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }
    ],
    textContent: EMPTY_DOC_HTML,
    header: { title: '', subtitle: '', logoUrl: '' }
  })

  // Sidebar State
  const [showSidebar, setShowSidebar] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [draftDocuments, setDraftDocuments] = useState<DraftDocument[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)

  // Editor State
  const [editor, setEditor] = useState<Editor | null>(null)

  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [docScale, setDocScale] = useState(1)
  const [docMargins, setDocMargins] = useState({ vertical: 56, horizontal: 56 })
  const [showRuledLines, setShowRuledLines] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  const documentPageRef = useRef<HTMLDivElement>(null)

  // UI State
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [draggingMargin, setDraggingMargin] = useState<'left' | 'right' | null>(null)

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks.find(b => b.id === selectedBlockId)

  const createNewDocument = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: 'Il mio documento',
      format: 'a4',
      slides: [],
      textContent: EMPTY_DOC_HTML,
      header: { title: '', subtitle: '', logoUrl: '' }
    })
    setMode('document')
    setSubmitted(false)
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
  }

  const createNewPresentation = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: 'La mia presentazione',
      format: '16:9',
      slides: [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }],
      textContent: ''
    })
    setMode('slides')
    setSubmitted(false)
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
  }

  const upsertDraft = async (titleOverride?: string) => {
    const type = mode === 'slides' ? 'presentation' : 'document'
    const contentJson = JSON.stringify(
      mode === 'slides'
        ? { type: 'presentation_v2', format: document.format, slides: document.slides }
        : { type: 'document_v1', htmlContent: document.textContent || '', header: document.header, margins: docMargins }
    )
    try {
      if (draftId) {
        const res = await studentApi.updateDocumentDraft(draftId, {
          title: titleOverride ?? document.title,
          doc_type: type,
          content_json: contentJson
        })
        const updated: DraftDocument = {
          id: res.data.id,
          title: res.data.title,
          type: res.data.doc_type,
          updatedAt: res.data.updated_at,
          contentJson: res.data.content_json,
        }
        setDraftDocuments(prev => [updated, ...prev.filter(d => d.id !== updated.id)])
      } else {
        const res = await studentApi.createDocumentDraft({
          title: titleOverride ?? document.title,
          doc_type: type,
          content_json: contentJson
        })
        setDraftId(res.data.id)
        const created: DraftDocument = {
          id: res.data.id,
          title: res.data.title,
          type: res.data.doc_type,
          updatedAt: res.data.updated_at,
          contentJson: res.data.content_json,
        }
        setDraftDocuments(prev => [created, ...prev.filter(d => d.id !== created.id)])
      }
    } catch (e) {
      console.error('Draft save failed', e)
    }
  }

  const handleTitleChange = (value: string) => {
    setDocument(d => ({ ...d, title: value }))
    upsertDraft(value)
  }

  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const res = await studentApi.listDocumentDrafts()
        const drafts: DraftDocument[] = (res.data || []).map((d: any) => ({
          id: d.id,
          title: d.title,
          type: d.doc_type,
          updatedAt: d.updated_at,
          contentJson: d.content_json
        }))
        setDraftDocuments(drafts)
      } catch (e) {
        console.error('Failed to load drafts', e)
      }
    }
    fetchDrafts()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      upsertDraft()
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, mode, docMargins])

  const loadDraft = (doc: DraftDocument) => {
    try {
      const content = JSON.parse(doc.contentJson)
      if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
        setDraftId(doc.id)
        const safeSlides = (content.slides && Array.isArray(content.slides) && content.slides.length > 0)
          ? content.slides.map((s: any) => ({
              id: s.id || crypto.randomUUID(),
              title: s.title || 'Slide',
              blocks: s.blocks || []
            }))
          : [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }]

        setDocument({
          id: doc.id,
          title: doc.title,
          format: content.format || '16:9',
          slides: safeSlides,
          textContent: ''
        })
        setCurrentSlideIndex(0)
        setSelectedBlockId(null)
      } else {
        setMode('document')
        setDraftId(doc.id)
        if (content.margins) {
          setDocMargins({
            vertical: content.margins.vertical ?? content.margins.top ?? 56,
            horizontal: content.margins.horizontal ?? content.margins.left ?? 56
          })
        }
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || EMPTY_DOC_HTML,
          header: content.header || { title: '', subtitle: '', logoUrl: '' }
        })
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Fit canvas
  useEffect(() => {
    const handleResize = () => {
      if (mode === 'slides' && canvasRef.current) {
        const parent = canvasRef.current.parentElement
        if (parent) {
          const dims = FORMAT_DIMENSIONS[document.format]
          const scaleX = (parent.clientWidth - 64) / dims.width
          const scaleY = (parent.clientHeight - 64) / dims.height
          setScale(Math.min(scaleX, scaleY, 1))
        }
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [document.format, mode, showSidebar])

  const addSlide = () => {
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      title: `Slide ${document.slides.length + 1}`,
      blocks: []
    }
    setDocument(prev => ({ ...prev, slides: [...prev.slides, newSlide] }))
    setCurrentSlideIndex(document.slides.length)
  }

  const deleteSlide = (index: number) => {
    if (document.slides.length <= 1) return
    const newSlides = document.slides.filter((_, i) => i !== index)
    setDocument(prev => ({ ...prev, slides: newSlides }))
    if (currentSlideIndex >= index && currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1)
    }
  }

  const updateSlideBlocks = (blocks: Block[]) => {
    const newSlides = [...document.slides]
    newSlides[currentSlideIndex] = { ...newSlides[currentSlideIndex], blocks }
    setDocument(prev => ({ ...prev, slides: newSlides }))
  }

  const addSlideBlock = (type: 'text' | 'image') => {
    const dims = FORMAT_DIMENSIONS[document.format]
    const newBlock: Block = {
      id: crypto.randomUUID(),
      type,
      content: type === 'text' ? 'Nuovo Testo' : 'https://placehold.co/400x300?text=Immagine',
      x: dims.width / 2 - 100,
      y: dims.height / 2 - (type === 'text' ? 50 : 150),
      width: 200,
      height: type === 'text' ? 100 : 300,
      style: {
        fontSize: 24,
        color: '#000000',
        backgroundColor: 'transparent',
        textAlign: 'center',
        padding: 10
      }
    }
    updateSlideBlocks([...currentSlide.blocks, newBlock])
    setSelectedBlockId(newBlock.id)
  }

  const addSlideImage = (imageUrl: string) => {
    const dims = FORMAT_DIMENSIONS[document.format]
    const newBlock: Block = {
      id: crypto.randomUUID(),
      type: 'image',
      content: imageUrl,
      x: dims.width / 2 - 150,
      y: dims.height / 2 - 100,
      width: 300,
      height: 200,
      style: {}
    }
    updateSlideBlocks([...currentSlide.blocks, newBlock])
    setSelectedBlockId(newBlock.id)
  }

  const updateBlockStyle = (key: string, value: unknown) => {
    if (!selectedBlockId) return
    const newBlocks = currentSlide.blocks.map(b =>
      b.id === selectedBlockId
        ? { ...b, style: { ...b.style, [key]: value } }
        : b
    )
    updateSlideBlocks(newBlocks)
  }

  // Submit document to teacher
  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      let contentJson = ""

      if (mode === 'slides') {
        contentJson = JSON.stringify({
          type: 'student_presentation',
          format: document.format,
          title: document.title,
          slides: document.slides.map(s => ({
            id: s.id,
            title: s.title,
            blocks: s.blocks
          }))
        })
      } else {
        contentJson = JSON.stringify({
          type: 'student_document',
          title: document.title,
          htmlContent: document.textContent,
          header: document.header,
          margins: docMargins
        })
      }

      // Submit as a student work/task submission
      await studentApi.submitDocument({
        title: document.title,
        content_type: mode === 'slides' ? 'presentation' : 'document',
        content_json: contentJson
      })

      setShowSubmitModal(false)
      setSubmitted(true)
      toast({
        title: "Documento inviato!",
        description: "Il docente riceverà il tuo lavoro nella sezione compiti.",
        className: "bg-green-500 text-white"
      })
    } catch (e) {
      console.error('Submit error:', e)
      toast({ title: "Errore invio", description: "Impossibile inviare il documento. Riprova.", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetDocument = () => {
    createNewDocument()
  }

  useEffect(() => {
    if (!draggingMargin || mode !== 'document') return

    const onMouseMove = (event: MouseEvent) => {
      const page = documentPageRef.current
      if (!page) return
      const rect = page.getBoundingClientRect()
      const pageWidth = FORMAT_DIMENSIONS.a4.width
      const scaleFactor = rect.width / pageWidth
      if (scaleFactor <= 0) return

      const rawMargin = draggingMargin === 'left'
        ? (event.clientX - rect.left) / scaleFactor
        : (rect.right - event.clientX) / scaleFactor

      const nextMargin = Math.max(16, Math.min(220, Math.round(rawMargin)))
      setDocMargins(prev => ({ ...prev, horizontal: nextMargin }))
    }

    const onMouseUp = () => setDraggingMargin(null)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [draggingMargin, mode])

  return (
    <>
      <div className="h-full flex flex-col bg-slate-100 overflow-hidden">

        {/* Header / Meta-Toolbar */}
        <div className="h-14 bg-white border-b flex items-center justify-between px-4 z-20 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
             <Button
               variant="ghost"
               size="sm"
               onClick={() => setShowSidebar(!showSidebar)}
               className="mr-2 text-slate-500"
             >
               {showSidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
             </Button>

             <Button
               onClick={() => setShowNewModal(true)}
               className="bg-slate-900 text-white hover:bg-slate-800 px-4"
             >
               <Plus className="h-4 w-4 mr-2" />
               Nuovo
             </Button>

             <div className="h-6 w-px bg-slate-200" />

             <Input
               value={document.title}
               onChange={(e) => handleTitleChange(e.target.value)}
               className="font-bold border-transparent hover:border-slate-200 focus:border-indigo-500 w-64 text-lg"
               placeholder="Nome file..."
             />
          </div>

          <div className="flex gap-2">
             {submitted ? (
               <Button variant="outline" onClick={resetDocument}>
                 <Plus className="h-4 w-4 mr-2" />
                 Nuovo documento
               </Button>
             ) : (
               <Button
                 onClick={() => setShowSubmitModal(true)}
                 className="bg-indigo-600 hover:bg-indigo-700 text-white"
               >
                 <Send className="h-4 w-4 mr-2" />
                 Invia al docente
               </Button>
             )}
          </div>
        </div>

        {/* Unified Toolbar */}
        <UnifiedToolbar
          mode={mode}
          editor={editor}
          docScale={docScale}
          setDocScale={setDocScale}
          showRuledLines={showRuledLines}
          onToggleRuledLines={() => setShowRuledLines(v => !v)}
          scale={scale}
          setScale={setScale}
          onAddSlideBlock={addSlideBlock}
          onAddSlideImage={addSlideImage}
          selectedBlock={selectedBlock}
          onUpdateBlockStyle={updateBlockStyle}
        />

        <div className="flex-1 flex overflow-hidden">

          {/* LEFT SIDEBAR: Slides */}
          <div className={`${showSidebar ? 'w-56' : 'w-0'} bg-white border-r flex flex-col transition-all duration-300 overflow-hidden shrink-0`}>

            {/* Slide Navigation (Only in Slide Mode) */}
            {mode === 'slides' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                 <div className="p-3 border-b flex justify-between items-center bg-slate-50">
                   <span className="font-semibold text-xs uppercase text-slate-500">Slide</span>
                   <Button size="icon" variant="ghost" className="h-6 w-6" onClick={addSlide}>
                     <Plus className="h-4 w-4" />
                   </Button>
                 </div>
                 <div className="flex-1 overflow-y-auto p-2 space-y-2">
                   {document.slides.map((slide, idx) => (
                     <div
                       key={slide.id}
                       onClick={() => { setCurrentSlideIndex(idx); setSelectedBlockId(null); }}
                       className={`p-3 rounded-lg border cursor-pointer transition-all group relative ${currentSlideIndex === idx ? 'ring-2 ring-indigo-500 bg-indigo-50' : 'hover:bg-slate-50'}`}
                     >
                       <div className="text-xs font-bold text-slate-500 mb-1">#{idx + 1}</div>
                       <div className="text-sm truncate font-medium">{slide.title}</div>
                       <button
                         onClick={(e) => { e.stopPropagation(); deleteSlide(idx); }}
                         className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                       >
                         <Trash2 className="h-3 w-3" />
                       </button>
                     </div>
                   ))}
                 </div>
              </div>
            )}

            {/* Drafts */}
            <div className="border-t">
              <div className="p-3 border-b bg-slate-50">
                <h3 className="font-semibold text-xs uppercase text-slate-500">Bozze</h3>
              </div>
              <div className="max-h-40 overflow-y-auto p-2">
                {draftDocuments.length === 0 && (
                  <p className="text-xs text-center text-slate-400 py-2">Nessuna bozza</p>
                )}
                {draftDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => loadDraft(doc)}
                    className="group flex items-start gap-3 p-2 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors border border-transparent hover:border-slate-200 mb-1"
                  >
                    <div className={`p-1.5 rounded-md ${doc.type === 'presentation' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'}`}>
                      {doc.type === 'presentation' ? <Monitor className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{doc.title}</p>
                      <p className="text-[10px] text-slate-400 truncate">{new Date(doc.updatedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Status indicator */}
            {submitted && (
              <div className="p-4 bg-green-50 border-t">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">Inviato!</span>
                </div>
              </div>
            )}
          </div>

          {/* Main Area */}
          <div className="flex-1 bg-slate-100 flex items-start justify-center p-2 md:p-3 relative overflow-y-auto"
               onClick={() => setSelectedBlockId(null)}
          >

             {/* MODE: DOCUMENT */}
             {mode === 'document' && (
               <div
                 ref={documentPageRef}
                 className="mb-6 print:shadow-none flex flex-col relative transition-all overflow-hidden"
                 style={{
                   width: FORMAT_DIMENSIONS.a4.width,
                   minHeight: FORMAT_DIMENSIONS.a4.height,
                   transform: `scale(${docScale})`,
                   transformOrigin: 'top center',
                   backgroundImage: `repeating-linear-gradient(to bottom, #ffffff 0, #ffffff ${FORMAT_DIMENSIONS.a4.height}px, #f1f5f9 ${FORMAT_DIMENSIONS.a4.height}px, #f1f5f9 ${FORMAT_DIMENSIONS.a4.height + DOC_PAGE_GAP}px)`,
                   boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
                   padding: `${docMargins.vertical}px ${docMargins.horizontal}px`
                 }}
               >
                  {/* Top guides for lateral margins with drag handles */}
                  <div className="pointer-events-none absolute top-3 left-0 right-0 z-10">
                    <div className="relative h-4">
                      <div
                        className="absolute top-2 border-t border-slate-300"
                        style={{ left: docMargins.horizontal, right: docMargins.horizontal }}
                      />
                      <div
                        className="pointer-events-auto absolute top-0 h-4 border-l border-slate-400"
                        style={{ left: docMargins.horizontal }}
                      />
                      <div
                        className="pointer-events-auto absolute top-0 h-4 border-l border-slate-400"
                        style={{ right: docMargins.horizontal }}
                      />
                      <button
                        type="button"
                        className="pointer-events-auto absolute -top-0.5 h-3.5 w-3.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white shadow-sm"
                        style={{ left: docMargins.horizontal }}
                        onMouseDown={() => setDraggingMargin('left')}
                        aria-label="Regola margine sinistro"
                        title="Trascina per regolare margine sinistro"
                      />
                      <button
                        type="button"
                        className="pointer-events-auto absolute -top-0.5 h-3.5 w-3.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white shadow-sm"
                        style={{ left: FORMAT_DIMENSIONS.a4.width - docMargins.horizontal }}
                        onMouseDown={() => setDraggingMargin('right')}
                        aria-label="Regola margine destro"
                        title="Trascina per regolare margine destro"
                      />
                    </div>
                  </div>

                  {showRuledLines && (
                    <div
                      className="pointer-events-none absolute z-0"
                      style={{
                        top: docMargins.vertical,
                        right: docMargins.horizontal,
                        bottom: docMargins.vertical,
                        left: docMargins.horizontal,
                        backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 21px, rgba(148, 163, 184, 0.35) 21px, rgba(148, 163, 184, 0.35) 22px, transparent 22px, transparent 28px)'
                      }}
                    />
                  )}

                  <div
                    className="flex-1 flex flex-col relative z-10"
                    style={{ minHeight: FORMAT_DIMENSIONS.a4.height - docMargins.vertical * 2 }}
                    onMouseDown={() => {
                      if (editor && mode === 'document') {
                        editor.chain().focus('end').run()
                      }
                    }}
                  >
                    <RichTextEditor
                      content={document.textContent || ''}
                      onChange={(html) => setDocument(d => ({ ...d, textContent: html }))}
                      onEditorReady={setEditor}
                      contentClassName="h-full min-h-full max-w-none focus:outline-none p-0 cursor-text [&_.ProseMirror]:min-h-full [&_.ProseMirror]:h-full [&_.ProseMirror]:text-[16px] [&_.ProseMirror]:leading-7 [&_.ProseMirror_p]:m-0 [&_.ProseMirror_h1]:m-0 [&_.ProseMirror_h2]:m-0 [&_.ProseMirror_h3]:m-0 [&_.ProseMirror_ul]:my-0 [&_.ProseMirror_ol]:my-0"
                    />
                  </div>
               </div>
             )}

             {/* MODE: SLIDES */}
             {mode === 'slides' && (
               <div
                 ref={canvasRef}
                 className="bg-white shadow-xl relative transition-transform origin-center flex flex-col"
                 style={{
                   width: FORMAT_DIMENSIONS[document.format].width,
                   height: FORMAT_DIMENSIONS[document.format].height,
                   transform: `scale(${scale})`,
                   marginTop: '20px'
                 }}
                 onClick={(e) => e.stopPropagation()}
               >
                  <div className="absolute top-0 left-0 right-0 p-8 z-10 pointer-events-none">
                     <input
                       value={currentSlide.title}
                       onChange={(e) => {
                         const newSlides = [...document.slides]
                         newSlides[currentSlideIndex].title = e.target.value
                         setDocument(d => ({ ...d, slides: newSlides }))
                       }}
                       className="text-4xl font-bold bg-transparent border-none focus:outline-none w-full placeholder-slate-300 pointer-events-auto"
                       placeholder="Titolo Slide"
                     />
                  </div>

                  <div className="flex-1 relative">
                    <SlideEditor
                      blocks={currentSlide.blocks}
                      onChange={updateSlideBlocks}
                      selectedBlockId={selectedBlockId}
                      onSelectBlock={setSelectedBlockId}
                      scale={scale}
                    />
                  </div>
               </div>
             )}

          </div>
        </div>

        {/* New Document Modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
              <h3 className="text-lg font-semibold mb-2">Crea nuovo</h3>
              <p className="text-sm text-gray-600 mb-4">
                Scegli se creare un nuovo documento o una nuova presentazione.
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  className="w-full justify-center bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => {
                    createNewDocument()
                    setShowNewModal(false)
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Nuovo documento
                </Button>
                <Button
                  className="w-full justify-center bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => {
                    createNewPresentation()
                    setShowNewModal(false)
                  }}
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  Nuova presentazione
                </Button>
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setShowNewModal(false)}>Annulla</Button>
              </div>
            </div>
          </div>
        )}

        {/* Submit Modal */}
        {showSubmitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-bold mb-2">Invia al Docente</h3>
            <p className="text-sm text-gray-600 mb-4">
              Il tuo {mode === 'slides' ? 'presentazione' : 'documento'} "<strong>{document.title}</strong>" verrà inviato al docente per la revisione.
            </p>
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mb-4">
              <p className="text-sm text-indigo-700">
                Il docente potrà visualizzare il tuo lavoro nella sezione Compiti della sessione.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSubmitModal(false)} disabled={isSubmitting}>
                Annulla
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {isSubmitting ? 'Invio...' : 'Conferma Invio'}
              </Button>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  )
}
