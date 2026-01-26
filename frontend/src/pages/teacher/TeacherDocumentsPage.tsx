import { useState, useRef, useEffect } from 'react'
import { TeacherNavbar } from '@/components/TeacherNavbar'
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

interface Document {
  id: string
  title: string
  format: Format
  slides: Slide[]
  textContent?: string
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

// Format dimensions
const FORMAT_DIMENSIONS = {
  '16:9': { width: 960, height: 540, label: '16:9 (Presentazione)' },
  '4:3': { width: 800, height: 600, label: '4:3 (Standard)' },
  'a4': { width: 794, height: 1123, label: 'A4 (Documento)' }
}

export default function TeacherDocumentsPage() {
  const { toast } = useToast()
  
  // State
  const [mode, setMode] = useState<EditorMode>('document') 
  const [document, setDocument] = useState<Document>({
    id: crypto.randomUUID(),
    title: 'Nuovo Documento',
    format: 'a4',
    slides: [
      { id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }
    ],
    textContent: '<h1>Titolo del documento</h1><p>Inizia a scrivere qui...</p>'
  })
  
  // Sidebar State
  const [showSidebar, setShowSidebar] = useState(true)
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([])
  const [isLoadingDocs, setIsLoadingDocs] = useState(false)

  // Editor State
  const [editor, setEditor] = useState<Editor | null>(null)
  
  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  
  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  
  // UI State
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState('')

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks.find(b => b.id === selectedBlockId)

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

  // Load document
  const loadDocument = (doc: StoredDocument) => {
    try {
      const content = JSON.parse(doc.contentJson)
      
      if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
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
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || ''
        })
      }
      
      toast({ title: "Documento caricato", description: `Hai aperto "${doc.title}"` })
    } catch (e) {
      console.error(e)
      toast({ title: "Errore caricamento", description: "Impossibile aprire questo documento.", variant: "destructive" })
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
  const switchMode = (newMode: EditorMode) => {
    setMode(newMode)
    if (newMode === 'document') {
      setDocument(d => ({ ...d, format: 'a4' }))
    } else {
      setDocument(d => ({ ...d, format: '16:9' }))
    }
  }

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
          htmlContent: document.textContent
        })
        taskType = 'lesson'
      }

      await teacherApi.createTask(selectedSessionId, {
        title: document.title,
        description: `Documento creato con Golinelli AI Editor (${mode === 'slides' ? 'Presentazione' : 'Testo'})`,
        task_type: taskType,
        content_json: contentJson
      })

      setShowPublishModal(false)
      toast({ title: "Documento pubblicato!", className: "bg-green-500 text-white" })
    } catch (e) {
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }

  return (
    <>
      <TeacherNavbar />
      <div className="pt-16 h-screen flex flex-col bg-slate-100 overflow-hidden"> 
        
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

             <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-md mr-2">
                <Button 
                  size="sm" 
                  variant={mode === 'document' ? 'secondary' : 'ghost'}
                  className={mode === 'document' ? 'shadow-sm bg-white' : ''}
                  onClick={() => switchMode('document')}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Doc
                </Button>
                <Button 
                  size="sm" 
                  variant={mode === 'slides' ? 'secondary' : 'ghost'}
                  className={mode === 'slides' ? 'shadow-sm bg-white' : ''}
                  onClick={() => switchMode('slides')}
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  Slide
                </Button>
             </div>

             <div className="h-6 w-px bg-slate-200" />

             <Input 
               value={document.title}
               onChange={(e) => setDocument(d => ({ ...d, title: e.target.value }))}
               className="font-bold border-transparent hover:border-slate-200 focus:border-violet-500 w-64 text-lg"
               placeholder="Titolo documento..."
             />
          </div>
          
          <div className="flex gap-2">
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
          scale={scale}
          setScale={setScale}
          onAddSlideBlock={addSlideBlock}
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

            {/* Document List */}
            <div className={`flex flex-col ${mode === 'slides' ? 'h-1/3 border-t' : 'h-full'}`}>
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
              <div className="p-3 border-t bg-slate-50">
                 <Button 
                   variant="outline" 
                   className="w-full text-xs"
                   onClick={() => {
                     setDocument({
                       id: crypto.randomUUID(),
                       title: 'Nuovo Documento',
                       format: 'a4',
                       slides: [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }],
                       textContent: '<h1>Titolo del documento</h1><p>Inizia a scrivere qui...</p>'
                     })
                     setMode('document')
                   }}
                 >
                   <Plus className="h-3 w-3 mr-2" />
                   Nuovo
                 </Button>
              </div>
            </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 bg-slate-100 flex items-start justify-center p-8 relative overflow-y-auto" 
               onClick={() => setSelectedBlockId(null)} // Deselect block when clicking background
          > 
             
             {/* MODE: DOCUMENT */}
             {mode === 'document' && (
               <div className="w-full max-w-[800px] h-[1100px] mb-20 print:shadow-none bg-white shadow-lg">
                  <RichTextEditor 
                    content={document.textContent || ''}
                    onChange={(html) => setDocument(d => ({ ...d, textContent: html }))}
                    onEditorReady={setEditor}
                  />
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