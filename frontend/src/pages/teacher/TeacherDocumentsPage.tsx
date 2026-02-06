import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Plus, Trash2, Upload, Monitor, FileText, ChevronLeft, ChevronRight
} from 'lucide-react'
import { teacherApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useQuery } from '@tanstack/react-query'
import { SlideEditor, SlideBlock } from '@/components/SlideEditor'
import { RichTextEditor } from '@/components/RichTextEditor'
import { PagedDocumentPreview } from '@/components/PagedDocumentPreview'
import { UnifiedToolbar } from '@/components/UnifiedToolbar'
import { Editor } from '@tiptap/react'

// Types
type Format = 'a4' | '16:9' | '4:3'
type EditorMode = 'slides' | 'document'

// Reuse SlideBlock type
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

// Stored Document Metadata for Sidebar
interface StoredDocument {
  id: string
  title: string
  type: 'presentation' | 'document'
  updatedAt: string
  sessionId: string
  sessionName: string
  contentJson: string
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

export default function TeacherDocumentsPage() {
  const { toast } = useToast()
  const [draftId, setDraftId] = useState<string | null>(null)
  
  // State
  const [mode, setMode] = useState<EditorMode>('document') 
  const [document, setDocument] = useState<Document>({
    id: crypto.randomUUID(),
    title: 'Nuovo Documento',
    format: 'a4',
    slides: [
      { id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }
    ],
    textContent: '<h1>Titolo del documento</h1><p>Inizia a scrivere qui...</p>',
    header: { title: '', subtitle: '', logoUrl: '' }
  })
  
  // Sidebar State
  const [showSidebar, setShowSidebar] = useState(true)
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([])
  const [isLoadingDocs, setIsLoadingDocs] = useState(false)
  const [draftDocuments, setDraftDocuments] = useState<DraftDocument[]>([])

  // Editor State
  const [editor, setEditor] = useState<Editor | null>(null)
  
  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [docScale, setDocScale] = useState(1)
  const [docView, setDocView] = useState<'edit' | 'paged'>('paged')
  const [docMargins, setDocMargins] = useState({ vertical: 56, horizontal: 56 })
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  
  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  
  // UI State
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks.find(b => b.id === selectedBlockId)

  const createNewDocument = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: 'Nuovo Documento',
      format: 'a4',
      slides: [],
      textContent: '<h1>Titolo del documento</h1><p>Inizia a scrivere qui...</p>',
      header: { title: '', subtitle: '', logoUrl: '' }
    })
    setMode('document')
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
    setDocView('paged')
  }

  const createNewPresentation = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: 'Nuova Presentazione',
      format: '16:9',
      slides: [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }],
      textContent: '',
    })
    setMode('slides')
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
        const res = await teacherApi.updateDocumentDraft(draftId, {
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
        const res = await teacherApi.createDocumentDraft({
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

  const adjustMargins = (axis: 'horizontal' | 'vertical', delta: number) => {
    setDocMargins(prev => ({
      ...prev,
      [axis]: Math.max(16, Math.min(160, prev[axis] + delta))
    }))
  }

  // Fetch classes and sessions
  const { data: classesData } = useQuery({
    queryKey: ['teacher-classes-docs'],
    queryFn: async () => {
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data || []
      const allSessions: any[] = []
      for (const cls of classes) {
        try {
          const sessionsRes = await teacherApi.getSessions(cls.id)
          const sessions = sessionsRes.data || []
          sessions.forEach((s: any) => {
            allSessions.push({ id: s.id, name: s.title || s.name, class_name: cls.name })
          })
        } catch (e) { console.error(e) }
      }
      return allSessions
    },
  })

  // Load existing documents
  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const res = await teacherApi.listDocumentDrafts()
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

    const fetchDocuments = async () => {
      if (!classesData || classesData.length === 0) return
      
      setIsLoadingDocs(true)
      const docs: StoredDocument[] = []
      
      for (const session of classesData) {
        try {
          const tasksRes = await teacherApi.getTasks(session.id)
          const tasks = tasksRes.data || []
          
          tasks.forEach((t: any) => {
            if (t.content_json) {
              try {
                const content = JSON.parse(t.content_json)
                if (content.type === 'document_v1' || content.type === 'presentation_v2' || 
                    t.task_type === 'presentation' || (t.task_type === 'lesson' && content.sections)) {
                  
                  docs.push({
                    id: t.id,
                    title: t.title,
                    type: (content.type === 'presentation_v2' || t.task_type === 'presentation') ? 'presentation' : 'document',
                    updatedAt: t.created_at,
                    sessionId: session.id,
                    sessionName: session.name,
                    contentJson: t.content_json
                  })
                }
              } catch (e) { }
            }
          })
        } catch (e) { console.error(e) }
      }
      
      docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setStoredDocuments(docs)
      setIsLoadingDocs(false)
    }

    fetchDocuments()
  }, [classesData])

  useEffect(() => {
    const timer = setTimeout(() => {
      upsertDraft()
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, mode, docMargins])

  // Load document
  const loadDocument = (doc: StoredDocument) => {
    try {
      const content = JSON.parse(doc.contentJson)
      
      if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
        setDraftId(null)
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
        setDraftId(null)
        setDocView('paged')
        if (content.margins) {
          setDocMargins({
            vertical: content.margins.vertical ?? content.margins.top ?? 56,
            horizontal: content.margins.horizontal ?? content.margins.left ?? 56,
          })
        }
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || '',
          header: content.header || { title: '', subtitle: '', logoUrl: '' }
        })
      }
      
      toast({ title: "Documento caricato", description: `Hai aperto "${doc.title}"` })
    } catch (e) {
      console.error(e)
      toast({ title: "Errore caricamento", description: "Impossibile aprire questo documento.", variant: "destructive" })
    }
  }

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
        setDocView('paged')
        if (content.margins) {
          setDocMargins({
            vertical: content.margins.vertical ?? content.margins.top ?? 56,
            horizontal: content.margins.horizontal ?? content.margins.left ?? 56,
          })
        }
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || '',
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

  // Actions
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

  const updateBlockStyle = (key: string, value: any) => {
    if (!selectedBlockId) return
    const newBlocks = currentSlide.blocks.map(b => 
      b.id === selectedBlockId 
        ? { ...b, style: { ...b.style, [key]: value } }
        : b
    )
    updateSlideBlocks(newBlocks)
  }

  const handlePublish = async () => {
    if (!selectedSessionId) return
    try {
      let contentJson = ""
      let taskType = ""

      if (mode === 'slides') {
        contentJson = JSON.stringify({
          type: 'presentation_v2',
          format: document.format,
          title: document.title,
          slides: document.slides.map(s => ({
            id: s.id,
            title: s.title,
            blocks: s.blocks
          }))
        })
        taskType = 'presentation'
      } else {
        contentJson = JSON.stringify({
          type: 'document_v1',
          title: document.title,
          htmlContent: document.textContent,
          header: document.header,
          margins: docMargins
        })
        taskType = 'lesson'
      }

      const response = await teacherApi.createTask(selectedSessionId, {
        title: document.title,
        description: `Documento creato con Golinelli AI Editor (${mode === 'slides' ? 'Presentazione' : 'Testo'})`,
        task_type: taskType,
        content_json: contentJson
      })

      // Emit socket event to notify students
      const taskId = response.data?.id
      if (taskId && window.socket) {
        window.socket.emit('teacher_publish_task', {
          session_id: selectedSessionId,
          task_id: taskId,
          title: document.title,
          task_type: taskType
        })
      }

      setShowPublishModal(false)
      toast({ title: "Documento pubblicato!", className: "bg-green-500 text-white" })
    } catch (e) {
      console.error('Publish error:', e)
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setDocument(d => ({ ...d, header: { ...d.header!, logoUrl: reader.result as string } }))
      }
      reader.readAsDataURL(file)
    }
  }

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
               className="font-bold border-transparent hover:border-slate-200 focus:border-violet-500 w-64 text-lg"
               placeholder="Nome file..."
             />
          </div>
          
          <div className="flex gap-2">
             {mode === 'document' && (
               <Button
                 variant="outline"
                 onClick={() => setDocView(v => (v === 'paged' ? 'edit' : 'paged'))}
               >
                 {docView === 'paged' ? 'Modifica' : 'Anteprima pagine'}
               </Button>
             )}
             <Button variant="outline" onClick={() => setShowPublishModal(true)}>
               <Upload className="h-4 w-4 mr-2" />
               Pubblica
             </Button>
          </div>
        </div>

        {/* Unified Toolbar */}
        <UnifiedToolbar
          mode={mode}
          editor={editor}
          docScale={docScale}
          setDocScale={setDocScale}
          scale={scale}
          setScale={setScale}
          onAddSlideBlock={addSlideBlock}
          onAddSlideImage={addSlideImage}
          selectedBlock={selectedBlock}
          onUpdateBlockStyle={updateBlockStyle}
        />

        <div className="flex-1 flex overflow-hidden"> 
          
          {/* LEFT SIDEBAR: Documents & Slides */}
          <div className={`${showSidebar ? 'w-64' : 'w-0'} bg-white border-r flex flex-col transition-all duration-300 overflow-hidden shrink-0`}>
            
            {/* Slide Navigation (Only in Slide Mode) */}
            {mode === 'slides' && (
              <div className="flex-1 flex flex-col overflow-hidden border-b">
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
                       className={`p-3 rounded-lg border cursor-pointer transition-all group relative ${currentSlideIndex === idx ? 'ring-2 ring-violet-500 bg-violet-50' : 'hover:bg-slate-50'}`}
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

            {/* Document Lists */}
            <div className={`flex flex-col ${mode === 'slides' ? 'h-1/3 border-t' : 'h-full'}`}>
              <div className="p-3 border-b bg-slate-50">
                <h3 className="font-semibold text-xs uppercase text-slate-500">Bozze</h3>
              </div>
              <div className="max-h-40 overflow-y-auto p-2 border-b">
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

              <div className="p-3 border-b bg-slate-50">
                <h3 className="font-semibold text-xs uppercase text-slate-500">Salvati</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {isLoadingDocs && <p className="text-xs text-center text-slate-400 py-4">Caricamento...</p>}
                {storedDocuments.map((doc) => (
                  <div 
                    key={doc.id}
                    onClick={() => loadDocument(doc)}
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
          </div>

          {/* Main Area */}
          <div className="flex-1 bg-slate-100 flex items-start justify-center p-8 relative overflow-y-auto" 
               onClick={() => setSelectedBlockId(null)} // Deselect block when clicking background
          > 
             
             {/* MODE: DOCUMENT */}
             {mode === 'document' && (
               <div
                 className="mb-20 print:shadow-none flex flex-col relative transition-all"
                 style={{
                   width: FORMAT_DIMENSIONS.a4.width,
                   minHeight: FORMAT_DIMENSIONS.a4.height,
                   transform: `scale(${docScale})`,
                   transformOrigin: 'top center',
                   backgroundImage: docView === 'edit'
                     ? `repeating-linear-gradient(to bottom, #ffffff 0, #ffffff ${FORMAT_DIMENSIONS.a4.height}px, #f1f5f9 ${FORMAT_DIMENSIONS.a4.height}px, #f1f5f9 ${FORMAT_DIMENSIONS.a4.height + DOC_PAGE_GAP}px)`
                     : undefined,
                   boxShadow: docView === 'edit' ? '0 10px 30px rgba(15, 23, 42, 0.12)' : undefined,
                   padding: docView === 'edit' ? `${docMargins.vertical}px ${docMargins.horizontal}px` : 0
                 }}
               >

                  {/* Rulers */}
                  <div className="absolute -top-8 left-0 right-0 flex justify-center">
                    <div className="flex items-center gap-2 bg-white/90 border border-slate-200 rounded-full px-3 py-1 shadow-sm">
                      <button
                        className="h-6 w-6 rounded-full hover:bg-slate-100 text-slate-600"
                        onClick={() => adjustMargins('horizontal', -8)}
                        title="Riduci margine orizzontale"
                      >
                        −
                      </button>
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">Orizz</span>
                      <button
                        className="h-6 w-6 rounded-full hover:bg-slate-100 text-slate-600"
                        onClick={() => adjustMargins('horizontal', 8)}
                        title="Aumenta margine orizzontale"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="absolute top-0 -left-8 bottom-0 flex items-center">
                    <div className="flex flex-col items-center gap-2 bg-white/90 border border-slate-200 rounded-full px-1 py-3 shadow-sm">
                      <button
                        className="h-6 w-6 rounded-full hover:bg-slate-100 text-slate-600"
                        onClick={() => adjustMargins('vertical', -8)}
                        title="Riduci margine verticale"
                      >
                        −
                      </button>
                      <span className="text-[10px] uppercase tracking-wide text-slate-500 [writing-mode:vertical-rl] rotate-180">Vert</span>
                      <button
                        className="h-6 w-6 rounded-full hover:bg-slate-100 text-slate-600"
                        onClick={() => adjustMargins('vertical', 8)}
                        title="Aumenta margine verticale"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {docView === 'edit' ? (
                    <>
                      {/* Visual Header Section */}
                      <div className="pb-4 flex items-center gap-6 border-b border-transparent hover:border-slate-100 transition-colors group/header">
                        {/* Logo Area */}
                        <div className="w-20 h-20 bg-slate-50 rounded-lg flex items-center justify-center cursor-pointer hover:bg-slate-100 relative overflow-hidden group/logo border border-dashed border-slate-300 hover:border-violet-400 transition-colors">
                          {document.header?.logoUrl ? (
                            <img src={document.header.logoUrl} className="w-full h-full object-contain" alt="Logo" />
                          ) : (
                            <div className="text-center p-1">
                              <Upload className="h-5 w-5 text-slate-400 mx-auto mb-1" />
                              <span className="text-[9px] text-slate-400 block uppercase">Logo</span>
                            </div>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={handleLogoUpload}
                          />
                          {document.header?.logoUrl && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/logo:opacity-100 transition-opacity">
                              <span className="text-white text-xs font-medium">Cambia</span>
                            </div>
                          )}
                        </div>
                        
                        {/* Title Area */}
                        <div className="flex-1">
                          <input
                            className="text-3xl font-bold w-full border-none focus:ring-0 placeholder:text-slate-300 px-0 text-slate-900"
                            placeholder="Titolo Intestazione"
                            value={document.header?.title || ''}
                            onChange={(e) => setDocument(d => ({ ...d, header: { ...d.header!, title: e.target.value } }))}
                          />
                          <input
                            className="text-base text-slate-500 w-full border-none focus:ring-0 placeholder:text-slate-300 px-0 mt-1"
                            placeholder="Sottotitolo o Dettagli..."
                            value={document.header?.subtitle || ''}
                            onChange={(e) => setDocument(d => ({ ...d, header: { ...d.header!, subtitle: e.target.value } }))}
                          />
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col">
                        <RichTextEditor
                          content={document.textContent || ''}
                          onChange={(html) => setDocument(d => ({ ...d, textContent: html }))}
                          onEditorReady={setEditor}
                          contentClassName="flex-1 prose max-w-none focus:outline-none min-h-[500px] p-0"
                        />
                      </div>
                    </>
                  ) : (
                    <PagedDocumentPreview
                      contentHtml={document.textContent || ''}
                      header={document.header}
                      margins={docMargins}
                      pageGap={DOC_PAGE_GAP}
                    />
                  )}
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
                 onClick={(e) => e.stopPropagation()} // Prevent deselection when clicking slide background
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

        {/* Publish Modal */}
        {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Pubblica {mode === 'slides' ? 'Presentazione' : 'Documento'}</h3>
            <p className="text-sm text-gray-600 mb-4">
              Salva questo contenuto come compito/materiale per una classe.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Seleziona Sessione:</label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full p-2 border rounded-md text-sm"
              >
                <option value="">-- Seleziona --</option>
                {classesData?.map((session: any) => (
                  <option key={session.id} value={session.id}>
                    {session.name} - {session.class_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPublishModal(false)}>Annulla</Button>
              <Button onClick={handlePublish} disabled={!selectedSessionId} className="bg-violet-600 text-white">
                Pubblica Ora
              </Button>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  )
}
